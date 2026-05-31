package alerting

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/smtp"
	"text/template"
	"time"

	"dtsplatform/internal/config"
)

type AlertLevel string

const (
	AlertLevelWarning  AlertLevel = "warning"
	AlertLevelError    AlertLevel = "error"
	AlertLevelCritical AlertLevel = "critical"
)

type Alert struct {
	Level      AlertLevel
	Title      string
	Message    string
	JobID      string
	TaskID     string
	ExecutorID string
	Timestamp  time.Time
	Details    map[string]any
}

type Alerter struct {
	cfg      *config.Config
	channels []AlertChannel
}

type AlertChannel interface {
	Send(ctx context.Context, alert *Alert) error
	Type() string
}

func NewAlerter(cfg *config.Config) *Alerter {
	alerter := &Alerter{cfg: cfg}

	for _, webhook := range cfg.Alerting.Webhooks {
		switch webhook.Type {
		case "dingtalk":
			alerter.channels = append(alerter.channels, NewDingTalkChannel(webhook.URL))
		case "wechat":
			alerter.channels = append(alerter.channels, NewWeChatChannel(webhook.URL))
		case "email":
			alerter.channels = append(alerter.channels, NewEmailChannel(
				webhook.SMTPServer,
				webhook.SMTPPort,
				webhook.From,
				webhook.To,
			))
		}
	}

	return alerter
}

func (a *Alerter) Send(ctx context.Context, alert *Alert) error {
	if alert.Timestamp.IsZero() {
		alert.Timestamp = time.Now()
	}

	var lastErr error
	for _, channel := range a.channels {
		if err := channel.Send(ctx, alert); err != nil {
			fmt.Printf("Failed to send alert via %s: %v\n", channel.Type(), err)
			lastErr = err
		}
	}

	return lastErr
}

type DingTalkChannel struct {
	webhookURL string
}

func NewDingTalkChannel(url string) *DingTalkChannel {
	return &DingTalkChannel{webhookURL: url}
}

func (d *DingTalkChannel) Type() string {
	return "dingtalk"
}

func (d *DingTalkChannel) Send(ctx context.Context, alert *Alert) error {
	msg := map[string]any{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": alert.Title,
			"text":  formatDingTalkMessage(alert),
		},
	}

	body, _ := json.Marshal(msg)
	return sendHTTP(ctx, d.webhookURL, body)
}

type WeChatChannel struct {
	webhookURL string
}

func NewWeChatChannel(url string) *WeChatChannel {
	return &WeChatChannel{webhookURL: url}
}

func (w *WeChatChannel) Type() string {
	return "wechat"
}

func (w *WeChatChannel) Send(ctx context.Context, alert *Alert) error {
	msg := map[string]any{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"content": formatWeChatMessage(alert),
		},
	}

	body, _ := json.Marshal(msg)
	return sendHTTP(ctx, w.webhookURL, body)
}

type EmailChannel struct {
	smtpServer string
	smtpPort   int
	from       string
	to         []string
}

func NewEmailChannel(server string, port int, from string, to []string) *EmailChannel {
	return &EmailChannel{
		smtpServer: server,
		smtpPort:   port,
		from:       from,
		to:         to,
	}
}

func (e *EmailChannel) Type() string {
	return "email"
}

func (e *EmailChannel) Send(ctx context.Context, alert *Alert) error {
	tmpl := `From: {{.From}}
To: {{.To}}
Subject: [{{.Level}}] {{.Title}}
Date: {{.Date}}

{{.Message}}

Job ID: {{.JobID}}
Task ID: {{.TaskID}}
Executor: {{.ExecutorID}}
Time: {{.Timestamp}}

Details:
{{.Details}}
`

	data := map[string]any{
		"From":       e.from,
		"To":         joinStrings(e.to, ", "),
		"Title":      alert.Title,
		"Level":      alert.Level,
		"Message":    alert.Message,
		"JobID":      alert.JobID,
		"TaskID":     alert.TaskID,
		"ExecutorID": alert.ExecutorID,
		"Timestamp":  alert.Timestamp.Format(time.RFC3339),
		"Date":       time.Now().Format(time.RFC1123Z),
		"Details":    formatDetails(alert.Details),
	}

	var buf bytes.Buffer
	t := template.Must(template.New("email").Parse(tmpl))
	t.Execute(&buf, data)

	auth := smtp.PlainAuth("", "", "", e.smtpServer)
	addr := fmt.Sprintf("%s:%d", e.smtpServer, e.smtpPort)

	return smtp.SendMail(addr, auth, e.from, e.to, buf.Bytes())
}

func formatDingTalkMessage(alert *Alert) string {
	emoji := "⚠️"
	switch alert.Level {
	case AlertLevelError:
		emoji = "❌"
	case AlertLevelCritical:
		emoji = "🚨"
	}

	return fmt.Sprintf(`
%s **[%s] %s**

**消息:** %s

**作业:** %s
**任务:** %s
**执行器:** %s
**时间:** %s

**详情:**
%s
`, emoji, alert.Level, alert.Title, alert.Message, alert.JobID, alert.TaskID, alert.ExecutorID, alert.Timestamp.Format(time.RFC3339), formatDetails(alert.Details))
}

func formatWeChatMessage(alert *Alert) string {
	return fmt.Sprintf(`
<font color="warning">**[%s] %s**</font>

> **消息:** %s
> **作业:** %s
> **任务:** %s
> **执行器:** %s
> **时间:** %s
`, alert.Level, alert.Title, alert.Message, alert.JobID, alert.TaskID, alert.ExecutorID, alert.Timestamp.Format(time.RFC3339))
}

func formatDetails(details map[string]any) string {
	if len(details) == 0 {
		return "  无"
	}

	result := ""
	for k, v := range details {
		result += fmt.Sprintf("- %s: %v\n", k, v)
	}
	return result
}

func joinStrings(s []string, sep string) string {
	if len(s) == 0 {
		return ""
	}
	result := s[0]
	for i := 1; i < len(s); i++ {
		result += sep + s[i]
	}
	return result
}

func sendHTTP(ctx context.Context, url string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("http error: %d", resp.StatusCode)
	}

	return nil
}
