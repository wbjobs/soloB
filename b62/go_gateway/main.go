package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	pb "go_gateway/proto"
)

const (
	ChunkSize        = 5 * 1024 * 1024
	MaxConcurrent    = 5
	UploadsDir       = "uploads"
	ChunksDir        = "uploads/chunks"
	OutputsDir       = "outputs"
	StateFile        = "uploads/state.json"
)

type FilterConfig struct {
	FilterType string  `json:"filter_type"`
	Intensity  float32 `json:"intensity"`
}

type ChunkUploadState struct {
	ChunkIndex int32 `json:"chunk_index"`
	Uploaded   bool  `json:"uploaded"`
	Size       int64 `json:"size"`
	Path       string `json:"path"`
}

type UploadSession struct {
	UploadID       string              `json:"upload_id"`
	FileName       string              `json:"file_name"`
	FileSize       int64               `json:"file_size"`
	TotalChunks    int32               `json:"total_chunks"`
	FileHash       string              `json:"file_hash"`
	Filters        []FilterConfig      `json:"filters"`
	Chunks         map[int32]*ChunkUploadState `json:"chunks"`
	CreatedAt      time.Time           `json:"created_at"`
	UpdatedAt      time.Time           `json:"updated_at"`
	Status         string              `json:"status"`
	VideoID        string              `json:"video_id"`
	ProcessingProgress float32         `json:"processing_progress"`
}

type UploadSessionManager struct {
	sessions map[string]*UploadSession
	mu       sync.RWMutex
}

func NewUploadSessionManager() *UploadSessionManager {
	os.MkdirAll(ChunksDir, 0755)
	os.MkdirAll(OutputsDir, 0755)

	manager := &UploadSessionManager{
		sessions: make(map[string]*UploadSession),
	}
	manager.loadState()
	go manager.periodicSaveState()
	return manager
}

func (usm *UploadSessionManager) loadState() {
	if _, err := os.Stat(StateFile); os.IsNotExist(err) {
		return
	}

	data, err := os.ReadFile(StateFile)
	if err != nil {
		log.Printf("Failed to load state: %v", err)
		return
	}

	var sessions map[string]*UploadSession
	if err := json.Unmarshal(data, &sessions); err != nil {
		log.Printf("Failed to parse state: %v", err)
		return
	}

	usm.mu.Lock()
	usm.sessions = sessions
	usm.mu.Unlock()
}

func (usm *UploadSessionManager) saveState() {
	usm.mu.RLock()
	data, err := json.MarshalIndent(usm.sessions, "", "  ")
	usm.mu.RUnlock()

	if err != nil {
		log.Printf("Failed to marshal state: %v", err)
		return
	}

	if err := os.WriteFile(StateFile, data, 0644); err != nil {
		log.Printf("Failed to save state: %v", err)
	}
}

func (usm *UploadSessionManager) periodicSaveState() {
	ticker := time.NewTicker(30 * time.Second)
	for range ticker.C {
		usm.saveState()
	}
}

func (usm *UploadSessionManager) CreateSession(
	fileName string,
	fileSize int64,
	totalChunks int32,
	fileHash string,
	filters []FilterConfig,
) string {
	uploadID := generateUploadID(fileName, fileHash)

	usm.mu.Lock()
	defer usm.mu.Unlock()

	if existing, exists := usm.sessions[uploadID]; exists {
		return uploadID
	}

	chunks := make(map[int32]*ChunkUploadState)
	for i := int32(0); i < totalChunks; i++ {
		chunks[i] = &ChunkUploadState{
			ChunkIndex: i,
			Uploaded:   false,
			Size:       0,
		}
	}

	session := &UploadSession{
		UploadID:    uploadID,
		FileName:    fileName,
		FileSize:    fileSize,
		TotalChunks: totalChunks,
		FileHash:    fileHash,
		Filters:     filters,
		Chunks:      chunks,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		Status:      "uploading",
	}

	usm.sessions[uploadID] = session
	usm.saveState()

	return uploadID
}

func (usm *UploadSessionManager) GetSession(uploadID string) (*UploadSession, bool) {
	usm.mu.RLock()
	defer usm.mu.RUnlock()
	session, exists := usm.sessions[uploadID]
	return session, exists
}

