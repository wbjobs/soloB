<template>
  <div class="video-player-container">
    <div class="player-header">
      <h3>{{ title || '视频播放器' }}</h3>
      <div class="format-badge" v-if="format">
        {{ format.toUpperCase() }}
      </div>
    </div>

    <div class="video-wrapper" :class="{ 'no-video': !videoUrl }">
      <video
        v-if="videoUrl"
        ref="videoRef"
        class="video-element"
        :controls="controls"
        :autoplay="autoplay"
        :loop="loop"
        :muted="muted"
        :poster="poster"
        @loadedmetadata="onLoadedMetadata"
        @play="onPlay"
        @pause="onPause"
        @timeupdate="onTimeUpdate"
        @ended="onEnded"
        @error="onError"
      >
        <source :src="videoUrl" :type="sourceType" />
        您的浏览器不支持视频播放
      </video>

      <div v-else class="placeholder">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <p>暂无视频</p>
      </div>
    </div>

    <div v-if="showInfo && videoUrl" class="video-info">
      <div class="info-item" v-if="duration">
        <span class="label">时长:</span>
        <span class="value">{{ formatTime(duration) }}</span>
      </div>
      <div class="info-item" v-if="currentTime !== undefined">
        <span class="label">当前:</span>
        <span class="value">{{ formatTime(currentTime) }}</span>
      </div>
      <div class="info-item" v-if="videoSize">
        <span class="label">大小:</span>
        <span class="value">{{ formatFileSize(videoSize) }}</span>
      </div>
    </div>

    <div class="actions" v-if="videoUrl && showDownload">
      <button class="btn btn-primary" @click="downloadVideo">
        下载视频
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  videoUrl: {
    type: String,
    default: ''
  },
  sourceType: {
    type: String,
    default: 'video/webm'
  },
  title: {
    type: String,
    default: ''
  },
  format: {
    type: String,
    default: ''
  },
  controls: {
    type: Boolean,
    default: true
  },
  autoplay: {
    type: Boolean,
    default: false
  },
  loop: {
    type: Boolean,
    default: false
  },
  muted: {
    type: Boolean,
    default: false
  },
  poster: {
    type: String,
    default: ''
  },
  showInfo: {
    type: Boolean,
    default: true
  },
  showDownload: {
    type: Boolean,
    default: true
  },
  videoSize: {
    type: Number,
    default: null
  },
  downloadFilename: {
    type: String,
    default: 'video.webm'
  }
})

const emit = defineEmits([
  'loadedmetadata',
  'play',
  'pause',
  'timeupdate',
  'ended',
  'error'
])

const videoRef = ref(null)
const duration = ref(0)
const currentTime = ref(0)

const onLoadedMetadata = (event) => {
  duration.value = videoRef.value?.duration || 0
  emit('loadedmetadata', event)
}

const onPlay = (event) => {
  emit('play', event)
}

const onPause = (event) => {
  emit('pause', event)
}

const onTimeUpdate = (event) => {
  currentTime.value = videoRef.value?.currentTime || 0
  emit('timeupdate', event)
}

const onEnded = (event) => {
  emit('ended', event)
}

const onError = (event) => {
  console.error('Video error:', event)
  emit('error', event)
}

const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`
}

const downloadVideo = () => {
  if (!props.videoUrl) return
  const link = document.createElement('a')
  link.href = props.videoUrl
  link.download = props.downloadFilename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

watch(() => props.videoUrl, (newUrl) => {
  duration.value = 0
  currentTime.value = 0
  if (videoRef.value) {
    videoRef.value.load()
  }
})

onUnmounted(() => {
  if (props.videoUrl && props.videoUrl.startsWith('blob:')) {
    URL.revokeObjectURL(props.videoUrl)
  }
})
</script>

<style scoped>
.video-player-container {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.player-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.player-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.format-badge {
  background: rgba(255, 255, 255, 0.2);
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
}

.video-wrapper {
  background: #1a1a2e;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: black;
}

.placeholder {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
}

.placeholder svg {
  margin-bottom: 16px;
  opacity: 0.6;
}

.placeholder p {
  margin: 0;
  font-size: 16px;
}

.video-info {
  display: flex;
  gap: 24px;
  padding: 16px 20px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
}

.info-item {
  display: flex;
  gap: 8px;
  align-items: center;
}

.info-item .label {
  color: #6c757d;
  font-size: 14px;
  font-weight: 500;
}

.info-item .value {
  color: #212529;
  font-size: 14px;
  font-weight: 600;
}

.actions {
  padding: 16px 20px;
  display: flex;
  justify-content: flex-end;
}

.btn {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-primary:active {
  transform: translateY(0);
}
</style>
