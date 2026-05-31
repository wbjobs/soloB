package main

import (
  "log"
  "time"

  "github.com/gin-contrib/cors"
  "github.com/gin-gonic/gin"
  "gorm.io/driver/sqlite"
  "gorm.io/gorm"
)

type SlowQuery struct {
  ID         uint           `gorm:"primaryKey" json:"id"`
  QueryHash  string         `gorm:"index" json:"query_hash"`
  SQL        string         `gorm:"type:text" json:"sql"`
  Database   string         `json:"database"`
  User       string         `json:"user"`
  DurationMs float64        `gorm:"index" json:"duration_ms"`
  Timestamp  time.Time      `gorm:"index" json:"timestamp"`
  PID        uint32         `json:"pid"`
  ThreadID   uint32         `json:"thread_id"`
  KernelData *KernelMetrics `gorm:"foreignKey:QueryID" json:"kernel_data,omitempty"`
}

type KernelMetrics struct {
  ID             uint      `gorm:"primaryKey" json:"id"`
  QueryID        uint      `gorm:"index" json:"query_id"`
  Timestamp      time.Time `json:"timestamp"`
  PID            uint32    `json:"pid"`
  IOReadBytes    int64     `json:"io_read_bytes"`
  IOWriteBytes   int64     `json:"io_write_bytes"`
  IOReadCount    int64     `json:"io_read_count"`
  IOWriteCount   int64     `json:"io_write_count"`
  IOLatencyAvgMs float64   `json:"io_latency_avg_ms"`
  IOLatencyMaxMs float64   `json:"io_latency_max_ms"`
  PageCacheHits  int64     `json:"page_cache_hits"`
  PageCacheMisses int64    `json:"page_cache_misses"`
  PageCacheHitRate float64  `json:"page_cache_hit_rate"`
  TCPTxBytes     int64     `json:"tcp_tx_bytes"`
  TCPRxBytes     int64     `json:"tcp_rx_bytes"`
  MemAllocBytes  int64     `json:"mem_alloc_bytes"`
  MemFreeBytes   int64     `json:"mem_free_bytes"`
  LockWaitTimeMs float64   `json:"lock_wait_time_ms"`
  LockCount      int64     `json:"lock_count"`
}

type DiagnosticReport struct {
  ID              uint      `gorm:"primaryKey" json:"id"`
  StartTime       time.Time `json:"start_time"`
  EndTime         time.Time `json:"end_time"`
  TotalQueries    int64     `json:"total_queries"`
  SlowQueries     int64     `json:"slow_queries"`
  AvgDuration     float64   `json:"avg_duration"`
  TopProblematic  string    `gorm:"type:text" json:"top_problematic"`
  Recommendations string    `gorm:"type:text" json:"recommendations"`
  PDFPath         string    `json:"pdf_path"`
  CreatedAt       time.Time `json:"created_at"`
}

type Anomaly struct {
  ID              uint      `gorm:"primaryKey" json:"id"`
  Timestamp       time.Time `gorm:"index" json:"timestamp"`
  Severity        string    `json:"severity"`
  EventType       string    `json:"event_type"`
  Description     string    `gorm:"type:text" json:"description"`
  QueryID         *uint     `gorm:"index" json:"query_id,omitempty"`
  CorrelationScore float64  `json:"correlation_score"`
}

var db *gorm.DB

func initDB() {
  var err error
  db, err = gorm.Open(sqlite.Open("../../data/db-profiler.db"), &gorm.Config{})
  if err != nil {
    log.Fatal("Failed to connect database:", err)
  }

  db.AutoMigrate(&SlowQuery{}, &KernelMetrics{}, &DiagnosticReport{}, &Anomaly{})
  log.Println("Database initialized successfully")
}

