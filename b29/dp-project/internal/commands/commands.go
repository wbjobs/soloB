package commands

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"

	"github.com/jmespath/go-jmespath"
)

const maxScannerBufferSize = 1024 * 1024

func Filter(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: dp filter <expression>")
	}
	expression := args[0]

	compiled, err := jmespath.Compile(expression)
	if err != nil {
		return fmt.Errorf("invalid JMESPath expression: %w", err)
	}

	scanner := bufio.NewScanner(os.Stdin)
	buf := make([]byte, maxScannerBufferSize)
	scanner.Buffer(buf, maxScannerBufferSize)

	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var data interface{}
		if err := json.Unmarshal(line, &data); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}

		result, err := compiled.Search(data)
		if err != nil {
			return fmt.Errorf("JMESPath evaluation failed: %w", err)
		}

		if isTruthy(result) {
			canonical, err := json.Marshal(data)
			if err != nil {
				return fmt.Errorf("failed to marshal JSON: %w", err)
			}
			if _, err := writer.Write(canonical); err != nil {
				return err
			}
			if err := writer.WriteByte('\n'); err != nil {
				return err
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading input: %w", err)
	}
	return nil
}

func Map(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: dp map <expression>")
	}
	expression := args[0]

	compiled, err := jmespath.Compile(expression)
	if err != nil {
		return fmt.Errorf("invalid JMESPath expression: %w", err)
	}

	scanner := bufio.NewScanner(os.Stdin)
	buf := make([]byte, maxScannerBufferSize)
	scanner.Buffer(buf, maxScannerBufferSize)

	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var data interface{}
		if err := json.Unmarshal(line, &data); err != nil {
			return fmt.Errorf("invalid JSON: %w", err)
		}

		result, err := compiled.Search(data)
		if err != nil {
			return fmt.Errorf("JMESPath evaluation failed: %w", err)
		}

		output, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("failed to marshal result to JSON: %w", err)
		}

		if _, err := writer.Write(output); err != nil {
			return err
		}
		if err := writer.WriteByte('\n'); err != nil {
			return err
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading input: %w", err)
	}
	return nil
}

func Tee(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: dp tee <file>")
	}
	filename := args[0]

	file, err := os.Create(filename)
	if err != nil {
		return fmt.Errorf("failed to create file %s: %w", filename, err)
	}
	defer file.Close()

	fileWriter := bufio.NewWriter(file)
	stdoutWriter := bufio.NewWriter(os.Stdout)
	defer fileWriter.Flush()
	defer stdoutWriter.Flush()

	scanner := bufio.NewScanner(os.Stdin)
	buf := make([]byte, maxScannerBufferSize)
	scanner.Buffer(buf, maxScannerBufferSize)

	for scanner.Scan() {
		line := scanner.Bytes()

		if _, err := fileWriter.Write(line); err != nil {
			return fmt.Errorf("failed to write to file: %w", err)
		}
		if err := fileWriter.WriteByte('\n'); err != nil {
			return fmt.Errorf("failed to write newline to file: %w", err)
		}

		if _, err := stdoutWriter.Write(line); err != nil {
			return fmt.Errorf("failed to write to stdout: %w", err)
		}
		if err := stdoutWriter.WriteByte('\n'); err != nil {
			return fmt.Errorf("failed to write newline to stdout: %w", err)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading input: %w", err)
	}
	return nil
}

func isTruthy(v interface{}) bool {
	if v == nil {
		return false
	}

	switch val := v.(type) {
	case bool:
		return val
	case string:
		return len(val) > 0
	case float64:
		return val != 0
	case []interface{}:
		return len(val) > 0
	case map[string]interface{}:
		return len(val) > 0
	default:
		return true
	}
}