func (usm *UploadSessionManager) UploadChunk(
	uploadID string,
	chunkIndex int32,
	chunkData []byte,
) error {
	usm.mu.Lock()
	session, exists := usm.sessions[uploadID]
	usm.mu.Unlock()

	if !exists {
		return fmt.Errorf("session not found: %s", uploadID)
	}

	chunkPath := filepath.Join(ChunksDir, fmt.Sprintf("%s_%d.chunk", uploadID, chunkIndex))

	if err := os.WriteFile(chunkPath, chunkData, 0644); err != nil {
		return fmt.Errorf("failed to write chunk: %w", err)
	}

	usm.mu.Lock()
	if chunk, exists := session.Chunks[chunkIndex]; exists {
		chunk.Uploaded = true
		chunk.Size = int64(len(chunkData))
		chunk.Path = chunkPath
	}
	session.UpdatedAt = time.Now()
	usm.mu.Unlock()

	usm.saveState()
	return nil
}

func (usm *UploadSessionManager) GetUploadedChunks(uploadID string) []int32 {
	usm.mu.RLock()
	defer usm.mu.RUnlock()

	session, exists := usm.sessions[uploadID]
	if !exists {
		return nil
	}

	var uploaded []int32
	for idx, chunk := range session.Chunks {
		if chunk.Uploaded {
			uploaded = append(uploaded, idx)
		}
	}
	sort.Slice(uploaded, func(i, j int) bool { return uploaded[i] < uploaded[j] })
	return uploaded
}

func (usm *UploadSessionManager) IsComplete(uploadID string) bool {
	usm.mu.RLock()
	defer usm.mu.RUnlock()

	session, exists := usm.sessions[uploadID]
	if !exists {
		return false
	}

	for _, chunk := range session.Chunks {
		if !chunk.Uploaded {
			return false
		}
	}
	return true
}

func (usm *UploadSessionManager) MergeChunks(uploadID string) (string, error) {
	usm.mu.Lock()
	session, exists := usm.sessions[uploadID]
	usm.mu.Unlock()

	if !exists {
		return "", fmt.Errorf("session not found")
	}

	outputPath := filepath.Join(UploadsDir, fmt.Sprintf("%s_merged.mp4", uploadID))
	outputFile, err := os.Create(outputPath)
	if err != nil {
		return "", fmt.Errorf("failed to create output file: %w", err)
	}
	defer outputFile.Close()

	var chunkIndices []int32
	for idx := range session.Chunks {
		chunkIndices = append(chunkIndices, idx)
	}
	sort.Slice(chunkIndices, func(i, j int) bool { return chunkIndices[i] < chunkIndices[j] })

	for _, idx := range chunkIndices {
		chunk := session.Chunks[idx]
		if !chunk.Uploaded {
			return "", fmt.Errorf("chunk %d not uploaded", idx)
		}

		chunkData, err := os.ReadFile(chunk.Path)
		if err != nil {
			return "", fmt.Errorf("failed to read chunk %d: %w", idx, err)
		}

		if _, err := outputFile.Write(chunkData); err != nil {
			return "", fmt.Errorf("failed to write chunk %d: %w", idx, err)
		}
	}

	usm.mu.Lock()
	session.Status = "merging"
	session.UpdatedAt = time.Now()
	usm.mu.Unlock()

	return outputPath, nil
}

func (usm *UploadSessionManager) GetProgress(uploadID string) (uploadedCount int32, totalCount int32, progress float32) {
	usm.mu.RLock()
	defer usm.mu.RUnlock()

	session, exists := usm.sessions[uploadID]
	if !exists {
		return 0, 0, 0
	}

	uploaded := int32(0)
	for _, chunk := range session.Chunks {
		if chunk.Uploaded {
			uploaded++
		}
	}

	progress = float32(uploaded) / float32(session.TotalChunks) * 100
	return uploaded, session.TotalChunks, progress
}

