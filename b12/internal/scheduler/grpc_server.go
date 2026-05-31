package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"time"

	"dtsplatform/api/proto"
	"dtsplatform/internal/config"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

type GRPCServer struct {
	scheduler.UnimplementedSchedulerServiceServer
	cfg       *config.Config
	scheduler *Scheduler
	server    *grpc.Server
}

func NewGRPCServer(cfg *config.Config, scheduler *Scheduler) *GRPCServer {
	return &GRPCServer{
		cfg:       cfg,
		scheduler: scheduler,
	}
}

func (gs *GRPCServer) Start(ctx context.Context) error {
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", gs.cfg.Scheduler.Port))
	if err != nil {
		return fmt.Errorf("failed to listen: %w", err)
	}

	gs.server = grpc.NewServer()
	scheduler.RegisterSchedulerServiceServer(gs.server, gs)
	reflection.Register(gs.server)

	log.Printf("Scheduler gRPC server listening on :%d", gs.cfg.Scheduler.Port)

	go func() {
		<-ctx.Done()
		gs.Stop()
	}()

	if err := gs.server.Serve(lis); err != nil {
		log.Printf("gRPC server stopped: %v", err)
	}
	return nil
}

func (gs *GRPCServer) Stop() {
	if gs.server != nil {
		gs.server.GracefulStop()
	}
}

func (gs *GRPCServer) RegisterExecutor(ctx context.Context, req *scheduler.RegisterExecutorRequest) (*scheduler.RegisterExecutorResponse, error) {
	info := &ExecutorInfo{
		ID:             req.ExecutorId,
		Address:        req.Address,
		MaxTasks:       int(req.MaxTasks),
		SupportedTypes: req.SupportedTypes,
		CurrentLoad:    0,
		LastHeartbeat:  time.Now(),
	}

	if err := gs.scheduler.RegisterExecutor(info); err != nil {
		return &scheduler.RegisterExecutorResponse{
			Success: false,
			Message: err.Error(),
		}, err
	}

	return &scheduler.RegisterExecutorResponse{
		Success: true,
		Message: "registered successfully",
	}, nil
}

func (gs *GRPCServer) Heartbeat(ctx context.Context, req *scheduler.HeartbeatRequest) (*scheduler.HeartbeatResponse, error) {
	if err := gs.scheduler.UpdateExecutorHeartbeat(req.ExecutorId, int(req.CurrentLoad)); err != nil {
		return &scheduler.HeartbeatResponse{
			Alive: false,
		}, err
	}

	return &scheduler.HeartbeatResponse{
		Alive: true,
	}, nil
}

func (gs *GRPCServer) GetTask(ctx context.Context, req *scheduler.GetTaskRequest) (*scheduler.GetTaskResponse, error) {
	return &scheduler.GetTaskResponse{
		HasTask: false,
	}, nil
}

func (gs *GRPCServer) UpdateTaskStatus(ctx context.Context, req *scheduler.UpdateTaskStatusRequest) (*scheduler.UpdateTaskStatusResponse, error) {
	statusData := map[string]any{
		"status":  req.Status.String(),
		"message": req.Message,
		"start":   req.StartTime,
		"end":     req.EndTime,
	}
	if err := gs.scheduler.etcd.UpdateTaskStatus(ctx, req.TaskId, statusData); err != nil {
		return &scheduler.UpdateTaskStatusResponse{
			Success: false,
		}, err
	}
	log.Printf("Task %s status update: %s - %s", req.TaskId, req.Status, req.Message)
	return &scheduler.UpdateTaskStatusResponse{
		Success: true,
	}, nil
}

func (gs *GRPCServer) SubmitTaskLog(ctx context.Context, req *scheduler.SubmitTaskLogRequest) (*scheduler.SubmitTaskLogResponse, error) {
	data, _ := json.Marshal(map[string]any{
		"task_id":     req.TaskId,
		"log":         string(req.LogData),
		"is_complete": req.IsComplete,
		"timestamp":   time.Now().Unix(),
	})
	if err := gs.scheduler.etcd.UpdateTaskStatus(ctx, req.TaskId+"/log", data); err != nil {
		return &scheduler.SubmitTaskLogResponse{
			Success: false,
		}, err
	}
	return &scheduler.SubmitTaskLogResponse{
		Success: true,
	}, nil
}
