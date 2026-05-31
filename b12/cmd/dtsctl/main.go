package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/spf13/cobra"
)

var (
	apiBaseURL string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "dtsctl",
		Short: "DTS Platform Command Line Tool",
		PersistentPreRun: func(cmd *cobra.Command, args []string) {
			if envURL := os.Getenv("DTS_API_URL"); envURL != "" {
				apiBaseURL = envURL
			}
		},
	}

	rootCmd.PersistentFlags().StringVarP(&apiBaseURL, "api", "a", "http://localhost:8080/api/v1", "API server URL")

	rootCmd.AddCommand(NewJobCommand())
	rootCmd.AddCommand(NewPipelineCommand())
	rootCmd.AddCommand(NewHealthCommand())

	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func NewJobCommand() *cobra.Command {
	jobCmd := &cobra.Command{
		Use:   "job",
		Short: "Manage jobs",
	}

	jobCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List all jobs",
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Get(fmt.Sprintf("%s/jobs", apiBaseURL))
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	jobCmd.AddCommand(&cobra.Command{
		Use:   "get <id>",
		Short: "Get job details",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Get(fmt.Sprintf("%s/jobs/%s", apiBaseURL, args[0]))
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	jobCmd.AddCommand(&cobra.Command{
		Use:   "trigger <id>",
		Short: "Trigger a job manually",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Post(fmt.Sprintf("%s/jobs/%s/trigger", apiBaseURL, args[0]), "application/json", nil)
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	jobCmd.AddCommand(&cobra.Command{
		Use:   "pause <id>",
		Short: "Pause a job",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Post(fmt.Sprintf("%s/jobs/%s/pause", apiBaseURL, args[0]), "application/json", nil)
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	jobCmd.AddCommand(&cobra.Command{
		Use:   "resume <id>",
		Short: "Resume a paused job",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Post(fmt.Sprintf("%s/jobs/%s/resume", apiBaseURL, args[0]), "application/json", nil)
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	jobCmd.AddCommand(&cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a job",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/jobs/%s", apiBaseURL, args[0]), nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	jobCmd.AddCommand(&cobra.Command{
		Use:   "executions <id>",
		Short: "Get job execution history",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Get(fmt.Sprintf("%s/jobs/%s/executions", apiBaseURL, args[0]))
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	return jobCmd
}

func NewPipelineCommand() *cobra.Command {
	pipelineCmd := &cobra.Command{
		Use:   "pipeline",
		Short: "Manage streaming pipelines",
	}

	pipelineCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List all pipelines",
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Get(fmt.Sprintf("%s/pipelines", apiBaseURL))
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	pipelineCmd.AddCommand(&cobra.Command{
		Use:   "start <id>",
		Short: "Start a pipeline",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Post(fmt.Sprintf("%s/pipelines/%s/start", apiBaseURL, args[0]), "application/json", nil)
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	pipelineCmd.AddCommand(&cobra.Command{
		Use:   "stop <id>",
		Short: "Stop a pipeline",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Post(fmt.Sprintf("%s/pipelines/%s/stop", apiBaseURL, args[0]), "application/json", nil)
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	})

	return pipelineCmd
}

func NewHealthCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "health",
		Short: "Check API server health",
		Run: func(cmd *cobra.Command, args []string) {
			resp, err := http.Get(fmt.Sprintf("%s/health", apiBaseURL))
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer resp.Body.Close()
			printResponse(resp)
		},
	}
}

func printResponse(resp *http.Response) {
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		fmt.Printf("Error: %s\n", resp.Status)
		if len(body) > 0 {
			fmt.Println(formatJSON(body))
		}
		return
	}

	if len(body) > 0 {
		fmt.Println(formatJSON(body))
	}
	fmt.Printf("Status: %s\n", resp.Status)
}

func formatJSON(data []byte) string {
	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, data, "", "  "); err != nil {
		return string(data)
	}
	return prettyJSON.String()
}
