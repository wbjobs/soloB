package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"
)

type BackendHealthState int32

const (
	BackendHealthy BackendHealthState = iota
	BackendUnhealthy
)

func (s BackendHealthState) String() string {
	switch s {
	case BackendHealthy:
		return "healthy"
	case BackendUnhealthy:
		return "unhealthy"
	default:
		return "unknown"
	}
}

type trackedConn struct {
	conn      net.Conn
	cancel    context.CancelFunc
	startTime time.Time
}

type TCPServer struct {
	listenAddr       string
	backendURL       string
	protocol         ProtocolType
	bufferPool       *BufferPool
	converter        *ProtocolConverter
	httpClient       *http.Client
	healthCheckURL   string

	maxConnections   int
	connTimeout      time.Duration
	idleTimeout      time.Duration
	httpTimeout      time.Duration

	tcpKeepAliveEnabled bool
	tcpKeepAlivePeriod  time.Duration

	healthCheckEnabled   bool
	healthCheckInterval  time.Duration
	healthCheckTimeout   time.Duration
	healthFailureThreshold int
	healthSuccessThreshold int

	backendHealth atomic.Int32
	consecutiveFailures atomic.Int32
	consecutiveSuccesses atomic.Int32

	ctx        context.Context
	cancel     context.CancelFunc
	activeConn map[net.Conn]*trackedConn
	mu         sync.RWMutex
	wg         sync.WaitGroup
	connSem    chan struct{}
	once       sync.Once

	healthStopCh chan struct{}
	healthWg     sync.WaitGroup
}

type TCPServerConfig struct {
	ListenAddr     string
	BackendURL     string
	Protocol       ProtocolType
	BufferSize     int
	MaxConnections int
	HTTPTimeout    time.Duration
	ConnTimeout    time.Duration
	IdleTimeout    time.Duration

	TCPKeepAliveEnabled bool
	TCPKeepAlivePeriod  time.Duration

	HealthCheckEnabled     bool
	HealthCheckInterval    time.Duration
	HealthCheckTimeout     time.Duration
	HealthCheckURL         string
	HealthFailureThreshold int
	HealthSuccessThreshold int
}

