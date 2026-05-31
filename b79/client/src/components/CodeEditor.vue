<template>
  <div ref="editorContainer" class="code-editor-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as monaco from 'monaco-editor'

const props = defineProps<{
  modelValue: string
  language?: string
  theme?: string
  readOnly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const editorContainer = ref<HTMLElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null

const initEditor = () => {
  if (!editorContainer.value) return

  editor = monaco.editor.create(editorContainer.value, {
    value: props.modelValue,
    language: props.language || 'javascript',
    theme: props.theme || 'vs-dark',
    readOnly: props.readOnly || false,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: 'on',
    automaticLayout: true,
    tabSize: 2
  })

  editor.onDidChangeModelContent(() => {
    if (editor) {
      emit('update:modelValue', editor.getValue())
    }
  })
}

watch(() => props.modelValue, (newValue) => {
  if (editor && editor.getValue() !== newValue) {
    editor.setValue(newValue)
  }
})

onMounted(() => {
  initEditor()
})

onUnmounted(() => {
  if (editor) {
    editor.dispose()
  }
})
</script>

<style scoped>
.code-editor-container {
  width: 100%;
  height: 500px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}
</style>
