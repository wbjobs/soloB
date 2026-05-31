package content

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type FrontMatter struct {
	Title       string    `yaml:"title"`
	Date        time.Time `yaml:"date"`
	Author      string    `yaml:"author"`
	Description string    `yaml:"description"`
	Tags        []string  `yaml:"tags"`
	Draft       bool      `yaml:"draft"`
	Layout      string    `yaml:"layout"`
	Weight      int       `yaml:"weight"`
}

type Page struct {
	FrontMatter
	Content    string
	RawContent string
	SourcePath string
	OutputPath string
	Permalink  string
}

type Post struct {
	Page
}

func ParseFrontMatter(content string) (*FrontMatter, string, error) {
	content = strings.TrimSpace(content)
	
	if !strings.HasPrefix(content, "---") {
		return &FrontMatter{}, content, nil
	}

	parts := strings.SplitN(content, "---", 3)
	if len(parts) < 3 {
		return &FrontMatter{}, content, nil
	}

	fmContent := strings.TrimSpace(parts[1])
	body := strings.TrimSpace(parts[2])

	fm := &FrontMatter{}
	if fmContent != "" {
		if err := yaml.Unmarshal([]byte(fmContent), fm); err != nil {
			return nil, "", fmt.Errorf("failed to parse front matter: %w", err)
		}
	}

	return fm, body, nil
}

func GeneratePermalink(sourcePath, contentDir string) string {
	relPath, _ := filepath.Rel(contentDir, sourcePath)
	ext := filepath.Ext(relPath)
	permalink := strings.TrimSuffix(relPath, ext)
	
	base := filepath.Base(permalink)
	if base == "index" || base == "_index" {
		dir := filepath.Dir(permalink)
		if dir == "." {
			permalink = ""
		} else {
			permalink = dir
		}
	}
	
	result := "/" + filepath.ToSlash(permalink)
	if !strings.HasSuffix(result, "/") {
		result += "/"
	}
	if result == "//" {
		result = "/"
	}
	return result
}

func GenerateOutputPath(sourcePath, contentDir, outputDir string) string {
	relPath, _ := filepath.Rel(contentDir, sourcePath)
	ext := filepath.Ext(relPath)
	base := strings.TrimSuffix(relPath, ext)
	
	filename := filepath.Base(base)
	var outputRel string
	if filename == "index" || filename == "_index" {
		dir := filepath.Dir(base)
		if dir == "." {
			outputRel = "index.html"
		} else {
			outputRel = filepath.Join(dir, "index.html")
		}
	} else {
		outputRel = filepath.Join(base, "index.html")
	}
	
	return filepath.Join(outputDir, outputRel)
}
