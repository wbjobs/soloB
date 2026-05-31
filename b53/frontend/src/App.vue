<template>
  <div class="app-container">
    <header class="app-header">
      <h1>视频转码器</h1>
      <p class="subtitle">MP4 → WebM 浏览器端转码</p>
    </header>

    <main class="app-main">
      <div v-if="ffmpegLoadError" class="error-message ffmpeg-error">
        <div class="error-title">⚠️ FFmpeg WASM 加载失败</div>
        <div class="error-details">{{ ffmpegLoadError }}</div>
        <div class="error-help">
          可能的原因：
          <ul>
            <li>浏览器不支持 WebAssembly 或 SharedArrayBuffer</li>
            <li>缺少跨域隔离头 (COOP/COEP)</li>
            <li>网络问题导致 FFmpeg 文件下载失败</li>
          </ul>
          <button class="btn btn-secondary" @click="retryLoadFFmpeg">
            重试加载
          </button>
        </div>
      </div>

      <div class="upload-section" :class="{ 'drag-over': isDragOver }">
        <div class="upload-box" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
          <input
            ref="fileInput"
            type="file"
            accept="video/mp4,.mp4"
            class="file-input"
            @change="onFileSelect"
          />
          <div class="upload-content" @click="triggerFileInput">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="upload-icon"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <p class="upload-text">
              {{ selectedFile ? selectedFile.name : '点击选择或拖拽 MP4 文件' }}
            </p>
            <p class="upload-hint" v-if="!selectedFile">支持 MP4 格式</p>
            <p class="upload-hint" v-else-if="selectedFile">
              {{ formatFileSize(selectedFile.size) }}
            </p>
          </div>
        </div>

        <ProgressBar
          v-if="isUploading"
          :percent="uploadProgress"
          label="文件上传"
          color="primary"
          :striped="true"
          :animated="true"
        />

        <ProgressBar
          v-if="isTranscoding"
          :percent="transcodeProgress"
          label="视频转码"
          color="success"
          :striped="true"
          :animated="true"
          :showDetailed="true"
          :startTime="transcodeStartTime"
          :status="'processing'"
          :statusText="'处理中...'"
        />

        <div class="button-group">
          <button
            class="btn btn-primary"
            :disabled="!selectedFile || isUploading || isTranscoding"
            @click="startUpload"
          >
            <span v-if="isUploading">
              上传中 {{ uploadProgress }}%
            </span>
            <span v-else-if="uploaded">已上传 ✓</span>
            <span v-else>上传到 S3</span>
          </button>

          <button
            class="btn btn-success"
            :disabled="(!selectedFile && !uploaded) || isTranscoding || ffmpegLoadError"
            @click="startTranscode"
          >
            <span v-if="isTranscoding">
              转码中 {{ transcodeProgress }}%
            </span>
            <span v-else-if="ffmpegLoadError">转码不可用</span>
            <span v-else-if="transcoded">已转码 ✓</span>
            <span v-else>转码为 WebM</span>
          </button>
        </div>
      </div>

      <div v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>

      <div class="status-section" v-if="statusMessage && !isUploading && !isTranscoding">
        <div class="status-message">
          <span>{{ statusMessage }}</span>
        </div>
      </div>

      <div class="job-info-card" v-if="currentJob">
        <div class="job-info-header">
          <h4>转码任务信息</h4>
          <span :class="'job-status status-' + currentJob.status">
            {{ getStatusText(currentJob.status) }}
          </span>
        </div>
        <div class="job-info-content">
          <div class="job-info-item">
            <span class="job-info-label">任务 ID</span>
            <span class="job-info-value">{{ currentJob.job_id }}</span>
          </div>
          <div class="job-info-item">
            <span class="job-info-label">文件名</span>
            <span class="job-info-value">{{ currentJob.filename }}</span>
          </div>
          <div class="job-info-item">
            <span class="job-info-label">原始大小</span>
            <span class="job-info-value">{{ formatFileSize(currentJob.original_size) }}</span>
          </div>
          <div class="job-info-item" v-if="currentJob.output_size > 0">
            <span class="job-info-label">输出大小</span>
            <span class="job-info-value">{{ formatFileSize(currentJob.output_size) }}</span>
          </div>
          <div class="job-info-item">
            <span class="job-info-label">进度</span>
            <span class="job-info-value">{{ currentJob.progress }}%</span>
          </div>
          <div class="job-info-item">
            <span class="job-info-label">创建时间</span>
            <span class="job-info-value">{{ currentJob.created_at }}</span>
          </div>
        </div>
      </div>

      <div class="player-section" v-if="transcodedVideoUrl">
        <VideoPlayer
          :videoUrl="transcodedVideoUrl"
          :title="'转码结果 - ' + (selectedFile?.name || 'video')"
          :format="'webm'"
          :videoSize="transcodedVideoSize"
          :downloadFilename="downloadFilename"
        />
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import VideoPlayer from '../components/VideoPlayer.vue'
import ProgressBar from '../components/ProgressBar.vue'
import VideoTranscoder from '../wasm/transcoder.js'

