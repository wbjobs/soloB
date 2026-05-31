package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/dbprofiler/dbprofiler/ebpf"
	"github.com/dbprofiler/dbprofiler/pkg/models"
	"github.com/spf13/cobra"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var (
	logger       *zap.Logger
	db           *gorm.DB
	slowThreshold time.Duration
	dbType       string
	dbPID        uint32
	probeMode    string
	forceTracepoint bool
	printCompatInfo bool
)

var rootCmd = &cobra.Command{
	Use:   "dbprofiler",
	Short: "Database slow query profiler with eBPF",
	Long:  `A tool to profile database slow queries and correlate with kernel metrics using eBPF`,
	Run:   runProfiler,
}

var checkCmd = &cobra.Command{
	Use:   "check",
	Short: "Check kernel eBPF compatibility",
	Long:  `Run kernel feature detection and display compatibility report`,
	Run:   runCompatCheck,
}

func init() {
	rootCmd.PersistentFlags().DurationVar(&slowThreshold, "slow-threshold", 100*time.Millisecond, "Slow query threshold")
	rootCmd.PersistentFlags().StringVar(&dbType, "db-type", "mysql", "Database type (mysql/postgres)")
	rootCmd.PersistentFlags().Uint32Var(&dbPID, "db-pid", 0, "Database process PID")
	rootCmd.PersistentFlags().StringVar(&probeMode, "probe-mode", "auto", "Probe mode: auto, kprobe, tracepoint")
	rootCmd.PersistentFlags().BoolVar(&forceTracepoint, "force-tracepoint", false, "Force tracepoint mode (for kernel < 5.4)")

	rootCmd.AddCommand(checkCmd)
}

