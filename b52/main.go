package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
	"gopkg.in/yaml.v3"

	"apigateway/circuit"
	"apigateway/limiter"
)

type ServerConfig struct {
	Port        int           `yaml:"port"`
	ReadTimeout time.Duration `yaml:"read_timeout"`
	WriteTimeout time.Duration `yaml:"write_timeout"`
}

type LimiterConfig struct {
	Strategy string        `yaml:"strategy"`
	Rate     int64         `yaml:"rate"`
	Capacity int64         `yaml:"capacity"`
	Window   time.Duration `yaml:"window"`
}

type CircuitBreakerConfig struct {
	ErrorThreshold float64       `yaml:"error_threshold"`
	Timeout        time.Duration `yaml:"timeout"`
	WindowSize     int           `yaml:"window_size"`
}

type ProxyConfig struct {
	Target string `yaml:"target"`
}

type Config struct {
	Server         ServerConfig         `yaml:"server"`
	Limiter        LimiterConfig        `yaml:"limiter"`
	CircuitBreaker CircuitBreakerConfig `yaml:"circuit_breaker"`
	Proxy          ProxyConfig          `yaml:"proxy"`
}

type Gateway struct {
	config         *Config
	configMu       sync.RWMutex
	defaultLimiter limiter.Limiter
	tokenBucket    *limiter.TokenBucket
	slidingWindow  *limiter.SlidingWindowLog
	breaker        *circuit.Breaker
	proxy          *httputil.ReverseProxy
	watcher        *fsnotify.Watcher
	configPath     string
}

func NewGateway(configPath string) (*Gateway, error) {
	g := &Gateway{configPath: configPath}
	if err := g.loadConfig(); err != nil {
		return nil, err
	}
	g.initComponents()
	if err := g.watchConfig(); err != nil {
		return nil, err
	}
	return g, nil
}

func (g *Gateway) loadConfig() error {
	data, err := os.ReadFile(g.configPath)
	if err != nil {
		return fmt.Errorf("failed to read config: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}

	g.configMu.Lock()
	g.config = &cfg
	g.configMu.Unlock()

	return nil
}

func (g *Gateway) initComponents() {
	g.configMu.RLock()
	cfg := g.config
	g.configMu.RUnlock()

	g.tokenBucket = limiter.NewTokenBucket(cfg.Limiter.Rate, cfg.Limiter.Capacity)
	g.slidingWindow = limiter.NewSlidingWindowLog(cfg.Limiter.Rate, cfg.Limiter.Capacity, cfg.Limiter.Window)

	if cfg.Limiter.Strategy == "sliding_window" {
		g.defaultLimiter = g.slidingWindow
	} else {
		g.defaultLimiter = g.tokenBucket
	}

	g.breaker = circuit.NewBreaker(
		cfg.CircuitBreaker.ErrorThreshold,
		cfg.CircuitBreaker.Timeout,
		cfg.CircuitBreaker.WindowSize,
	)

	targetURL, err := url.Parse(cfg.Proxy.Target)
	if err != nil {
		log.Printf("Warning: invalid proxy target %s: %v", cfg.Proxy.Target, err)
		g.proxy = nil
		return
	}
	g.proxy = httputil.NewSingleHostReverseProxy(targetURL)
	g.proxy.ModifyResponse = func(resp *http.Response) error {
		if resp.StatusCode >= 500 {
			g.breaker.Failure()
		} else {
			g.breaker.Success()
		}
		return nil
	}
	g.proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		g.breaker.Failure()
		http.Error(w, "Service Unavailable", http.StatusServiceUnavailable)
	}
}

func (g *Gateway) watchConfig() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("failed to create watcher: %w", err)
	}

	absPath, err := filepath.Abs(g.configPath)
	if err != nil {
		return fmt.Errorf("failed to get absolute path: %w", err)
	}
	configDir := filepath.Dir(absPath)

	if err := watcher.Add(configDir); err != nil {
		watcher.Close()
		return fmt.Errorf("failed to watch directory: %w", err)
	}

	g.watcher = watcher

	go func() {
		var debounceTimer *time.Timer
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Name == absPath && (event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Create == fsnotify.Create) {
					if debounceTimer != nil {
						debounceTimer.Stop()
					}
					debounceTimer = time.AfterFunc(500*time.Millisecond, func() {
						if err := g.reloadConfig(); err != nil {
							log.Printf("Failed to reload config: %v", err)
						}
					})
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("Watcher error: %v", err)
			}
		}
	}()

	return nil
}

