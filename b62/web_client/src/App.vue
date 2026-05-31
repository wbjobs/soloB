<template>
  <div class="container">
    <header class="header">
      <h1>🎬 视频处理微服务</h1>
      <p>基于 Rust + WebAssembly 的高性能视频滤镜处理平台 | 支持断点续传</p>
    </header>

    <div class="main-content">
      <div class="card">
        <h2>🎥 视频预览</h2>
        <VideoPlayer 
          :video-src="videoSrc" 
          :is-processing="isProcessing"
        />
      </div>

      <div class="card">
        <h2>⚙️ 控制面板</h2>

        <div 
          class="upload-area"
          :class="{ dragover: isDragOver }"
          @click="triggerFileInput"
          @dragover.prevent="isDragOver = true"
          @dragleave.prevent="isDragOver = false"
          @drop.prevent="handleDrop"
        >
          <input 
            ref="fileInput" 
            type="file" 
            accept="video/*" 
            class="file-input"
            @change="handleFileSelect"
          />
          <div v-if="!selectedFile">
            <div class="upload-icon">📁</div>
            <div class="upload-text">点击或拖拽上传视频文件</div>
            <div class="upload-hint">支持 MP4, MOV, AVI, WebM 格式</div>
            <div class="upload-hint" style="margin-top: 8px; color: #00d9ff;">
              ⚡ 大文件自动分片上传（5MB/片），支持断点续传
            </div>
          </div>
        </div>

        <div v-if="selectedFile" class="selected-file">
          <div class="file-icon">🎬</div>
          <div class="file-info">
            <div class="file-name">{{ selectedFile.name }}</div>
            <div class="file-size">
              {{ formatFileSize(selectedFile.size) }}
              <span v-if="shouldUseChunkedUpload" style="color: #00d9ff; margin-left: 8px;">
                (分片: {{ totalChunks }} 片 × 5MB)
              </span>
            </div>
          </div>
          <button 
            class="remove-btn" 
            @click="removeFile"
            :disabled="isUploading || isProcessing"
          >✕</button>
        </div>

        <h2 style="margin-top: 30px;">🎨 滤镜效果</h2>
        <div v-for="filter in availableFilters" :key="filter.id" class="filter-item">
          <input 
            type="checkbox" 
            v-model="filter.enabled" 
            class="filter-checkbox"
            :disabled="isProcessing || isUploading"
          />
          <label class="filter-label">{{ filter.label }}</label>
          <input 
            type="range" 
            v-model="filter.intensity" 
            min="0" 
            max="1" 
            step="0.01"
            class="filter-slider"
            :disabled="!filter.enabled || isProcessing || isUploading"
          />
          <span class="filter-intensity">{{ (filter.intensity * 100).toFixed(0) }}%</span>
        </div>

        <button 
          class="process-btn" 
          :disabled="!canProcess || isProcessing || isUploading"
          @click="startProcessing"
        >
          <span v-if="isUploading">
            ⬆️ 上传中 {{ currentChunk }}/{{ totalChunks }} ({{ uploadProgress.toFixed(1) }}%)
          </span>
          <span v-else-if="isProcessing">⏳ 处理中...</span>
          <span v-else-if="shouldUseChunkedUpload">🚀 分片上传并处理</span>
          <span v-else>🚀 开始处理</span>
        </button>

        <div v-if="isUploading || uploadProgress > 0" class="progress-section">
          <div class="progress-header">
            <span class="progress-label">上传进度</span>
            <span class="progress-percent">{{ uploadProgress.toFixed(1) }}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
          </div>
          <div class="progress-info">
            分片: {{ uploadedChunks.length }} / {{ totalChunks }}
            <span v-if="canResume" style="color: #00d9ff; margin-left: 10px;">
              🔄 断点续传模式
            </span>
          </div>
          <div class="progress-info">
            已上传: {{ formatFileSize(uploadedBytes) }} / {{ formatFileSize(selectedFile?.size || 0) }}
          </div>
        </div>

        <div v-if="(isProcessing || progress > 0) && !isUploading" class="progress-section">
          <div class="progress-header">
            <span class="progress-label">处理进度</span>
            <span class="progress-percent">{{ progress.toFixed(1) }}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progress + '%' }"></div>
          </div>
          <div class="progress-info" v-if="currentFrame > 0">
            帧: {{ currentFrame }} / {{ totalFrames }}
          </div>
          <div class="progress-info">
            状态: 
            <span 
              class="status-badge"
              :class="{
                'status-processing': status === 'processing',
                'status-completed': status === 'completed',
                'status-failed': status === 'failed'
              }"
            >
              {{ statusText }}
            </span>
          </div>

          <button 
            v-if="status === 'completed' && processedVideoId"
            class="download-btn"
            @click="downloadVideo"
          >
            📥 下载处理后的视频
          </button>
        </div>

        <div v-if="errorMessage" class="error-message">
          ❌ {{ errorMessage }}
        </div>

        <div v-if="successMessage" class="success-message">
          ✅ {{ successMessage }}
        </div>

        <div v-if="uploadingErrors.length > 0" class="error-message" style="cursor: pointer;" @click="retryFailedChunks">
          ⚠️ {{ uploadingErrors.length }} 个分片上传失败，点击重试
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import axios from 'axios'
import VideoPlayer from './components/VideoPlayer.vue'

