package executor

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"dtsplatform/internal/models"
)

type HTTPExecutor struct{}

func NewHTTPExecutor() *HTTPExecutor {
	return &HTTPExecutor{}
}

func (e *HTTPExecutor) Type() string {
	return "http"
}

func (e *HTTPExecutor) Execute(ctx context.Context, payload *models.TaskPayload) ([]byte, error) {
	method := payload.Method
	if method == "" {
		method = "GET"
	}

	req, err := http.NewRequestWithContext(ctx, method, payload.URL, bytes.NewReader(payload.Body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	for k, v := range payload.Headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("http timeout: %w", err)
		}
		return nil, fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("http error %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}
