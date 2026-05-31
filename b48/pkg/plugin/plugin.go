package plugin

import (
	"fmt"
	"path/filepath"
	"plugin"
	"regexp"
	"runtime/debug"
	"strings"
)

type FileProcessor interface {
	Extensions() []string
	Process(input []byte, ctx map[string]interface{}) (output []byte, err error)
	Name() string
	Version() string
}

type ShortcodeProcessor interface {
	Name() string
	Render(params map[string]string, inner string, ctx map[string]interface{}) (output string, err error)
}

type Manager struct {
	processors   map[string]FileProcessor
	shortcodes   map[string]ShortcodeProcessor
	plugins      map[string]*plugin.Plugin
}

func NewManager() *Manager {
	return &Manager{
		processors: make(map[string]FileProcessor),
		shortcodes: make(map[string]ShortcodeProcessor),
		plugins:    make(map[string]*plugin.Plugin),
	}
}

func (m *Manager) LoadPlugin(path string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("plugin %s panicked during loading: %v\nStack: %s", path, r, string(debug.Stack()))
		}
	}()

	var p *plugin.Plugin
	p, err = plugin.Open(path)
	if err != nil {
		if strings.Contains(err.Error(), "plugin was built with a different version of package") {
			return fmt.Errorf("plugin %s version mismatch: %w\nPlease recompile the plugin with the same Go version as the main program", path, err)
		}
		if strings.Contains(err.Error(), "plugin.Open") {
			return fmt.Errorf("failed to load plugin %s: %w\nNote: Go plugins are only supported on Linux and macOS, not Windows", path, err)
		}
		return fmt.Errorf("failed to open plugin %s: %w", path, err)
	}

	pluginName := filepath.Base(path)
	pluginName = strings.TrimSuffix(pluginName, filepath.Ext(pluginName))

	var loadedFeatures []string

	if symProcessor, lookErr := p.Lookup("Processor"); lookErr == nil {
		if processor, ok := symProcessor.(FileProcessor); ok {
			var exts []string
			func() {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("plugin %s panicked in Extensions(): %v", path, r)
					}
				}()
				exts = processor.Extensions()
			}()
			if err != nil {
				return err
			}

			for _, ext := range exts {
				normalizedExt := strings.ToLower(ext)
				if !strings.HasPrefix(normalizedExt, ".") {
					normalizedExt = "." + normalizedExt
				}
				m.processors[normalizedExt] = processor
			}
			loadedFeatures = append(loadedFeatures, fmt.Sprintf("file processor for %v", exts))
		}
	}

	if symShortcode, lookErr := p.Lookup("Shortcode"); lookErr == nil {
		if shortcode, ok := symShortcode.(ShortcodeProcessor); ok {
			name := shortcode.Name()
			m.shortcodes[name] = shortcode
			loadedFeatures = append(loadedFeatures, fmt.Sprintf("shortcode '%s'", name))
		}
	}

	if symShortcodes, lookErr := p.Lookup("Shortcodes"); lookErr == nil {
		if shortcodes, ok := symShortcodes.([]ShortcodeProcessor); ok {
			for _, sc := range shortcodes {
				name := sc.Name()
				m.shortcodes[name] = sc
				loadedFeatures = append(loadedFeatures, fmt.Sprintf("shortcode '%s'", name))
			}
		}
	}

	if len(loadedFeatures) == 0 {
		return fmt.Errorf("plugin %s does not export any recognized symbols (Processor, Shortcode, or Shortcodes)", path)
	}

	m.plugins[pluginName] = p

	fmt.Printf("Successfully loaded plugin: %s\n", pluginName)
	for _, feature := range loadedFeatures {
		fmt.Printf("  - %s\n", feature)
	}

	return nil
}

func (m *Manager) GetProcessor(ext string) (FileProcessor, bool) {
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	proc, ok := m.processors[ext]
	return proc, ok
}

func (m *Manager) HasProcessor(ext string) bool {
	_, ok := m.GetProcessor(ext)
	return ok
}

func (m *Manager) ProcessFile(ext string, input []byte, ctx map[string]interface{}) (output []byte, err error) {
	proc, ok := m.GetProcessor(ext)
	if !ok {
		return nil, fmt.Errorf("no processor found for extension %s", ext)
	}

	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("plugin panicked while processing file: %v\nStack: %s", r, string(debug.Stack()))
		}
	}()

	output, err = proc.Process(input, ctx)
	return output, err
}

