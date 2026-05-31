import express from 'express';
import cors from 'cors';
import dataSourceRoutes from './routes/dataSource.routes';
import { initModels } from './models';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/data-sources', dataSourceRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Lowcode Data Source Platform API is running' });
});

const startServer = async () => {
  try {
    await initModels();
    console.log('Database models initialized successfully');
    
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
