package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type Span struct {
	TraceID      string                 `json:"traceId"`
	SpanID       string                 `json:"spanId"`
	ParentSpanID string                 `json:"parentSpanId,omitempty"`
	Name         string                 `json:"name"`
	ServiceName  string                 `json:"serviceName"`
	StartTime    time.Time              `json:"startTime"`
	EndTime      time.Time              `json:"endTime"`
	Duration     int64                  `json:"duration"`
	Tags         map[string]interface{} `json:"tags,omitempty"`
}

type Config struct {
	CollectorURL  string
	Elasticsearch string
	LocalFile     string
	UseES         bool
	UseFile       bool
}

type Agent struct {
	config Config
	client *http.Client
}

func NewAgent(config Config) *Agent {
	return &Agent{
		config: config,
		client: &http.Client{Timeout: 5 * time.Second},
	}
}

func (a *Agent) SendSpan(span *Span) error {
	if a.config.CollectorURL != "" {
		if err := a.sendToCollector(span); err != nil {
			return err
		}
	}

	if a.config.UseES && a.config.Elasticsearch != "" {
		if err := a.writeToElasticsearch(span); err != nil {
			fmt.Printf("ES write error: %v\n", err)
		}
	}

	if a.config.UseFile && a.config.LocalFile != "" {
		if err := a.writeToFile(span); err != nil {
			fmt.Printf("File write error: %v\n", err)
		}
	}

	return nil
}

func (a *Agent) sendToCollector(span *Span) error {
	data, err := json.Marshal(span)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", a.config.CollectorURL+"/spans", bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("collector returned status: %d", resp.StatusCode)
	}

	return nil
}

func (a *Agent) writeToElasticsearch(span *Span) error {
	data, err := json.Marshal(span)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/traces/_doc", a.config.Elasticsearch)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

func (a *Agent) writeToFile(span *Span) error {
	f, err := os.OpenFile(a.config.LocalFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	data, err := json.Marshal(span)
	if err != nil {
		return err
	}

	_, err = f.Write(append(data, '\n'))
	return err
}
