<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'

interface SearchResult {
  file_path: string
  function_name: string
  code: string
  score: number
}

const searchQuery = ref('')
const selectedDirectory = ref('')
const searchResults = ref<SearchResult[]>([])
const isScanning = ref(false)
const isSearching = ref(false)
const scanProgress = ref(0)
const scanStatus = ref('')

onMounted(async () => {
  try {
    selectedDirectory.value = await invoke<string>('get_data_directory')
    if (!selectedDirectory.value) {
      await selectDirectory()
    } else {
      await loadExistingIndex()
    }
  } catch (error) {
    console.error('初始化失败:', error)
  }
})

async function selectDirectory() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择要索引的代码目录'
  })
  
  if (selected && typeof selected === 'string') {
    selectedDirectory.value = selected
    await scanDirectory()
  }
}

async function scanDirectory() {
  if (!selectedDirectory.value) return
  
  isScanning.value = true
  scanStatus.value = '正在准备扫描...'
  
  try {
    const unsubscribe = await invoke<number>('scan_directory', {
      directory: selectedDirectory.value
    })
    
    await pollScanProgress()
  } catch (error) {
    console.error('扫描失败:', error)
    scanStatus.value = `扫描失败: ${error}`
  } finally {
    isScanning.value = false
  }
}

async function pollScanProgress() {
  const pollInterval = setInterval(async () => {
    try {
      const progress = await invoke<{ progress: number; status: string; finished: boolean }>(
        'get_scan_progress'
      )
      scanProgress.value = progress.progress
      scanStatus.value = progress.status
      
      if (progress.finished) {
        clearInterval(pollInterval)
        scanStatus.value = '扫描完成！'
      }
    } catch (error) {
      clearInterval(pollInterval)
      console.error('获取进度失败:', error)
    }
  }, 500)
}

async function loadExistingIndex() {
  try {
    const hasIndex = await invoke<boolean>('has_existing_index', {
      directory: selectedDirectory.value
    })
    if (hasIndex) {
      scanStatus.value = '已加载现有索引'
    }
  } catch (error) {
    console.error('检查索引失败:', error)
  }
}

async function performSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }
  
  isSearching.value = true
  
  try {
    const results = await invoke<SearchResult[]>('search_code', {
      query: searchQuery.value,
      limit: 10
    })
    searchResults.value = results
  } catch (error) {
    console.error('搜索失败:', error)
  } finally {
    isSearching.value = false
  }
}

function formatScore(score: number): string {
  return (score * 100).toFixed(1) + '%'
}
</script>

<template>
  <div class="app-container">
    <header class="header">
      <h1>语义代码搜索</h1>
      <div class="directory-info">
        <span>当前目录: {{ selectedDirectory || '未选择' }}</span>
        <button @click="selectDirectory" :disabled="isScanning">
          {{ isScanning ? '扫描中...' : '选择目录' }}
        </button>
      </div>
    </header>

    <main class="main">
      <div class="search-section">
        <div class="search-bar">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="输入自然语言查询，例如：'找出所有处理用户登录的逻辑'"
            @keyup.enter="performSearch"
            :disabled="isSearching"
          />
          <button @click="performSearch" :disabled="isSearching || !searchQuery.trim()">
            {{ isSearching ? '搜索中...' : '搜索' }}
          </button>
        </div>
        
        <div v-if="isScanning" class="progress-bar">
          <div class="progress-fill" :style="{ width: scanProgress + '%' }"></div>
          <span class="progress-text">{{ scanStatus }}</span>
        </div>
        <div v-else-if="scanStatus" class="status-text">
          {{ scanStatus }}
        </div>
      </div>

      <div class="results-section">
        <div v-if="searchResults.length > 0" class="results-list">
          <h3>找到 {{ searchResults.length }} 个相关代码片段</h3>
          <div
            v-for="(result, index) in searchResults"
            :key="index"
            class="result-item"
          >
            <div class="result-header">
              <span class="function-name">{{ result.function_name }}</span>
              <span class="score">{{ formatScore(result.score) }}</span>
            </div>
            <div class="file-path">{{ result.file_path }}</div>
            <pre class="code-block"><code>{{ result.code }}</code></pre>
          </div>
        </div>
        
        <div v-else-if="!isSearching && searchQuery" class="no-results">
          未找到相关代码片段
        </div>
        
        <div v-else class="welcome-message">
          <p>请先选择一个代码目录进行索引，然后输入自然语言查询来搜索代码。</p>
          <p class="example">示例查询: "找出所有处理用户登录的逻辑"</p>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.header {
  background: rgba(255, 255, 255, 0.95);
  padding: 20px 40px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header h1 {
  margin: 0;
  font-size: 24px;
  color: #333;
}

.directory-info {
  display: flex;
  align-items: center;
  gap: 20px;
  font-size: 14px;
  color: #666;
}

.directory-info button {
  padding: 8px 16px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.directory-info button:hover:not(:disabled) {
  background: #5a67d8;
}

.directory-info button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.main {
  flex: 1;
  padding: 40px;
  display: flex;
  flex-direction: column;
}

.search-section {
  max-width: 800px;
  margin: 0 auto 40px;
  width: 100%;
}

.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.search-bar input {
  flex: 1;
  padding: 15px 20px;
  font-size: 16px;
  border: none;
  border-radius: 8px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  outline: none;
  transition: box-shadow 0.2s;
}

.search-bar input:focus {
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
}

.search-bar input:disabled {
  background: #f5f5f5;
}

.search-bar button {
  padding: 15px 30px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.2s;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.search-bar button:hover:not(:disabled) {
  background: #5a67d8;
}

.search-bar button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.progress-bar {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  padding: 15px;
  position: relative;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.progress-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 8px;
  transition: width 0.3s;
  opacity: 0.3;
}

.progress-text {
  position: relative;
  z-index: 1;
  font-size: 14px;
  color: #333;
}

.status-text {
  text-align: center;
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
}

.results-section {
  flex: 1;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
}

.results-section h3 {
  color: white;
  margin-bottom: 20px;
  font-size: 18px;
}

.results-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.result-item {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.function-name {
  font-size: 18px;
  font-weight: 600;
  color: #667eea;
}

.score {
  font-size: 14px;
  color: #764ba2;
  font-weight: 500;
}

.file-path {
  font-size: 13px;
  color: #666;
  margin-bottom: 15px;
  font-family: monospace;
}

.code-block {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 15px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
  max-height: 300px;
  overflow-y: auto;
}

.no-results {
  text-align: center;
  color: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  padding: 60px 20px;
}

.welcome-message {
  text-align: center;
  color: white;
  padding: 80px 20px;
}

.welcome-message p {
  font-size: 18px;
  margin-bottom: 20px;
}

.welcome-message .example {
  font-size: 14px;
  opacity: 0.8;
  font-style: italic;
}
</style>
