package executor

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"

	"dtsplatform/internal/models"
)

type ShellExecutor struct{}

func NewShellExecutor() *ShellExecutor {
	return &ShellExecutor{}
}

func (e *ShellExecutor) Type() string {
	return "shell"
}

func (e *ShellExecutor) Execute(ctx context.Context, payload *models.TaskPayload) ([]byte, error) {
	cmd := exec.CommandContext(ctx, payload.Command, payload.Args...)

	env := cmd.Env
	for k, v := range payload.Env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = env

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("timeout: %s", stderr.String())
		}
		return nil, fmt.Errorf("command failed: %s - %s", err.Error(), stderr.String())
	}

	return stdout.Bytes(), nil
}