func (usm *UploadSessionManager) SetProcessingProgress(uploadID string, progress float32) {
	usm.mu.Lock()
	defer usm.mu.Unlock()

	if session, exists := usm.sessions[uploadID]; exists {
		session.ProcessingProgress = progress
		session.UpdatedAt = time.Now()
	}
}

func (usm *UploadSessionManager) SetVideoID(uploadID string, videoID string) {
	usm.mu.Lock()
	defer usm.mu.Unlock()

	if session, exists := usm.sessions[uploadID]; exists {
		session.VideoID = videoID
		session.Status = "processing"
		session.UpdatedAt = time.Now()
	}
}

func (usm *UploadSessionManager) SetComplete(uploadID string, videoID string) {
	usm.mu.Lock()
	defer usm.mu.Unlock()

	if session, exists := usm.sessions[uploadID]; exists {
		session.VideoID = videoID
		session.Status = "completed"
		session.ProcessingProgress = 100
		session.UpdatedAt = time.Now()
	}
}

func (usm *UploadSessionManager) CleanupChunks(uploadID string) {
	usm.mu.Lock()
	session, exists := usm.sessions[uploadID]
	usm.mu.Unlock()

	if !exists {
		return
	}

	for _, chunk := range session.Chunks {
		if chunk.Path != "" {
			os.Remove(chunk.Path)
		}
	}
}

func generateUploadID(fileName, fileHash string) string {
	h := sha256.New()
	h.Write([]byte(fileName))
	h.Write([]byte(fileHash))
	h.Write([]byte(time.Now().Format(time.RFC3339)))
	return hex.EncodeToString(h.Sum(nil))[:16]
}

type ProcessingTask struct {
	VideoID       string
	InputPath     string
	OutputPath    string
	Filters       []FilterConfig
	Progress      float32
	CurrentFrame  int32
	TotalFrames   int32
	Status        string
	ResultData    []byte
	Completed     bool
	Error         error
}

type ProcessingManager struct {
	tasks map[string]*ProcessingTask
	mu    sync.RWMutex
}

func NewProcessingManager() *ProcessingManager {
	return &ProcessingManager{
		tasks: make(map[string]*ProcessingTask),
	}
}

func (pm *ProcessingManager) AddTask(task *ProcessingTask) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.tasks[task.VideoID] = task
}

func (pm *ProcessingManager) GetTask(videoID string) (*ProcessingTask, bool) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	task, exists := pm.tasks[videoID]
	return task, exists
}

func (pm *ProcessingManager) UpdateProgress(videoID string, current, total int32) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if task, exists := pm.tasks[videoID]; exists {
		task.CurrentFrame = current
		task.TotalFrames = total
		if total > 0 {
			task.Progress = float32(current) / float32(total) * 100
		}
	}
}

func (pm *ProcessingManager) CompleteTask(videoID string, result []byte, err error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if task, exists := pm.tasks[videoID]; exists {
		task.Completed = true
		task.ResultData = result
		task.Error = err
		if err != nil {
			task.Status = "failed"
		} else {
			task.Status = "completed"
		}
	}
}

type videoServer struct {
	pb.UnimplementedVideoServiceServer
	uploadManager   *UploadSessionManager
	processingManager *ProcessingManager
}

func (s *videoServer) InitUpload(ctx context.Context, req *pb.UploadInitRequest) (*pb.UploadInitResponse, error) {
	var filters []FilterConfig
	for _, f := range req.GetFilters() {
		filters = append(filters, FilterConfig{
			FilterType: f.GetFilterType(),
			Intensity:  f.GetIntensity(),
		})
	}

	uploadID := s.uploadManager.CreateSession(
		req.GetFileName(),
		req.GetFileSize(),
		req.GetTotalChunks(),
		req.GetFileHash(),
		filters,
	)

	uploadedChunks := s.uploadManager.GetUploadedChunks(uploadID)
	canResume := len(uploadedChunks) > 0 && len(uploadedChunks) < int(req.GetTotalChunks())

	return &pb.UploadInitResponse{
		UploadId:       uploadID,
		CanResume:      canResume,
		UploadedChunks: uploadedChunks,
		Message:        "Upload initialized",
	}, nil
}

