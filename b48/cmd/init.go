package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"staticgen/pkg/config"
	"staticgen/pkg/utils"
)

var initCmd = &cobra.Command{
	Use:   "init [path]",
	Short: "Initialize a new static site",
	Long: `Initialize a new static site in the current directory or specified path.
This creates the directory structure, config file, and sample content.`,
	Run: func(cmd *cobra.Command, args []string) {
		targetDir := "."
		if len(args) > 0 {
			targetDir = args[0]
		}

		if err := initializeSite(targetDir); err != nil {
			fmt.Printf("Error: %v\n", err)
			os.Exit(1)
		}
	},
}

func init() {
	rootCmd.AddCommand(initCmd)
}

func initializeSite(path string) error {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("failed to get absolute path: %w", err)
	}

	if err := utils.EnsureDir(absPath); err != nil {
		return err
	}

	entries, _ := os.ReadDir(absPath)
	if len(entries) > 0 {
		return fmt.Errorf("directory %s is not empty", absPath)
	}

	fmt.Printf("Initializing site at %s\n", absPath)

	dirs := []string{
		"content",
		"content/posts",
		"static",
		"static/css",
		"static/js",
		"static/images",
		"plugins",
		"themes/default/layouts",
		"themes/default/layouts/partials",
		"public",
	}

	for _, dir := range dirs {
		fullPath := filepath.Join(absPath, dir)
		if err := utils.EnsureDir(fullPath); err != nil {
			return err
		}
	}

	cfg := config.Default()
	cfgPath := filepath.Join(absPath, "staticgen.yaml")
	if err := config.Save(cfg, cfgPath); err != nil {
		return err
	}
	fmt.Println("  Created: staticgen.yaml")

	indexContent := `---
title: Welcome
date: 2024-01-01
description: Welcome to my new static site
---

# Welcome to StaticGen

This is your first page. You can edit this file or create new ones.

## Features

- Fast static site generation
- Plugin support
- Live reload during development
- Template engine

Start the development server with:
` + "`staticgen serve`"
	indexPath := filepath.Join(absPath, "content", "_index.md")
	if err := os.WriteFile(indexPath, []byte(indexContent), 0644); err != nil {
		return err
	}
	fmt.Println("  Created: content/_index.md")

	postContent := `---
title: My First Post
date: ` + utils.FormatDate(time.Now(), "2006-01-02") + `
author: Admin
description: This is my first blog post
tags:
  - hello
  - first
---

# Hello World!

This is my first blog post.

## What I learned

1. Static sites are fast
2. Markdown is easy
3. StaticGen is awesome

## Shortcodes Example

StaticGen supports custom shortcodes that can be rendered by plugins.

### Video Shortcode

Embed a YouTube video:

` + "`{{< video id=\"abc123\" >}}`" + `

Embed a Bilibili video:

` + "`{{< video id=\"BV1xx411c7mD\" >}}`" + `

Or with custom dimensions:

` + "`{{< video id=\"abc123\" width=\"800\" height=\"450\" >}}`" + `

Self-closing syntax:

` + "`{{< video id=\"abc123\" />}}`" + `

HTML5 video with source:

` + "`{{< video src=\"/videos/my-video.mp4\" poster=\"/images/poster.jpg\" >}}`" + `
`
	postPath := filepath.Join(absPath, "content", "posts", "first-post.md")
	if err := os.WriteFile(postPath, []byte(postContent), 0644); err != nil {
		return err
	}
	fmt.Println("  Created: content/posts/first-post.md")

	styleContent := `body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #333;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
}

a {
    color: #007bff;
    text-decoration: none;
}

a:hover {
    text-decoration: underline;
}

header {
    border-bottom: 1px solid #eee;
    padding-bottom: 20px;
    margin-bottom: 30px;
}

footer {
    border-top: 1px solid #eee;
    padding-top: 20px;
    margin-top: 30px;
    color: #666;
    font-size: 0.9em;
}

h1, h2, h3 {
    color: #222;
}

pre {
    background: #f5f5f5;
    padding: 15px;
    border-radius: 4px;
    overflow-x: auto;
}

code {
    background: #f5f5f5;
    padding: 2px 6px;
    border-radius: 3px;
}

.tags {
    margin-top: 20px;
}

.tag {
    background: #007bff;
    color: white;
    padding: 3px 10px;
    border-radius: 15px;
    margin-right: 8px;
    font-size: 0.85em;
}
`
	stylePath := filepath.Join(absPath, "static", "css", "style.css")
	if err := os.WriteFile(stylePath, []byte(styleContent), 0644); err != nil {
		return err
	}
	fmt.Println("  Created: static/css/style.css")

	fmt.Println("\nSite initialized successfully!")
	fmt.Printf("Run 'cd %s && staticgen serve' to start development server\n", absPath)

	return nil
}
