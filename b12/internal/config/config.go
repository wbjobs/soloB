package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Scheduler   SchedulerConfig   `mapstructure:"scheduler"`
	Executor    ExecutorConfig    `mapstructure:"executor"`
	Streaming   StreamingConfig   `mapstructure:"streaming"`
	Database    DatabaseConfig    `mapstructure:"database"`
	Redis       RedisConfig       `mapstructure:"redis"`
	Minio       MinioConfig       `mapstructure:"minio"`
	Monitoring  MonitoringConfig  `mapstructure:"monitoring"`
	Alerting    AlertingConfig    `mapstructure:"alerting"`
	AutoScaling AutoScalingConfig `mapstructure:"auto_scaling"`
	Tenancy     TenancyConfig     `mapstructure:"tenancy"`
	Retry       RetryConfig       `mapstructure:"retry"`
	Lineage     LineageConfig     `mapstructure:"lineage"`
}

type SchedulerConfig struct {
	Name             string   `mapstructure:"name"`
	Port             int      `mapstructure:"port"`
	HTTPPort         int      `mapstructure:"http_port"`
	EtcdEndpoints    []string `mapstructure:"etcd_endpoints"`
	ElectionTTL      int      `mapstructure:"election_ttl"`
	ExecutorLeaseTTL int      `mapstructure:"executor_lease_ttl"`
	ExecutorTimeout  int      `mapstructure:"executor_timeout"`
}

type ExecutorConfig struct {
	Name              string `mapstructure:"name"`
	SchedulerAddr     string `mapstructure:"scheduler_addr"`
	Port              int    `mapstructure:"port"`
	MaxTasks          int    `mapstructure:"max_tasks"`
	HeartbeatInterval int    `mapstructure:"heartbeat_interval"`
	LeaseTTL          int    `mapstructure:"lease_ttl"`
}

type StreamingConfig struct {
	Name          string   `mapstructure:"name"`
	SchedulerAddr string   `mapstructure:"scheduler_addr"`
	KafkaBrokers  []string `mapstructure:"kafka_brokers"`
	ConsumerGroup string   `mapstructure:"consumer_group"`
}

type DatabaseConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	DBName   string `mapstructure:"dbname"`
	SSLMode  string `mapstructure:"sslmode"`
}

