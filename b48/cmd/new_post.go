package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"staticgen/pkg/utils"
)

var (
	newPostTitle  string
	newPostDate   string
	newPostTags   []string
	newPostAuthor string
	newPostDraft  bool
)

var newPostCmd = &cobra.Command{
	Use:   "new_post [title]",
	Short: "Create a new blog post",
	Long: `Create a new blog post with front matter.
The post will be created in the content/posts directory.`,
	Run: func(cmd *cobra.Command, args []string) {
		title := newPostTitle
		if len(args) > 0 {
			title = strings.Join(args, " ")
		}

		if title == "" {
			fmt.Println("Error: title is required")
			os.Exit(1)
		}

		if err := createNewPost(title); err != nil {
			fmt.Printf("Error: %v\n", err)
			os.Exit(1)
		}
	},
}

func init() {
	rootCmd.AddCommand(newPostCmd)

	newPostCmd.Flags().StringVarP(&newPostTitle, "title", "t", "", "Post title")
	newPostCmd.Flags().StringVar(&newPostDate, "date", "", "Post date (YYYY-MM-DD)")
	newPostCmd.Flags().StringSliceVar(&newPostTags, "tags", []string{}, "Post tags (comma-separated)")
	newPostCmd.Flags().StringVarP(&newPostAuthor, "author", "a", "", "Post author")
	newPostCmd.Flags().BoolVar(&newPostDraft, "draft", false, "Mark as draft")
}

func createNewPost(title string) error {
	workDir := utils.Getwd()
	contentDir := filepath.Join(workDir, "content", "posts")

	if err := utils.EnsureDir(contentDir); err != nil {
		return err
	}

	slug := utils.Slugify(title)
	filename := slug + ".md"
	filePath := filepath.Join(contentDir, filename)

	if utils.Exists(filePath) {
		return fmt.Errorf("post already exists: %s", filePath)
	}

	date := newPostDate
	if date == "" {
		date = utils.FormatDate(time.Now(), "2006-01-02")
	}

	tagsYaml := ""
	if len(newPostTags) > 0 {
		tagsYaml = "\ntags:\n"
		for _, tag := range newPostTags {
			tagsYaml += fmt.Sprintf("  - %s\n", strings.TrimSpace(tag))
		}
	}

	draftYaml := ""
	if newPostDraft {
		draftYaml = "\ndraft: true"
	}

	authorYaml := ""
	if newPostAuthor != "" {
		authorYaml = fmt.Sprintf("\nauthor: %s", newPostAuthor)
	}

	content := fmt.Sprintf(`---
title: %s
date: %s%s%s%s
---

# %s

Write your content here...
`, title, date, authorYaml, tagsYaml, draftYaml, title)

	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write post: %w", err)
	}

	fmt.Printf("Created new post: %s\n", filePath)
	fmt.Println("Edit this file to add your content.")

	return nil
}
