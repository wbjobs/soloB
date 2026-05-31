<template>
  <div class="ssh-container">
    <div class="ssh-header">
      <h2>SSH 终端</h2>
      <div class="header-controls">
        <label class="autocomplete-toggle">
          <input type="checkbox" v-model="autocompleteEnabled" />
          <span>💡 命令补全</span>
        </label>
        <button @click="goBack" class="btn-back">返回</button>
      </div>
    </div>
    <div class="terminal-wrapper">
      <div ref="terminalRef" class="terminal"></div>
      <CommandSuggestions
        ref="suggestionsRef"
        :suggestions="suggestions"
        :current-input="currentLine"
        :show-suggestions="showSuggestions"
        @apply="applySuggestion"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { useAuthStore } from '../stores/auth'
import CommandSuggestions from '../components/CommandSuggestions.vue'
import 'xterm/css/xterm.css'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const terminalRef = ref(null)
const suggestionsRef = ref(null)

let terminal = null
let ws = null
let autocompleteWs = null
let fitAddon = null

const currentLine = ref('')
const suggestions = ref([])
const showSuggestions = ref(false)
const autocompleteEnabled = ref(true)
let lastRequestTime = 0
const DEBOUNCE_MS = 150

function goBack() {
  router.push('/')
}

function connectAutocomplete() {
  const userId = authStore.user?.id
  const tenantId = authStore.user?.tenant_id
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${window.location.host}/ws/autocomplete?user_id=${userId}&tenant_id=${tenantId}`
  
  autocompleteWs = new WebSocket(wsUrl)
  
  autocompleteWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      suggestions.value = data.suggestions || []
      showSuggestions.value = suggestions.value.length > 0
    } catch (e) {
      console.error('Parse suggestion error:', e)
    }
  }
}

function requestSuggestions() {
  if (!autocompleteEnabled.value || !autocompleteWs || autocompleteWs.readyState !== WebSocket.OPEN) {
    return
  }
  
  const now = Date.now()
  if (now - lastRequestTime < DEBOUNCE_MS) {
    return
  }
  lastRequestTime = now
  
  try {
    autocompleteWs.send(JSON.stringify({
      input: currentLine.value,
      cursor_pos: currentLine.value.length
    }))
  } catch (e) {
    console.error('Send suggestion request error:', e)
  }
}

function applySuggestion(command) {
  if (!command || !ws || ws.readyState !== WebSocket.OPEN) return
  
  const input = currentLine.value
  const prefix = getInputPrefix()
  const toSend = command.slice(prefix.length) + '\r'
  
  for (const char of toSend) {
    ws.send(char)
  }
  
  showSuggestions.value = false
  currentLine.value = ''
}

function getInputPrefix() {
  const cmd = currentLine.value
  const parts = cmd.split(' ')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join(' ') + ' '
}

function handleKey(data) {
  if (data === '\u001b[A') {
    if (showSuggestions.value && suggestionsRef.value) {
      suggestionsRef.value.navigateUp()
      return false
    }
  }
  
  if (data === '\u001b[B') {
    if (showSuggestions.value && suggestionsRef.value) {
      suggestionsRef.value.navigateDown()
      return false
    }
  }
  
  if (data === '\t') {
    if (showSuggestions.value && suggestionsRef.value) {
      suggestionsRef.value.applySelected()
      return false
    }
  }
  
  if (data === '\r') {
    showSuggestions.value = false
    currentLine.value = ''
    return true
  }
  
  if (data === '\u007f' || data === '\b') {
    currentLine.value = currentLine.value.slice(0, -1)
    nextTick(() => requestSuggestions())
    return true
  }
  
  if (data === '\u0003') {
    showSuggestions.value = false
    currentLine.value = ''
    return true
  }
  
  if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
    currentLine.value += data
    nextTick(() => requestSuggestions())
    return true
  }
  
  if (data.startsWith('\u001b')) {
    showSuggestions.value = false
  }
  
  return true
}

onMounted(() => {
  terminal = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#1a1a2e',
      foreground: '#f0f0f0'
    },
    scrollback: 10000
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalRef.value)
  fitAddon.fit()

  const serverId = route.params.serverId
  const userId = authStore.user?.id
  const tenantId = authStore.user?.tenant_id

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${window.location.host}/ws/ssh?server_id=${serverId}&user_id=${userId}&tenant_id=${tenantId}`

  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    terminal.write('已连接到 SSH 服务器\r\n\r\n')
    connectAutocomplete()
  }

  ws.onmessage = (event) => {
    terminal.write(event.data)
  }

  ws.onerror = (error) => {
    terminal.write('\r\n连接错误\r\n')
  }

  ws.onclose = () => {
    terminal.write('\r\n连接已关闭\r\n')
    if (autocompleteWs) {
      autocompleteWs.close()
    }
  }

  terminal.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      const shouldSend = handleKey(data)
      if (shouldSend) {
        ws.send(data)
      }
    }
  })

  window.addEventListener('resize', () => {
    fitAddon.fit()
  })
})

onUnmounted(() => {
  if (ws) {
    ws.close()
  }
  if (autocompleteWs) {
    autocompleteWs.close()
  }
  if (terminal) {
    terminal.dispose()
  }
})

watch(autocompleteEnabled, (val) => {
  if (!val) {
    showSuggestions.value = false
  }
})
</script>

<style scoped>
.ssh-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.ssh-header {
  background: #16213e;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ssh-header h2 {
  color: #e94560;
  margin: 0;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.autocomplete-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #a0aec0;
  font-size: 0.875rem;
  cursor: pointer;
  user-select: none;
}

.autocomplete-toggle input {
  width: 16px;
  height: 16px;
  accent-color: #4299e1;
}

.autocomplete-toggle:hover {
  color: #e2e8f0;
}

.btn-back {
  background: #e94560;
  color: #fff;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-back:hover {
  background: #d63850;
}

.terminal-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
}

.terminal {
  flex: 1;
  padding: 1rem;
  background: #1a1a2e;
}

:deep(.xterm) {
  height: 100%;
}
</style>
