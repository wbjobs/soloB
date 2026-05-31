<template>
  <div class="video-player">
    <div v-if="videoSrc" class="video-container">
      <video 
        ref="videoElement"
        :src="videoSrc" 
        class="video-preview"
        controls
        playsinline
      />
    </div>
    
    <div v-else class="preview-placeholder">
      <div class="preview-placeholder-icon">🎥</div>
      <div class="preview-placeholder-text">请上传视频文件进行预览</div>
    </div>

    <div v-if="isProcessing" class="processing-overlay">
      <div class="processing-spinner"></div>
      <div class="processing-text">正在应用滤镜效果...</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  videoSrc: {
    type: String,
    default: null
  },
  isProcessing: {
    type: Boolean,
    default: false
  }
})

const videoElement = ref(null)

watch(() => props.videoSrc, (newSrc) => {
  if (newSrc && videoElement.value) {
    videoElement.value.load()
  }
})
</script>

<style scoped>
.video-player {
  position: relative;
}

.video-container {
  position: relative;
}

.video-preview {
  width: 100%;
  border-radius: 12px;
  background: #000;
  max-height: 500px;
  object-fit: contain;
}

.processing-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.processing-spinner {
  width: 60px;
  height: 60px;
  border: 4px solid rgba(255, 255, 255, 0.2);
  border-top-color: #e94560;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.processing-text {
  color: #ffffff;
  font-size: 1.1rem;
  font-weight: 500;
}

.preview-placeholder {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #808080;
  border: 2px dashed rgba(255, 255, 255, 0.1);
}

.preview-placeholder-icon {
  font-size: 4rem;
  margin-bottom: 15px;
  opacity: 0.5;
}

.preview-placeholder-text {
  font-size: 1rem;
}
</style>
