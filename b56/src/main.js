const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

const NOTES_DIR = path.join(app.getPath('userData'), 'notes')
const KEY_FILE = path.join(app.getPath('userData'), 'encryption.key')

if (!fs.existsSync(NOTES_DIR)) {
  fs.mkdirSync(NOTES_DIR, { recursive: true })
}

function getNotePath(id) {
  return path.join(NOTES_DIR, `${id}.note`)
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

function getRustBinaryPath() {
  const isDev = process.env.NODE_ENV !== 'production'
  const exeExtension = process.platform === 'win32' ? '.exe' : ''
  
  if (isDev) {
    const possiblePaths = [
      path.join(__dirname, '..', 'target', 'debug', 'secure-notes-core' + exeExtension),
      path.join(__dirname, '..', 'target', 'release', 'secure-notes-core' + exeExtension),
    ]
    
    for (const binPath of possiblePaths) {
      if (fs.existsSync(binPath)) {
        return binPath
      }
    }
    
    return possiblePaths[0]
  }
  
  return path.join(process.resourcesPath, 'bin', 'secure-notes-core' + exeExtension)
}

function runRustCommand(args) {
  return new Promise((resolve, reject) => {
    const binaryPath = getRustBinaryPath()
    console.log('Running Rust binary:', binaryPath)
    
    if (!fs.existsSync(binaryPath)) {
      reject(new Error(`Rust binary not found at ${binaryPath}. Please run 'cargo build' first.`))
      return
    }
    
    const child = spawn(binaryPath, args)
    let stdout = ''
    let stderr = ''
    
    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    
    child.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim())
          resolve(result)
        } catch (e) {
          resolve(stdout.trim())
        }
      } else {
        reject(new Error(stderr || `Rust process exited with code ${code}`))
      }
    })
    
    child.on('error', (err) => {
      reject(err)
    })
  })
}

async function generateEncryptionKey() {
  if (fs.existsSync(KEY_FILE)) {
    return fs.readFileSync(KEY_FILE, 'utf8')
  }
  
  try {
    const key = await runRustCommand(['generate-key'])
    fs.writeFileSync(KEY_FILE, key.key, { mode: 0o600 })
    return key.key
  } catch (error) {
    console.error('Failed to generate key:', error)
    throw error
  }
}

async function encryptContent(content) {
  const key = await generateEncryptionKey()
  return runRustCommand(['encrypt', content, key])
}

async function decryptContent(encryptedData) {
  const key = await generateEncryptionKey()
  return runRustCommand(['decrypt', JSON.stringify(encryptedData), key])
}

ipcMain.handle('crypto:generateKey', async () => {
  try {
    const key = await generateEncryptionKey()
    return { success: true, key }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('crypto:encrypt', async (event, { plaintext, key }) => {
  try {
    const result = await runRustCommand(['encrypt', plaintext, key])
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('crypto:decrypt', async (event, { ciphertext, key }) => {
  try {
    const result = await runRustCommand(['decrypt', JSON.stringify(ciphertext), key])
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('notes:list', async () => {
  try {
    const files = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.note'))
    const notes = []
    
    for (const file of files) {
      const id = file.replace('.note', '')
      const data = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, file), 'utf8'))
      notes.push({
        id,
        title: data.title || 'Untitled',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      })
    }
    
    return { success: true, data: notes.sort((a, b) => b.updatedAt - a.updatedAt) }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('notes:create', async (event, { title, content }) => {
  try {
    const id = generateId()
    const notePath = getNotePath(id)
    const now = Date.now()
    
    const encryptedContent = await encryptContent(content)
    
    const data = {
      id,
      title: title || 'Untitled',
      content: encryptedContent,
      createdAt: now,
      updatedAt: now
    }
    
    fs.writeFileSync(notePath, JSON.stringify(data, null, 2))
    return { success: true, data: { ...data, content: undefined } }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('notes:get', async (event, id) => {
  try {
    const notePath = getNotePath(id)
    if (!fs.existsSync(notePath)) {
      return { success: false, error: 'Note not found' }
    }
    
    const data = JSON.parse(fs.readFileSync(notePath, 'utf8'))
    const decryptedContent = await decryptContent(data.content)
    
    return { 
      success: true, 
      data: {
        ...data,
        content: decryptedContent
      }
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('notes:update', async (event, { id, title, content }) => {
  try {
    const notePath = getNotePath(id)
    if (!fs.existsSync(notePath)) {
      return { success: false, error: 'Note not found' }
    }
    
    const existing = JSON.parse(fs.readFileSync(notePath, 'utf8'))
    
    let updatedContent = existing.content
    if (content !== undefined) {
      updatedContent = await encryptContent(content)
    }
    
    const updated = {
      ...existing,
      title: title || existing.title,
      content: updatedContent,
      updatedAt: Date.now()
    }
    
    fs.writeFileSync(notePath, JSON.stringify(updated, null, 2))
    return { success: true, data: { ...updated, content: undefined } }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('notes:delete', async (event, id) => {
  try {
    const notePath = getNotePath(id)
    if (!fs.existsSync(notePath)) {
      return { success: false, error: 'Note not found' }
    }
    
    fs.unlinkSync(notePath)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})
