import Queue from 'bull';
import { config } from '../utils/config';

const redisOptions = {
  url: config.redisUrl,
};

export const videoProcessingQueue = new Queue('video-processing', {
  redis: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
  limiter: {
    max: 2,
    duration: 1000,
  },
});

export const subtitleGenerationQueue = new Queue('subtitle-generation', {
  redis: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
  limiter: {
    max: 5,
    duration: 1000,
  },
});

export const liveCaptionQueue = new Queue('live-caption', {
  redis: redisOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
  limiter: {
    max: 10,
    duration: 1000,
  },
});

export const videoMergeQueue = new Queue('video-merge', {
  redis: redisOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 10000,
    },
  },
  limiter: {
    max: 1,
    duration: 1000,
  },
});

export const queues = {
  videoProcessing: videoProcessingQueue,
  subtitleGeneration: subtitleGenerationQueue,
  liveCaption: liveCaptionQueue,
  videoMerge: videoMergeQueue,
};

export type QueueType = keyof typeof queues;

export async function closeAllQueues() {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
}
