package model

type Event struct {
	UserID    string `json:"user_id" binding:"required"`
	EventName string `json:"event_name" binding:"required"`
	Timestamp int64  `json:"timestamp" binding:"required"`
}

type FunnelStep struct {
	FromEvent      string  `json:"from_event"`
	ToEvent        string  `json:"to_event"`
	StepIndex      int     `json:"step_index"`
	FromUsers      int64   `json:"from_users"`
	ToUsers        int64   `json:"to_users"`
	ConversionRate float64 `json:"conversion_rate"`
}

type FunnelRequest struct {
	Events        []string `form:"events"`
	StartEvent    string   `form:"start_event"`
	EndEvent      string   `form:"end_event"`
	WindowMinutes int64    `form:"window_minutes" binding:"required,min=1"`
}

type FunnelResponse struct {
	WindowMinutes int64        `json:"window_minutes"`
	Events        []string     `json:"events"`
	Steps         []FunnelStep `json:"steps"`
	TotalUsers    int64        `json:"total_users"`
	FinalUsers    int64        `json:"final_users"`
	OverallRate   float64      `json:"overall_rate"`
}
