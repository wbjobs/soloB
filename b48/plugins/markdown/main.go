package main

import (
	"bytes"

	"github.com/gomarkdown/markdown"
	"github.com/gomarkdown/markdown/html"
	"github.com/gomarkdown/markdown/parser"
)

type MarkdownProcessor struct{}

var Processor MarkdownProcessor

func (p MarkdownProcessor) Name() string {
	return "markdown_plugin"
}

func (p MarkdownProcessor) Version() string {
	return "1.0.0"
}

func (p MarkdownProcessor) Extensions() []string {
	return []string{".md", ".markdown"}
}

func (p MarkdownProcessor) Process(input []byte, ctx map[string]interface{}) ([]byte, error) {
	extensions := parser.CommonExtensions | parser.AutoHeadingIDs | parser.NoEmptyLineBeforeBlock
	pParser := parser.NewWithExtensions(extensions)

	htmlFlags := html.CommonFlags | html.HrefTargetBlank
	opts := html.RendererOptions{Flags: htmlFlags}
	renderer := html.NewRenderer(opts)

	doc := pParser.Parse(input)
	result := markdown.Render(doc, renderer)

	return bytes.TrimSpace(result), nil
}