const fileInput = ref(null)
const selectedFile = ref(null)
const isDragOver = ref(false)
const isUploading = ref(false)
const isTranscoding = ref(false)
const isLoadingFFmpeg = ref(false)
const uploadProgress = ref(0)
const transcodeProgress = ref(0)
const transcodeStartTime = ref(null)
const uploaded = ref(false)
const transcoded = ref(false)
const transcodedVideoUrl = ref('')
const transcodedVideoSize = ref(null)
const errorMessage = ref('')
const statusMessage = ref('')
const ffmpegLoadError = ref('')
const currentJob = ref(null)

const uploadInfo = ref(null)
const uploadedParts = ref([])

let transcoder = null
let jobPollingTimer = null

const downloadFilename = computed(() => {
  if (selectedFile.value) {
    const name = selectedFile.value.name.replace(/\.mp4$/i, '')
    return `${name}.webm`
  }
  return 'transcoded-video.webm'
})

const triggerFileInput = () => {
  fileInput.value?.click()
}

const onFileSelect = (event) => {
  const file = event.target.files?.[0]
  if (file) {
    handleFile(file)
  }
}

const onDragOver = () => {
  isDragOver.value = true
}

const onDragLeave = () => {
  isDragOver.value = false
}

const onDrop = (event) => {
  isDragOver.value = false
  const file = event.dataTransfer.files?.[0]
  if (file) {
    handleFile(file)
  }
}

const handleFile = (file) => {
  if (!file.type.includes('video/mp4') && !file.name.toLowerCase().endsWith('.mp4')) {
    errorMessage.value = '请选择 MP4 格式的视频文件'
    return
  }

  errorMessage.value = ''
  selectedFile.value = file
  uploaded.value = false
  transcoded.value = false
  transcodedVideoUrl.value = ''
  transcodedVideoSize.value = null
  currentJob.value = null
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

const getStatusText = (status) => {
  const statusMap = {
    'pending': '等待中',
    'processing': '处理中',
    'completed': '已完成',
    'failed': '失败'
  }
  return statusMap[status] || status
}

const initiateUpload = async () => {
  const response = await fetch('/api/upload/initiate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filename: selectedFile.value.name,
      file_size: selectedFile.value.size,
      mime_type: selectedFile.value.type
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to initiate upload')
  }

  return response.json()
}

const uploadChunk = async (uploadId, key, partNumber, chunkData) => {
  const formData = new FormData()
  formData.append('upload_id', uploadId)
  formData.append('key', key)
  formData.append('part_number', partNumber.toString())
  formData.append('chunk', new Blob([chunkData]))

  const response = await fetch('/api/upload/chunk', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || `Failed to upload part ${partNumber}`)
  }

  return response.json()
}

const completeUpload = async (uploadId, key, parts) => {
  const response = await fetch('/api/upload/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      upload_id: uploadId,
      key: key,
      parts: parts
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to complete upload')
  }

  return response.json()
}

const createTranscodeJob = async (filename, originalSize, sourceKey = null) => {
  const response = await fetch('/api/transcode/job/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filename,
      original_size: originalSize,
      source_key: sourceKey
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create transcode job')
  }

  return response.json()
}

const fetchJobStatus = async (jobId) => {
  const response = await fetch(`/api/transcode/job/${jobId}`)
  if (response.ok) {
    return response.json()
  }
  return null
}

