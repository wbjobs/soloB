<template>
  <div class="app-container" :class="{ 'theme-dark': currentTheme === 'dark', 'theme-custom': currentTheme === 'custom' }">
    <header class="app-header">
      <h1>🔐 Secure Notes</h1>
      <div class="header-actions">
        <div class="theme-selector">
          <label for="theme-select">🎨 主题：</label>
          <select id="theme-select" v-model="currentTheme" @change="applyTheme">
            <option value="light">🌞 浅色</option>
            <option value="dark">🌙 深色</option>
            <option value="custom">🎨 自定义</option>
          </select>
        </div>
        <button @click="createNote" class="btn btn-primary">
          ➕ 新建笔记
        </button>
      </div>
    </header>

    <div class="app-content">
      <aside class="notes-sidebar">
        <div class="notes-list">
          <div
            v-for="note in notes"
            :key="note.id"
            :class="['note-item', { active: currentNoteId === note.id }]"
            @click="selectNote(note.id)"
          >
            <div class="note-title">{{ note.title }}</div>
            <div class="note-meta">
              <span class="note-date">{{ formatDate(note.updatedAt) }}</span>
              <button
                @click.stop="deleteNote(note.id)"
                class="btn btn-danger btn-small"
              >
                🗑️
              </button>
            </div>
          </div>

          <div v-if="notes.length === 0" class="empty-state">
            <p>暂无笔记</p>
            <p class="hint">点击"新建笔记"开始创建</p>
          </div>
        </div>
      </aside>

      <main class="notes-editor-main">
        <div v-if="currentNote" class="editor-wrapper">
          <div class="editor-header">
            <input
              v-model="currentNote.title"
              type="text"
              class="note-title-input"
              placeholder="笔记标题"
              @blur="saveNote"
            />
          </div>

          <div class="editor-preview-container">
            <div class="editor-panel">
              <div class="panel-header">
                <span class="panel-title">✏️ Markdown 编辑器</span>
              </div>
              <textarea
                v-model="currentNote.content"
                class="note-content-editor"
                placeholder="开始编写您的 Markdown 笔记...\n\n# 标题\n\n**粗体** *斜体*\n\n- 列表项"
                @input="updatePreview"
                @blur="saveNote"
              ></textarea>
            </div>

            <div class="preview-panel">
              <div class="panel-header">
                <span class="panel-title">👁️ 实时预览</span>
              </div>
              <div 
                class="markdown-preview" 
                v-html="renderedContent"
              ></div>
            </div>
          </div>

          <div class="editor-status">
            <span v-if="saving" class="saving-indicator">保存中...</span>
            <span v-else-if="lastSaved" class="saved-indicator">
              已保存: {{ formatDate(lastSaved) }}
            </span>
            <span class="word-count">字数: {{ wordCount }}</span>
          </div>
        </div>

        <div v-else class="editor-empty">
          <div class="welcome-message">
            <h2>欢迎使用 Secure Notes</h2>
            <p>您的笔记将使用 AES-256 加密保护</p>
            <p>请选择一个笔记或创建新笔记</p>
            <div class="markdown-features">
              <h3>支持的 Markdown 语法：</h3>
              <ul>
                <li># 标题 (H1-H6)</li>
                <li>**粗体** 和 *斜体*</li>
                <li>- 无序列表和 1. 有序列表</li>
                <li>`代码` 和 ```代码块```</li>
                <li>> 引用块</li>
                <li>[链接](url) 和 ![图片](url)</li>
                <li>表格、分隔线等</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>

    <div v-if="currentTheme === 'custom'" class="custom-theme-panel">
      <h3>🎨 自定义主题 CSS</h3>
      <textarea
        v-model="customCSS"
        class="custom-css-editor"
        placeholder="在此输入自定义 CSS 样式...\n\n例如：\n.markdown-preview h1 {\n  color: #ff6b6b;\n}\n\n.markdown-preview {\n  background: #f8f9fa;\n}"
        @input="applyCustomCSS"
      ></textarea>
      <button @click="saveCustomCSS" class="btn btn-primary btn-small">保存主题</button>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
      <button @click="error = ''" class="close-error">✕</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'

marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value
      } catch (e) {}
    }
    return hljs.highlightAuto(code).value
  },
  breaks: true,
  gfm: true
})

const notes = ref([])
const currentNoteId = ref(null)
const currentNote = ref(null)
const saving = ref(false)
const lastSaved = ref(null)
const error = ref('')
const renderedContent = ref('')
const currentTheme = ref('light')
const customCSS = ref('')