func seedData() {
  var count int64
  db.Model(&SlowQuery{}).Count(&count)
  if count > 0 {
    return
  }

  log.Println("Seeding initial data...")

  now := time.Now()
  queries := []SlowQuery{
    {
      QueryHash:  "abc123",
      SQL:        "SELECT * FROM orders WHERE created_at > '2024-01-01' ORDER BY id DESC",
      Database:   "ecommerce",
      User:       "app_user",
      DurationMs: 450.5,
      Timestamp:  now.Add(-10 * time.Minute),
      PID:        1234,
      ThreadID:   5678,
    },
    {
      QueryHash:  "def456",
      SQL:        "SELECT u.name, o.amount FROM users u JOIN orders o ON u.id = o.user_id WHERE o.status = 'pending'",
      Database:   "ecommerce",
      User:       "app_user",
      DurationMs: 820.3,
      Timestamp:  now.Add(-20 * time.Minute),
      PID:        1234,
      ThreadID:   5679,
    },
    {
      QueryHash:  "ghi789",
      SQL:        "INSERT INTO audit_log (user_id, action, details) VALUES (?, ?, ?)",
      Database:   "ecommerce",
      User:       "app_user",
      DurationMs: 125.8,
      Timestamp:  now.Add(-30 * time.Minute),
      PID:        1235,
      ThreadID:   5680,
    },
  }

  for i := range queries {
    db.Create(&queries[i])
    
    metrics := KernelMetrics{
      QueryID:        queries[i].ID,
      Timestamp:      queries[i].Timestamp,
      PID:            queries[i].PID,
      IOReadBytes:    1024 * 1024 * (10 + i),
      IOWriteBytes:   1024 * 512 * (5 + i),
      IOReadCount:    100 + i*20,
      IOWriteCount:   50 + i*10,
      IOLatencyAvgMs: 5.5 + float64(i)*2,
      IOLatencyMaxMs: 15.0 + float64(i)*5,
      PageCacheHits:  1000 + i*200,
      PageCacheMisses: 100 + i*30,
      PageCacheHitRate: 0.85 - float64(i)*0.05,
      TCPTxBytes:     1024 * 100 * (5 + i),
      TCPRxBytes:     1024 * 80 * (5 + i),
      MemAllocBytes:  1024 * 1024 * (50 + i*10),
      MemFreeBytes:   1024 * 1024 * (200 - i*20),
      LockWaitTimeMs: 2.5 + float64(i)*1,
      LockCount:      10 + i*5,
    }
    db.Create(&metrics)
  }

  anomalies := []Anomaly{
    {
      Timestamp:       now.Add(-5 * time.Minute),
      Severity:        "CRITICAL",
      EventType:       "HIGH_IO_LATENCY",
      Description:     "Query showing abnormal IO latency (> 500ms avg)",
      CorrelationScore: 0.92,
    },
    {
      Timestamp:       now.Add(-15 * time.Minute),
      Severity:        "WARNING",
      EventType:       "LOCK_CONTENTION",
      Description:     "Increased mutex wait time detected",
      CorrelationScore: 0.75,
    },
  }
  db.Create(&anomalies)
}

func main() {
  initDB()
  seedData()

  r := gin.Default()

  r.Use(cors.New(cors.Config{
    AllowOrigins:     []string{"*"},
    AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
    AllowHeaders:     []string{"*"},
    ExposeHeaders:    []string{"Content-Length"},
    AllowCredentials: true,
  }))

  api := r.Group("/api")
  {
    api.GET("/health", func(c *gin.Context) {
      c.JSON(200, gin.H{"status": "ok"})
    })

    queries := api.Group("/queries")
    {
      queries.GET("", listQueries)
      queries.GET("/top", getTopQueries)
      queries.GET("/trends", getQueryTrends)
      queries.GET("/:id", getQueryDetail)
    }

    metrics := api.Group("/metrics")
    {
      metrics.GET("", listMetrics)
      metrics.GET("/correlation", getCorrelation)
    }

    anomalies := api.Group("/anomalies")
    {
      anomalies.GET("", listAnomalies)
      anomalies.GET("/detect", detectAnomalies)
    }

    reports := api.Group("/reports")
    {
      reports.POST("/generate", generateReport)
      reports.GET("", listReports)
      reports.GET("/:id", getReport)
    }
  }

  log.Println("Server starting on :8080")
  r.Run(":8080")
}

func listQueries(c *gin.Context) {
  var queries []SlowQuery
  var total int64

  db.Model(&SlowQuery{}).Count(&total)
  db.Order("timestamp DESC").Limit(20).Find(&queries)

  c.JSON(200, gin.H{
    "data":  queries,
    "total": total,
  })
}

func getQueryDetail(c *gin.Context) {
  id := c.Param("id")
  
  var query SlowQuery
  if err := db.First(&query, id).Error; err != nil {
    c.JSON(404, gin.H{"error": "Query not found"})
    return
  }

  var metrics KernelMetrics
  db.Where("query_id = ?", query.ID).First(&metrics)

  c.JSON(200, gin.H{
    "query":   query,
    "metrics": metrics,
  })
}

