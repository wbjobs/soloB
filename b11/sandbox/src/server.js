require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { executeCode } = require('./services/executor');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/execute', async (req, res) => {
  const { language, code } = req.body;

  if (!language || !code) {
    return res.status(400).json({ error: 'Language and code are required' });
  }

  const supportedLanguages = ['javascript', 'python', 'java'];
  if (!supportedLanguages.includes(language)) {
    return res.status(400).json({
      error: `Unsupported language. Supported: ${supportedLanguages.join(', ')}`
    });
  }

  const executionId = uuidv4();

  try {
    const result = await executeCode(executionId, language, code);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Execution error',
      message: error.message,
      executionId
    });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Sandbox server running on port ${PORT}`);
});
