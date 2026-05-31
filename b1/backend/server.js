const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');
const { initScheduler } = require('./scheduler');
const tasksRouter = require('./routes/tasks');
const dependenciesRouter = require('./routes/dependencies');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/tasks', tasksRouter);
app.use('/api/dependencies', dependenciesRouter);

const startServer = async () => {
  try {
    await initDb();
    await initScheduler();
    
    app.listen(PORT, () => {
      console.log(`Task scheduler backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