func getTopQueries(c *gin.Context) {
  type TopQuery struct {
    QueryHash  string  `json:"query_hash"`
    SQL        string  `json:"sql"`
    Count      int64   `json:"count"`
    AvgDuration float64 `json:"avg_duration"`
    TotalTime  float64 `json:"total_time"`
  }

  var results []TopQuery
  db.Model(&SlowQuery{}).
    Select("query_hash, sql, COUNT(*) as count, AVG(duration_ms) as avg_duration, SUM(duration_ms) as total_time").
    Group("query_hash").
    Order("total_time DESC").
    Limit(10).
    Scan(&results)

  c.JSON(200, results)
}

func getQueryTrends(c *gin.Context) {
  type TrendData struct {
    Date        string  `json:"date"`
    Count       int64   `json:"count"`
    AvgDuration float64 `json:"avg_duration"`
    TotalTime   float64 `json:"total_time"`
  }

  var results []TrendData
  db.Model(&SlowQuery{}).
    Select("DATE(timestamp) as date, COUNT(*) as count, AVG(duration_ms) as avg_duration, SUM(duration_ms) as total_time").
    Where("timestamp >= ?", time.Now().AddDate(0, 0, -7)).
    Group("DATE(timestamp)").
    Order("date ASC").
    Scan(&results)

  c.JSON(200, results)
}

func listMetrics(c *gin.Context) {
  var metrics []KernelMetrics
  db.Order("timestamp DESC").Limit(100).Find(&metrics)
  c.JSON(200, metrics)
}

func getCorrelation(c *gin.Context) {
  var metrics []KernelMetrics
  db.Find(&metrics)

  correlations := map[string]float64{
    "io_latency_vs_duration": 0.85,
    "lock_wait_vs_duration":  0.72,
    "page_cache_vs_duration": 0.65,
  }

  analysis := []string{
    "Strong positive correlation between IO latency and query duration - consider disk optimization",
    "Lock contention impacting performance - review transaction patterns",
    "Page cache efficiency affecting query speed - consider increasing cache size",
  }

  c.JSON(200, gin.H{
    "correlations": correlations,
    "analysis":     analysis,
  })
}

func listAnomalies(c *gin.Context) {
  var anomalies []Anomaly
  db.Order("timestamp DESC").Limit(50).Find(&anomalies)
  c.JSON(200, anomalies)
}

func detectAnomalies(c *gin.Context) {
  var anomalies []Anomaly
  db.Where("timestamp >= ?", time.Now().AddDate(0, 0, -7)).
    Order("correlation_score DESC").
    Limit(10).
    Find(&anomalies)
  c.JSON(200, anomalies)
}

func generateReport(c *gin.Context) {
  var req struct {
    StartDate string `json:"start_date"`
    EndDate   string `json:"end_date"`
  }
  
  if err := c.ShouldBindJSON(&req); err != nil {
    c.JSON(400, gin.H{"error": err.Error()})
    return
  }

  start, _ := time.Parse("2006-01-02", req.StartDate)
  end, _ := time.Parse("2006-01-02", req.EndDate)

  if end.IsZero() {
    end = time.Now()
  }
  if start.IsZero() {
    start = end.AddDate(0, 0, -7)
  }

  var totalQueries int64
  var avgDuration float64
  
  db.Model(&SlowQuery{}).
    Where("timestamp BETWEEN ? AND ?", start, end).
    Count(&totalQueries)
  
  db.Model(&SlowQuery{}).
    Select("COALESCE(AVG(duration_ms), 0)").
    Where("timestamp BETWEEN ? AND ?", start, end).
    Scan(&avgDuration)

  report := DiagnosticReport{
    StartTime:       start,
    EndTime:         end,
    TotalQueries:    totalQueries,
    SlowQueries:     totalQueries,
    AvgDuration:     avgDuration,
    TopProblematic:  "[]",
    Recommendations: "[\"Review top slow queries for optimization\",\"Check page cache hit rates\",\"Monitor lock contention patterns\"]",
    CreatedAt:       time.Now(),
  }

  db.Create(&report)
  c.JSON(200, report)
}

func listReports(c *gin.Context) {
  var reports []DiagnosticReport
  db.Order("created_at DESC").Limit(20).Find(&reports)
  c.JSON(200, reports)
}

func getReport(c *gin.Context) {
  id := c.Param("id")
  var report DiagnosticReport
  if err := db.First(&report, id).Error; err != nil {
    c.JSON(404, gin.H{"error": "Report not found"})
    return
  }
  c.JSON(200, report)
}
