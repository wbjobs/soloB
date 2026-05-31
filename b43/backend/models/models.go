package models

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type Note struct {
	ID        string     `gorm:"primaryKey;type:uuid" json:"id"`
	Title     string     `gorm:"not null" json:"title"`
	Content   string     `gorm:"type:text" json:"content"`
	UserID    string     `gorm:"not null;index" json:"user_id"`
	UpdatedAt time.Time  `gorm:"not null;index" json:"updated_at"`
	DeletedAt *time.Time `gorm:"index" json:"deleted_at,omitempty"`
}

type ChangeLog struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"-"`
	NoteID    string    `gorm:"type:uuid;index" json:"note_id"`
	UserID    string    `gorm:"not null;index" json:"user_id"`
	Operation string    `gorm:"not null" json:"operation"`
	Timestamp time.Time `gorm:"not null;index" json:"timestamp"`
	Title     string    `json:"title"`
	Content   string    `gorm:"type:text" json:"content"`
}

type SyncRequest struct {
	UserID   string      `json:"user_id" binding:"required"`
	LastSync time.Time   `json:"last_sync"`
	Changes  []ChangeLog `json:"changes"`
}

func (s *SyncRequest) UnmarshalJSON(data []byte) error {
	var raw struct {
		UserID   string            `json:"user_id"`
		LastSync string            `json:"last_sync"`
		Changes  []json.RawMessage `json:"changes"`
	}

	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	s.UserID = raw.UserID

	if raw.LastSync != "" {
		t, err := parseTime(raw.LastSync)
		if err != nil {
			return fmt.Errorf("invalid last_sync: %v", err)
		}
		s.LastSync = t
	}

	for _, rawChange := range raw.Changes {
		var change ChangeLog
		if err := json.Unmarshal(rawChange, &change); err != nil {
			return fmt.Errorf("invalid change: %v", err)
		}
		s.Changes = append(s.Changes, change)
	}

	return nil
}

func (c *ChangeLog) UnmarshalJSON(data []byte) error {
	var raw struct {
		NoteID    string `json:"note_id"`
		UserID    string `json:"user_id"`
		Operation string `json:"operation"`
		Timestamp string `json:"timestamp"`
		Title     string `json:"title"`
		Content   string `json:"content"`
	}

	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	c.NoteID = raw.NoteID
	c.UserID = raw.UserID
	c.Operation = raw.Operation
	c.Title = raw.Title
	c.Content = raw.Content

	if raw.Timestamp != "" {
		t, err := parseTime(raw.Timestamp)
		if err != nil {
			return fmt.Errorf("invalid timestamp: %v", err)
		}
		c.Timestamp = t
	}

	return nil
}

func parseTime(s string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999999999Z07:00",
		"2006-01-02T15:04:05.999Z07:00",
		"2006-01-02 15:04:05+00",
	}

	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("unrecognized time format: %s", s)
}

type SyncResponse struct {
	Success bool        `json:"success"`
	Changes []ChangeLog `json:"changes"`
	Now     time.Time   `json:"now"`
}

func (note *Note) BeforeCreate() error {
	if note.ID == "" {
		note.ID = uuid.New().String()
	}
	return nil
}
