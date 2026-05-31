<script>
  import { onMount } from "svelte";
  import { marked } from "marked";
  import {
    getNotes,
    createNote,
    updateNote,
    deleteNote,
    syncWithServer,
    checkServerHealth,
    getUnsyncedChanges,
    getNoteHistory,
    rollbackToVersion,
  } from "./api.js";

  let notes = [];
  let selectedNote = null;
  let editorContent = "";
  let editorTitle = "";
  let syncStatus = "idle";
  let isOnline = false;
  let unsyncedCount = 0;

  let noteHistory = [];
  let loadingHistory = false;
  let selectedVersion = null;
  let showHistoryPanel = false;

  async function loadNotes() {
    try {
      notes = await getNotes();
      const unsynced = await getUnsyncedChanges();
      unsyncedCount = unsynced.length;
    } catch (error) {
      console.error("Failed to load notes:", error);
    }
  }

  async function checkConnectivity() {
    isOnline = await checkServerHealth();
    return isOnline;
  }

  async function triggerSync() {
    if (!isOnline) {
      console.log("Offline, skipping sync");
      return;
    }

    syncStatus = "syncing";
    try {
      await syncWithServer();
      await loadNotes();
      if (selectedNote && showHistoryPanel) {
        await loadNoteHistory();
      }
      syncStatus = "synced";
      setTimeout(() => {
        syncStatus = "idle";
      }, 2000);
    } catch (error) {
      console.error("Sync error:", error);
      syncStatus = "error";
    }
  }

  async function handleCreateNote() {
    try {
      const newNote = await createNote("Untitled Note", "");
      await loadNotes();
      selectNote(newNote);
    } catch (error) {
      console.error("Failed to create note:", error);
    }
  }

  async function handleDeleteNote(id) {
    if (!confirm("Are you sure you want to delete this note?")) {
      return;
    }

    try {
      await deleteNote(id);
      await loadNotes();
      if (selectedNote && selectedNote.id === id) {
        selectedNote = null;
        editorContent = "";
        editorTitle = "";
        noteHistory = [];
        selectedVersion = null;
        showHistoryPanel = false;
      }
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  }

  async function saveCurrentNote() {
    if (!selectedNote) return;
    
    try {
      await updateNote(selectedNote.id, editorTitle, editorContent);
      await loadNotes();
    } catch (error) {
      console.error("Failed to save note:", error);
    }
  }

  function selectNote(note) {
    selectedNote = note;
    editorTitle = note.title;
    editorContent = note.content;
    noteHistory = [];
    selectedVersion = null;
    
    if (isOnline) {
      showHistoryPanel = true;
      loadNoteHistory();
    } else {
      showHistoryPanel = false;
    }
  }

  async function loadNoteHistory() {
    if (!selectedNote || !isOnline) return;

    loadingHistory = true;
    try {
      noteHistory = await getNoteHistory(selectedNote.id);
      console.log("History loaded:", noteHistory.length, "versions");
    } catch (error) {
      console.error("Failed to load history:", error);
      noteHistory = [];
    } finally {
      loadingHistory = false;
    }
  }

  function formatTimestamp(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function selectVersion(version) {
    selectedVersion = version;
  }

  $: selectedVersionHTML = selectedVersion ? marked(selectedVersion.content || "") : "";

  async function handleRollback() {
    if (!selectedVersion || !selectedNote) return;

    if (!confirm(`确定要回滚到版本 ${selectedVersion.version} 吗？当前未保存的更改将丢失。`)) {
      return;
    }

    try {
      const updatedNote = await rollbackToVersion(selectedNote.id, selectedVersion.version);
      
      editorTitle = updatedNote.title;
      editorContent = updatedNote.content;
      
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        await updateNote(selectedNote.id, updatedNote.title, updatedNote.content);
        await triggerSync();
        await loadNoteHistory();
      }, 500);

      selectedVersion = null;
      alert("回滚成功！");
    } catch (error) {
      console.error("Rollback failed:", error);
      alert("回滚失败: " + error.message);
    }
  }

  function closePreview() {
    selectedVersion = null;
  }

  $: previewHTML = marked(editorContent);

  function handleTitleChange() {
    if (selectedNote) {
      selectedNote.title = editorTitle;
    }
  }

  function handleContentChange() {
    if (selectedNote) {
      selectedNote.content = editorContent;
    }
  }

  async function toggleHistoryPanel() {
    if (!isOnline) {
      alert("历史版本功能需要联网才能使用。");
      return;
    }
    
    showHistoryPanel = !showHistoryPanel;
    if (showHistoryPanel && selectedNote) {
      await loadNoteHistory();
    }
  }

  onMount(async () => {
    await loadNotes();
    await checkConnectivity();

    setInterval(async () => {
      const wasOnline = isOnline;
      await checkConnectivity();
      if (!wasOnline && isOnline) {
        console.log("Back online, triggering sync");
        await triggerSync();
      }
    }, 5000);

    setInterval(async () => {
      if (selectedNote) {
        await loadNotes();
      }
    }, 10000);
  });

  let saveTimeout;
  function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      await saveCurrentNote();
      if (isOnline) {
        await triggerSync();
      }
    }, 1000);
  }
