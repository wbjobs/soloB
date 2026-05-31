package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dtsplatform/internal/api"
	"dtsplatform/internal/config"
	"dtsplatform/internal/monitoring"
	"dtsplatform/internal/scheduler"
	"dtsplatform/internal/streaming"
	"dtsplatform/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/spf13/cobra"
)

func main() {
	var configPath string

	rootCmd := &cobra.Command{
		Use:   "apiserver",
		Short: "DTS Platform API Server",
		Run: func(cmd *cobra.Command, args []string) {
			cfg, err := config.Load(configPath)
			if err != nil {
				log.Fatalf("Failed to load config: %v", err)
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			metrics := monitoring.NewMetrics("dts")

			var pgStore *store.PostgresStore
			if cfg.Database.Host != "" {
				pgStore, err = store.NewPostgresStore(cfg)
				if err != nil {
					log.Printf("Warning: failed to connect to postgres: %v", err)
				} else {
					defer pgStore.Close()
				}
			}

			var redisStore *store.RedisStore
			if cfg.Redis.Addr != "" {
				redisStore, err = store.NewRedisStore(cfg)
				if err != nil {
					log.Printf("Warning: failed to connect to redis: %v", err)
				} else {
					defer redisStore.Close()
				}
			}

			var minioStore *store.MinioStore
			if cfg.Minio.Endpoint != "" {
				minioStore, err = store.NewMinioStore(cfg)
				if err != nil {
					log.Printf("Warning: failed to connect to minio: %v", err)
				}
			}

			etcdMgr, err := scheduler.NewEtcdManager(cfg)
			if err != nil {
				log.Fatalf("Failed to create etcd manager: %v", err)
			}
			defer etcdMgr.Close()

			sched := scheduler.NewScheduler(cfg, etcdMgr)
			streamMgr := streaming.NewStreamManager(cfg)

			handler := api.NewAPIHandler(cfg, sched, streamMgr, pgStore, redisStore, minioStore, metrics)

			r := gin.Default()
			handler.RegisterRoutes(r)

			server := &http.Server{
				Addr:    fmt.Sprintf(":%d", cfg.Scheduler.HTTPPort),
				Handler: r,
			}

			go func() {
				etcdMgr.SetLeaderCallbacks(
					func() { log.Println("API server is leader") },
					func() { log.Println("API server is follower") },
				)
				etcdMgr.StartElection(ctx)
			}()

			go func() {
				if err := sched.Start(ctx); err != nil {
					log.Printf("Scheduler error: %v", err)
				}
			}()

			go func() {
				if err := streamMgr.Start(ctx); err != nil {
					log.Printf("Streaming manager error: %v", err)
				}
			}()

			go func() {
				log.Printf("API server listening on :%d", cfg.Scheduler.HTTPPort)
				if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
					log.Printf("Server error: %v", err)
				}
			}()

			sigChan := make(chan os.Signal, 1)
			signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

			<-sigChan
			log.Println("Shutting down...")

			shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer shutdownCancel()

			server.Shutdown(shutdownCtx)
			cancel()
		},
	}

	rootCmd.Flags().StringVarP(&configPath, "config", "c", "config/config.yaml", "Path to config file")

	if err := rootCmd.Execute(); err != nil {
		log.Fatal(err)
	}
}