func NewTCPServer(config TCPServerConfig) *TCPServer {
	if config.BufferSize <= 0 {
		config.BufferSize = 4096
	}
	if config.MaxConnections <= 0 {
		config.MaxConnections = 100
	}
	if config.HTTPTimeout <= 0 {
		config.HTTPTimeout = 30 * time.Second
	}
	if config.ConnTimeout <= 0 {
		config.ConnTimeout = 5 * time.Minute
	}
	if config.IdleTimeout <= 0 {
		config.IdleTimeout = 30 * time.Second
	}
	if config.TCPKeepAlivePeriod <= 0 {
		config.TCPKeepAlivePeriod = 30 * time.Second
	}
	if config.HealthCheckInterval <= 0 {
		config.HealthCheckInterval = 10 * time.Second
	}
	if config.HealthCheckTimeout <= 0 {
		config.HealthCheckTimeout = 5 * time.Second
	}
	if config.HealthFailureThreshold <= 0 {
		config.HealthFailureThreshold = 3
	}
	if config.HealthSuccessThreshold <= 0 {
		config.HealthSuccessThreshold = 2
	}

	healthCheckURL := config.HealthCheckURL
	if healthCheckURL == "" {
		healthCheckURL = deriveHealthCheckURL(config.BackendURL)
	}

	ctx, cancel := context.WithCancel(context.Background())

	server := &TCPServer{
		listenAddr:             config.ListenAddr,
		backendURL:             config.BackendURL,
		protocol:               config.Protocol,
		bufferPool:             NewBufferPool(config.BufferSize),
		converter:              NewProtocolConverter(config.Protocol),
		healthCheckURL:         healthCheckURL,
		maxConnections:         config.MaxConnections,
		connTimeout:            config.ConnTimeout,
		idleTimeout:            config.IdleTimeout,
		httpTimeout:            config.HTTPTimeout,
		tcpKeepAliveEnabled:    config.TCPKeepAliveEnabled,
		tcpKeepAlivePeriod:     config.TCPKeepAlivePeriod,
		healthCheckEnabled:     config.HealthCheckEnabled,
		healthCheckInterval:    config.HealthCheckInterval,
		healthCheckTimeout:     config.HealthCheckTimeout,
		healthFailureThreshold: config.HealthFailureThreshold,
		healthSuccessThreshold: config.HealthSuccessThreshold,
		ctx:                    ctx,
		cancel:                 cancel,
		activeConn:             make(map[net.Conn]*trackedConn),
		connSem:                make(chan struct{}, config.MaxConnections),
		healthStopCh:           make(chan struct{}),
	}

	server.backendHealth.Store(int32(BackendHealthy))

	server.httpClient = &http.Client{
		Timeout: config.HTTPTimeout,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	return server
}

func deriveHealthCheckURL(backendURL string) string {
	parsed, err := url.Parse(backendURL)
	if err != nil {
		return backendURL
	}
	return fmt.Sprintf("%s://%s/health", parsed.Scheme, parsed.Host)
}

func (s *TCPServer) Start() error {
	listener, err := net.Listen("tcp", s.listenAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", s.listenAddr, err)
	}

	log.Printf("TCP proxy server listening on %s, backend: %s", s.listenAddr, s.backendURL)
	log.Printf("Protocol: %s, Buffer size: %d bytes", s.protocol, s.bufferPool.Size())
	log.Printf("Max connections: %d, Conn timeout: %v, Idle timeout: %v",
		s.maxConnections, s.connTimeout, s.idleTimeout)
	log.Printf("TCP Keep-Alive: enabled=%v, period=%v",
		s.tcpKeepAliveEnabled, s.tcpKeepAlivePeriod)
	log.Printf("Health Check: enabled=%v, interval=%v, failure-threshold=%d",
		s.healthCheckEnabled, s.healthCheckInterval, s.healthFailureThreshold)

	if s.healthCheckEnabled {
		s.healthWg.Add(1)
		go s.healthCheckLoop()
	}

	go s.acceptLoop(listener)

	<-s.ctx.Done()
	log.Println("Shutting down gracefully...")

	close(s.healthStopCh)
	s.healthWg.Wait()

	listener.Close()

	s.mu.Lock()
	for conn, tc := range s.activeConn {
		log.Printf("Closing active connection: %s", conn.RemoteAddr())
		tc.cancel()
		conn.Close()
	}
	s.mu.Unlock()

	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		log.Println("All connections closed gracefully")
	case <-time.After(10 * time.Second):
		log.Println("Forced shutdown after timeout")
	}

	return nil
}

func (s *TCPServer) Stop() {
	s.once.Do(func() {
		if s.cancel != nil {
			s.cancel()
		}
	})
}

func (s *TCPServer) healthCheckLoop() {
	defer s.healthWg.Done()

	log.Printf("Starting health check loop, checking: %s", s.healthCheckURL)

	ticker := time.NewTicker(s.healthCheckInterval)
	defer ticker.Stop()

	s.checkBackendHealth()

	for {
		select {
		case <-s.healthStopCh:
			log.Println("Health check loop stopped")
			return
		case <-ticker.C:
			s.checkBackendHealth()
		}
	}
}

func (s *TCPServer) checkBackendHealth() {
	ctx, cancel := context.WithTimeout(context.Background(), s.healthCheckTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", s.healthCheckURL, nil)
	if err != nil {
		s.recordHealthFailure(fmt.Errorf("failed to create health check request: %w", err))
		return
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		s.recordHealthFailure(fmt.Errorf("health check request failed: %w", err))
		return
	}
	defer resp.Body.Close()

	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		s.recordHealthFailure(fmt.Errorf("health check returned status %d", resp.StatusCode))
		return
	}

	s.recordHealthSuccess()
}

