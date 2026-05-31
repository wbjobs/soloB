package utils

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func Getwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func EnsureDir(path string) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := os.MkdirAll(path, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", path, err)
		}
	}
	return nil
}

func CopyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return fmt.Errorf("failed to read source file: %w", err)
	}

	if err := EnsureDir(filepath.Dir(dst)); err != nil {
		return err
	}

	if err := os.WriteFile(dst, data, 0644); err != nil {
		return fmt.Errorf("failed to write destination file: %w", err)
	}

	return nil
}

func CopyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}

		dstPath := filepath.Join(dst, relPath)

		if info.IsDir() {
			return EnsureDir(dstPath)
		}

		return CopyFile(path, dstPath)
	})
}

func Slugify(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, " ", "-")
	s = strings.ReplaceAll(s, "_", "-")
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '.' {
			return r
		}
		return -1
	}, s)
	s = strings.Trim(s, "-")
	return s
}

func FormatDate(t time.Time, format string) string {
	if format == "" {
		format = "2006-01-02"
	}
	return t.Format(format)
}

func Exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
