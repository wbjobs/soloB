const Redis = require('ioredis');

class RedisListener {
  constructor() {
    this.pubSub = null;
    this.listener = null;
    this.eventCallbacks = [];
    this.isSubscribed = false;
  }

  connect() {
    const options = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        console.log(`Redis reconnecting... attempt ${times}, delay ${delay}ms`);
        return delay;
      }
    };

    if (process.env.REDIS_PASSWORD) {
      options.password = process.env.REDIS_PASSWORD;
    }

    console.log('Connecting to Redis...');
    this.pubSub = new Redis(options);
    this.listener = new Redis(options);

    this.pubSub.on('connect', () => {
      console.log('[Redis] pubSub connection established');
    });

    this.pubSub.on('error', (error) => {
      console.error('[Redis] pubSub error:', error.message);
    });

    this.pubSub.on('close', () => {
      console.log('[Redis] pubSub connection closed');
    });

    this.listener.on('connect', () => {
      console.log('[Redis] listener connection established');
      this.subscribeToChannel();
    });

    this.listener.on('error', (error) => {
      console.error('[Redis] listener error:', error.message);
    });

    this.listener.on('close', () => {
      console.log('[Redis] listener connection closed');
      this.isSubscribed = false;
    });

    this.listener.on('reconnecting', () => {
      console.log('[Redis] listener reconnecting...');
    });

    this.listener.on('message', (channel, message) => {
      console.log(`[Redis] Received raw message on channel ${channel}: ${message.substring(0, 200)}...`);
      this.handleMessage(channel, message);
    });
  }

  subscribeToChannel() {
    const channel = process.env.REDIS_CHANNEL || 'celery-task-monitor';
    console.log(`[Redis] Subscribing to channel: ${channel}`);
    
    this.listener.subscribe(channel, (error, count) => {
      if (error) {
        console.error(`[Redis] Failed to subscribe to channel ${channel}:`, error.message);
      } else {
        this.isSubscribed = true;
        console.log(`[Redis] Subscribed to channel: ${channel}, total subscriptions: ${count}`);
      }
    });
  }

  handleMessage(channel, message) {
    let event;
    try {
      event = JSON.parse(message);
      console.log(`[Redis] Parsed event successfully: type=${event.type || event.status}, taskId=${event.taskId || 'N/A'}, workerId=${event.workerId || 'N/A'}`);
    } catch (error) {
      console.error(`[Redis] Failed to parse message: ${error.message}`);
      console.error(`[Redis] Raw message was: ${message}`);
      return;
    }

    if (!event.type && !event.status) {
      console.warn('[Redis] Event has no type or status field, ignoring:', event);
      return;
    }

    console.log(`[Redis] Triggering ${this.eventCallbacks.length} callback(s)`);
    this.eventCallbacks.forEach((callback, index) => {
      try {
        callback(event);
        console.log(`[Redis] Callback ${index + 1} executed successfully`);
      } catch (err) {
        console.error(`[Redis] Error in callback ${index + 1}:`, err.message);
      }
    });
  }

  onEvent(callback) {
    console.log(`[Redis] Registering callback, total: ${this.eventCallbacks.length + 1}`);
    this.eventCallbacks.push(callback);
  }

  async publish(event) {
    if (this.pubSub) {
      const channel = process.env.REDIS_CHANNEL || 'celery-task-monitor';
      await this.pubSub.publish(channel, JSON.stringify(event));
    }
  }

  close() {
    console.log('[Redis] Closing connections...');
    if (this.pubSub) {
      this.pubSub.disconnect();
    }
    if (this.listener) {
      this.listener.disconnect();
    }
  }
}

module.exports = new RedisListener();