const api = window.electronAPI

const wordCount = computed(() => {
  if (!currentNote.value) return 0
  return currentNote.value.content ? currentNote.value.content.length : 0
})

async function loadNotes() {
  try {
    const result = await api.notes.list()
    if (result.success) {
      notes.value = result.data
    } else {
      showError(result.error)
    }
  } catch (err) {
    showError('加载笔记失败: ' + err.message)
  }
}

async function createNote() {
  try {
    const result = await api.notes.create({
      title: '新笔记',
      content: '# 新笔记\n\n开始编写您的 Markdown 笔记...'
    })
    
    if (result.success) {
      await loadNotes()
      selectNote(result.data.id)
    } else {
      showError(result.error)
    }
  } catch (err) {
    showError('创建笔记失败: ' + err.message)
  }
}

async function selectNote(id) {
  currentNoteId.value = id
  currentNote.value = null
  
  try {
    const result = await api.notes.get(id)
    if (result.success) {
      currentNote.value = {
        id: result.data.id,
        title: result.data.title,
        content: result.data.content
      }
      lastSaved.value = Date.now()
      updatePreview()
    } else {
      showError(result.error)
    }
  } catch (err) {
    showError('加载笔记失败: ' + err.message)
  }
}

function updatePreview() {
  if (!currentNote.value) {
    renderedContent.value = ''
    return
  }
  
  try {
    renderedContent.value = marked.parse(currentNote.value.content || '')
  } catch (err) {
    renderedContent.value = '<p class="markdown-error">Markdown 解析错误</p>'
  }
  
  nextTick(() => {
    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block)
    })
  })
}

let saveTimeout = null

function saveNote() {
  if (!currentNote.value) return
  
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  
  saveTimeout = setTimeout(async () => {
    saving.value = true
    
    try {
      const result = await api.notes.update({
        id: currentNote.value.id,
        title: currentNote.value.title,
        content: currentNote.value.content
      })
      
      if (result.success) {
        lastSaved.value = Date.now()
        await loadNotes()
      } else {
        showError(result.error)
      }
    } catch (err) {
      showError('保存笔记失败: ' + err.message)
    } finally {
      saving.value = false
    }
  }, 300)
}

async function deleteNote(id) {
  if (!confirm('确定要删除这个笔记吗？')) {
    return
  }
  
  try {
    const result = await api.notes.delete(id)
    if (result.success) {
      if (currentNoteId.value === id) {
        currentNoteId.value = null
        currentNote.value = null
        renderedContent.value = ''
      }
      await loadNotes()
    } else {
      showError(result.error)
    }
  } catch (err) {
    showError('删除笔记失败: ' + err.message)
  }
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function showError(message) {
  error.value = message
  setTimeout(() => {
    error.value = ''
  }, 5000)
}

function applyTheme() {
  if (currentTheme.value === 'custom') {
    loadCustomCSS()
  } else {
    removeCustomCSS()
  }
}

function applyCustomCSS() {
  removeCustomCSS()
  
  if (currentTheme.value === 'custom' && customCSS.value) {
    const style = document.createElement('style')
    style.id = 'custom-theme-css'
    style.textContent = customCSS.value
    document.head.appendChild(style)
  }
}

function removeCustomCSS() {
  const existing = document.getElementById('custom-theme-css')
  if (existing) {
    existing.remove()
  }
}

function saveCustomCSS() {
  localStorage.setItem('customCSS', customCSS.value)
  applyCustomCSS()
  showError('自定义主题已保存！')
}

function loadCustomCSS() {
  const saved = localStorage.getItem('customCSS')
  if (saved) {
    customCSS.value = saved
  }
  applyCustomCSS()
}

onMounted(() => {
  loadNotes()
  
  const savedTheme = localStorage.getItem('theme')
  if (savedTheme) {
    currentTheme.value = savedTheme
  }
  
  loadCustomCSS()
})

watch(currentTheme, (newTheme) => {
  localStorage.setItem('theme', newTheme)
  applyTheme()
})

watch(currentNote, (newNote, oldNote) => {
  if (oldNote && !newNote) {
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
  }
}, { deep: true })
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: #f5f5f5;
  color: #333;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  transition: background-color 0.3s, color 0.3s;
}

.app-container.theme-dark {
  background-color: #1a1a2e;
  color: #e0e0e0;
}

.app-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.app-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.theme-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.theme-selector label {
  font-size: 0.9rem;
}

.theme-selector select {
  padding: 0.4rem 0.8rem;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  cursor: pointer;
  font-size: 0.9rem;
}

