package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "staticgen",
	Short: "A static site generator written in Go",
	Long: `StaticGen is a static site generator built with Go.
It supports markdown content, plugins, templates, and live reload.`,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}
