package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"dtsplatform/internal/config"
	"dtsplatform/internal/scheduler"

	"github.com/spf13/cobra"
)

func main() {
	var configPath string

	rootCmd := &cobra.Command{
		Use:   "scheduler",
		Short: "Distributed Task Scheduler",
		Run: func(cmd *cobra.Command, args []string) {
			cfg, err := config.Load(configPath)
			if err != nil {
				log.Fatalf("Failed to load config: %v", err)
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			etcdMgr, err := scheduler.NewEtcdManager(cfg)
			if err != nil {
				log.Fatalf("Failed to create etcd manager: %v", err)
			}
			defer etcdMgr.Close()

			sched := scheduler.NewScheduler(cfg, etcdMgr)
			grpcServer := scheduler.NewGRPCServer(cfg, sched)

			sigChan := make(chan os.Signal, 1)
			signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

			go func() {
				if err := grpcServer.Start(ctx); err != nil {
					log.Printf("gRPC server error: %v", err)
				}
			}()

			go func() {
				if err := sched.Start(ctx); err != nil {
					log.Printf("Scheduler error: %v", err)
				}
			}()

			log.Printf("Scheduler %s started", cfg.Scheduler.Name)

			<-sigChan
			log.Println("Shutting down...")
			cancel()
			grpcServer.Stop()
			sched.Stop()
		},
	}

	rootCmd.Flags().StringVarP(&configPath, "config", "c", "config/config.yaml", "Path to config file")

	if err := rootCmd.Execute(); err != nil {
		log.Fatal(err)
	}
}