func (s *TCPServer) recordHealthFailure(err error) {
	failures := s.consecutiveFailures.Add(1)
	s.consecutiveSuccesses.Store(0)

	log.Printf("Health check failed (%d/%d): %v",
		failures, s.healthFailureThreshold, err)

	currentState := BackendHealthState(s.backendHealth.Load())

	if currentState == BackendHealthy && int(failures) >= s.healthFailureThreshold {
		s.transitionToUnhealthy()
	}
}

func (s *TCPServer) recordHealthSuccess() {
	successes := s.consecutiveSuccesses.Add(1)
	s.consecutiveFailures.Store(0)

	currentState := BackendHealthState(s.backendHealth.Load())

	if currentState == BackendUnhealthy && int(successes) >= s.healthSuccessThreshold {
		s.transitionToHealthy()
	}
}

func (s *TCPServer) transitionToUnhealthy() {
	s.backendHealth.Store(int32(BackendUnhealthy))
	log.Printf("⚠️  Backend transitioned to UNHEALTHY after %d consecutive failures",
		s.healthFailureThreshold)
	log.Println("⚠️  Closing all active client connections...")
	s.disconnectAllClients("backend service unavailable")
}

func (s *TCPServer) transitionToHealthy() {
	s.backendHealth.Store(int32(BackendHealthy))
	log.Printf("✅ Backend transitioned to HEALTHY after %d consecutive successes",
		s.healthSuccessThreshold)
}

func (s *TCPServer) disconnectAllClients(reason string) {
	s.mu.Lock()
	connections := make([]net.Conn, 0, len(s.activeConn))
	for conn := range s.activeConn {
		connections = append(connections, conn)
	}
	s.mu.Unlock()

	for _, conn := range connections {
		clientAddr := conn.RemoteAddr().String()
		log.Printf("Disconnecting %s: %s", clientAddr, reason)

		s.mu.Lock()
		if tc, exists := s.activeConn[conn]; exists {
			tc.cancel()
		}
		s.mu.Unlock()

		conn.Close()
	}
}

func (s *TCPServer) BackendHealth() BackendHealthState {
	return BackendHealthState(s.backendHealth.Load())
}

func (s *TCPServer) acceptLoop(listener net.Listener) {
	for {
		select {
		case <-s.ctx.Done():
			return
		default:
		}

		conn, err := listener.Accept()
		if err != nil {
			select {
			case <-s.ctx.Done():
				return
			default:
			}
			log.Printf("Failed to accept connection: %v", err)
			continue
		}

		if !s.isBackendHealthy() {
			log.Printf("Rejecting connection from %s: backend is unhealthy", conn.RemoteAddr())
			conn.Close()
			continue
		}

		if s.tcpKeepAliveEnabled {
			if tcpConn, ok := conn.(*net.TCPConn); ok {
				tcpConn.SetKeepAlive(true)
				tcpConn.SetKeepAlivePeriod(s.tcpKeepAlivePeriod)
			}
		}

		select {
		case s.connSem <- struct{}{}:
			s.wg.Add(1)
			go s.safeHandleConnection(conn)
		default:
			log.Printf("Connection rejected: max connections (%d) reached", s.maxConnections)
			conn.Close()
		}
	}
}

func (s *TCPServer) isBackendHealthy() bool {
	return BackendHealthState(s.backendHealth.Load()) == BackendHealthy
}

func (s *TCPServer) safeHandleConnection(conn net.Conn) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Panic recovered in connection handler: %v", r)
		}
		s.wg.Done()
		select {
		case <-s.connSem:
		default:
		}
	}()

	connCtx, connCancel := context.WithTimeout(s.ctx, s.connTimeout)
	defer connCancel()

	tc := &trackedConn{
		conn:      conn,
		cancel:    connCancel,
		startTime: time.Now(),
	}

	s.mu.Lock()
	s.activeConn[conn] = tc
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.activeConn, conn)
		s.mu.Unlock()
		conn.Close()
	}()

	s.handleConnection(connCtx, conn)
}

