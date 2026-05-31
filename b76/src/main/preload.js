const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  discoverDevices: () => ipcRenderer.invoke('discover-devices'),
  runTests: (deviceId, deviceInfo) => ipcRenderer.invoke('run-tests', deviceId, deviceInfo),
  getTestHistory: () => ipcRenderer.invoke('get-test-history'),
  getTestResults: (sessionId) => ipcRenderer.invoke('get-test-results', sessionId),
  exportPDF: (sessionId) => ipcRenderer.invoke('export-pdf', sessionId),
  deleteTestSession: (sessionId) => ipcRenderer.invoke('delete-test-session', sessionId),
  getRepairSuggestions: (results) => ipcRenderer.invoke('get-repair-suggestions', results),
  getKnowledgeBase: () => ipcRenderer.invoke('get-knowledge-base'),
  onTestProgress: (callback) => {
    ipcRenderer.on('test-progress', (event, data) => callback(data));
    return () => ipcRenderer.removeListener('test-progress', callback);
  }
});