func (s *videoServer) UploadChunk(stream pb.VideoService_UploadChunkServer) error {
	for {
		chunk, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		err = s.uploadManager.UploadChunk(
			chunk.GetUploadId(),
			chunk.GetChunkIndex(),
			chunk.GetChunkData(),
		)

		response := &pb.ChunkUploadResponse{
			UploadId:    chunk.GetUploadId(),
			ChunkIndex:  chunk.GetChunkIndex(),
			Success:     err == nil,
			ReceivedSize: chunk.GetChunkSize(),
		}

		if err != nil {
			response.Message = err.Error()
		} else {
			response.Message = "Chunk uploaded"
		}

		if err := stream.Send(response); err != nil {
			return err
		}
	}
}

func (s *videoServer) GetUploadStatus(ctx context.Context, req *pb.UploadStatusRequest) (*pb.UploadStatusResponse, error) {
	uploadID := req.GetUploadId()
	uploaded, total, progress := s.uploadManager.GetProgress(uploadID)

	session, exists := s.uploadManager.GetSession(uploadID)
	if !exists {
		return &pb.UploadStatusResponse{
			UploadId: uploadID,
			Status:   "not_found",
		}, nil
	}

	return &pb.UploadStatusResponse{
		UploadId:          uploadID,
		UploadedChunks:    uploaded,
		TotalChunks:       total,
		UploadProgress:    progress,
		Status:            session.Status,
		Completed:         session.Status == "completed",
		VideoId:           session.VideoID,
		ProcessingProgress: session.ProcessingProgress,
	}, nil
}

func (s *videoServer) CompleteUpload(ctx context.Context, req *pb.CompleteUploadRequest) (*pb.CompleteUploadResponse, error) {
	uploadID := req.GetUploadId()

	if !s.uploadManager.IsComplete(uploadID) {
		return &pb.CompleteUploadResponse{
			UploadId: uploadID,
			Success:  false,
			Message:  "Not all chunks uploaded",
		}, nil
	}

	mergedPath, err := s.uploadManager.MergeChunks(uploadID)
	if err != nil {
		return &pb.CompleteUploadResponse{
			UploadId: uploadID,
			Success:  false,
			Message:  err.Error(),
		}, nil
	}

	videoID := fmt.Sprintf("video_%s", uploadID[:8])
	s.uploadManager.SetVideoID(uploadID, videoID)

	session, _ := s.uploadManager.GetSession(uploadID)

	task := &ProcessingTask{
		VideoID:   videoID,
		InputPath: mergedPath,
		Filters:   session.Filters,
		Status:    "processing",
	}
	s.processingManager.AddTask(task)

	go s.simulateProcessing(uploadID, videoID, mergedPath, session.Filters)

	go func() {
		time.Sleep(1 * time.Second)
		s.uploadManager.CleanupChunks(uploadID)
	}()

	return &pb.CompleteUploadResponse{
		UploadId: uploadID,
		VideoId:  videoID,
		Success:  true,
		Message:  "Upload completed, processing started",
	}, nil
}

func (s *videoServer) simulateProcessing(uploadID, videoID, inputPath string, filters []FilterConfig) {
	totalFrames := int32(100)
	for i := int32(1); i <= totalFrames; i++ {
		s.processingManager.UpdateProgress(videoID, i, totalFrames)
		s.uploadManager.SetProcessingProgress(uploadID, float32(i)/float32(totalFrames)*100)
		time.Sleep(50 * time.Millisecond)
	}

	var result []byte
	if info, err := os.Stat(inputPath); err == nil && info.Size() > 0 {
		result, _ = os.ReadFile(inputPath)
	} else {
		result = []byte("mock_processed_video_data")
	}

	s.processingManager.CompleteTask(videoID, result, nil)
	s.uploadManager.SetComplete(uploadID, videoID)
}