const startJobPolling = (jobId) => {
  if (jobPollingTimer) {
    clearInterval(jobPollingTimer)
  }

  jobPollingTimer = setInterval(async () => {
    try {
      const job = await fetchJobStatus(jobId)
      if (job) {
        currentJob.value = job

        if (job.status === 'completed' || job.status === 'failed') {
          clearInterval(jobPollingTimer)
          jobPollingTimer = null
        }
      }
    } catch (e) {
      console.warn('Failed to fetch job status:', e)
    }
  }, 2000)
}

const stopJobPolling = () => {
  if (jobPollingTimer) {
    clearInterval(jobPollingTimer)
    jobPollingTimer = null
  }
}

const startUpload = async () => {
  if (!selectedFile.value) return

  isUploading.value = true
  uploadProgress.value = 0
  errorMessage.value = ''
  statusMessage.value = '正在初始化上传...'
  uploadedParts.value = []

  try {
    uploadInfo.value = await initiateUpload()
    const { upload_id, key, chunk_size, total_parts } = uploadInfo.value

    statusMessage.value = `上传中... (0/${total_parts} 分片)`

    const file = selectedFile.value
    let uploadedCount = 0

    for (let partNumber = 1; partNumber <= total_parts; partNumber++) {
      const start = (partNumber - 1) * chunk_size
      const end = Math.min(start + chunk_size, file.size)
      const chunk = file.slice(start, end)
      const chunkData = await chunk.arrayBuffer()

      const result = await uploadChunk(upload_id, key, partNumber, chunkData)

      uploadedParts.value.push({
        PartNumber: partNumber,
        ETag: result.etag
      })

      uploadedCount++
      uploadProgress.value = Math.round((uploadedCount / total_parts) * 100)
      statusMessage.value = `上传中... (${uploadedCount}/${total_parts} 分片)`
    }

    statusMessage.value = '正在完成上传...'
    await completeUpload(upload_id, key, uploadedParts.value)

    uploaded.value = true
    statusMessage.value = `上传完成！共 ${uploadedCount} 个分片`
  } catch (error) {
    console.error('Upload error:', error)
    errorMessage.value = `上传失败: ${error.message}`
    statusMessage.value = ''
  } finally {
    isUploading.value = false
  }
}

const loadFFmpeg = async () => {
  if (!transcoder) {
    transcoder = new VideoTranscoder()
  }

  if (!transcoder.isLoaded) {
    isLoadingFFmpeg.value = true
    statusMessage.value = '正在加载 FFmpeg (WASM)...'
    ffmpegLoadError.value = ''

    try {
      await transcoder.load()
      statusMessage.value = 'FFmpeg 加载完成'
    } catch (error) {
      console.error('FFmpeg load error:', error)
      ffmpegLoadError.value = error.message
      throw new Error(`FFmpeg 加载失败: ${error.message}`)
    } finally {
      isLoadingFFmpeg.value = false
    }
  }
}

const retryLoadFFmpeg = async () => {
  ffmpegLoadError.value = ''
  if (transcoder) {
    await transcoder.terminate()
    transcoder = null
  }
  await loadFFmpeg()
}

const startTranscode = async () => {
  if (!selectedFile.value && !uploaded) return
  if (ffmpegLoadError.value) {
    errorMessage.value = 'FFmpeg 未正确加载，请先重试加载'
    return
  }

  isTranscoding.value = true
  transcodeProgress.value = 0
  errorMessage.value = ''
  statusMessage.value = ''
  transcodeStartTime.value = Date.now()

  try {
    await loadFFmpeg()

    const job = await createTranscodeJob(
      selectedFile.value.name,
      selectedFile.value.size,
      uploadInfo.value?.key
    )
    currentJob.value = job

    startJobPolling(job.job_id)

    statusMessage.value = '开始转码...'

    const result = await transcoder.transcodeToWebM(selectedFile.value, {
      crf: 30,
      jobId: job.job_id,
      reportToBackend: true,
      onProgress: (progress, info) => {
        transcodeProgress.value = info?.percent || Math.round(progress * 100)
        if (transcodeProgress.value > 0) {
          statusMessage.value = `转码中... ${transcodeProgress.value}%`
        }
      }
    })

    transcodedVideoUrl.value = result.url
    transcodedVideoSize.value = result.size
    transcoded.value = true
    statusMessage.value = `转码完成！输出大小: ${formatFileSize(result.size)}`

    const updatedJob = await fetchJobStatus(job.job_id)
    if (updatedJob) {
      currentJob.value = updatedJob
    }
  } catch (error) {
    console.error('Transcode error:', error)
    errorMessage.value = `转码失败: ${error.message}`
    statusMessage.value = ''
  } finally {
    isTranscoding.value = false
    transcodeStartTime.value = null
    stopJobPolling()
  }
}

