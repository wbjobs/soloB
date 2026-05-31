package executor

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"dtsplatform/internal/models"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

type DockerExecutor struct{}

func NewDockerExecutor() *DockerExecutor {
	return &DockerExecutor{}
}

func (e *DockerExecutor) Type() string {
	return "docker"
}

func (e *DockerExecutor) Execute(ctx context.Context, payload *models.TaskPayload) ([]byte, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	reader, err := cli.ImagePull(ctx, payload.Image, image.PullOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to pull image: %w", err)
	}
	io.Copy(io.Discard, reader)
	reader.Close()

	env := make([]string, 0, len(payload.Env))
	for k, v := range payload.Env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}

	volumes := make(map[string]struct{})
	binds := make([]string, 0)
	for _, vol := range payload.Volumes {
		parts := strings.SplitN(vol, ":", 2)
		if len(parts) == 2 {
			volumes[parts[1]] = struct{}{}
			binds = append(binds, vol)
		}
	}

	containerConfig := &container.Config{
		Image:        payload.Image,
		Cmd:          payload.CommandArgs,
		Env:          env,
		Volumes:      volumes,
		AttachStdout: true,
		AttachStderr: true,
	}

	hostConfig := &container.HostConfig{
		Binds:       binds,
		AutoRemove:  true,
		NetworkMode: "bridge",
	}

	resp, err := cli.ContainerCreate(ctx, containerConfig, hostConfig, nil, nil, "")
	if err != nil {
		return nil, fmt.Errorf("failed to create container: %w", err)
	}

	if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return nil, fmt.Errorf("failed to start container: %w", err)
	}

	statusCh, errCh := cli.ContainerWait(ctx, resp.ID, container.WaitConditionNotRunning)
	select {
	case err := <-errCh:
		if err != nil {
			return nil, fmt.Errorf("container wait error: %w", err)
		}
	case status := <-statusCh:
		if status.StatusCode != 0 {
			return nil, fmt.Errorf("container exited with code %d", status.StatusCode)
		}
	case <-ctx.Done():
		stopCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cli.ContainerStop(stopCtx, resp.ID, container.StopOptions{})
		return nil, fmt.Errorf("container execution timeout")
	}

	logsReader, err := cli.ContainerLogs(ctx, resp.ID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get container logs: %w", err)
	}
	defer logsReader.Close()

	var stdout, stderr bytes.Buffer
	stdcopy.StdCopy(&stdout, &stderr, logsReader)

	if stderr.Len() > 0 {
		return nil, fmt.Errorf("container stderr: %s", stderr.String())
	}

	return stdout.Bytes(), nil
}
