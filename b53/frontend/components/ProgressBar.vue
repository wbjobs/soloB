<template>
  <div class="progress-bar-container">
    <div class="progress-header" v-if="showHeader">
      <span class="progress-label">{{ label }}</span>
      <span class="progress-percent" v-if="!showDetailed">
        {{ displayPercent }}%
      </span>
    </div>

    <div class="progress-track" :class="{ 'has-glow': animated }">
      <div
        class="progress-fill"
        :style="progressStyle"
        :class="{
          'progress-indeterminate': indeterminate,
          'progress-striped': striped,
          'progress-animated': animated && !indeterminate
        }"
      >
        <span v-if="showPercentInside && !indeterminate" class="progress-text">
          {{ displayPercent }}%
        </span>
      </div>
    </div>

    <div class="progress-details" v-if="showDetailed && !indeterminate">
      <div class="detail-item">
        <span class="detail-label">进度</span>
        <span class="detail-value">{{ displayPercent }}%</span>
      </div>
      <div class="detail-item" v-if="elapsedTime > 0">
        <span class="detail-label">已用</span>
        <span class="detail-value">{{ formatTime(elapsedTime) }}</span>
      </div>
      <div class="detail-item" v-if="estimatedRemaining > 0">
        <span class="detail-label">剩余</span>
        <span class="detail-value">{{ formatTime(estimatedRemaining) }}</span>
      </div>
      <div class="detail-item" v-if="speed > 0">
        <span class="detail-label">速度</span>
        <span class="detail-value">{{ formatSpeed(speed) }}</span>
      </div>
    </div>

    <div class="progress-status" v-if="status">
      <span :class="'status-badge status-' + status">
        {{ statusText }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  percent: {
    type: Number,
    default: 0
  },
  label: {
    type: String,
    default: '进度'
  },
  color: {
    type: String,
    default: 'primary'
  },
  striped: {
    type: Boolean,
    default: true
  },
  animated: {
    type: Boolean,
    default: true
  },
  indeterminate: {
    type: Boolean,
    default: false
  },
  showHeader: {
    type: Boolean,
    default: true
  },
  showDetailed: {
    type: Boolean,
    default: false
  },
  showPercentInside: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    default: ''
  },
  statusText: {
    type: String,
    default: ''
  },
  startTime: {
    type: Number,
    default: null
  }
})

const elapsedTime = ref(0)
const lastPercent = ref(0)
const lastTime = ref(0)
const speed = ref(0)
let timer = null

const displayPercent = computed(() => {
  const p = Math.min(100, Math.max(0, props.percent))
  return Math.round(p * 10) / 10
})

const estimatedRemaining = computed(() => {
  if (speed.value <= 0 || displayPercent.value <= 0 || displayPercent.value >= 100) {
    return 0
  }
  const remainingPercent = 100 - displayPercent.value
  return (remainingPercent / 100) * (elapsedTime.value / (displayPercent.value / 100))
})

const progressStyle = computed(() => {
  if (props.indeterminate) {
    return {}
  }

  const colors = {
    primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    success: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    warning: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    danger: 'linear-gradient(135deg, #eb3349 0%, #f45c43 100%)',
    info: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
  }

  return {
    width: `${displayPercent.value}%`,
    background: colors[props.color] || colors.primary
  }
})

const formatTime = (seconds) => {
  if (!seconds || seconds <= 0) return '0s'

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) {
    return `${h}h ${m}m ${s}s`
  } else if (m > 0) {
    return `${m}m ${s}s`
  } else {
    return `${s}s`
  }
}

const formatSpeed = (percentPerSecond) => {
  if (percentPerSecond <= 0) return ''
  return `${percentPerSecond.toFixed(2)}%/s`
}

const updateTimer = () => {
  if (props.startTime && displayPercent.value > 0 && displayPercent.value < 100) {
    const now = Date.now()
    elapsedTime.value = (now - props.startTime) / 1000

    if (lastTime.value > 0 && lastPercent.value < displayPercent.value) {
      const timeDiff = (now - lastTime.value) / 1000
      const percentDiff = displayPercent.value - lastPercent.value
      if (timeDiff > 0) {
        speed.value = percentDiff / timeDiff
      }
    }
    lastTime.value = now
    lastPercent.value = displayPercent.value
  }
}

watch(() => props.percent, (newVal) => {
  if (timer) {
    clearInterval(timer)
  }
  timer = setInterval(updateTimer, 500)
  updateTimer()
})

onMounted(() => {
  timer = setInterval(updateTimer, 500)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
  }
})
</script>

<style scoped>
.progress-bar-container {
  width: 100%;
  margin: 8px 0;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-label {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.progress-percent {
  font-size: 14px;
  font-weight: 700;
  color: #667eea;
}

.progress-track {
  position: relative;
  height: 12px;
  background: #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}

.progress-track.has-glow {
  box-shadow: 0 0 10px rgba(102, 126, 234, 0.1);
}

.progress-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.3s ease;
  position: relative;
}

.progress-indeterminate {
  width: 40% !important;
  animation: indeterminate 1.5s ease-in-out infinite;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}

.progress-striped {
  background-image: linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.15) 25%,
    transparent 25%,
    transparent 50%,
    rgba(255, 255, 255, 0.15) 50%,
    rgba(255, 255, 255, 0.15) 75%,
    transparent 75%,
    transparent
  );
  background-size: 1rem 1rem;
}

.progress-animated {
  animation: progress-stripes 1s linear infinite;
}

@keyframes progress-stripes {
  from {
    background-position: 1rem 0;
  }
  to {
    background-position: 0 0;
  }
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 11px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
}

.progress-details {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  padding: 8px;
  background: #f9fafb;
  border-radius: 8px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 11px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-value {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.progress-status {
  margin-top: 8px;
}

.status-badge {
  display: inline-block;
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
</style>
