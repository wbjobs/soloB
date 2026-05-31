import { videoProcessingQueue, liveCaptionQueue } from '../queues';
import { VideoProcessor } from './VideoProcessor';
import { liveCaptionService } from '../services/LiveCaptionService';

let ioInstance: any = null;

export function setIOInstance(io: any) {
  ioInstance = io;
}

videoProcessingQueue.process(async (job) => {
  const { sessionId, driftInfo } = job.data;
  console.log(`Processing video for session: ${sessionId}, avgDrift: ${driftInfo?.avgDrift}`);
  
  const processor = new VideoProcessor(sessionId, ioInstance, driftInfo);
  await processor.process();
  
  return { success: true, sessionId, driftInfo };
});

liveCaptionQueue.process(async (job) => {
  const { chunkId, sessionId, filePath } = job.data;
  console.log(`Processing live caption chunk: ${chunkId} for session: ${sessionId}`);
  
  try {
    await liveCaptionService.processAudioChunk(chunkId, sessionId, filePath);
    return { success: true, chunkId, sessionId };
  } catch (error) {
    console.error(`Failed to process caption chunk ${chunkId}:`, error);
    throw error;
  }
});

videoProcessingQueue.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

videoProcessingQueue.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

videoProcessingQueue.on('progress', (job, progress) => {
  console.log(`Job ${job.id} progress: ${progress}%`);
});

console.log('Video processing worker started');