const CHUNK_SIZE = 5 * 1024 * 1024
const MAX_CONCURRENT_CHUNKS = 5

const fileInput = ref(null)
const isDragOver = ref(false)
const selectedFile = ref(null)
const videoSrc = ref(null)
const isUploading = ref(false)
const isProcessing = ref(false)
const progress = ref(0)
const uploadProgress = ref(0)
const currentFrame = ref(0)
const totalFrames = ref(0)
const status = ref('idle')
const processedVideoId = ref(null)
const errorMessage = ref('')
const successMessage = ref('')

const uploadID = ref('')
const currentChunk = ref(0)
const totalChunks = ref(0)
const uploadedChunks = ref([])
const failedChunks = ref([])
const uploadingErrors = ref([])
const uploadedBytes = ref(0)
const fileHash = ref('')
const canResume = ref(false)

let progressInterval = null
let uploadAbortController = null

const availableFilters = ref([
  { id: 'grayscale', label: '黑白滤镜', intensity: 0.5, enabled: false },
  { id: 'vintage', label: '老电影效果', intensity: 0.8, enabled: false },
  { id: 'contrast', label: '对比度调节', intensity: 0.3, enabled: false }
])

const shouldUseChunkedUpload = computed(() => {
  return selectedFile.value && selectedFile.value.size > CHUNK_SIZE
})

const canProcess = computed(() => {
  return selectedFile.value && 
         availableFilters.value.some(f => f.enabled) &&
         !isProcessing.value &&
         !isUploading.value
})

const statusText = computed(() => {
  switch (status.value) {
    case 'processing': return '处理中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return '等待中'
  }
})

const triggerFileInput = () => {
  if (!isProcessing.value && !isUploading.value) {
    fileInput.value?.click()
  }
}

const handleFileSelect = (event) => {
  const file = event.target.files?.[0]
  if (file) {
    processFile(file)
  }
}

const handleDrop = (event) => {
  isDragOver.value = false
  const file = event.dataTransfer.files?.[0]
  if (file && file.type.startsWith('video/')) {
    processFile(file)
  }
}

const processFile = async (file) => {
  selectedFile.value = file
  
  if (videoSrc.value) {
    URL.revokeObjectURL(videoSrc.value)
  }
  videoSrc.value = URL.createObjectURL(file)
  
  resetProgress()
  
  if (file.size > CHUNK_SIZE) {
    totalChunks.value = Math.ceil(file.size / CHUNK_SIZE)
    uploadedChunks.value = []
    failedChunks.value = []
    
    fileHash.value = await calculateFileHash(file)
    await checkResumeAbility()
  }
}

const calculateFileHash = async (file) => {
  const sampleSize = Math.min(file.size, 1024 * 1024)
  const sample = file.slice(0, sampleSize)
  const buffer = await sample.arrayBuffer()
  
  let hash = 0
  const view = new Uint8Array(buffer)
  for (let i = 0; i < view.length; i++) {
    hash = ((hash << 5) - hash) + view[i]
    hash = hash & hash
  }
  
  return `${file.name}_${file.size}_${hash}`
}

const checkResumeAbility = async () => {
  if (!fileHash.value || !selectedFile.value) return
  
  const enabledFilters = availableFilters.value
    .filter(f => f.enabled)
    .map(f => ({
      filter_type: f.id,
      intensity: parseFloat(f.intensity)
    }))
  
  try {
    const response = await axios.post('/api/upload/init', {
      file_name: selectedFile.value.name,
      file_size: selectedFile.value.size,
      total_chunks: totalChunks.value,
      file_hash: fileHash.value,
      filters: enabledFilters
    })
    
    uploadID.value = response.data.upload_id
    
    if (response.data.uploaded_chunks && response.data.uploaded_chunks.length > 0) {
      uploadedChunks.value = response.data.uploaded_chunks
      canResume.value = true
      uploadProgress.value = (uploadedChunks.value.length / totalChunks.value) * 100
      uploadedBytes.value = uploadedChunks.value.length * CHUNK_SIZE
    }
  } catch (error) {
    console.error('Failed to check resume ability:', error)
  }
}

