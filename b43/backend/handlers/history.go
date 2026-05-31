package handlers

import (
	"net/http"
	"strconv"
	"time"

	"noteapp/backend/db"
	"noteapp/backend/models"

	"github.com/gin-gonic/gin"
)

type HistoryVersion struct {
	Version   int       `json:"version"`
	Timestamp time.Time `json:"timestamp"`
	Operation string    `json:"operation"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
}

func GetNoteHistory(c *gin.Context) {
	noteID := c.Param("note_id")
	userID := c.Query("user_id")

	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}

	if noteID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "note_id is required"})
		return
	}

	var changeLogs []models.ChangeLog
	err := db.DB.Where("note_id = ? AND user_id = ?", noteID, userID).
		Order("timestamp DESC").
		Find(&changeLogs).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var history []HistoryVersion
	for i, log := range changeLogs {
		history = append(history, HistoryVersion{
			Version:   len(changeLogs) - i,
			Timestamp: log.Timestamp,
			Operation: log.Operation,
			Title:     log.Title,
			Content:   log.Content,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"note_id": noteID,
		"history": history,
	})
}

func RollbackToVersion(c *gin.Context) {
	noteID := c.Param("note_id")
	versionStr := c.Param("version")
	userID := c.Query("user_id")

	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}

	if noteID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "note_id is required"})
		return
	}

	version, err := strconv.Atoi(versionStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid version number"})
		return
	}

	var changeLogs []models.ChangeLog
	err = db.DB.Where("note_id = ? AND user_id = ?", noteID, userID).
		Order("timestamp DESC").
		Find(&changeLogs).Error

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if version < 1 || version > len(changeLogs) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "version not found"})
		return
	}

	targetIndex := len(changeLogs) - version
	targetLog := changeLogs[targetIndex]

	var note models.Note
	err = db.DB.Where("id = ? AND user_id = ?", noteID, userID).First(&note).Error
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "note not found"})
		return
	}

	note.Title = targetLog.Title
	note.Content = targetLog.Content
	note.UpdatedAt = time.Now()

	if err := db.DB.Save(&note).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rollbackLog := models.ChangeLog{
		NoteID:    noteID,
		UserID:    userID,
		Operation: "update",
		Timestamp: time.Now(),
		Title:     targetLog.Title,
		Content:   targetLog.Content,
	}

	if err := db.DB.Create(&rollbackLog).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"note":    note,
		"message": "Rolled back to version " + versionStr,
	})
}
