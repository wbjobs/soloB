<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Note, NoteHistory } from "./types";

const notes = ref<Note[]>([]);
const selectedNoteId = ref<string | null>(null);
const currentTitle = ref("");
const currentContent = ref("");
const lastSaveTime = ref("");
const saveTimer = ref<number | null>(null);

const showHistoryDialog = ref(false);
const noteHistory = ref<NoteHistory[]>([]);
const selectedHistory = ref<NoteHistory | null>(null);
const loadingHistory = ref(false);

const selectedNote = () => {
  return notes.value.find(n => n.id === selectedNoteId.value) || null;
};

const loadNotes = async () => {
  try {
    const result = await invoke<Note[]>("get_all_notes");
    notes.value = result;
  } catch (error) {
    console.error("Failed to load notes:", error);
  }
};

const createNewNote = async () => {
  try {
    const note = await invoke<Note>("create_note", {
      title: "",
      content: "",
    });
    notes.value.unshift(note);
    selectedNoteId.value = note.id;
    currentTitle.value = "";
    currentContent.value = "";
    lastSaveTime.value = new Date().toLocaleTimeString();
  } catch (error) {
    console.error("Failed to create note:", error);
  }
};

const selectNote = (note: Note) => {
  selectedNoteId.value = note.id;
  currentTitle.value = note.title;
  currentContent.value = note.content;
};

const scheduleSave = () => {
  if (saveTimer.value) {
    clearTimeout(saveTimer.value);
  }
  saveTimer.value = window.setTimeout(() => {
    saveNote();
  }, 500);
};

const saveNote = async () => {
  if (!selectedNoteId.value) return;
  
  try {
    const note = await invoke<Note>("update_note", {
      id: selectedNoteId.value,
      title: currentTitle.value,
      content: currentContent.value,
    });
    
    const index = notes.value.findIndex(n => n.id === note.id);
    if (index !== -1) {
      notes.value[index] = note;
    }
    
    lastSaveTime.value = new Date().toLocaleTimeString();
  } catch (error) {
    console.error("Failed to save note:", error);
  }
};

const deleteNote = async () => {
  if (!selectedNoteId.value) return;
  
  try {
    await invoke("delete_note", { id: selectedNoteId.value });
    notes.value = notes.value.filter(n => n.id !== selectedNoteId.value);
    selectedNoteId.value = null;
    currentTitle.value = "";
    currentContent.value = "";
  } catch (error) {
    console.error("Failed to delete note:", error);
  }
};

const openHistoryDialog = async () => {
  if (!selectedNoteId.value) return;
  
  showHistoryDialog.value = true;
  loadingHistory.value = true;
  selectedHistory.value = null;
  
  try {
    noteHistory.value = await invoke<NoteHistory[]>("get_note_history", {
      noteId: selectedNoteId.value,
    });
  } catch (error) {
    console.error("Failed to load history:", error);
    noteHistory.value = [];
  } finally {
    loadingHistory.value = false;
  }
};

const closeHistoryDialog = () => {
  showHistoryDialog.value = false;
  noteHistory.value = [];
  selectedHistory.value = null;
};

const selectHistoryItem = (history: NoteHistory) => {
  selectedHistory.value = history;
};

const rollbackToHistory = async (historyId: string) => {
  if (!confirm("确定要回滚到此版本吗？当前内容会被保存为新版本的历史记录。")) {
    return;
  }
  
  try {
    const note = await invoke<Note>("rollback_to_history", {
      historyId,
    });
    
    const index = notes.value.findIndex(n => n.id === note.id);
    if (index !== -1) {
      notes.value[index] = note;
    }
    
    currentTitle.value = note.title;
    currentContent.value = note.content;
    lastSaveTime.value = new Date().toLocaleTimeString();
    
    closeHistoryDialog();
  } catch (error) {
    console.error("Failed to rollback:", error);
    alert("回滚失败: " + error);
  }
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString();
};

const getPreview = (content: string) => {
  return content.slice(0, 100) || "(无内容)";
};

watch([currentTitle, currentContent], () => {
  if (selectedNoteId.value) {
    scheduleSave();
  }
});

onMounted(async () => {
  await loadNotes();
  
  await listen<Note>("note-created", (event) => {
    console.log("Note created remotely:", event.payload);
    const exists = notes.value.some(n => n.id === event.payload.id);
    if (!exists) {
      notes.value.unshift(event.payload);
    }
  });
  
  await listen<Note>("note-updated", (event) => {
    console.log("Note updated remotely:", event.payload);
    const index = notes.value.findIndex(n => n.id === event.payload.id);
    if (index !== -1) {
      notes.value[index] = event.payload;
      if (selectedNoteId.value === event.payload.id) {
        currentTitle.value = event.payload.title;
        currentContent.value = event.payload.content;
      }
    }
  });
  
  await listen<Note>("note-deleted", (event) => {
    console.log("Note deleted remotely:", event.payload);
    notes.value = notes.value.filter(n => n.id !== event.payload.id);
    if (selectedNoteId.value === event.payload.id) {
      selectedNoteId.value = null;
      currentTitle.value = "";
      currentContent.value = "";
    }
  });
});
</script>

