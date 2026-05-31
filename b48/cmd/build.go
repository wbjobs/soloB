package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"staticgen/pkg/builder"
	"staticgen/pkg/config"
	"staticgen/pkg/utils"
)

var buildCmd = &cobra.Command{
	Use:   "build",
	Short: "Build the static site",
	Long: `Build the static site by processing all content files,
applying plugins, and rendering templates.`,
	Run: func(cmd *cobra.Command, args []string) {
		if err := buildSite(); err != nil {
			fmt.Printf("Error: %v\n", err)
			os.Exit(1)
		}
	},
}

func init() {
	rootCmd.AddCommand(buildCmd)
}

func buildSite() error {
	workDir := utils.Getwd()
	cfgPath := config.GetConfigPath(workDir)

	if !utils.Exists(cfgPath) {
		return fmt.Errorf("no staticgen.yaml found. Run 'staticgen init' first")
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		return err
	}

	b, err := builder.NewBuilder(workDir, cfg)
	if err != nil {
		return err
	}

	return b.Build()
}
