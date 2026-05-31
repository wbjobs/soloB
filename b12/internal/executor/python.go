package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"dtsplatform/internal/models"
)

type PythonExecutor struct{}

func NewPythonExecutor() *PythonExecutor {
	return &PythonExecutor{}
}

func (e *PythonExecutor) Type() string {
	return "python"
}

func (e *PythonExecutor) Execute(ctx context.Context, payload *models.TaskPayload) ([]byte, error) {
	paramsJSON, err := json.Marshal(payload.Params)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal params: %w", err)
	}

	script := fmt.Sprintf(`
import sys
import json
import importlib.util

params = json.loads(sys.argv[1])

if __name__ == "__main__":
    try:
        if "%s" and "%s":
            spec = importlib.util.spec_from_file_location("task_module", "%s")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            func = getattr(module, "%s")
            result = func(**params)
            print(json.dumps(result))
        else:
            print(json.dumps({"error": "missing module or function"}))
    except Exception as ex:
        print(json.dumps({"error": str(ex)}))
        sys.exit(1)
`, payload.Module, payload.Function, payload.Module, payload.Function)

	tmpDir, err := os.MkdirTemp("", "python-exec-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	scriptPath := filepath.Join(tmpDir, "executor.py")
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return nil, fmt.Errorf("failed to write script: %w", err)
	}

	cmd := exec.CommandContext(ctx, "python3", scriptPath, string(paramsJSON))

	env := cmd.Env
	for k, v := range payload.Env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = env

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("timeout: %s", stderr.String())
		}
		return nil, fmt.Errorf("python execution failed: %s - %s", err.Error(), stderr.String())
	}

	return stdout.Bytes(), nil
}