<template>
  <div class="app-container">
    <div class="sidebar">
      <div class="sidebar-header">
        <h1>P2P 笔记</h1>
        <button class="new-note-btn" @click="createNewNote">
          新建
        </button>
      </div>
      <div class="notes-list">
        <div
          v-for="note in notes"
          :key="note.id"
          class="note-item"
          :class="{ active: note.id === selectedNoteId }"
          @click="selectNote(note)"
        >
          <div class="note-item-title">
            {{ note.title || "(无标题)" }}
          </div>
          <div class="note-item-preview">
            {{ getPreview(note.content) }}
          </div>
          <div class="note-item-date">
            {{ formatDate(note.updated_at) }}
          </div>
        </div>
      </div>
    </div>
    
    <div class="editor">
      <div v-if="selectedNote()" class="editor">
        <div class="editor-header">
          <input
            v-model="currentTitle"
            type="text"
            class="editor-title-input"
            placeholder="输入标题..."
          />
          <div class="editor-actions">
            <button class="action-btn" @click="openHistoryDialog">
              历史版本
            </button>
            <button class="action-btn delete" @click="deleteNote">
              删除
            </button>
          </div>
        </div>
        <div class="editor-content">
          <textarea
            v-model="currentContent"
            class="editor-textarea"
            placeholder="开始输入笔记内容..."
          ></textarea>
        </div>
        <div class="status-bar">
          <span>字数: {{ currentContent.length }}</span>
          <span>上次保存: {{ lastSaveTime || "未保存" }}</span>
        </div>
      </div>
      <div v-else class="editor-empty">
        选择或创建一个笔记
      </div>
    </div>

    <div v-if="showHistoryDialog" class="dialog-overlay" @click="closeHistoryDialog">
      <div class="dialog" @click.stop>
        <div class="dialog-header">
          <h2>历史版本</h2>
          <button class="close-btn" @click="closeHistoryDialog">&times;</button>
        </div>
        
        <div class="dialog-content">
          <div v-if="loadingHistory" class="loading">
            加载中...
          </div>
          <div v-else-if="noteHistory.length === 0" class="empty-history">
            暂无历史版本
          </div>
          <div v-else class="history-container">
            <div class="history-list">
              <div
                v-for="history in noteHistory"
                :key="history.id"
                class="history-item"
                :class="{ active: selectedHistory?.id === history.id }"
                @click="selectHistoryItem(history)"
              >
                <div class="history-version">版本 #{{ history.version_number }}</div>
                <div class="history-title">{{ history.title || "(无标题)" }}</div>
                <div class="history-date">{{ formatDate(history.version_at) }}</div>
              </div>
            </div>
            
            <div v-if="selectedHistory" class="history-preview">
              <div class="preview-header">
                <h3>版本 #{{ selectedHistory.version_number }} 预览</h3>
                <button 
                  class="action-btn" 
                  @click="rollbackToHistory(selectedHistory.id)"
                >
                  回滚到此版本
                </button>
              </div>
              <div class="preview-title">
                <strong>标题:</strong> {{ selectedHistory.title || "(无标题)" }}
              </div>
              <div class="preview-content">
                <strong>内容:</strong>
                <div class="preview-text">{{ selectedHistory.content }}</div>
              </div>
            </div>
            <div v-else class="preview-empty">
              选择一个历史版本查看
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background-color: white;
  border-radius: 8px;
  width: 900px;
  max-width: 90vw;
  height: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.close-btn {
  background: none;
  border: none;
  font-size: 28px;
  cursor: pointer;
  color: #999;
  line-height: 1;
}

.close-btn:hover {
  color: #333;
}

.dialog-content {
  flex: 1;
  overflow: hidden;
}

.loading, .empty-history, .preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
}

.history-container {
  display: flex;
  height: 100%;
}

.history-list {
  width: 280px;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
}

.history-item {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background-color 0.2s;
}

.history-item:hover {
  background-color: #f9f9f9;
}

.history-item.active {
  background-color: #e8f5e9;
}

.history-version {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.history-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-date {
  font-size: 11px;
  color: #999;
}

.history-preview {
  flex: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e0e0e0;
}

.preview-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.preview-title {
  margin-bottom: 12px;
  font-size: 14px;
  color: #333;
}

.preview-content {
  flex: 1;
  font-size: 14px;
  color: #333;
}

.preview-text {
  margin-top: 8px;
  padding: 12px;
  background-color: #f9f9f9;
  border-radius: 4px;
  white-space: pre-wrap;
  line-height: 1.6;
  max-height: 300px;
  overflow-y: auto;
}
</style>