func (m *Manager) GetShortcode(name string) (ShortcodeProcessor, bool) {
	sc, ok := m.shortcodes[name]
	return sc, ok
}

func (m *Manager) HasShortcode(name string) bool {
	_, ok := m.shortcodes[name]
	return ok
}

func (m *Manager) ProcessShortcodes(input string, ctx map[string]interface{}) (output string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic while processing shortcodes: %v\nStack: %s", r, string(debug.Stack()))
		}
	}()

	return m.processShortcodesRecursive(input, ctx)
}

var (
	selfClosingShortcodeRe = regexp.MustCompile(`\{\{<\s*(\w+)(\s+[^>]*)?\s*/>\}\}`)
	openTagRe              = regexp.MustCompile(`\{\{<\s*(\w+)(\s+[^>]*)?\s*>\}\}`)
	closeTagRe             = regexp.MustCompile(`\{\{<\s*/\s*(\w+)\s*>\}\}`)
)

func (m *Manager) processShortcodesRecursive(input string, ctx map[string]interface{}) (string, error) {
	input = m.processSelfClosingShortcodes(input, ctx)
	input, err := m.processPairedShortcodes(input, ctx)
	return input, err
}

func (m *Manager) processSelfClosingShortcodes(input string, ctx map[string]interface{}) string {
	return selfClosingShortcodeRe.ReplaceAllStringFunc(input, func(match string) string {
		parts := selfClosingShortcodeRe.FindStringSubmatch(match)
		if len(parts) < 3 {
			return match
		}

		name := parts[1]
		paramsStr := strings.TrimSpace(parts[2])

		sc, ok := m.shortcodes[name]
		if !ok {
			return match
		}

		params := parseShortcodeParams(paramsStr)

		result, err := sc.Render(params, "", ctx)
		if err != nil {
			fmt.Printf("Warning: shortcode '%s' error: %v\n", name, err)
			return match
		}

		return result
	})
}

func (m *Manager) processPairedShortcodes(input string, ctx map[string]interface{}) (string, error) {
	for {
		openMatch := openTagRe.FindStringSubmatchIndex(input)
		if openMatch == nil {
			return input, nil
		}

		name := input[openMatch[2]:openMatch[3]]
		paramsStr := strings.TrimSpace(input[openMatch[4]:openMatch[5]])

		afterOpen := input[openMatch[1]:]

		closePattern := fmt.Sprintf(`\{\{<\s*/\s*%s\s*>\}\}`, regexp.QuoteMeta(name))
		closeRe := regexp.MustCompile(closePattern)
		closeMatch := closeRe.FindStringSubmatchIndex(afterOpen)

		if closeMatch == nil {
			input = input[:openMatch[0]] + input[openMatch[1]:]
			continue
		}

		sc, ok := m.shortcodes[name]
		if !ok {
			input = input[:openMatch[0]] + input[openMatch[1]:]
			continue
		}

		params := parseShortcodeParams(paramsStr)

		betweenOpenAndClose := afterOpen[0:closeMatch[0]]

		processedInner, err := m.processShortcodesRecursive(betweenOpenAndClose, ctx)
		if err != nil {
			return input, err
		}

		result, err := sc.Render(params, processedInner, ctx)
		if err != nil {
			fmt.Printf("Warning: shortcode '%s' error: %v\n", name, err)
			input = input[:openMatch[0]] + input[openMatch[1]:]
			continue
		}

		fullEnd := openMatch[1] + closeMatch[1]
		input = input[:openMatch[0]] + result + input[fullEnd:]
	}
}

func parseShortcodeParams(paramsStr string) map[string]string {
	params := make(map[string]string)
	if paramsStr == "" {
		return params
	}

	paramRe := regexp.MustCompile(`(\w+)\s*=\s*"([^"]*)"`)
	matches := paramRe.FindAllStringSubmatch(paramsStr, -1)
	for _, match := range matches {
		if len(match) == 3 {
			params[match[1]] = match[2]
		}
	}

	return params
}

func (m *Manager) ListPlugins() []string {
	plugins := make([]string, 0, len(m.plugins))
	for name := range m.plugins {
		plugins = append(plugins, name)
	}
	return plugins
}

func (m *Manager) ListShortcodes() []string {
	shortcodes := make([]string, 0, len(m.shortcodes))
	for name := range m.shortcodes {
		shortcodes = append(shortcodes, name)
	}
	return shortcodes
}