type RedisConfig struct {
	Addr     string `mapstructure:"addr"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

type MinioConfig struct {
	Endpoint  string `mapstructure:"endpoint"`
	AccessKey string `mapstructure:"access_key"`
	SecretKey string `mapstructure:"secret_key"`
	Bucket    string `mapstructure:"bucket"`
	SSL       bool   `mapstructure:"ssl"`
}

type MonitoringConfig struct {
	PrometheusPort int    `mapstructure:"prometheus_port"`
	GrafanaURL     string `mapstructure:"grafana_url"`
}

type AlertingConfig struct {
	Webhooks []WebhookConfig `mapstructure:"webhooks"`
}

type WebhookConfig struct {
	Type       string   `mapstructure:"type"`
	URL        string   `mapstructure:"url"`
	SMTPServer string   `mapstructure:"smtp_server"`
	SMTPPort   int      `mapstructure:"smtp_port"`
	From       string   `mapstructure:"from"`
	To         []string `mapstructure:"to"`
}

func Load(configPath string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(configPath)
	v.SetConfigType("yaml")
	v.AutomaticEnv()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &cfg, nil
}

func (d *DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.DBName, d.SSLMode,
	)
}

type AutoScalingConfig struct {
	Enabled                bool                    `mapstructure:"enabled"`
	ScaleIntervalSeconds   int                     `mapstructure:"scale_interval_seconds"`
	KubernetesNamespace    string                  `mapstructure:"kubernetes_namespace"`
	ExecutorDeploymentName string                  `mapstructure:"executor_deployment_name"`
	ExecutorLabel          string                  `mapstructure:"executor_label"`
	HPAName                string                  `mapstructure:"hpa_name"`
	Policy                 ScalingPolicyConfig     `mapstructure:"policy"`
}

type ScalingPolicyConfig struct {
	MinExecutors             int     `mapstructure:"min_executors"`
	MaxExecutors             int     `mapstructure:"max_executors"`
	CPUThresholdHigh         float64 `mapstructure:"cpu_threshold_high"`
	CPUThresholdLow          float64 `mapstructure:"cpu_threshold_low"`
	MemoryThresholdHigh      float64 `mapstructure:"memory_threshold_high"`
	MemoryThresholdLow       float64 `mapstructure:"memory_threshold_low"`
	QueueThresholdHigh       int     `mapstructure:"queue_threshold_high"`
	QueueThresholdLow        int     `mapstructure:"queue_threshold_low"`
	ScaleUpCooldownMinutes   int     `mapstructure:"scale_up_cooldown_minutes"`
	ScaleDownCooldownMinutes int     `mapstructure:"scale_down_cooldown_minutes"`
	UseHPA                   bool    `mapstructure:"use_hpa"`
	UseVPA                   bool    `mapstructure:"use_vpa"`
}

type TenancyConfig struct {
	Enabled               bool                     `mapstructure:"enabled"`
	DefaultNamespace      string                   `mapstructure:"default_namespace"`
	IsolationMode         string                   `mapstructure:"isolation_mode"`
	EnableNamespacePrefix bool                     `mapstructure:"enable_namespace_prefix"`
	DefaultQuota          DefaultQuotaConfig       `mapstructure:"default_quota"`
}

type DefaultQuotaConfig struct {
	MaxConcurrentJobs     int     `mapstructure:"max_concurrent_jobs"`
	MaxTotalTasks         int     `mapstructure:"max_total_tasks"`
	MaxExecutors          int     `mapstructure:"max_executors"`
	MaxCPU                float64 `mapstructure:"max_cpu"`
	MaxMemoryGB           float64 `mapstructure:"max_memory_gb"`
	MaxStorageGB          float64 `mapstructure:"max_storage_gb"`
	MaxDailyExecutions    int64   `mapstructure:"max_daily_executions"`
	MaxTaskTimeoutMinutes int     `mapstructure:"max_task_timeout_minutes"`
	MaxRetriesPerTask     int     `mapstructure:"max_retries_per_task"`
}

type RetryConfig struct {
	Enabled             bool                     `mapstructure:"enabled"`
	DefaultRetryPolicy  DefaultRetryPolicyConfig `mapstructure:"default_policy"`
	EnableCircuitBreaker bool                    `mapstructure:"enable_circuit_breaker"`
	RetryableErrors      RetryableErrorsConfig   `mapstructure:"retryable_errors"`
}

type DefaultRetryPolicyConfig struct {
	MaxRetries         int      `mapstructure:"max_retries"`
	RetryDelayMs       int      `mapstructure:"retry_delay_ms"`
	MaxDelayMs         int      `mapstructure:"max_delay_ms"`
	BackoffMultiplier  float64  `mapstructure:"backoff_multiplier"`
	Strategies         []string `mapstructure:"strategies"`
	FailureThreshold   int      `mapstructure:"failure_threshold"`
	FuseWindowMinutes  int      `mapstructure:"fuse_window_minutes"`
}

type RetryableErrorsConfig struct {
	NetworkPatterns  []string `mapstructure:"network_patterns"`
	TimeoutPatterns  []string `mapstructure:"timeout_patterns"`
	ResourcePatterns []string `mapstructure:"resource_patterns"`
}

type LineageConfig struct {
	Enabled          bool   `mapstructure:"enabled"`
	AutoAnalyze      bool   `mapstructure:"auto_analyze"`
	EnableRerun      bool   `mapstructure:"enable_rerun"`
	AnalysisTimeoutMs int   `mapstructure:"analysis_timeout_ms"`
}
