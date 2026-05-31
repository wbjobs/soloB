package server

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"staticgen/pkg/builder"
	"staticgen/pkg/config"
	"staticgen/pkg/utils"
)

type Server struct {
	workDir         string
	cfg             *config.Config
	builder         *builder.Builder
	watcher         *fsnotify.Watcher
	clients         map[chan string]bool
	mu              sync.Mutex
	buildMu         sync.Mutex
	port            int
	lastBuildTime   time.Time
	watchedDirs     map[string]bool
	watchedDirsMu   sync.Mutex
}

func NewServer(workDir string, cfg *config.Config, port int) (*Server, error) {
	b, err := builder.NewBuilder(workDir, cfg)
	if err != nil {
		return nil, err
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create watcher: %w", err)
	}

	return &Server{
		workDir:     workDir,
		cfg:         cfg,
		builder:     b,
		watcher:     watcher,
		clients:     make(map[chan string]bool),
		port:        port,
		watchedDirs: make(map[string]bool),
	}, nil
}

func (s *Server) Start() error {
	defer s.watcher.Close()

	if err := s.InitialBuild(); err != nil {
		return err
	}

	if err := s.setupWatchers(); err != nil {
		return err
	}

	go s.watch()

	http.HandleFunc("/", s.handleFile)
	http.HandleFunc("/__reload", s.handleReload)

	addr := fmt.Sprintf(":%d", s.port)
	fmt.Printf("Server running at http://localhost%s\n", addr)
	fmt.Printf("Watching for changes in: %s, static, themes, plugins, staticgen.yaml\n", s.cfg.SourceDir)

	return http.ListenAndServe(addr, nil)
}

func (s *Server) InitialBuild() error {
	return s.builder.Build()
}

func (s *Server) setupWatchers() error {
	dirs := []string{
		filepath.Join(s.workDir, s.cfg.SourceDir),
		filepath.Join(s.workDir, "static"),
		filepath.Join(s.workDir, "themes"),
		filepath.Join(s.workDir, s.cfg.PluginsDir),
	}

	cfgPath := config.GetConfigPath(s.workDir)
	if utils.Exists(cfgPath) {
		cfgDir := filepath.Dir(cfgPath)
		if err := s.watchDir(cfgDir); err != nil {
			return fmt.Errorf("failed to watch config dir: %w", err)
		}
	}

	for _, dir := range dirs {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}

		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				return s.watchDir(path)
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("failed to watch %s: %w", dir, err)
		}
	}

	return nil
}

func (s *Server) watchDir(dir string) error {
	s.watchedDirsMu.Lock()
	defer s.watchedDirsMu.Unlock()

	absDir, err := filepath.Abs(dir)
	if err != nil {
		return err
	}

	if s.watchedDirs[absDir] {
		return nil
	}

	if err := s.watcher.Add(absDir); err != nil {
		return err
	}

	s.watchedDirs[absDir] = true
	return nil
}

func (s *Server) watchNewDirs(dir string) error {
	return filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if err := s.watchDir(path); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Server) watch() {
	var debounceTimer *time.Timer
	debounceDuration := 300 * time.Millisecond
	lastEventTime := make(map[string]time.Time)
	var lastEventMu sync.Mutex

	for {
		select {
		case event, ok := <-s.watcher.Events:
			if !ok {
				return
			}

			if s.shouldIgnore(event.Name) {
				continue
			}

			lastEventMu.Lock()
			lastTime, exists := lastEventTime[event.Name]
			now := time.Now()
			if exists && now.Sub(lastTime) < 100*time.Millisecond {
				lastEventMu.Unlock()
				continue
			}
			lastEventTime[event.Name] = now
			lastEventMu.Unlock()

			if event.Op&fsnotify.Create == fsnotify.Create {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					fmt.Printf("New directory detected, watching: %s\n", event.Name)
					if err := s.watchNewDirs(event.Name); err != nil {
						log.Printf("Failed to watch new directory: %v\n", err)
					}
				}
			}

			shouldTrigger := false
			if event.Op&fsnotify.Write == fsnotify.Write {
				shouldTrigger = true
			}
			if event.Op&fsnotify.Create == fsnotify.Create {
				shouldTrigger = true
			}
			if event.Op&fsnotify.Remove == fsnotify.Remove {
				shouldTrigger = true
			}
			if event.Op&fsnotify.Rename == fsnotify.Rename {
				shouldTrigger = true
			}

			if shouldTrigger {
				if debounceTimer != nil {
					debounceTimer.Stop()
				}

				eventName := event.Name
				eventOp := event.Op
				debounceTimer = time.AfterFunc(debounceDuration, func() {
					fmt.Printf("\nChange detected [%s]: %s\n", eventOp, eventName)
					s.triggerRebuild()
				})
			}

		case err, ok := <-s.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Watcher error: %v\n", err)
		}
	}
}

