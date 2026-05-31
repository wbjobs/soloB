package handlers

import (
	"errors"
	"log"
	"net/http"
	"time"

	"noteapp/backend/db"
	"noteapp/backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SyncHandler(c *gin.Context) {
	var req models.SyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("Failed to bind sync request: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	log.Printf("Sync request from user %s, changes: %d, last_sync: %v",
		req.UserID, len(req.Changes), req.LastSync)

	serverChanges := processClientChanges(req.UserID, req.Changes)
	serverNewerChanges := getServerChangesSince(req.UserID, req.LastSync)

	allChanges := append(serverChanges, serverNewerChanges...)

	log.Printf("Sync response: %d server changes", len(allChanges))

	c.JSON(http.StatusOK, models.SyncResponse{
		Success: true,
		Changes: allChanges,
		Now:     time.Now(),
	})
}

func processClientChanges(userID string, clientChanges []models.ChangeLog) []models.ChangeLog {
	var serverChanges []models.ChangeLog

	for i, change := range clientChanges {
		log.Printf("Processing change %d: note_id=%s, op=%s, ts=%v",
			i, change.NoteID, change.Operation, change.Timestamp)

		change.UserID = userID

		var existingNote models.Note
		err := db.DB.Where("id = ? AND user_id = ?", change.NoteID, userID).First(&existingNote).Error

		serverNote := existingNote
		shouldApply := false

		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				log.Printf("Note %s not found on server, will apply change", change.NoteID)
				shouldApply = true
			} else {
				log.Printf("Error querying note %s: %v", change.NoteID, err)
				continue
			}
		} else {
			log.Printf("Note %s found on server, updated_at=%v, client_ts=%v, should_apply=%v",
				change.NoteID, serverNote.UpdatedAt, change.Timestamp,
				change.Timestamp.After(serverNote.UpdatedAt))
			shouldApply = change.Timestamp.After(serverNote.UpdatedAt)
		}

		if !shouldApply {
			log.Printf("Server version is newer, returning server change for note %s", change.NoteID)
			serverChanges = append(serverChanges, models.ChangeLog{
				NoteID:    serverNote.ID,
				UserID:    userID,
				Operation: "update",
				Timestamp: serverNote.UpdatedAt,
				Title:     serverNote.Title,
				Content:   serverNote.Content,
			})
			continue
		}

		switch change.Operation {
		case "create":
			newNote := models.Note{
				ID:        change.NoteID,
				Title:     change.Title,
				Content:   change.Content,
				UserID:    userID,
				UpdatedAt: change.Timestamp,
			}
			if err := db.DB.Create(&newNote).Error; err != nil {
				log.Printf("Failed to create note %s: %v", change.NoteID, err)
			} else {
				log.Printf("Created note %s", change.NoteID)
				db.DB.Create(&change)
			}

		case "update":
			if err == nil {
				existingNote.Title = change.Title
				existingNote.Content = change.Content
				existingNote.UpdatedAt = change.Timestamp
				if err := db.DB.Save(&existingNote).Error; err != nil {
					log.Printf("Failed to update note %s: %v", change.NoteID, err)
				} else {
					log.Printf("Updated note %s", change.NoteID)
					db.DB.Create(&change)
				}
			}

		case "delete":
			if err == nil {
				now := time.Now()
				existingNote.DeletedAt = &now
				existingNote.UpdatedAt = change.Timestamp
				if err := db.DB.Save(&existingNote).Error; err != nil {
					log.Printf("Failed to delete note %s: %v", change.NoteID, err)
				} else {
					log.Printf("Deleted note %s", change.NoteID)
					db.DB.Create(&change)
				}
			}
		}
	}

	return serverChanges
}

func getServerChangesSince(userID string, since time.Time) []models.ChangeLog {
	var changes []models.ChangeLog
	db.DB.Where("user_id = ? AND timestamp > ?", userID, since).
		Order("timestamp ASC").
		Find(&changes)
	log.Printf("Found %d server changes since %v", len(changes), since)
	return changes
}

func GetNotes(c *gin.Context) {
	userID := c.Query("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}

	var notes []models.Note
	db.DB.Where("user_id = ? AND deleted_at IS NULL", userID).
		Order("updated_at DESC").
		Find(&notes)

	c.JSON(http.StatusOK, notes)
}
