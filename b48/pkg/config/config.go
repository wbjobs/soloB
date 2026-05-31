package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	SiteName        string   `yaml:"site_name"`
	Description     string   `yaml:"description"`
	BaseURL         string   `yaml:"base_url"`
	Theme           string   `yaml:"theme"`
	SourceDir       string   `yaml:"source_dir"`
	OutputDir       string   `yaml:"output_dir"`
	PluginsDir      string   `yaml:"plugins_dir"`
	Plugins         []string `yaml:"plugins"`
	DefaultLanguage string   `yaml:"default_language"`
	Author          string   `yaml:"author"`
}

func Default() *Config {
	return &Config{
		SiteName:        "My Static Site",
		Description:     "A static site generated with staticgen",
		BaseURL:         "http://localhost:1313",
		Theme:           "default",
		SourceDir:       "content",
		OutputDir:       "public",
		PluginsDir:      "plugins",
		Plugins:         []string{},
		DefaultLanguage: "en",
		Author:          "",
	}
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	cfg := Default()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	return cfg, nil
}

func Save(cfg *Config, path string) error {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}

	return nil
}

func GetConfigPath(dir string) string {
	return filepath.Join(dir, "staticgen.yaml")
}
