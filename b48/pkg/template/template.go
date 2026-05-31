package template

import (
	"bytes"
	"fmt"
	"html/template"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"staticgen/pkg/config"
)

type Engine struct {
	templates map[string]*template.Template
	cfg       *config.Config
	funcMap   template.FuncMap
}

type TemplateContext struct {
	Site      *SiteContext
	Page      *PageContext
	Content   template.HTML
	Path      string
}

type SiteContext struct {
	Name        string
	Description string
	BaseURL     string
	Author      string
	Pages       []*PageContext
}

type PageContext struct {
	Title       string
	Date        string
	Author      string
	Description string
	Tags        []string
	Permalink   string
	Path        string
}

func NewEngine(cfg *config.Config) *Engine {
	return &Engine{
		templates: make(map[string]*template.Template),
		cfg:       cfg,
		funcMap: template.FuncMap{
			"now": func() time.Time {
				return time.Now()
			},
			"date": func(t time.Time, format string) string {
				return t.Format(format)
			},
			"upper": strings.ToUpper,
			"lower": strings.ToLower,
			"safeHTML": func(s string) template.HTML {
				return template.HTML(s)
			},
		},
	}
}

func (e *Engine) LoadFromDir(dir string) error {
	themeDir := filepath.Join(dir, "themes", e.cfg.Theme, "layouts")
	if _, err := os.Stat(themeDir); os.IsNotExist(err) {
		return nil
	}

	err := filepath.Walk(themeDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		ext := filepath.Ext(path)
		if ext != ".html" && ext != ".tmpl" {
			return nil
		}

		relPath, _ := filepath.Rel(themeDir, path)
		name := strings.TrimSuffix(relPath, ext)

		tmpl, err := template.New(filepath.Base(path)).Funcs(e.funcMap).ParseFiles(path)
		if err != nil {
			return fmt.Errorf("failed to parse template %s: %w", path, err)
		}

		partialsDir := filepath.Join(themeDir, "partials")
		if _, err := os.Stat(partialsDir); err == nil {
			partialFiles, _ := filepath.Glob(filepath.Join(partialsDir, "*.html"))
			if len(partialFiles) > 0 {
				tmpl, err = tmpl.ParseFiles(partialFiles...)
				if err != nil {
					return fmt.Errorf("failed to parse partials: %w", err)
				}
			}
		}

		e.templates[name] = tmpl
		return nil
	})

	return err
}

func (e *Engine) Render(w io.Writer, name string, ctx *TemplateContext) error {
	tmpl, ok := e.templates[name]
	if !ok {
		return e.renderDefault(w, ctx)
	}

	return tmpl.Execute(w, ctx)
}

func (e *Engine) renderDefault(w io.Writer, ctx *TemplateContext) error {
	defaultTmpl := `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    {{ if .Page.Description }}<meta name="description" content="{{ .Page.Description }}">{{ end }}
    <title>{{ if .Page.Title }}{{ .Page.Title }} - {{ end }}{{ .Site.Name }}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
        header { border-bottom: 1px solid #eee; padding-bottom: 20px; margin-bottom: 30px; }
        footer { border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; color: #666; }
        nav a { margin-right: 15px; color: #007bff; text-decoration: none; }
        nav a:hover { text-decoration: underline; }
        h1 { color: #333; }
        .tags .tag { background: #007bff; color: white; padding: 2px 8px; border-radius: 4px; margin-right: 5px; font-size: 0.9em; }
        .meta { color: #666; font-size: 0.9em; margin-bottom: 20px; }
    </style>
</head>
<body>
    <header>
        <h1><a href="{{ .Site.BaseURL }}">{{ .Site.Name }}</a></h1>
        {{ if .Site.Description }}<p>{{ .Site.Description }}</p>{{ end }}
    </header>
    <main>
        {{ if .Page.Title }}<h1>{{ .Page.Title }}</h1>{{ end }}
        {{ if .Page.Date }}<div class="meta">{{ .Page.Date }}</div>{{ end }}
        <article>
            {{ .Content }}
        </article>
        {{ if .Page.Tags }}
        <div class="tags">
            {{ range .Page.Tags }}<span class="tag">{{ . }}</span>{{ end }}
        </div>
        {{ end }}
    </main>
    <footer>
        <p>&copy; {{ now.Format "2006" }} {{ .Site.Name }}. Powered by staticgen.</p>
    </footer>
</body>
</html>`

	tmpl, err := template.New("default").Funcs(e.funcMap).Parse(defaultTmpl)
	if err != nil {
		return fmt.Errorf("failed to parse default template: %w", err)
	}

	return tmpl.Execute(w, ctx)
}

func (e *Engine) RenderToString(name string, ctx *TemplateContext) (string, error) {
	var buf bytes.Buffer
	if err := e.Render(&buf, name, ctx); err != nil {
		return "", err
	}
	return buf.String(), nil
}