func (s *Server) shouldIgnore(path string) bool {
	base := filepath.Base(path)
	if strings.HasPrefix(base, ".") {
		return true
	}
	if strings.HasPrefix(base, "~") {
		return true
	}
	if strings.HasSuffix(base, ".swp") || strings.HasSuffix(base, ".swo") || strings.HasSuffix(base, ".tmp") {
		return true
	}
	if strings.Contains(path, "node_modules") {
		return true
	}
	outputDir := filepath.Join(s.workDir, s.cfg.OutputDir)
	absOutputDir, _ := filepath.Abs(outputDir)
	absPath, _ := filepath.Abs(path)
	if strings.HasPrefix(absPath, absOutputDir) {
		return true
	}
	return false
}

func (s *Server) triggerRebuild() {
	s.buildMu.Lock()
	s.buildMu.Unlock()

	fmt.Println("Rebuilding...")
	start := time.Now()

	cfgPath := config.GetConfigPath(s.workDir)
	cfgInfo, cfgErr := os.Stat(cfgPath)
	if cfgErr == nil && cfgInfo.ModTime().After(s.lastBuildTime) {
		fmt.Println("Config file changed, reloading...")
		cfg, cfgLoadErr := config.Load(cfgPath)
		if cfgLoadErr != nil {
			fmt.Printf("Error reloading config: %v\n", cfgLoadErr)
		} else {
			s.cfg = cfg
			newBuilder, bErr := builder.NewBuilder(s.workDir, cfg)
			if bErr != nil {
				fmt.Printf("Error creating builder: %v\n", bErr)
			} else {
				s.builder = newBuilder
			}
		}
	}

	err := s.builder.Rebuild()
	if err != nil {
		fmt.Printf("Build failed: %v\n", err)
		return
	}

	s.lastBuildTime = time.Now()
	elapsed := time.Since(start)
	fmt.Printf("Rebuild completed in %s\n", elapsed)

	s.broadcast("reload")
}

func (s *Server) broadcast(msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	disconnected := make([]chan string, 0)
	for client := range s.clients {
		select {
		case client <- msg:
		default:
			disconnected = append(disconnected, client)
		}
	}

	for _, client := range disconnected {
		delete(s.clients, client)
		close(client)
	}
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	outputDir := filepath.Join(s.workDir, s.cfg.OutputDir)
	requestedPath := r.URL.Path

	if requestedPath == "/" {
		requestedPath = "/index.html"
	}

	filePath := filepath.Join(outputDir, requestedPath)

	if info, err := os.Stat(filePath); err == nil && info.IsDir() {
		indexPath := filepath.Join(filePath, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			filePath = indexPath
		}
	}

	if strings.HasSuffix(filePath, ".html") {
		data, err := os.ReadFile(filePath)
		if err != nil {
			http.NotFound(w, r)
			return
		}

		reloadScript := `
<script>
(function() {
    var source = new EventSource('/__reload');
    source.onmessage = function(event) {
        if (event.data === 'reload') {
            window.location.reload();
        }
    };
    source.onerror = function() {
        setTimeout(function() {
            window.location.reload();
        }, 1000);
    };
})();
</script>
</body>`

		content := string(data)
		originalContent := content
		content = strings.Replace(content, "</body>", reloadScript, 1)
		if content == originalContent {
			content = content + reloadScript
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(content))
		return
	}

	http.FileServer(http.Dir(outputDir)).ServeHTTP(w, r)
}

func (s *Server) handleReload(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("X-Accel-Buffering", "no")

	notify := make(chan string, 1)
	s.mu.Lock()
	s.clients[notify] = true
	clientCount := len(s.clients)
	s.mu.Unlock()

	fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()
	fmt.Printf("Browser connected. Total clients: %d\n", clientCount)

	defer func() {
		s.mu.Lock()
		delete(s.clients, notify)
		remaining := len(s.clients)
		s.mu.Unlock()
		close(notify)
		fmt.Printf("Browser disconnected. Remaining clients: %d\n", remaining)
	}()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg := <-notify:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}
