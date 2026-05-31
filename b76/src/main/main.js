const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Database = require('./database');
const OCFService = require('./ocf-service');
const PDFExporter = require('./pdf-exporter');

let mainWindow;
let db;
let ocfService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  db = new Database(path.join(app.getPath('userData'), 'tests.db'));
  ocfService = new OCFService();

  setupIPCHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function setupIPCHandlers() {
  ipcMain.handle('discover-devices', async () => {
    return await ocfService.discoverDevices();
  });

  ipcMain.handle('run-tests', async (event, deviceId, deviceInfo) => {
    const testSession = await db.createTestSession(deviceInfo);
    
    const testCases = [
      { name: '/oic/res', description: '资源发现' },
      { name: '/oic/d', description: '设备信息' },
      { name: '/oic/p', description: '平台信息' },
      { name: '/oic/sec/doxm', description: '设备所有者转让方法' },
      { name: '/oic/sec/pstat', description: '配置状态' }
    ];

    const results = [];
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      event.sender.send('test-progress', {
        current: i + 1,
        total: testCases.length,
        testName: testCase.name
      });

      const result = await ocfService.runTestCase(deviceInfo, testCase);
      await db.addTestResult(testSession.id, result);
      results.push(result);
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await db.updateTestSessionStatus(testSession.id, 'completed');
    return { sessionId: testSession.id, results };
  });

  ipcMain.handle('get-test-history', async () => {
    return await db.getTestSessions();
  });

  ipcMain.handle('get-test-results', async (event, sessionId) => {
    return await db.getTestResults(sessionId);
  });

  ipcMain.handle('export-pdf', async (event, sessionId) => {
    const session = await db.getTestSession(sessionId);
    const results = await db.getTestResults(sessionId);
    
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出PDF报告',
      defaultPath: `OCF测试报告_${session.device_name}_${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF文件', extensions: ['pdf'] }]
    });

    if (filePath) {
      await PDFExporter.export(filePath, session, results);
      return filePath;
    }
    return null;
  });

  ipcMain.handle('delete-test-session', async (event, sessionId) => {
    return await db.deleteTestSession(sessionId);
  });

  ipcMain.handle('get-repair-suggestions', async (event, results) => {
    return ocfService.getRepairSuggestions(results);
  });

  ipcMain.handle('get-knowledge-base', async () => {
    return ocfService.getAllKnowledgeBase();
  });
}