func (s *videoServer) ProcessVideo(req *pb.ProcessVideoRequest, stream pb.VideoService_ProcessVideoServer) error {
	videoID := req.GetVideoId()
	if videoID == "" {
		videoID = fmt.Sprintf("video_%d", time.Now().UnixNano())
	}

	var filters []FilterConfig
	for _, f := range req.GetFilters() {
		filters = append(filters, FilterConfig{
			FilterType: f.GetFilterType(),
			Intensity:  f.GetIntensity(),
		})
	}

	inputPath := filepath.Join(UploadsDir, videoID+"_input.mp4")

	os.MkdirAll(UploadsDir, 0755)
	os.MkdirAll(OutputsDir, 0755)

	if len(req.GetVideoData()) > 0 {
		if err := os.WriteFile(inputPath, req.GetVideoData(), 0644); err != nil {
			return err
		}
	}

	task := &ProcessingTask{
		VideoID:   videoID,
		InputPath: inputPath,
		Filters:   filters,
		Status:    "processing",
	}
	s.processingManager.AddTask(task)

	totalFrames := int32(100)
	for i := int32(1); i <= totalFrames; i++ {
		s.processingManager.UpdateProgress(videoID, i, totalFrames)

		progress := &pb.ProcessProgress{
			VideoId:         videoID,
			CurrentFrame:    i,
			TotalFrames:     totalFrames,
			ProgressPercent: float32(i) / float32(totalFrames) * 100,
		}

		if err := stream.Send(progress); err != nil {
			return err
		}

		time.Sleep(50 * time.Millisecond)
	}

	var mockResult []byte
	if info, err := os.Stat(inputPath); err == nil && info.Size() > 0 {
		mockResult, _ = os.ReadFile(inputPath)
	} else {
		mockResult = []byte("mock_processed_video_data")
	}

	s.processingManager.CompleteTask(videoID, mockResult, nil)
	return nil
}

func (s *videoServer) GetProcessedVideo(ctx context.Context, req *pb.ProcessVideoRequest) (*pb.ProcessVideoResponse, error) {
	videoID := req.GetVideoId()
	task, exists := s.processingManager.GetTask(videoID)

	if !exists {
		return &pb.ProcessVideoResponse{
			VideoId: videoID,
			Success: false,
			Message: "Task not found",
		}, nil
	}

	if !task.Completed {
		return &pb.ProcessVideoResponse{
			VideoId: videoID,
			Success: false,
			Message: "Task not completed yet",
		}, nil
	}

	if task.Error != nil {
		return &pb.ProcessVideoResponse{
			VideoId: videoID,
			Success: false,
			Message: task.Error.Error(),
		}, nil
	}

	return &pb.ProcessVideoResponse{
		VideoId:        videoID,
		ProcessedVideo: task.ResultData,
		Success:        true,
		Message:        "Success",
	}, nil
}

func (s *videoServer) ListFilters(ctx context.Context, req *pb.ListFiltersRequest) (*pb.ListFiltersResponse, error) {
	return &pb.ListFiltersResponse{
		FilterNames: []string{"grayscale", "vintage", "contrast"},
	}, nil
}

type APIGateway struct {
	grpcConn          *grpc.ClientConn
	grpcClient        pb.VideoServiceClient
	processingManager *ProcessingManager
	uploadManager     *UploadSessionManager
}

func NewAPIGateway(grpcAddr string) (*APIGateway, error) {
	conn, err := grpc.Dial(grpcAddr, grpc.WithInsecure())
	if err != nil {
		return nil, err
	}

	uploadManager := NewUploadSessionManager()

	return &APIGateway{
		grpcConn:          conn,
		grpcClient:        pb.NewVideoServiceClient(conn),
		processingManager: NewProcessingManager(),
		uploadManager:     uploadManager,
	}, nil
}

func (gw *APIGateway) Close() {
	if gw.grpcConn != nil {
		gw.grpcConn.Close()
	}
}