const removeFile = () => {
  if (videoSrc.value) {
    URL.revokeObjectURL(videoSrc.value)
  }
  selectedFile.value = null
  videoSrc.value = null
  resetProgress()
}

const resetProgress = () => {
  progress.value = 0
  uploadProgress.value = 0
  currentFrame.value = 0
  totalFrames.value = 0
  status.value = 'idle'
  processedVideoId.value = null
  errorMessage.value = ''
  successMessage.value = ''
  uploadID.value = ''
  currentChunk.value = 0
  totalChunks.value = 0
  uploadedChunks.value = []
  failedChunks.value = []
  uploadingErrors.value = []
  uploadedBytes.value = 0
  fileHash.value = ''
  canResume.value = false
}

const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

const startProcessing = async () => {
  if (!canProcess.value) return
  
  errorMessage.value = ''
  successMessage.value = ''
  
  if (shouldUseChunkedUpload.value) {
    await startChunkedUpload()
  } else {
    await startRegularUpload()
  }
}

const startChunkedUpload = async () => {
  isUploading.value = true
  uploadingErrors.value = []
  
  if (!uploadID.value) {
    const enabledFilters = availableFilters.value
      .filter(f => f.enabled)
      .map(f => ({
        filter_type: f.id,
        intensity: parseFloat(f.intensity)
      }))
    
    try {
      const initResponse = await axios.post('/api/upload/init', {
        file_name: selectedFile.value.name,
        file_size: selectedFile.value.size,
        total_chunks: totalChunks.value,
        file_hash: fileHash.value,
        filters: enabledFilters
      })
      
      uploadID.value = initResponse.data.upload_id
      
      if (initResponse.data.uploaded_chunks) {
        uploadedChunks.value = initResponse.data.uploaded_chunks
        canResume.value = true
      }
    } catch (error) {
      errorMessage.value = '初始化上传失败'
      isUploading.value = false
      return
    }
  }
  
  uploadAbortController = new AbortController()
  
  const chunksToUpload = []
  for (let i = 0; i < totalChunks.value; i++) {
    if (!uploadedChunks.value.includes(i)) {
      chunksToUpload.push(i)
    }
  }
  
  let activeUploads = 0
  let chunkIndex = 0
  
  const uploadNextChunk = async () => {
    while (chunkIndex < chunksToUpload.length && activeUploads < MAX_CONCURRENT_CHUNKS) {
      activeUploads++
      const idx = chunksToUpload[chunkIndex++]
      
      uploadSingleChunk(idx)
        .then(() => {
          activeUploads--
          uploadNextChunk()
        })
        .catch((error) => {
          console.error(`Chunk ${idx} upload failed:`, error)
          failedChunks.value.push(idx)
          uploadingErrors.value.push(idx)
          activeUploads--
          uploadNextChunk()
        })
    }
  }
  
  await uploadNextChunk()
  
  while (activeUploads > 0) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  isUploading.value = false
  
  if (uploadingErrors.value.length > 0) {
    errorMessage.value = `${uploadingErrors.value.length} 个分片上传失败，请重试`
    return
  }
  
  await completeUpload()
}

const uploadSingleChunk = async (index) => {
  const start = index * CHUNK_SIZE
  const end = Math.min(start + CHUNK_SIZE, selectedFile.value.size)
  const chunk = selectedFile.value.slice(start, end)
  
  const formData = new FormData()
  formData.append('upload_id', uploadID.value)
  formData.append('chunk_index', index)
  formData.append('total_chunks', totalChunks.value)
  formData.append('chunk_size', chunk.size)
  formData.append('file_name', selectedFile.value.name)
  formData.append('file_hash', fileHash.value)
  formData.append('chunk', chunk)
  
  const response = await axios.post('/api/upload/chunk', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal: uploadAbortController?.signal
  })
  
  if (response.data.success) {
    if (!uploadedChunks.value.includes(index)) {
      uploadedChunks.value.push(index)
      uploadedBytes.value += chunk.size
    }
    uploadProgress.value = (uploadedChunks.value.length / totalChunks.value) * 100
    currentChunk.value = uploadedChunks.value.length
  }
  
  return response.data
}

