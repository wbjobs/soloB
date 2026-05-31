import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 1420,
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
})