func (gw *APIGateway) InitUpload(c *gin.Context) {
	var req struct {
		FileName    string         `json:"file_name"`
		FileSize    int64          `json:"file_size"`
		TotalChunks int32          `json:"total_chunks"`
		FileHash    string         `json:"file_hash"`
		Filters     []FilterConfig `json:"filters"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	grpcFilters := make([]*pb.FilterConfig, 0, len(req.Filters))
	for _, f := range req.Filters {
		grpcFilters = append(grpcFilters, &pb.FilterConfig{
			FilterType: f.FilterType,
			Intensity:  f.Intensity,
		})
	}

	grpcReq := &pb.UploadInitRequest{
		FileName:    req.FileName,
		FileSize:    req.FileSize,
		TotalChunks: req.TotalChunks,
		FileHash:    req.FileHash,
		Filters:     grpcFilters,
	}

	resp, err := gw.grpcClient.InitUpload(context.Background(), grpcReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"upload_id":       resp.GetUploadId(),
		"can_resume":      resp.GetCanResume(),
		"uploaded_chunks": resp.GetUploadedChunks(),
		"message":         resp.GetMessage(),
	})
}

func (gw *APIGateway) UploadChunk(c *gin.Context) {
	uploadID := c.PostForm("upload_id")
	chunkIndexStr := c.PostForm("chunk_index")
	totalChunksStr := c.PostForm("total_chunks")
	chunkSizeStr := c.PostForm("chunk_size")
	fileName := c.PostForm("file_name")
	fileHash := c.PostForm("file_hash")

	chunkIndex, _ := strconv.Atoi(chunkIndexStr)
	totalChunks, _ := strconv.Atoi(totalChunksStr)
	chunkSize, _ := strconv.ParseInt(chunkSizeStr, 10, 64)

	file, _, err := c.Request.FormFile("chunk")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No chunk file provided"})
		return
	}
	defer file.Close()

	chunkData, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read chunk"})
		return
	}

	err = gw.uploadManager.UploadChunk(uploadID, int32(chunkIndex), chunkData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	uploaded, total, progress := gw.uploadManager.GetProgress(uploadID)

	c.JSON(http.StatusOK, gin.H{
		"upload_id":      uploadID,
		"chunk_index":    chunkIndex,
		"total_chunks":   totalChunks,
		"chunk_size":     chunkSize,
		"file_name":      fileName,
		"file_hash":      fileHash,
		"received_size":  len(chunkData),
		"uploaded_count": uploaded,
		"total_count":    total,
		"progress":       progress,
		"success":        true,
	})
}

func (gw *APIGateway) CompleteUpload(c *gin.Context) {
	var req struct {
		UploadID string `json:"upload_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !gw.uploadManager.IsComplete(req.UploadID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Not all chunks uploaded"})
		return
	}

	grpcReq := &pb.CompleteUploadRequest{
		UploadId: req.UploadID,
	}

	resp, err := gw.grpcClient.CompleteUpload(context.Background(), grpcReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"upload_id": resp.GetUploadId(),
		"video_id":  resp.GetVideoId(),
		"success":   resp.GetSuccess(),
		"message":   resp.GetMessage(),
	})
}

func (gw *APIGateway) GetUploadStatus(c *gin.Context) {
	uploadID := c.Param("id")

	grpcReq := &pb.UploadStatusRequest{
		UploadId: uploadID,
	}

	resp, err := gw.grpcClient.GetUploadStatus(context.Background(), grpcReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"upload_id":           resp.GetUploadId(),
		"uploaded_chunks":     resp.GetUploadedChunks(),
		"total_chunks":        resp.GetTotalChunks(),
		"upload_progress":     resp.GetUploadProgress(),
		"status":              resp.GetStatus(),
		"completed":           resp.GetCompleted(),
		"video_id":            resp.GetVideoId(),
		"processing_progress": resp.GetProcessingProgress(),
	})
}