</script>

<style>
  .app {
    display: flex;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 0;
  }

  .sidebar {
    width: 300px;
    border-right: 1px solid #e0e0e0;
    display: flex;
    flex-direction: column;
    background: #fafafa;
  }

  .sidebar-header {
    padding: 16px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .sidebar-header h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }

  .new-note-btn {
    background: #4c6ef5;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 14px;
  }

  .status-bar {
    padding: 8px 16px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #666;
  }

  .status-online {
    color: #28a745;
  }

  .status-offline {
    color: #dc3545;
  }

  .notes-list {
    flex: 1;
    overflow-y: auto;
  }

  .note-item {
    padding: 12px 16px;
    border-bottom: 1px solid #f0f0f0;
    cursor: pointer;
  }

  .note-item:hover {
    background: #f0f0f0;
  }

  .note-item.selected {
    background: #e8f0fe;
  }

  .note-title {
    font-weight: 500;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .note-preview {
    font-size: 12px;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-panel {
    border-top: 1px solid #e0e0e0;
    background: #f5f5f5;
    display: flex;
    flex-direction: column;
    max-height: 350px;
  }

  .history-header {
    padding: 12px 16px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #e9ecef;
  }

  .history-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #495057;
  }

  .history-toggle-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: #6c757d;
  }

  .history-toggle-btn:hover {
    color: #007bff;
  }

  .history-list {
    flex: 1;
    overflow-y: auto;
  }

  .history-item {
    padding: 10px 16px;
    border-bottom: 1px solid #e9ecef;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .history-item:hover {
    background: #e3f2fd;
  }

  .history-item.selected {
    background: #bbdefb;
  }

  .history-item-info {
    display: flex;
    flex-direction: column;
  }

  .history-version {
    font-weight: 600;
    font-size: 13px;
    color: #1976d2;
  }

  .history-time {
    font-size: 11px;
    color: #666;
    margin-top: 2px;
  }

  .history-op {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    text-transform: uppercase;
  }

  .op-create {
    background: #d4edda;
    color: #155724;
  }

  .op-update {
    background: #cce5ff;
    color: #004085;
  }

  .op-delete {
    background: #f8d7da;
    color: #721c24;
  }

  .empty-history {
    padding: 20px;
    text-align: center;
    color: #999;
    font-size: 13px;
  }

  .loading-history {
    padding: 20px;
    text-align: center;
    color: #666;
    font-size: 13px;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .editor-header {
    padding: 16px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .note-input {
    flex: 1;
    border: none;
    outline: none;
    font-size: 24px;
    font-weight: 600;
    margin-right: 12px;
  }

  .history-btn {
    background: #6c757d;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
  }

  .history-btn:hover:not(:disabled) {
    background: #5a6268;
  }

  .history-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .editor-body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #e0e0e0;
  }

  .editor-section:last-child {
    border-right: none;
  }

  .section-label {
    padding: 8px 16px;
    background: #f8f9fa;
    border-bottom: 1px solid #e0e0e0;
    font-weight: 500;
    font-size: 12px;
    text-transform: uppercase;
    color: #666;
  }

  textarea {
    flex: 1;
    border: none;
    outline: none;
    padding: 16px;
    font-family: monospace;
    font-size: 14px;
    line-height: 1.6;
    resize: none;
  }

  .preview {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
    line-height: 1.6;
  }

  .preview h1 { font-size: 2em; margin: 0.67em 0; }
  .preview h2 { font-size: 1.5em; margin: 0.83em 0; }
  .preview h3 { font-size: 1.17em; margin: 1em 0; }
  .preview p { margin: 1em 0; }
  .preview ul { margin: 1em 0; padding-left: 2em; }
  .preview code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
  .preview pre { background: #f4f4f4; padding: 16px; overflow-x: auto; border-radius: 4px; }
  .preview blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding-left: 1em; color: #666; }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #999;
    font-size: 16px;
  }

  .delete-btn {
    background: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
  }

  .note-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .version-preview-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .version-preview-modal {
    background: white;
    border-radius: 8px;
    width: 90%;
    max-width: 900px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }

  .preview-modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f8f9fa;
    border-radius: 8px 8px 0 0;
  }

  .preview-modal-header h3 {
    margin: 0;
    font-size: 16px;
    color: #333;
  }

  .preview-modal-actions {
    display: flex;
    gap: 8px;
  }

  .close-btn {
    background: #6c757d;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
    font-size: 13px;
  }

  .close-btn:hover {
    background: #5a6268;
  }

  .rollback-btn {
    background: #dc3545;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
    font-size: 13px;
  }

  .rollback-btn:hover:not(:disabled) {
    background: #c82333;
  }

  .rollback-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .preview-modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .version-info {
    background: #e3f2fd;
    padding: 12px 16px;
    border-radius: 4px;
    margin-bottom: 16px;
  }

  .version-info-row {
    display: flex;
    margin-bottom: 6px;
  }

  .version-info-row:last-child {
    margin-bottom: 0;
  }

  .version-info-label {
    font-weight: 600;
    color: #1565c0;
    width: 80px;
  }

  .version-info-value {
    color: #333;
  }

  .version-title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid #eee;
  }

  .version-content {
    line-height: 1.8;
  }

  .version-content h1 { font-size: 1.75em; margin: 0.5em 0; }
  .version-content h2 { font-size: 1.35em; margin: 0.5em 0; }
  .version-content h3 { font-size: 1.1em; margin: 0.5em 0; }
  .version-content p { margin: 0.8em 0; }
  .version-content ul { margin: 0.8em 0; padding-left: 2em; }
  .version-content code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
  .version-content pre { background: #f4f4f4; padding: 12px; overflow-x: auto; border-radius: 4px; }
  .version-content blockquote { border-left: 4px solid #ddd; margin: 0.8em 0; padding-left: 1em; color: #666; }
</style>

<div class="app">
  <div class="sidebar">
    <div class="sidebar-header">
      <h2>Notes</h2>
      <button class="new-note-btn" on:click={handleCreateNote}>+ New</button>
    </div>
    <div class="status-bar">
      <span class={isOnline ? "status-online" : "status-offline"}>
        {isOnline ? "● Online" : "● Offline"}
      </span>
      <span>
        {#if syncStatus === "syncing"}
          Syncing...
        {:else if syncStatus === "synced"}
          Synced!
        {:else if syncStatus === "error"}
          Sync error
        {:else if unsyncedCount > 0}
          {unsyncedCount} unsynced
        {:else}
          Up to date
        {/if}
      </span>
    </div>
    <div class="notes-list">
      {#each notes as note (note.id)}
        <div
          class="note-item {selectedNote && selectedNote.id === note.id ? 'selected' : ''}"
          on:click={() => selectNote(note)}
        >
          <div class="note-item-header">
            <div class="note-title">{note.title || "Untitled"}</div>
            {#if selectedNote && selectedNote.id === note.id}
              <button class="delete-btn" on:click|stopPropagation={() => handleDeleteNote(note.id)}>
                Delete
              </button>
            {/if}
          </div>
          <div class="note-preview">{note.content.substring(0, 50)}...</div>
        </div>
      {/each}
    </div>

    {#if showHistoryPanel && selectedNote}
      <div class="history-panel">
        <div class="history-header">
          <h3>📜 历史版本</h3>
          <button class="history-toggle-btn" on:click={toggleHistoryPanel}>✕</button>
        </div>
        <div class="history-list">
          {#if loadingHistory}
            <div class="loading-history">加载中...</div>
          {:else if noteHistory.length === 0}
            <div class="empty-history">暂无历史版本</div>
          {:else}
            {#each noteHistory as version (version.version)}
              <div
                class="history-item {selectedVersion && selectedVersion.version === version.version ? 'selected' : ''}"
                on:click={() => selectVersion(version)}
              >
                <div class="history-item-info">
                  <div class="history-version">版本 {version.version}</div>
                  <div class="history-time">{formatTimestamp(version.timestamp)}</div>
                </div>
                <span class="history-op op-{version.operation}">
                  {version.operation === "create" ? "创建" : version.operation === "update" ? "修改" : "删除"}
                </span>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <div class="main-content">
    {#if selectedNote}
      <div class="editor-header">
        <input
          class="note-input"
          bind:value={editorTitle}
          on:input={handleTitleChange}
          on:blur={scheduleSave}
          placeholder="Note title"
        />
        <button
          class="history-btn"
          on:click={toggleHistoryPanel}
          disabled={!isOnline}
        >
          {showHistoryPanel ? "隐藏历史" : "显示历史"}
        </button>
      </div>
      <div class="editor-body">
        <div class="editor-section">
          <div class="section-label">Markdown</div>
          <textarea
            bind:value={editorContent}
            on:input={handleContentChange}
            on:blur={scheduleSave}
            placeholder="Start writing..."
          />
        </div>
        <div class="editor-section">
          <div class="section-label">Preview</div>
          <div class="preview">{@html previewHTML}</div>
        </div>
      </div>
    {:else}
      <div class="empty-state">
        <p>Select a note or create a new one</p>
      </div>
    {/if}

    {#if selectedVersion}
      <div class="version-preview-overlay" on:click|self={closePreview}>
        <div class="version-preview-modal">
          <div class="preview-modal-header">
            <h3>版本 {selectedVersion.version} 预览</h3>
            <div class="preview-modal-actions">
              <button class="rollback-btn" on:click={handleRollback}>
                ↩ 回滚到此版本
              </button>
              <button class="close-btn" on:click={closePreview}>
                关闭
              </button>
            </div>
          </div>
          <div class="preview-modal-body">
            <div class="version-info">
              <div class="version-info-row">
                <span class="version-info-label">版本号:</span>
                <span class="version-info-value">{selectedVersion.version}</span>
              </div>
              <div class="version-info-row">
                <span class="version-info-label">保存时间:</span>
                <span class="version-info-value">{formatTimestamp(selectedVersion.timestamp)}</span>
              </div>
              <div class="version-info-row">
                <span class="version-info-label">操作类型:</span>
                <span class="version-info-value">
                  {selectedVersion.operation === "create" ? "创建" : selectedVersion.operation === "update" ? "修改" : "删除"}
                </span>
              </div>
            </div>
            <div class="version-title">{selectedVersion.title || "（无标题）"}</div>
            <div class="version-content">
              {@html selectedVersionHTML}
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