.theme-selector select option {
  background: #667eea;
  color: white;
}

.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-primary {
  background-color: rgba(255, 255, 255, 0.2);
  color: white;
}

.btn-primary:hover {
  background-color: rgba(255, 255, 255, 0.3);
}

.btn-danger {
  background-color: #ef4444;
  color: white;
}

.btn-danger:hover {
  background-color: #dc2626;
}

.btn-small {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.app-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.notes-sidebar {
  width: 280px;
  background-color: white;
  border-right: 1px solid #e5e7eb;
  overflow-y: auto;
  flex-shrink: 0;
}

.theme-dark .notes-sidebar {
  background-color: #16213e;
  border-right-color: #2d3748;
}

.notes-list {
  padding: 1rem;
}

.note-item {
  padding: 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 0.5rem;
  border: 1px solid transparent;
}

.note-item:hover {
  background-color: #f3f4f6;
}

.theme-dark .note-item:hover {
  background-color: #1a1a2e;
}

.note-item.active {
  background-color: #eff6ff;
  border-color: #3b82f6;
}

.theme-dark .note-item.active {
  background-color: #1e3a5f;
  border-color: #4a90d9;
}

.note-title {
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.5rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.theme-dark .note-title {
  color: #e2e8f0;
}

.note-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.note-date {
  font-size: 0.75rem;
  color: #6b7280;
}

.theme-dark .note-date {
  color: #a0aec0;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: #9ca3af;
}

.empty-state .hint {
  font-size: 0.875rem;
  margin-top: 0.5rem;
}

.notes-editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: white;
  overflow: hidden;
}

.theme-dark .notes-editor-main {
  background-color: #1a1a2e;
}

.editor-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.editor-header {
  padding: 1.5rem 2rem;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.theme-dark .editor-header {
  border-bottom-color: #2d3748;
}

.note-title-input {
  width: 100%;
  font-size: 1.75rem;
  font-weight: 700;
  border: none;
  padding: 0.5rem 0;
  outline: none;
  background: transparent;
  color: inherit;
}

.editor-preview-container {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.editor-panel,
.preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid #e5e7eb;
}

.theme-dark .editor-panel,
.theme-dark .preview-panel {
  border-right-color: #2d3748;
}

.preview-panel {
  border-right: none;
}

.panel-header {
  padding: 0.75rem 1.5rem;
  background-color: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.theme-dark .panel-header {
  background-color: #16213e;
  border-bottom-color: #2d3748;
}

.panel-title {
  font-weight: 600;
  font-size: 0.875rem;
  color: #4b5563;
}

.theme-dark .panel-title {
  color: #a0aec0;
}

.note-content-editor {
  flex: 1;
  font-family: 'Courier New', Courier, monospace;
  font-size: 1rem;
  line-height: 1.8;
  border: none;
  padding: 1.5rem;
  resize: none;
  outline: none;
  background: transparent;
  color: inherit;
}

.markdown-preview {
  flex: 1;
  padding: 1.5rem;
  overflow-y: auto;
  line-height: 1.8;
  color: #1f2937;
}

.theme-dark .markdown-preview {
  color: #e2e8f0;
}

.markdown-preview h1 {
  font-size: 2rem;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #e5e7eb;
  color: #1f2937;
}

.theme-dark .markdown-preview h1 {
  border-bottom-color: #2d3748;
  color: #f7fafc;
}

.markdown-preview h2 {
  font-size: 1.5rem;
  margin: 1.5rem 0 1rem;
  color: #374151;
}

.theme-dark .markdown-preview h2 {
  color: #edf2f7;
}

.markdown-preview h3 {
  font-size: 1.25rem;
  margin: 1.25rem 0 0.75rem;
  color: #4b5563;
}

.theme-dark .markdown-preview h3 {
  color: #e2e8f0;
}

.markdown-preview p {
  margin-bottom: 1rem;
}

.markdown-preview ul,
.markdown-preview ol {
  margin-left: 1.5rem;
  margin-bottom: 1rem;
}

.markdown-preview li {
  margin-bottom: 0.25rem;
}

.markdown-preview blockquote {
  border-left: 4px solid #3b82f6;
  padding-left: 1rem;
  margin: 1rem 0;
  color: #6b7280;
  font-style: italic;
}

.theme-dark .markdown-preview blockquote {
  color: #a0aec0;
}

.markdown-preview code {
  background-color: #f3f4f6;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.9em;
  color: #e53e3e;
}

.theme-dark .markdown-preview code {
  background-color: #2d3748;
  color: #fc8181;
}

.markdown-preview pre {
  background-color: #1f2937;
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1rem 0;
}

.markdown-preview pre code {
  background-color: transparent;
  padding: 0;
  color: #e2e8f0;
  font-size: 0.875rem;
}

.markdown-preview a {
  color: #3b82f6;
  text-decoration: none;
}

.markdown-preview a:hover {
  text-decoration: underline;
}

.markdown-preview img {
  max-width: 100%;
  border-radius: 8px;
  margin: 1rem 0;
}

.markdown-preview table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

.markdown-preview th,
.markdown-preview td {
  border: 1px solid #e5e7eb;
  padding: 0.75rem;
  text-align: left;
}

.theme-dark .markdown-preview th,
.theme-dark .markdown-preview td {
  border-color: #2d3748;
}

.markdown-preview th {
  background-color: #f9fafb;
  font-weight: 600;
}

.theme-dark .markdown-preview th {
  background-color: #16213e;
}

.markdown-preview hr {
  border: none;
  border-top: 2px solid #e5e7eb;
  margin: 2rem 0;
}

.theme-dark .markdown-preview hr {
  border-top-color: #2d3748;
}

.markdown-preview strong {
  font-weight: 700;
}

.markdown-preview em {
  font-style: italic;
}

.editor-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 2rem;
  border-top: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.theme-dark .editor-status {
  border-top-color: #2d3748;
}

.saving-indicator {
  color: #f59e0b;
  font-size: 0.875rem;
}

.saved-indicator {
  color: #10b981;
  font-size: 0.875rem;
}

.word-count {
  color: #6b7280;
  font-size: 0.875rem;
}

.theme-dark .word-count {
  color: #a0aec0;
}

.editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.welcome-message {
  text-align: center;
  color: #6b7280;
  max-width: 600px;
  padding: 2rem;
}

.theme-dark .welcome-message {
  color: #a0aec0;
}

.welcome-message h2 {
  font-size: 1.75rem;
  margin-bottom: 1rem;
  color: #374151;
}

.theme-dark .welcome-message h2 {
  color: #f7fafc;
}

.welcome-message p {
  margin-bottom: 0.5rem;
}

.markdown-features {
  margin-top: 2rem;
  text-align: left;
  background-color: #f9fafb;
  padding: 1.5rem;
  border-radius: 12px;
}

.theme-dark .markdown-features {
  background-color: #16213e;
}

.markdown-features h3 {
  margin-bottom: 1rem;
  color: #4b5563;
}

.theme-dark .markdown-features h3 {
  color: #e2e8f0;
}

.markdown-features ul {
  list-style-position: inside;
}

.markdown-features li {
  margin-bottom: 0.5rem;
}

.custom-theme-panel {
  position: fixed;
  right: 2rem;
  top: 80px;
  width: 350px;
  background-color: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 1.5rem;
  z-index: 100;
  border: 1px solid #e5e7eb;
}

.theme-dark .custom-theme-panel {
  background-color: #16213e;
  border-color: #2d3748;
}

.custom-theme-panel h3 {
  margin-bottom: 1rem;
  color: #374151;
}

.theme-dark .custom-theme-panel h3 {
  color: #f7fafc;
}

.custom-css-editor {
  width: 100%;
  height: 200px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  resize: vertical;
  background-color: #f9fafb;
}

.theme-dark .custom-css-editor {
  background-color: #1a1a2e;
  border-color: #2d3748;
  color: #e2e8f0;
}

.error-message {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  background-color: #ef4444;
  color: white;
  padding: 1rem 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  gap: 1rem;
  z-index: 1000;
}

.close-error {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 1rem;
  font-weight: bold;
}

.markdown-error {
  color: #ef4444;
  font-style: italic;
}

@media (max-width: 1024px) {
  .editor-preview-container {
    flex-direction: column;
  }
  
  .editor-panel,
  .preview-panel {
    border-right: none;
    border-bottom: 1px solid #e5e7eb;
  }
  
  .theme-dark .editor-panel,
  .theme-dark .preview-panel {
    border-bottom-color: #2d3748;
  }
}

@media (max-width: 768px) {
  .notes-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #e5e7eb;
    height: 200px;
    flex-shrink: 0;
  }
  
  .theme-dark .notes-sidebar {
    border-bottom-color: #2d3748;
  }
  
  .app-content {
    flex-direction: column;
  }
  
  .header-actions {
    flex-direction: column;
    align-items: stretch;
  }
  
  .theme-selector {
    justify-content: space-between;
  }
}
</style>
