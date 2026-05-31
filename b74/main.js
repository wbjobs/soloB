const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let pythonProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function startPythonBackend() {
  const pythonPaths = ['python', 'python3', 'py'];
  const scriptPath = path.join(__dirname, 'backend', 'server.py');
  const backendDir = path.join(__dirname, 'backend');
  
  function tryStartPython(index) {
    if (index >= pythonPaths.length) {
      console.error('Failed to start Python backend. Please ensure Python is installed.');
      return;
    }
    
    const pythonPath = pythonPaths[index];
    console.log(`Trying to start Python with: ${pythonPath}`);
    
    pythonProcess = spawn(pythonPath, [scriptPath], {
      cwd: backendDir,
      shell: process.platform === 'win32'
    });

    let started = false;
    
    pythonProcess.stdout.on('data', (data) => {
      const message = data.toString();
      console.log(`Python: ${message}`);
      if (message.includes('server started') && !started) {
        started = true;
        console.log('Python backend started successfully!');
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      const message = data.toString();
      console.error(`Python Error: ${message}`);
      if (message.includes('not recognized') || message.includes('command not found')) {
        if (!started) {
          pythonProcess.kill();
          tryStartPython(index + 1);
        }
      }
    });

    pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}`);
      if (code !== 0 && !started && index < pythonPaths.length - 1) {
        tryStartPython(index + 1);
      }
    });

    pythonProcess.on('error', (err) => {
      console.error(`Failed to start ${pythonPath}: ${err.message}`);
      tryStartPython(index + 1);
    });
  }
  
  tryStartPython(0);
}

app.whenReady().then(() => {
  startPythonBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('export-json', async (event, data) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  
  if (filePath) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('import-json', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile']
  });
  
  if (filePaths && filePaths[0]) {
    const content = fs.readFileSync(filePaths[0], 'utf-8');
    return { success: true, data: JSON.parse(content) };
  }
  return { success: false };
});
