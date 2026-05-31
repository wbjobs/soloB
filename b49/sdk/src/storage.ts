import type { TaskList } from './types';

const DB_NAME = 'task-crdt-db';
const DB_VERSION = 1;
const STORE_NAME = 'task-lists';

export interface StorageRecord {
  userId: string;
  taskList: TaskList;
  counter: number;
  pendingSync: boolean;
  lastLocalUpdate: string;
}

export class IndexedDBStorage {
  private dbPromise: Promise<IDBDatabase>;
  private userId: string;
  private replicaId: string;
  private counter: number = 0;

  constructor(userId: string, replicaId: string) {
    this.userId = userId;
    this.replicaId = replicaId;
    this.dbPromise = this.openDatabase();
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
        }
      };
    });
  }

  async saveTaskList(taskList: TaskList, pendingSync: boolean = true): Promise<void> {
    const db = await this.dbPromise;
    const now = new Date().toISOString();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const record: StorageRecord = {
        userId: this.userId,
        taskList,
        counter: this.counter,
        pendingSync,
        lastLocalUpdate: now
      };
      
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async loadTaskList(): Promise<TaskList | null> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(this.userId);
      
      request.onsuccess = () => {
        const record = request.result as StorageRecord | undefined;
        if (record) {
          this.counter = record.counter || 0;
          resolve(record.taskList);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async markSynced(): Promise<void> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(this.userId);
      
      request.onsuccess = () => {
        const record = request.result as StorageRecord | undefined;
        if (record) {
          record.pendingSync = false;
          record.taskList.last_sync_at = new Date().toISOString();
          const putRequest = store.put(record);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async hasPendingSync(): Promise<boolean> {
    const db = await this.dbPromise;
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(this.userId);
      
      request.onsuccess = () => {
        const record = request.result as StorageRecord | undefined;
        resolve(record?.pendingSync ?? false);
      };
      request.onerror = () => reject(request.error);
    });
  }

  getNextDot(): { replica_id: string; counter: number } {
    this.counter += 1;
    return {
      replica_id: this.replicaId,
      counter: this.counter
    };
  }

  getReplicaId(): string {
    return this.replicaId;
  }

  getUserId(): string {
    return this.userId;
  }
}

export function generateReplicaId(): string {
  return 'replica-' + 
    Math.random().toString(36).substring(2, 10) + 
    '-' + Date.now().toString(36);
}
