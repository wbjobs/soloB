<template>
  <div v-if="showSuggestions && suggestions.length > 0" class="suggestions-container">
    <div class="suggestions-header">
      <span class="suggestions-title">💡 命令建议</span>
      <span class="suggestions-hint">Tab/↑↓ 选择，Enter 应用</span>
    </div>
    <div class="suggestions-list">
      <div
        v-for="(sug, idx) in suggestions"
        :key="idx"
        class="suggestion-item"
        :class="{ active: selectedIndex === idx }"
        @click="applySuggestion(sug)"
        @mouseenter="selectedIndex = idx"
      >
        <span class="suggestion-type" :class="sug.type">{{ getTypeIcon(sug.type) }}</span>
        <span class="suggestion-command">
          <template v-if="Array.isArray(formatCommand(sug.command))">
            <span v-for="part in formatCommand(sug.command)" :key="part.text" :class="{ match: part.match }">{{ part.text }}</span>
          </template>
          <template v-else>{{ formatCommand(sug.command) }}</template>
        </span>
        <span v-if="sug.score" class="suggestion-score">{{ sug.score }}×</span>
      </div>
    </div>
    <div v-if="showDetails && suggestions[selectedIndex]" class="suggestion-details">
      <div class="detail-row">
        <span class="detail-label">类型:</span>
        <span class="detail-value">{{ getTypeName(suggestions[selectedIndex].type) }}</span>
      </div>
      <div v-if="suggestions[selectedIndex].args && suggestions[selectedIndex].args.length > 0" class="detail-row">
        <span class="detail-label">参数:</span>
        <span class="detail-value">{{ suggestions[selectedIndex].args.join(', ') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  suggestions: {
    type: Array,
    default: () => []
  },
  currentInput: {
    type: String,
    default: ''
  },
  showSuggestions: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['apply', 'navigate'])

const selectedIndex = ref(0)
const showDetails = ref(true)

watch(() => props.suggestions, () => {
  selectedIndex.value = 0
})

function getTypeIcon(type) {
  const icons = {
    history: '📜',
    builtin: '⚡',
    argument: '📝',
    recent: '🕐'
  }
  return icons[type] || '💡'
}

function getTypeName(type) {
  const names = {
    history: '历史命令',
    builtin: '内置命令',
    argument: '参数建议',
    recent: '最近使用'
  }
  return names[type] || '建议'
}

function formatCommand(cmd) {
  if (!props.currentInput) return cmd
  const inputLower = props.currentInput.toLowerCase()
  const cmdLower = cmd.toLowerCase()
  if (cmdLower.startsWith(inputLower)) {
    const prefix = cmd.slice(0, props.currentInput.length)
    const suffix = cmd.slice(props.currentInput.length)
    return [
      { text: prefix, match: true },
      { text: suffix, match: false }
    ]
  }
  return cmd
}

function applySuggestion(sug) {
  emit('apply', sug.command)
}

function navigateUp() {
  if (selectedIndex.value > 0) {
    selectedIndex.value--
  } else {
    selectedIndex.value = props.suggestions.length - 1
  }
  emit('navigate', selectedIndex.value)
}

function navigateDown() {
  if (selectedIndex.value < props.suggestions.length - 1) {
    selectedIndex.value++
  } else {
    selectedIndex.value = 0
  }
  emit('navigate', selectedIndex.value)
}

function applySelected() {
  if (props.suggestions[selectedIndex.value]) {
    applySuggestion(props.suggestions[selectedIndex.value])
  }
}

defineExpose({
  navigateUp,
  navigateDown,
  applySelected
})
</script>

<style scoped>
.suggestions-container {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: rgba(26, 26, 46, 0.98);
  border: 1px solid #4a5568;
  border-radius: 8px 8px 0 0;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  max-height: 300px;
  overflow: hidden;
  backdrop-filter: blur(10px);
}

.suggestions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(74, 85, 104, 0.3);
  border-bottom: 1px solid #4a5568;
}

.suggestions-title {
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 600;
}

.suggestions-hint {
  color: #718096;
  font-size: 11px;
}

.suggestions-list {
  max-height: 200px;
  overflow-y: auto;
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  border-left: 3px solid transparent;
}

.suggestion-item:hover,
.suggestion-item.active {
  background: rgba(66, 153, 225, 0.2);
  border-left-color: #4299e1;
}

.suggestion-type {
  font-size: 14px;
  width: 20px;
  text-align: center;
}

.suggestion-command {
  flex: 1;
  color: #e2e8f0;
  font-family: 'Fira Code', 'Monaco', monospace;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.suggestion-command :deep(.match) {
  color: #4299e1;
  font-weight: 600;
}

.suggestion-command :deep(.no-match) {
  color: #a0aec0;
}

.suggestion-score {
  color: #718096;
  font-size: 11px;
  padding: 2px 6px;
  background: rgba(74, 85, 104, 0.3);
  border-radius: 4px;
}

.suggestion-details {
  padding: 10px 12px;
  border-top: 1px solid #4a5568;
  background: rgba(45, 55, 72, 0.5);
}

.detail-row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  color: #718096;
  font-size: 11px;
  min-width: 40px;
}

.detail-value {
  color: #a0aec0;
  font-size: 11px;
  font-family: 'Fira Code', 'Monaco', monospace;
}

.suggestion-type.history {
  color: #48bb78;
}

.suggestion-type.builtin {
  color: #ed8936;
}

.suggestion-type.argument {
  color: #4299e1;
}

.suggestion-type.recent {
  color: #9f7aea;
}

.suggestions-list::-webkit-scrollbar {
  width: 6px;
}

.suggestions-list::-webkit-scrollbar-track {
  background: rgba(45, 55, 72, 0.5);
}

.suggestions-list::-webkit-scrollbar-thumb {
  background: #4a5568;
  border-radius: 3px;
}

.suggestions-list::-webkit-scrollbar-thumb:hover {
  background: #718096;
}
</style>
