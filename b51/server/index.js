const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const { CRDTEngine } = require('./crdt/engine');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/collab-editor';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Connected to MongoDB');
}).catch((err) => {
  console.error('MongoDB connection error:', err);
});

const documentSchema = new mongoose.Schema({
  documentId: { type: String, required: true, unique: true },
  content: { type: String, default: '' },
  operations: { type: Array, default: [] },
  version: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const versionHistorySchema = new mongoose.Schema({
  documentId: { type: String, required: true },
  version: { type: Number, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const Document = mongoose.model('Document', documentSchema);
const VersionHistory = mongoose.model('VersionHistory', versionHistorySchema);

const documents = new Map();

async function getOrCreateDocument(documentId) {
  if (documents.has(documentId)) {
    return documents.get(documentId);
  }
  
  let doc = await Document.findOne({ documentId });
  
  if (!doc) {
    doc = new Document({
      documentId,
      content: '',
      operations: [],
      version: 0
    });
    await doc.save();
    
    const initialHistory = new VersionHistory({
      documentId,
      version: 0,
      content: ''
    });
    await initialHistory.save();
  }
  
  const engine = new CRDTEngine();
  if (doc.operations && doc.operations.length > 0) {
    engine.applyOperations(doc.operations);
  }
  
  const documentData = {
    engine,
    clients: new Set(),
    version: doc.version,
    documentId
  };
  
  documents.set(documentId, documentData);
  return documentData;
}

async function saveDocumentVersion(documentId, content, version) {
  const versionHistory = new VersionHistory({
    documentId,
    version,
    content
  });
  await versionHistory.save();
}

async function updateDocumentInDB(documentId, engine, version) {
  const content = engine.getDocument();
  const operations = engine.getOperations();
  
  await Document.findOneAndUpdate(
    { documentId },
    {
      content,
      operations,
      version,
      updatedAt: Date.now()
    }
  );
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  let currentDocumentId = null;
  let documentData = null;
  
  socket.on('join-document', async ({ documentId }) => {
    console.log(`Client ${socket.id} joining document ${documentId}`);
    
    if (currentDocumentId && documentData) {
      documentData.clients.delete(socket.id);
      socket.leave(currentDocumentId);
      
      io.to(currentDocumentId).emit('user-left', {
        userId: socket.id,
        clients: Array.from(documentData.clients)
      });
    }
    
    currentDocumentId = documentId;
    documentData = await getOrCreateDocument(documentId);
    
    socket.join(documentId);
    documentData.clients.add(socket.id);
    
    const content = documentData.engine.getDocument();
    
    socket.emit('document-joined', {
      documentId,
      content,
      version: documentData.version,
      clients: Array.from(documentData.clients)
    });
    
    io.to(documentId).emit('user-joined', {
      userId: socket.id,
      clients: Array.from(documentData.clients)
    });
  });
  
  socket.on('operation', async ({ documentId, operation }) => {
    if (!documentData || documentData.documentId !== documentId) {
      return;
    }
    
    documentData.engine.applyOperation(operation);
    documentData.version++;
    
    const shouldSaveHistory = documentData.version % 10 === 0;
    
    if (shouldSaveHistory) {
      const content = documentData.engine.getDocument();
      await saveDocumentVersion(documentId, content, documentData.version);
    }
    
    await updateDocumentInDB(documentId, documentData.engine, documentData.version);
    
    socket.broadcast.to(documentId).emit('operation', {
      operation,
      version: documentData.version,
      from: socket.id
    });
  });
  
  socket.on('get-history', async ({ documentId }) => {
    const history = await VersionHistory.find({ documentId })
      .sort({ version: -1 })
      .limit(50);
    
    socket.emit('history', {
      documentId,
      versions: history.map(h => ({
        version: h.version,
        content: h.content,
        timestamp: h.timestamp
      }))
    });
  });
  
  socket.on('restore-version', async ({ documentId, version }) => {
    const historyEntry = await VersionHistory.findOne({ documentId, version });
    
    if (!historyEntry) {
      socket.emit('restore-error', { message: 'Version not found' });
      return;
    }
    
    const doc = await Document.findOne({ documentId });
    if (!doc) {
      socket.emit('restore-error', { message: 'Document not found' });
      return;
    }
    
    const newEngine = new CRDTEngine();
    const content = historyEntry.content;
    
    for (let i = 0; i < content.length; i++) {
      newEngine.insert(i, content[i]);
    }
    
    doc.content = content;
    doc.operations = newEngine.getOperations();
    doc.version = version;
    doc.updatedAt = Date.now();
    await doc.save();
    
    if (documents.has(documentId)) {
      documents.set(documentId, {
        engine: newEngine,
        clients: documents.get(documentId).clients,
        version: version,
        documentId
      });
    }
    
    io.to(documentId).emit('version-restored', {
      documentId,
      content,
      version
    });
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    if (currentDocumentId && documentData) {
      documentData.clients.delete(socket.id);
      
      io.to(currentDocumentId).emit('user-left', {
        userId: socket.id,
        clients: Array.from(documentData.clients)
      });
    }
  });
});

app.get('/api/documents/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const doc = await Document.findOne({ documentId });
    
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    res.json({
      documentId: doc.documentId,
      content: doc.content,
      version: doc.version,
      updatedAt: doc.updatedAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
