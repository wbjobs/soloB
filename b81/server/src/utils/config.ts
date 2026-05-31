import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  openaiApiKey: process.env.OPENAI_API_KEY,
  
  uploadPath: path.resolve(__dirname, '../../..', process.env.UPLOAD_PATH || '../uploads'),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10737418240', 10),
  
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
};

export const paths = {
  temp: path.join(config.uploadPath, 'temp'),
  processed: path.join(config.uploadPath, 'processed'),
};
