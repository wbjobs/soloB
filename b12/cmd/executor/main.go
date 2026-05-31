package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"dtsplatform/internal/config"
	"dtsplatform/internal/executor"

	"github.com/spf13/cobra"
)

func main() {
	var configPath string

	rootCmd := &cobra.Command{
		Use:   "executor",
		Short: "Distributed Task Executor",
		Run: func(cmd *cobra.Command, args []string) {
			cfg, err := config.Load(configPath)
			if err != nil {
				log.Fatalf("Failed to load config: %v", err)
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			exec := executor.NewExecutor(cfg)

			sigChan := make(chan os.Signal, 1)
			signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

			go func() {
				if err := exec.Start(ctx); err != nil {
					log.Printf("Executor error: %v", err)
				}
			}()

			log.Printf("Executor %s started", cfg.Executor.Name)

			<-sigChan
			log.Println("Shutting down...")
			cancel()
			exec.Stop()
		},
	}

	rootCmd.Flags().StringVarP(&configPath, "config", "c", "config/config.yaml", "Path to config file")

	if err := rootCmd.Execute(); err != nil {
		log.Fatal(err)
	}
}
