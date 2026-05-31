<template>
  <div class="playback-container">
    <div class="playback-header">
      <h2>会话回放</h2>
      <div class="controls">
        <button @click="togglePlay" class="btn-control">
          {{ isPlaying ? '暂停' : '播放' }}
        </button>
        <button @click="resetPlayback" class="btn-control">重置</button>
        <span>速度: </span>
        <select v-model="playbackSpeed" class="speed-select">
          <option :value="0.25">0.25x</option>
          <option :value="0.5">0.5x</option>
          <option :value="1">1x</option>
          <option :value="2">2x</option>
          <option :value="4">4x</option>
        </select>
        <span class="time-display">{{ formatTime(currentTime) }} / {{ formatTime(totalDuration) }}</span>
      </div>
      <button @click="goBack" class="btn-back">返回</button>
    </div>
    <div ref="terminalRef" class="terminal"></div>
    <div class="progress-container">
      <input
        ref="progressBar"
        type="range"
        :min="0"
        :max="totalDuration"
        :value="currentTime"
        @input="seekTo"
        @mousedown="onSeekStart"
        @mouseup="onSeekEnd"
        class="progress-slider"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import axios from 'axios'
import 'xterm/css/xterm.css'

const router = useRouter()
const route = useRoute()
const terminalRef = ref(null)
const progressBar = ref(null)

let terminal = null
let fitAddon = null
let frames = []
let isPlaying = ref(false)
let playbackSpeed = ref(1)
let currentTime = ref(0)
let totalDuration = ref(0)

let playbackRAF = null
let lastFrameTime = 0
let nextFrameIndex = 0
let buffer = ''
let isSeeking = false

function goBack() {
  router.push('/')
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function togglePlay() {
  if (isPlaying.value) {
    pausePlayback()
  } else {
    startPlayback()
  }
}

function startPlayback() {
  if (nextFrameIndex >= frames.length && frames.length > 0) {
    resetPlayback()
    return
  }
  isPlaying.value = true
  lastFrameTime = performance.now()
  scheduleNextFrame()
}

function pausePlayback() {
  isPlaying.value = false
  if (playbackRAF) {
    cancelAnimationFrame(playbackRAF)
    playbackRAF = null
  }
}

function resetPlayback() {
  pausePlayback()
  nextFrameIndex = 0
  currentTime.value = 0
  buffer = ''
  terminal.clear()
}

function renderFramesUpTo(targetTimeMs) {
  while (nextFrameIndex < frames.length && frames[nextFrameIndex].offset <= targetTimeMs) {
    const frame = frames[nextFrameIndex]
    buffer += frame.data
    nextFrameIndex++
  }
  if (buffer.length > 0) {
    terminal.write(buffer)
    buffer = ''
  }
  currentTime.value = targetTimeMs
}

function scheduleNextFrame() {
  if (!isPlaying.value || isSeeking) return

  const now = performance.now()
  const elapsed = (now - lastFrameTime) * playbackSpeed.value

  const newTime = currentTime.value + elapsed
  lastFrameTime = now

  if (newTime >= totalDuration.value) {
    renderFramesUpTo(totalDuration.value)
    isPlaying.value = false
    return
  }

  renderFramesUpTo(newTime)
  playbackRAF = requestAnimationFrame(scheduleNextFrame)
}

function findFrameIndexByTime(targetTimeMs) {
  let left = 0
  let right = frames.length - 1
  let result = 0

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    if (frames[mid].offset <= targetTimeMs) {
      result = mid + 1
      left = mid + 1
    } else {
      right = mid - 1
    }
  }
  return result
}

function rebuildTerminalTo(targetTimeMs) {
  terminal.clear()
  let content = ''
  for (let i = 0; i < frames.length && frames[i].offset <= targetTimeMs; i++) {
    content += frames[i].data
  }
  terminal.write(content)
  nextFrameIndex = findFrameIndexByTime(targetTimeMs)
  currentTime.value = targetTimeMs
}

function onSeekStart() {
  isSeeking = true
  pausePlayback()
}

function onSeekEnd() {
  isSeeking = false
}

function seekTo(event) {
  const targetTime = parseInt(event.target.value, 10)
  rebuildTerminalTo(targetTime)
}

onMounted(async () => {
  terminal = new Terminal({
    cursorBlink: false,
    theme: {
      background: '#1a1a2e',
      foreground: '#f0f0f0'
    }
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(terminalRef.value)
  fitAddon.fit()

  const sessionId = route.params.sessionId
  const res = await axios.get(`/api/sessions/${sessionId}/frames`)
  frames = res.data

  if (frames.length > 0) {
    frames.sort((a, b) => a.offset - b.offset)
    totalDuration.value = frames[frames.length - 1].offset
  }

  terminal.write('会话回放已就绪，点击"播放"开始\r\n\r\n')

  window.addEventListener('resize', () => {
    fitAddon.fit()
  })
})

onUnmounted(() => {
  pausePlayback()
  if (terminal) {
    terminal.dispose()
  }
})
</script>

<style scoped>
.playback-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.playback-header {
  background: #16213e;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.playback-header h2 {
  color: #e94560;
  margin: 0;
}

.controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #fff;
}

.time-display {
  font-family: monospace;
  font-size: 0.9rem;
  color: #ccc;
  min-width: 100px;
  text-align: center;
}

.btn-control {
  background: #4caf50;
  color: #fff;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-control:hover {
  background: #45a049;
}

.speed-select {
  background: #1a1a2e;
  color: #fff;
  border: 1px solid #0f3460;
  padding: 0.5rem;
  border-radius: 6px;
  cursor: pointer;
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

.terminal {
  flex: 1;
  padding: 1rem;
  background: #1a1a2e;
}

.progress-container {
  padding: 0.75rem 1rem;
  background: #0f3460;
}

.progress-slider {
  width: 100%;
  height: 8px;
  -webkit-appearance: none;
  appearance: none;
  background: #1a1a2e;
  border-radius: 4px;
  outline: none;
  cursor: pointer;
}

.progress-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #e94560;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.2s;
}

.progress-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.progress-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: #e94560;
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

:deep(.xterm) {
  height: 100%;
}
</style>
