const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    create: (encryptedContent) => ipcRenderer.invoke('notes:create', encryptedContent),
    get: (id) => ipcRenderer.invoke('notes:get', id),
    update: (data) => ipcRenderer.invoke('notes:update', data),
    delete: (id) => ipcRenderer.invoke('notes:delete', id)
  },
  crypto: {
    encrypt: (plaintext, key) => ipcRenderer.invoke('crypto:encrypt', { plaintext, key }),
    decrypt: (ciphertext, key) => ipcRenderer.invoke('crypto:decrypt', { ciphertext, key }),
    generateKey: () => ipcRenderer.invoke('crypto:generateKey')
  }
})