func (s *TCPServer) handleConnection(ctx context.Context, conn net.Conn) {
	clientAddr := conn.RemoteAddr().String()
	log.Printf("New connection from %s", clientAddr)

	buf := s.bufferPool.Get()
	defer s.bufferPool.Put(buf)

	idleTimer := time.NewTimer(s.idleTimeout)
	defer idleTimer.Stop()

	for {
		if !idleTimer.Stop() {
			select {
			case <-idleTimer.C:
			default:
			}
		}
		idleTimer.Reset(s.idleTimeout)

		select {
		case <-ctx.Done():
			log.Printf("Connection %s cancelled: %v", clientAddr, ctx.Err())
			return
		case <-idleTimer.C:
			log.Printf("Connection %s idle timeout", clientAddr)
			return
		default:
		}

		if !s.isBackendHealthy() {
			log.Printf("Backend became unhealthy, closing connection %s", clientAddr)
			return
		}

		readCtx, readCancel := context.WithTimeout(ctx, s.idleTimeout)

		n, err := s.readWithTimeout(readCtx, conn, buf)
		readCancel()

		if err != nil {
			if err != context.Canceled && err != context.DeadlineExceeded {
				if err != io.EOF {
					log.Printf("Read error from %s: %v", clientAddr, err)
				}
			}
			return
		}

		if n == 0 {
			return
		}

		log.Printf("Received %d bytes from %s", n, clientAddr)

		if !s.isBackendHealthy() {
			log.Printf("Backend is unhealthy, cannot forward request from %s", clientAddr)
			return
		}

		respCtx, respCancel := context.WithTimeout(ctx, s.httpTimeout+5*time.Second)
		response, err := s.forwardToBackend(respCtx, buf[:n])
		respCancel()

		if err != nil {
			log.Printf("Failed to forward to backend: %v", err)

			if s.healthCheckEnabled {
				s.recordHealthFailure(err)
			}

			if !s.isBackendHealthy() {
				log.Printf("Closing connection %s due to backend failure", clientAddr)
				return
			}
			continue
		}

		if len(response) > 0 {
			writeCtx, writeCancel := context.WithTimeout(ctx, 10*time.Second)
			err = s.writeWithTimeout(writeCtx, conn, response)
			writeCancel()

			if err != nil {
				log.Printf("Write error to %s: %v", clientAddr, err)
				return
			}
			log.Printf("Sent %d bytes to %s", len(response), clientAddr)
		}
	}
}

func (s *TCPServer) readWithTimeout(ctx context.Context, conn net.Conn, buf []byte) (int, error) {
	type result struct {
		n   int
		err error
	}

	ch := make(chan result, 1)

	go func() {
		conn.SetReadDeadline(time.Now().Add(s.idleTimeout))
		n, err := conn.Read(buf)
		ch <- result{n, err}
	}()

	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case res := <-ch:
		return res.n, res.err
	}
}

func (s *TCPServer) writeWithTimeout(ctx context.Context, conn net.Conn, data []byte) error {
	type result struct {
		err error
	}

	ch := make(chan result, 1)

	go func() {
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		_, err := conn.Write(data)
		ch <- result{err}
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case res := <-ch:
		return res.err
	}
}

func (s *TCPServer) forwardToBackend(ctx context.Context, data []byte) ([]byte, error) {
	jsonData, err := s.converter.BinaryToJSON(data)
	if err != nil {
		return nil, fmt.Errorf("failed to convert binary to JSON: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", s.backendURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Protocol", string(s.protocol))

	resp, err := s.httpClient.Do(req)
	if err != nil {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		return nil, fmt.Errorf("failed to send HTTP request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("backend returned status %d: %s", resp.StatusCode, string(body))
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read HTTP response: %w", err)
	}

	if len(respBody) == 0 {
		return nil, nil
	}

	var jsonResp map[string]interface{}
	if err := json.Unmarshal(respBody, &jsonResp); err != nil {
		return respBody, nil
	}

	binaryResp, err := s.converter.JSONToBinary(respBody)
	if err != nil {
		log.Printf("Warning: failed to convert JSON response to binary, returning raw: %v", err)
		return respBody, nil
	}

	return binaryResp, nil
}

func (s *TCPServer) ActiveConnections() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.activeConn)
}