func (g *Gateway) reloadConfig() error {
	if err := g.loadConfig(); err != nil {
		return err
	}

	g.configMu.RLock()
	cfg := g.config
	g.configMu.RUnlock()

	g.tokenBucket.UpdateConfig(cfg.Limiter.Rate, cfg.Limiter.Capacity)
	g.slidingWindow.UpdateConfig(cfg.Limiter.Rate, cfg.Limiter.Capacity)
	g.slidingWindow.SetWindow(cfg.Limiter.Window)

	if cfg.Limiter.Strategy == "sliding_window" {
		g.defaultLimiter = g.slidingWindow
	} else {
		g.defaultLimiter = g.tokenBucket
	}

	g.breaker.UpdateConfig(cfg.CircuitBreaker.ErrorThreshold, cfg.CircuitBreaker.Timeout, cfg.CircuitBreaker.WindowSize)

	targetURL, err := url.Parse(cfg.Proxy.Target)
	if err == nil {
		g.proxy = httputil.NewSingleHostReverseProxy(targetURL)
		g.proxy.ModifyResponse = func(resp *http.Response) error {
			if resp.StatusCode >= 500 {
				g.breaker.Failure()
			} else {
				g.breaker.Success()
			}
			return nil
		}
		g.proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			g.breaker.Failure()
			http.Error(w, "Service Unavailable", http.StatusServiceUnavailable)
		}
	}

	log.Printf("Config reloaded successfully")
	log.Printf("  Limiter: strategy=%s, rate=%d, capacity=%d, window=%s",
		cfg.Limiter.Strategy, cfg.Limiter.Rate, cfg.Limiter.Capacity, cfg.Limiter.Window)
	log.Printf("  CircuitBreaker: threshold=%.2f, timeout=%s, window=%d",
		cfg.CircuitBreaker.ErrorThreshold, cfg.CircuitBreaker.Timeout, cfg.CircuitBreaker.WindowSize)
	log.Printf("  Proxy target: %s", cfg.Proxy.Target)

	return nil
}

func (g *Gateway) Close() error {
	if g.watcher != nil {
		return g.watcher.Close()
	}
	return nil
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !g.breaker.Allow() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Service Unavailable",
			"detail": "Circuit breaker is open",
			"retry_after": g.getRemainingCooldown(),
		})
		return
	}

	lim := g.getLimiter(r)
	w.Header().Set("X-Rate-Limiter", lim.Name())

	if !lim.Allow() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Too Many Requests",
			"detail": "Rate limit exceeded",
			"strategy": lim.Name(),
		})
		return
	}

	if g.proxy == nil {
		g.breaker.Success()
		g.echoHandler(w, r)
		return
	}

	g.proxy.ServeHTTP(w, r)
}

func (g *Gateway) getLimiter(r *http.Request) limiter.Limiter {
	strategy := r.Header.Get("X-Rate-Limit-Strategy")

	switch strategy {
	case "sliding_window":
		return g.slidingWindow
	case "token_bucket":
		return g.tokenBucket
	default:
		return g.defaultLimiter
	}
}

func (g *Gateway) getRemainingCooldown() int64 {
	g.configMu.RLock()
	timeout := g.config.CircuitBreaker.Timeout
	g.configMu.RUnlock()
	return int64(timeout.Seconds())
}

func (g *Gateway) echoHandler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	response := map[string]interface{}{
		"method":  r.Method,
		"path":    r.URL.Path,
		"headers": r.Header,
		"query":   r.URL.Query(),
		"body":    string(body),
		"timestamp": time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (g *Gateway) statusHandler(w http.ResponseWriter, r *http.Request) {
	g.configMu.RLock()
	cfg := g.config
	g.configMu.RUnlock()

	status := map[string]interface{}{
		"gateway":   "running",
		"timestamp": time.Now().Format(time.RFC3339),
		"limiter": map[string]interface{}{
			"default_strategy": g.defaultLimiter.Name(),
			"rate":             g.defaultLimiter.GetRate(),
			"capacity":         g.defaultLimiter.GetCapacity(),
			"strategies": map[string]interface{}{
				"token_bucket": map[string]interface{}{
					"tokens":   g.tokenBucket.GetTokens(),
					"rate":     g.tokenBucket.GetRate(),
					"capacity": g.tokenBucket.GetCapacity(),
				},
				"sliding_window": map[string]interface{}{
					"tokens":   g.slidingWindow.GetTokens(),
					"rate":     g.slidingWindow.GetRate(),
					"capacity": g.slidingWindow.GetCapacity(),
					"window":   g.slidingWindow.GetWindow().String(),
				},
			},
		},
		"circuit_breaker": map[string]interface{}{
			"state":      g.breaker.GetStateString(),
			"error_rate": fmt.Sprintf("%.2f%%", g.breaker.GetErrorRate()*100),
			"threshold":  fmt.Sprintf("%.2f%%", cfg.CircuitBreaker.ErrorThreshold*100),
		},
		"proxy_target": cfg.Proxy.Target,
		"tips": map[string]string{
			"strategy_header": "Set 'X-Rate-Limit-Strategy' header to 'token_bucket' or 'sliding_window' to switch per request",
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func main() {
	configPath := "config/config.yaml"
	if len(os.Args) > 1 {
		configPath = os.Args[1]
	}

	gateway, err := NewGateway(configPath)
	if err != nil {
		log.Fatalf("Failed to create gateway: %v", err)
	}
	defer gateway.Close()

	gateway.configMu.RLock()
	port := gateway.config.Server.Port
	gateway.configMu.RUnlock()

	mux := http.NewServeMux()
	mux.HandleFunc("/status", gateway.statusHandler)
	mux.Handle("/", gateway)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", port),
		Handler:      mux,
		ReadTimeout:  gateway.config.Server.ReadTimeout,
		WriteTimeout: gateway.config.Server.WriteTimeout,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("API Gateway starting on port %d...", port)
		log.Printf("Status endpoint: http://localhost:%d/status", port)
		log.Printf("Configuration file: %s", configPath)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-stop
	log.Println("Shutting down gracefully...")
	gateway.Close()
	log.Println("Gateway stopped")
}