const completeUpload = async () => {
  try {
    const response = await axios.post('/api/upload/complete', {
      upload_id: uploadID.value
    })
    
    if (response.data.success) {
      processedVideoId.value = response.data.video_id
      isProcessing.value = true
      status.value = 'processing'
      successMessage.value = '上传完成，开始处理...'
      
      startProcessingPolling()
    } else {
      errorMessage.value = response.data.message || '合并上传失败'
    }
  } catch (error) {
    console.error('Complete upload error:', error)
    errorMessage.value = '合并上传失败'
  }
}

const retryFailedChunks = async () => {
  if (uploadingErrors.value.length === 0) return
  
  const chunksToRetry = [...uploadingErrors.value]
  uploadingErrors.value = []
  
  let activeUploads = 0
  let idx = 0
  
  const retryNext = async () => {
    while (idx < chunksToRetry.length && activeUploads < MAX_CONCURRENT_CHUNKS) {
      activeUploads++
      const chunkIdx = chunksToRetry[idx++]
      
      uploadSingleChunk(chunkIdx)
        .then(() => {
          activeUploads--
          retryNext()
        })
        .catch(() => {
          uploadingErrors.value.push(chunkIdx)
          activeUploads--
          retryNext()
        })
    }
  }
  
  await retryNext()
  
  while (activeUploads > 0) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  if (uploadingErrors.value.length === 0) {
    await completeUpload()
  }
}

const startRegularUpload = async () => {
  isProcessing.value = true
  status.value = 'processing'
  errorMessage.value = ''
  successMessage.value = ''
  processedVideoId.value = null

  const formData = new FormData()
  formData.append('video', selectedFile.value)

  const enabledFilters = availableFilters.value
    .filter(f => f.enabled)
    .map(f => ({
      filter_type: f.id,
      intensity: parseFloat(f.intensity)
    }))

  formData.append('filters', JSON.stringify(enabledFilters))

  try {
    const response = await axios.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })

    const videoId = response.data.video_id
    processedVideoId.value = videoId

    startProcessingPolling()
  } catch (error) {
    console.error('Upload error:', error)
    errorMessage.value = error.response?.data?.error || '上传失败，请重试'
    status.value = 'failed'
    isProcessing.value = false
  }
}

const startProcessingPolling = () => {
  if (progressInterval) {
    clearInterval(progressInterval)
  }

  const videoId = processedVideoId.value
  const useUploadStatus = shouldUseChunkedUpload.value

  progressInterval = setInterval(async () => {
    try {
      let response
      if (useUploadStatus && uploadID.value) {
        response = await axios.get(`/api/upload/status/${uploadID.value}`)
        const data = response.data
        
        if (data.upload_progress < 100) {
          uploadProgress.value = data.upload_progress
        }
        
        progress.value = data.processing_progress || 0
        currentFrame.value = Math.floor((data.processing_progress || 0) / 100 * 100)
        totalFrames.value = 100

        if (data.completed || data.status === 'completed') {
          clearInterval(progressInterval)
          progressInterval = null
          
          if (data.status === 'completed') {
            status.value = 'completed'
            successMessage.value = '视频处理完成！'
            isProcessing.value = false
            isUploading.value = false
          } else if (data.status === 'failed') {
            status.value = 'failed'
            errorMessage.value = '处理失败'
            isProcessing.value = false
            isUploading.value = false
          }
        }
      } else {
        response = await axios.get(`/api/progress/${videoId}`)
        const data = response.data

        progress.value = data.progress || 0
        currentFrame.value = data.current_frame || 0
        totalFrames.value = data.total_frames || 0

        if (data.completed) {
          clearInterval(progressInterval)
          progressInterval = null
          
          if (data.status === 'completed') {
            status.value = 'completed'
            successMessage.value = '视频处理完成！'
          } else {
            status.value = 'failed'
            errorMessage.value = '处理失败'
          }
          
          isProcessing.value = false
        }
      }
    } catch (error) {
      console.error('Progress polling error:', error)
    }
  }, 500)
}

const downloadVideo = () => {
  if (!processedVideoId.value) return
  
  const link = document.createElement('a')
  link.href = `/api/download/${processedVideoId.value}`
  link.download = `${selectedFile.value?.name || 'processed'}_filtered.mp4`
  link.click()
}

onUnmounted(() => {
  if (progressInterval) {
    clearInterval(progressInterval)
  }
  if (uploadAbortController) {
    uploadAbortController.abort()
  }
  if (videoSrc.value) {
    URL.revokeObjectURL(videoSrc.value)
  }
})
</script>
