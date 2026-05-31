package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tcproxy/proxy"
)

func main() {
	listenAddr := flag.String("listen", ":9000", "TCP listen address")
	backendURL := flag.String("backend", "http://localhost:8080/api/modbus", "Backend HTTP service URL")
	protocol := flag.String("protocol", "modbus", "Protocol type: modbus or generic")
	bufferSize := flag.Int("buffer", 4096, "Buffer size in bytes")
	maxConns := flag.Int("max-conns", 100, "Maximum concurrent connections")
	httpTimeout := flag.Int("http-timeout", 30, "HTTP request timeout in seconds")
	connTimeout := flag.Int("conn-timeout", 300, "Maximum connection lifetime in seconds")
	idleTimeout := flag.Int("idle-timeout", 30, "Connection idle timeout in seconds")

	keepAliveEnabled := flag.Bool("keep-alive", true, "Enable TCP Keep-Alive")
	keepAlivePeriod := flag.Int("keep-alive-period", 30, "TCP Keep-Alive period in seconds")

	healthCheckEnabled := flag.Bool("health-check", true, "Enable backend health check")
	healthCheckURL := flag.String("health-url", "", "Backend health check URL (default: derived from backend URL)")
	healthCheckInterval := flag.Int("health-interval", 10, "Health check interval in seconds")
	healthCheckTimeout := flag.Int("health-timeout", 5, "Health check timeout in seconds")
	healthFailureThreshold := flag.Int("health-failures", 3, "Consecutive failures before marking backend unhealthy")
	healthSuccessThreshold := flag.Int("health-successes", 2, "Consecutive successes before marking backend healthy")

	flag.Parse()

	var proto proxy.ProtocolType
	switch *protocol {
	case "modbus":
		proto = proxy.ProtocolModbus
	case "generic":
		proto = proxy.ProtocolGeneric
	default:
		log.Fatalf("Unknown protocol: %s. Use 'modbus' or 'generic'", *protocol)
	}

	config := proxy.TCPServerConfig{
		ListenAddr:     *listenAddr,
		BackendURL:     *backendURL,
		Protocol:       proto,
		BufferSize:     *bufferSize,
		MaxConnections: *maxConns,
		HTTPTimeout:    time.Duration(*httpTimeout) * time.Second,
		ConnTimeout:    time.Duration(*connTimeout) * time.Second,
		IdleTimeout:    time.Duration(*idleTimeout) * time.Second,

		TCPKeepAliveEnabled: *keepAliveEnabled,
		TCPKeepAlivePeriod:  time.Duration(*keepAlivePeriod) * time.Second,

		HealthCheckEnabled:     *healthCheckEnabled,
		HealthCheckURL:         *healthCheckURL,
		HealthCheckInterval:    time.Duration(*healthCheckInterval) * time.Second,
		HealthCheckTimeout:     time.Duration(*healthCheckTimeout) * time.Second,
		HealthFailureThreshold: *healthFailureThreshold,
		HealthSuccessThreshold: *healthSuccessThreshold,
	}

	server := proxy.NewTCPServer(config)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	serverErr := make(chan error, 1)
	go func() {
		serverErr <- server.Start()
	}()

	select {
	case err := <-serverErr:
		if err != nil {
			log.Fatalf("Server error: %v", err)
		}
	case <-stop:
		log.Println("Received shutdown signal, stopping server...")
		server.Stop()
	}

	log.Println("Server stopped")
}
