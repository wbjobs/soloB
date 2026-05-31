package builder

import (
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"staticgen/pkg/config"
	"staticgen/pkg/content"
	"staticgen/pkg/plugin"
	"staticgen/pkg/template"
	"staticgen/pkg/utils"
)

type Builder struct {
	cfg          *config.Config
	workDir      string
	pluginMgr    *plugin.Manager
	templateEng  *template.Engine
	contentDir   string
	outputDir    string
	pluginsDir   string
	staticDir    string
	themesDir    string
}

func NewBuilder(workDir string, cfg *config.Config) (*Builder, error) {
	b := &Builder{
		cfg:        cfg,
		workDir:    workDir,
		pluginMgr:  plugin.NewManager(),
		contentDir: filepath.Join(workDir, cfg.SourceDir),
		outputDir:  filepath.Join(workDir, cfg.OutputDir),
		pluginsDir: filepath.Join(workDir, cfg.PluginsDir),
		staticDir:  filepath.Join(workDir, "static"),
		themesDir:  filepath.Join(workDir, "themes"),
	}

	b.templateEng = template.NewEngine(cfg)
	if err := b.templateEng.LoadFromDir(workDir); err != nil {
		return nil, err
	}

	return b, nil
}

func (b *Builder) LoadPlugins() {
	if _, err := os.Stat(b.pluginsDir); os.IsNotExist(err) {
		return
	}

	for _, pluginName := range b.cfg.Plugins {
		pluginPath := filepath.Join(b.pluginsDir, pluginName+".so")
		if _, err := os.Stat(pluginPath); os.IsNotExist(err) {
			fmt.Printf("Warning: plugin %s not found at %s, skipping\n", pluginName, pluginPath)
			continue
		}

		if err := b.pluginMgr.LoadPlugin(pluginPath); err != nil {
			fmt.Printf("Error: failed to load plugin %s: %v\n", pluginName, err)
			fmt.Println("Continuing without this plugin...")
		}
	}
}

func (b *Builder) Build() error {
	fmt.Println("Building site...")
	start := time.Now()

	if err := utils.EnsureDir(b.outputDir); err != nil {
		return err
	}

	b.LoadPlugins()

	pages, err := b.loadAllPages()
	if err != nil {
		return err
	}

	if err := b.processPages(pages); err != nil {
		return err
	}

	if err := b.copyStaticFiles(); err != nil {
		return err
	}

	elapsed := time.Since(start)
	fmt.Printf("Build completed in %s\n", elapsed)
	fmt.Printf("Generated %d pages in %s\n", len(pages), b.outputDir)

	return nil
}

func (b *Builder) loadAllPages() ([]*content.Page, error) {
	var pages []*content.Page

	if _, err := os.Stat(b.contentDir); os.IsNotExist(err) {
		return pages, nil
	}

	err := filepath.Walk(b.contentDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !b.shouldProcessFile(ext) {
			return nil
		}

		page, err := b.loadPage(path)
		if err != nil {
			return err
		}

		if page.FrontMatter.Draft {
			return nil
		}

		pages = append(pages, page)
		return nil
	})

	if err != nil {
		return nil, err
	}

	sort.Slice(pages, func(i, j int) bool {
		if pages[i].FrontMatter.Weight != pages[j].FrontMatter.Weight {
			return pages[i].FrontMatter.Weight < pages[j].FrontMatter.Weight
		}
		return pages[i].FrontMatter.Date.After(pages[j].FrontMatter.Date)
	})

	return pages, nil
}

func (b *Builder) shouldProcessFile(ext string) bool {
	if ext == ".md" || ext == ".markdown" {
		return true
	}
	if ext == ".html" {
		return true
	}
	return b.pluginMgr.HasProcessor(ext)
}

func (b *Builder) loadPage(path string) (*content.Page, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %w", path, err)
	}

	fm, body, err := content.ParseFrontMatter(string(data))
	if err != nil {
		return nil, err
	}

	if fm.Date.IsZero() {
		info, _ := os.Stat(path)
		fm.Date = info.ModTime()
	}

	if fm.Author == "" {
		fm.Author = b.cfg.Author
	}

	return &content.Page{
		FrontMatter: *fm,
		RawContent:  body,
		SourcePath:  path,
		OutputPath:  content.GenerateOutputPath(path, b.contentDir, b.outputDir),
		Permalink:   content.GeneratePermalink(path, b.contentDir),
	}, nil
}

func (b *Builder) processPages(pages []*content.Page) error {
	pageCtxs := b.buildPageContexts(pages)
	siteCtx := &template.SiteContext{
		Name:        b.cfg.SiteName,
		Description: b.cfg.Description,
		BaseURL:     b.cfg.BaseURL,
		Author:      b.cfg.Author,
		Pages:       pageCtxs,
	}

	for _, page := range pages {
		if err := b.processPage(page, siteCtx, pages); err != nil {
			return err
		}
	}

	return nil
}