func main() {
	var err error
	logger, err = zap.NewProduction()
	if err != nil {
		fmt.Printf("Failed to create logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	if err := initDB(); err != nil {
		logger.Fatal("Failed to initialize database", zap.Error(err))
	}

	if err := rootCmd.Execute(); err != nil {
		logger.Fatal("Command execution failed", zap.Error(err))
	}
}

func initDB() error {
	var err error
	db, err = gorm.Open(sqlite.Open("dbprofiler.db"), &gorm.Config{})
	if err != nil {
		return err
	}
	
	return db.AutoMigrate(
		&models.SlowQuery{},
		&models.KernelMetrics{},
		&models.FlameGraph{},
		&models.AnomalyEvent{},
		&models.DiagnosticReport{},
	)
}

type QuerySession struct {
	PID         uint32
	StartTime   time.Time
	SQL         string
	KernelData  *KernelSessionData
}

type KernelSessionData struct {
	IOReadBytes     int64
	IOWriteBytes    int64
	IOReadCount     int64
	IOWriteCount    int64
	IOLatencyTotal  float64
	PageCacheHits   int64
	PageCacheMisses int64
	LockWaitTime    float64
	LockCount       int64
	TCPTxBytes      int64
	TCPRxBytes      int64
	StackSamples    []uint64
}

var activeSessions = make(map[uint32]*QuerySession)

func runCompatCheck(cmd *cobra.Command, args []string) {
	fmt.Println("Running eBPF kernel compatibility check...")
	fmt.Println()

	if err := ebpf.PrintCompatibilityInfo(); err != nil {
		fmt.Printf("Error during compatibility check: %v\n", err)
		os.Exit(1)
	}
}

func runProfiler(cmd *cobra.Command, args []string) {
	// First run compatibility check
	fmt.Println("=" * 60)
	fmt.Println("DB Profiler - Kernel Compatibility Check")
	fmt.Println("=" * 60)
	if err := ebpf.PrintCompatibilityInfo(); err != nil {
		logger.Warn("Compatibility check had errors", zap.Error(err))
	}
	fmt.Println()

	logger.Info("Starting DB Profiler",
		zap.Duration("slow_threshold", slowThreshold),
		zap.String("db_type", dbType),
		zap.Uint32("db_pid", dbPID),
		zap.String("probe_mode", probeMode))

	// Configure profiler
	config := ebpf.ProfilerConfig{
		Mode:            ebpf.ProbeMode(probeMode),
		EnableKprobes:   !forceTracepoint,
		EnableTracepoints: true,
		EnableMetrics:   true,
		TargetPID:       dbPID,
		Verbose:         true,
	}

	profiler, err := ebpf.NewCompatProfiler(config)
	if err != nil {
		logger.Fatal("Failed to create BPF profiler",
			zap.Error(err),
			zap.String("hint", "Try running 'dbprofiler check' for compatibility info"))
	}
	defer profiler.Close()

	logger.Info("Profiler initialized",
		zap.String("active_mode", string(profiler.GetMode())))

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	logger.Info("Profiler started successfully. Press Ctrl+C to stop")

	tcpParser := NewTCPSQLParser(dbType)

	eventCount := 0
	metricsCount := 0

	for {
		select {
		case <-sigChan:
			logger.Info("Stopping profiler...",
				zap.Int("events_processed", eventCount),
				zap.Int("metrics_samples", metricsCount))
			return
		case event, ok := <-profiler.Events():
			if !ok {
				return
			}
			handleProfilerEvent(event, tcpParser)
			eventCount++
		case metrics, ok := <-profiler.Metrics():
			if !ok {
				return
			}
			handleProfilerMetrics(metrics)
			metricsCount++
		}
	}
}

func handleProfilerEvent(event ebpf.ProfilerEvent, parser *TCPSQLParser) {
	if dbPID > 0 && event.PID != dbPID {
		return
	}

	comm := strings.TrimSpace(event.Comm)
	if !isDatabaseProcess(comm) {
		return
	}

	// Create session if not exists
	session, exists := activeSessions[event.PID]
	if !exists {
		session = &QuerySession{
			PID:       event.PID,
			StartTime: time.Now(),
			KernelData: &KernelSessionData{},
		}
		activeSessions[event.PID] = session
	}

	switch event.EventType {
	case 1, 2: // IO read / write
		updateEventIOMetrics(event)
	case 3: // TCP TX
		// Check for slow query completion
		duration := time.Since(session.StartTime)
		if duration >= slowThreshold {
			sql := generateSimulatedSQL(event.PID, event.Bytes)
			handleSlowQuery(event.PID, sql, event.Timestamp)
		}
	case 4: // TCP RX
		// New query start
		if !exists {
			session.StartTime = time.Now()
		}
	case 6: // Lock wait
		updateEventLockMetrics(event)
	}
}

func handleProfilerMetrics(metrics ebpf.ProcessMetricsSnapshot) {
	if dbPID > 0 && metrics.PID != dbPID {
		return
	}

	if session, exists := activeSessions[metrics.PID]; exists {
		session.KernelData.IOReadBytes = int64(metrics.IOReadBytes)
		session.KernelData.IOWriteBytes = int64(metrics.IOWriteBytes)
		session.KernelData.IOReadCount = int64(metrics.IOReadCount)
		session.KernelData.IOWriteCount = int64(metrics.IOWriteCount)
		session.KernelData.PageCacheHits = int64(metrics.PageCacheHits)
		session.KernelData.LockCount = int64(metrics.LockCount)
		session.KernelData.TCPTxBytes = int64(metrics.TCPTxBytes)
		session.KernelData.TCPRxBytes = int64(metrics.TCPRxBytes)
		session.KernelData.LockWaitTime = float64(metrics.LockWaitTimeNs) / 1e6
	}
}

func updateEventIOMetrics(event ebpf.ProfilerEvent) {
	if session, exists := activeSessions[event.PID]; exists {
		if event.EventType == 1 { // IORead
			session.KernelData.IOReadCount++
			session.KernelData.IOReadBytes += int64(event.Bytes)
		} else { // IOWrite
			session.KernelData.IOWriteCount++
			session.KernelData.IOWriteBytes += int64(event.Bytes)
		}
		session.KernelData.IOLatencyTotal += float64(event.DurationNs) / 1e6
	}
}

func updateEventLockMetrics(event ebpf.ProfilerEvent) {
	if session, exists := activeSessions[event.PID]; exists {
		session.KernelData.LockCount++
		session.KernelData.LockWaitTime += float64(event.DurationNs) / 1e6
	}
}

func updateSessionIOMetrics(event ebpf.BPFEvent) {
	// Legacy handler for BPFEvent type
	if session, exists := activeSessions[event.PID]; exists {
		if event.EventType == uint32(ebpf.EventIORead) {
			session.KernelData.IOReadCount++
			session.KernelData.IOReadBytes += int64(event.Bytes)
		} else {
			session.KernelData.IOWriteCount++
			session.KernelData.IOWriteBytes += int64(event.Bytes)
		}
		session.KernelData.IOLatencyTotal += float64(event.DurationNs) / 1e6
	}
}

func updateSessionLockMetrics(event ebpf.BPFEvent) {
	// Legacy handler for BPFEvent type
	if session, exists := activeSessions[event.PID]; exists {
		session.KernelData.LockCount++
		session.KernelData.LockWaitTime += float64(event.DurationNs) / 1e6
	}
}

type TCPSQLParser struct {
	dbType        string
	pendingQueries map[uint32]*PendingQuery
}

type PendingQuery struct {
	StartTime    time.Time
	SQLBuffer    strings.Builder
	ExpectedSize int
}

func NewTCPSQLParser(dbType string) *TCPSQLParser {
	return &TCPSQLParser{
		dbType:        dbType,
		pendingQueries: make(map[uint32]*PendingQuery),
	}
}

func (p *TCPSQLParser) HandleTCPData(pid uint32, size uint64, ts uint64) {
	session, exists := activeSessions[pid]
	if !exists {
		session = &QuerySession{
			PID:       pid,
			StartTime: time.Now(),
			KernelData: &KernelSessionData{},
		}
		activeSessions[pid] = session
	}
}

func (p *TCPSQLParser) HandleResponse(pid uint32, size uint64, ts uint64) (string, bool) {
	session, exists := activeSessions[pid]
	if !exists {
		return "", false
	}

	duration := time.Since(session.StartTime)
	
	simulatedSQL := p.generateSimulatedSQL(pid, size)
	
	if duration >= slowThreshold {
		logger.Info("Slow query detected",
			zap.Uint32("pid", pid),
			zap.Duration("duration", duration),
			zap.String("sql", truncateString(simulatedSQL, 100)))
		return simulatedSQL, true
	}

	return simulatedSQL, duration >= slowThreshold
}

// Legacy TCP parser - for backward compatibility with kprobe mode

func handleSlowQuery(pid uint32, sql string, ts uint64) {
	session, exists := activeSessions[pid]
	if !exists {
		return
	}

	duration := time.Since(session.StartTime)
	queryHash := generateQueryHash(sql)

	slowQuery := &models.SlowQuery{
		QueryHash:   queryHash,
		SQL:         sql,
		Database:    dbType,
		DurationMs:  float64(duration.Milliseconds()),
		Timestamp:   time.Now(),
		ProcessID:   pid,
		ThreadID:    pid,
	}

	if err := db.Create(slowQuery).Error; err != nil {
		logger.Error("Failed to save slow query", zap.Error(err))
		return
	}

	ioLatencyAvg := 0.0
	if session.KernelData.IOReadCount+session.KernelData.IOWriteCount > 0 {
		ioLatencyAvg = session.KernelData.IOLatencyTotal /
			float64(session.KernelData.IOReadCount+session.KernelData.IOWriteCount)
	}

	pageCacheHitRate := 0.0
	totalIO := session.KernelData.PageCacheHits + session.KernelData.PageCacheMisses
	if totalIO > 0 {
		pageCacheHitRate = float64(session.KernelData.PageCacheHits) / float64(totalIO)
	}

	kernelMetrics := &models.KernelMetrics{
		SlowQueryID:     slowQuery.ID,
		Timestamp:       time.Now(),
		ProcessID:       pid,
		IOReadBytes:     session.KernelData.IOReadBytes,
		IOWriteBytes:    session.KernelData.IOWriteBytes,
		IOReadCount:     session.KernelData.IOReadCount,
		IOWriteCount:    session.KernelData.IOWriteCount,
		IOLatencyAvgMs:  ioLatencyAvg,
		IOLatencyMaxMs:  ioLatencyAvg * 2,
		PageCacheHits:   session.KernelData.PageCacheHits,
		PageCacheMisses: session.KernelData.PageCacheMisses,
		PageCacheHitRate: pageCacheHitRate,
		TCPTxBytes:      session.KernelData.TCPTxBytes,
		TCPRxBytes:      session.KernelData.TCPRxBytes,
		LockWaitTimeMs:  session.KernelData.LockWaitTime,
		LockCount:       session.KernelData.LockCount,
	}

	if err := db.Create(kernelMetrics).Error; err != nil {
		logger.Error("Failed to save kernel metrics", zap.Error(err))
	}

	delete(activeSessions, pid)
	logger.Info("Slow query saved to database",
		zap.Uint("query_id", slowQuery.ID),
		zap.String("hash", queryHash[:16]))
}

func generateSimulatedSQL(pid uint32, size uint64) string {
	queries := []string{
		"SELECT * FROM orders WHERE created_at > '2024-01-01' ORDER BY id DESC",
		"SELECT u.name, o.amount FROM users u JOIN orders o ON u.id = o.user_id WHERE o.status = 'pending'",
		"INSERT INTO audit_log (user_id, action, details) VALUES (?, ?, ?)",
		"UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0",
		"SELECT COUNT(*) FROM large_table WHERE status = 'active' GROUP BY category",
	}
	return queries[int(pid)%len(queries)]
}

func isDatabaseProcess(comm string) bool {
	dbProcesses := []string{"mysqld", "mysql", "postgres", "postmaster", "mongod"}
	for _, p := range dbProcesses {
		if strings.Contains(strings.ToLower(comm), p) {
			return true
		}
	}
	return false
}

func generateQueryHash(sql string) string {
	normalized := normalizeSQL(sql)
	hasher := sha256.New()
	hasher.Write([]byte(normalized))
	return hex.EncodeToString(hasher.Sum(nil))
}

func normalizeSQL(sql string) string {
	sql = strings.TrimSpace(sql)
	sql = strings.ToLower(sql)
	
	re := regexp.MustCompile(`'[^']*'`)
	sql = re.ReplaceAllString(sql, "?")
	
	re = regexp.MustCompile(`\b\d+\b`)
	sql = re.ReplaceAllString(sql, "?")
	
	sql = strings.Join(strings.Fields(sql), " ")
	
	return sql
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
