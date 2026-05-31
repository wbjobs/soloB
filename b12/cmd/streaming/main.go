package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"dtsplatform/internal/config"
	"dtsplatform/internal/streaming"

	"github.com/spf13/cobra"
)

func main() {
	var configPath string

	rootCmd := &cobra.Command{
		Use:   "streaming",
		Short: "Distributed Streaming Service",
		Run: func(cmd *cobra.Command, args []string) {
			cfg, err := config.Load(configPath)
			if err != nil {
				log.Fatalf("Failed to load config: %v", err)
			}

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			manager := streaming.NewStreamManager(cfg)

			sigChan := make(chan os.Signal, 1)
			signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

			go func() {
				if err := manager.Start(ctx); err != nil {
					log.Printf("Streaming manager error: %v", err)
				}
			}()

			log.Printf("Streaming service %s started", cfg.Streaming.Name)

			<-sigChan
			log.Println("Shutting down...")
			cancel()
			manager.Stop()
		},
	}

	rootCmd.Flags().StringVarP(&configPath, "config", "c", "config/config.yaml", "Path to config file")

	if err := rootCmd.Execute(); err != nil {
		log.Fatal(err)
	}
}