func (b *Builder) buildPageContexts(pages []*content.Page) []*template.PageContext {
	ctxs := make([]*template.PageContext, 0, len(pages))
	for _, p := range pages {
		ctxs = append(ctxs, &template.PageContext{
			Title:       p.FrontMatter.Title,
			Date:        utils.FormatDate(p.FrontMatter.Date, ""),
			Author:      p.FrontMatter.Author,
			Description: p.FrontMatter.Description,
			Tags:        p.FrontMatter.Tags,
			Permalink:   p.Permalink,
			Path:        p.OutputPath,
		})
	}
	return ctxs
}

func (b *Builder) processPage(page *content.Page, siteCtx *template.SiteContext, allPages []*content.Page) error {
	ext := strings.ToLower(filepath.Ext(page.SourcePath))
	var processedContent string

	shortcodeCtx := map[string]interface{}{
		"page":  page,
		"site":  siteCtx,
		"pages": allPages,
	}

	contentWithShortcodes, err := b.pluginMgr.ProcessShortcodes(page.RawContent, shortcodeCtx)
	if err != nil {
		return fmt.Errorf("failed to process shortcodes in %s: %w", page.SourcePath, err)
	}

	if b.pluginMgr.HasProcessor(ext) {
		ctx := map[string]interface{}{
			"page":  page,
			"site":  siteCtx,
			"pages": allPages,
		}
		result, err := b.pluginMgr.ProcessFile(ext, []byte(contentWithShortcodes), ctx)
		if err != nil {
			return fmt.Errorf("failed to process %s: %w", page.SourcePath, err)
		}
		processedContent = string(result)
	} else if ext == ".md" || ext == ".markdown" {
		processedContent = b.simpleMarkdownToHTML(contentWithShortcodes)
	} else {
		processedContent = contentWithShortcodes
	}

	layout := page.FrontMatter.Layout
	if layout == "" {
		layout = "single"
	}

	tplCtx := &template.TemplateContext{
		Site: siteCtx,
		Page: &template.PageContext{
			Title:       page.FrontMatter.Title,
			Date:        utils.FormatDate(page.FrontMatter.Date, ""),
			Author:      page.FrontMatter.Author,
			Description: page.FrontMatter.Description,
			Tags:        page.FrontMatter.Tags,
			Permalink:   page.Permalink,
			Path:        page.OutputPath,
		},
		Content: template.HTML(processedContent),
		Path:    page.Permalink,
	}

	output, err := b.templateEng.RenderToString(layout, tplCtx)
	if err != nil {
		return fmt.Errorf("failed to render template for %s: %w", page.SourcePath, err)
	}

	if err := utils.EnsureDir(filepath.Dir(page.OutputPath)); err != nil {
		return err
	}

	if err := os.WriteFile(page.OutputPath, []byte(output), 0644); err != nil {
		return fmt.Errorf("failed to write output file %s: %w", page.OutputPath, err)
	}

	fmt.Printf("  Generated: %s\n", page.Permalink)
	return nil
}

func (b *Builder) simpleMarkdownToHTML(md string) string {
	lines := strings.Split(md, "\n")
	var html strings.Builder
	inList := false

	for _, line := range lines {
		line = strings.TrimSpace(line)

		if strings.HasPrefix(line, "### ") {
			if inList {
				html.WriteString("</ul>\n")
				inList = false
			}
			html.WriteString(fmt.Sprintf("<h3>%s</h3>\n", line[4:]))
		} else if strings.HasPrefix(line, "## ") {
			if inList {
				html.WriteString("</ul>\n")
				inList = false
			}
			html.WriteString(fmt.Sprintf("<h2>%s</h2>\n", line[3:]))
		} else if strings.HasPrefix(line, "# ") {
			if inList {
				html.WriteString("</ul>\n")
				inList = false
			}
			html.WriteString(fmt.Sprintf("<h1>%s</h1>\n", line[2:]))
		} else if strings.HasPrefix(line, "- ") || strings.HasPrefix(line, "* ") {
			if !inList {
				html.WriteString("<ul>\n")
				inList = true
			}
			html.WriteString(fmt.Sprintf("<li>%s</li>\n", line[2:]))
		} else if line == "" {
			if inList {
				html.WriteString("</ul>\n")
				inList = false
			}
			html.WriteString("<br>\n")
		} else if line != "" {
			if inList {
				html.WriteString("</ul>\n")
				inList = false
			}
			html.WriteString(fmt.Sprintf("<p>%s</p>\n", line))
		}
	}

	if inList {
		html.WriteString("</ul>\n")
	}

	return html.String()
}

func (b *Builder) copyStaticFiles() error {
	if _, err := os.Stat(b.staticDir); os.IsNotExist(err) {
		return nil
	}

	return filepath.Walk(b.staticDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		relPath, _ := filepath.Rel(b.staticDir, path)
		dstPath := filepath.Join(b.outputDir, relPath)

		if err := utils.CopyFile(path, dstPath); err != nil {
			return err
		}

		fmt.Printf("  Copied: /%s\n", filepath.ToSlash(relPath))
		return nil
	})
}

func (b *Builder) Clean() error {
	if _, err := os.Stat(b.outputDir); os.IsNotExist(err) {
		return nil
	}
	return os.RemoveAll(b.outputDir)
}

func (b *Builder) Rebuild() error {
	if err := b.Clean(); err != nil {
		return err
	}
	return b.Build()
}
