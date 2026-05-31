package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"staticgen/pkg/config"
	"staticgen/pkg/server"
	"staticgen/pkg/utils"
)

var servePort int

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the development server",
	Long: `Start a local HTTP server for development.
Watches for file changes and automatically rebuilds and refreshes the browser.`,
	Run: func(cmd *cobra.Command, args []string) {
		if err := serveSite(); err != nil {
			fmt.Printf("Error: %v\n", err)
			os.Exit(1)
		}
	},
}

func init() {
	rootCmd.AddCommand(serveCmd)
	serveCmd.Flags().IntVarP(&servePort, "port", "p", 1313, "Port to serve on")
}

func serveSite() error {
	workDir := utils.Getwd()
	cfgPath := config.GetConfigPath(workDir)

	if !utils.Exists(cfgPath) {
		return fmt.Errorf("no staticgen.yaml found. Run 'staticgen init' first")
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		return err
	}

	s, err := server.NewServer(workDir, cfg, servePort)
	if err != nil {
		return err
	}

	return s.Start()
}