func (gw *APIGateway) UploadVideo(c *gin.Context) {
	file, header, err := c.Request.FormFile("video")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No video file provided"})
		return
	}
	defer file.Close()

	videoID := fmt.Sprintf("video_%d", time.Now().UnixNano())
	filtersJSON := c.PostForm("filters")

	var filters []FilterConfig
	if filtersJSON != "" {
		if err := json.Unmarshal([]byte(filtersJSON), &filters); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid filters format"})
			return
		}
	}

	videoData, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read video"})
		return
	}

	grpcFilters := make([]*pb.FilterConfig, 0, len(filters))
	for _, f := range filters {
		grpcFilters = append(grpcFilters, &pb.FilterConfig{
			FilterType: f.FilterType,
			Intensity:  f.Intensity,
		})
	}

	grpcReq := &pb.ProcessVideoRequest{
		VideoId:   videoID,
		VideoData: videoData,
		Filters:   grpcFilters,
	}

	stream, err := gw.grpcClient.ProcessVideo(context.Background(), grpcReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	go func() {
		for {
			progress, err := stream.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("Stream error: %v", err)
				break
			}
			gw.processingManager.UpdateProgress(
				videoID,
				progress.GetCurrentFrame(),
				progress.GetTotalFrames(),
			)
		}

		result, err := gw.grpcClient.GetProcessedVideo(context.Background(), &pb.ProcessVideoRequest{
			VideoId: videoID,
		})
		if err == nil && result.GetSuccess() {
			gw.processingManager.CompleteTask(videoID, result.GetProcessedVideo(), nil)
		} else if err != nil {
			gw.processingManager.CompleteTask(videoID, nil, err)
		} else {
			gw.processingManager.CompleteTask(videoID, nil, fmt.Errorf(result.GetMessage()))
		}
	}()

	task := &ProcessingTask{
		VideoID:   videoID,
		InputPath: header.Filename,
		Filters:   filters,
		Status:    "processing",
	}
	gw.processingManager.AddTask(task)

	c.JSON(http.StatusOK, gin.H{
		"video_id": videoID,
		"filename": header.Filename,
		"status":   "processing",
		"progress": 0,
	})
}

func (gw *APIGateway) GetProgress(c *gin.Context) {
	videoID := c.Param("id")
	task, exists := gw.processingManager.GetTask(videoID)

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"video_id":      task.VideoID,
		"progress":      task.Progress,
		"current_frame": task.CurrentFrame,
		"total_frames":  task.TotalFrames,
		"status":        task.Status,
		"completed":     task.Completed,
	})
}

func (gw *APIGateway) DownloadVideo(c *gin.Context) {
	videoID := c.Param("id")
	task, exists := gw.processingManager.GetTask(videoID)

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	if !task.Completed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Task not completed"})
		return
	}

	if task.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": task.Error.Error()})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s_processed.mp4", videoID))
	c.Data(http.StatusOK, "video/mp4", task.ResultData)
}

func (gw *APIGateway) ListFilters(c *gin.Context) {
	resp, err := gw.grpcClient.ListFilters(context.Background(), &pb.ListFiltersRequest{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"filters": resp.GetFilterNames(),
	})
}

func (gw *APIGateway) SetupRoutes(r *gin.Engine) {
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	api := r.Group("/api")
	{
		api.POST("/upload/init", gw.InitUpload)
		api.POST("/upload/chunk", gw.UploadChunk)
		api.POST("/upload/complete", gw.CompleteUpload)
		api.GET("/upload/status/:id", gw.GetUploadStatus)

		api.POST("/upload", gw.UploadVideo)
		api.GET("/progress/:id", gw.GetProgress)
		api.GET("/download/:id", gw.DownloadVideo)
		api.GET("/filters", gw.ListFilters)
	}

	r.StaticFS("/static", http.Dir("./web"))
}

func main() {
	grpcPort := ":50051"
	httpPort := ":8080"

	lis, err := net.Listen("tcp", grpcPort)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	grpcServer := grpc.NewServer()
	videoSrv := &videoServer{
		uploadManager:     NewUploadSessionManager(),
		processingManager: NewProcessingManager(),
	}
	pb.RegisterVideoServiceServer(grpcServer, videoSrv)
	reflection.Register(grpcServer)

	go func() {
		log.Printf("gRPC server listening on %s", grpcPort)
		if err := grpcServer.Serve(lis); err != nil {
			log.Fatalf("Failed to serve gRPC: %v", err)
		}
	}()

	time.Sleep(100 * time.Millisecond)

	gw, err := NewAPIGateway("localhost" + grpcPort)
	if err != nil {
		log.Fatalf("Failed to create API gateway: %v", err)
	}
	defer gw.Close()

	r := gin.Default()
	gw.SetupRoutes(r)

	log.Printf("HTTP/REST API gateway listening on %s", httpPort)
	if err := r.Run(httpPort); err != nil {
		log.Fatalf("Failed to run HTTP server: %v", err)
	}
}