onMounted(() => {
  loadFFmpeg().catch((e) => {
    console.error('Initial FFmpeg load failed:', e)
  })
})

onUnmounted(() => {
  stopJobPolling()

  if (transcoder) {
    transcoder.terminate()
  }
  if (transcodedVideoUrl.value) {
    URL.revokeObjectURL(transcodedVideoUrl.value)
  }
})
</script>

<style scoped>
.app-container {
  min-height: 100vh;
}

.app-header {
  text-align: center;
  padding: 40px 20px;
  color: white;
}

.app-header h1 {
  font-size: 36px;
  font-weight: 700;
  margin-bottom: 8px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
}

.subtitle {
  font-size: 16px;
  opacity: 0.9;
  font-weight: 400;
}

.app-main {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 20px;
}

.upload-section {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 20px;
  padding: 32px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  margin-bottom: 24px;
}

.upload-box {
  position: relative;
}

.file-input {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.upload-content {
  border: 2px dashed #667eea;
  border-radius: 16px;
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: linear-gradient(135deg, #f5f7fa 0%, #e4e8f0 100%);
}

.upload-content:hover {
  border-color: #764ba2;
  background: linear-gradient(135deg, #e8ecf5 0%, #d4d9e8 100%);
}

.drag-over .upload-content {
  border-color: #764ba2;
  border-style: solid;
  background: linear-gradient(135deg, #e0e5f5 0%, #c9d0e8 100%);
}

.upload-icon {
  color: #667eea;
  margin-bottom: 16px;
}

.upload-text {
  font-size: 18px;
  font-weight: 600;
  color: #2d3748;
  margin: 0 0 8px 0;
}

.upload-hint {
  font-size: 14px;
  color: #718096;
  margin: 0;
}

.button-group {
  display: flex;
  gap: 16px;
  margin-top: 24px;
  justify-content: center;
}

.btn {
  padding: 14px 32px;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
  margin-top: 12px;
  align-self: flex-start;
}

.btn-secondary:hover:not(:disabled) {
  background: #e5e7eb;
}

.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
}

.btn-success {
  background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
  color: white;
}

.btn-success:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(17, 153, 142, 0.4);
}

.error-message {
  background: rgba(254, 215, 215, 0.95);
  border: 1px solid #fca5a5;
  color: #dc2626;
  padding: 16px 20px;
  border-radius: 12px;
  margin-bottom: 24px;
  font-weight: 500;
}

.ffmpeg-error {
  display: flex;
  flex-direction: column;
}

.ffmpeg-error .error-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}

.ffmpeg-error .error-details {
  font-size: 14px;
  margin-bottom: 12px;
  font-family: monospace;
  background: rgba(0, 0, 0, 0.05);
  padding: 8px;
  border-radius: 4px;
}

.ffmpeg-error .error-help {
  font-size: 13px;
  opacity: 0.9;
}

.ffmpeg-error .error-help ul {
  margin: 8px 0;
  padding-left: 20px;
}

.ffmpeg-error .error-help li {
  margin: 4px 0;
}

.status-section {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.status-message {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #2d3748;
  font-weight: 500;
}

.job-info-card {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.job-info-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.job-info-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #374151;
}

.job-status {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.status-pending {
  background: #f3f4f6;
  color: #6b7280;
}

.status-processing {
  background: #dbeafe;
  color: #1d4ed8;
}

.status-completed {
  background: #d1fae5;
  color: #059669;
}

.status-failed {
  background: #fee2e2;
  color: #dc2626;
}

.job-info-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.job-info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.job-info-label {
  font-size: 12px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.job-info-value {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  word-break: break-all;
}

.player-section {
  margin-bottom: 40px;
}
</style>
