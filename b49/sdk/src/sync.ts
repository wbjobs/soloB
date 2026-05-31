import type { TaskList, SyncResponse } from './types';
import { IndexedDBStorage } from './storage';
import { createTaskList } from './crdt';

export interface SyncManagerOptions {
  apiBaseUrl: string;
  storage: IndexedDBStorage;
  syncIntervalMs?: number;
}

export class SyncManager {
  private apiBaseUrl: string;
  private storage: IndexedDBStorage;
  private syncIntervalMs: number;
  private syncTimer: number | null = null;
  private isOnline: boolean = true;
  private isSyncing: boolean = false;
  private listeners: Set<() => void> = new Set();
  private errorListeners: Set<(error: Error) => void> = new Set();

  constructor(options: SyncManagerOptions) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.storage = options.storage;
    this.syncIntervalMs = options.syncIntervalMs || 30000;
    
    this.setupNetworkListeners();
  }

  private setupNetworkListeners(): void {
    if (typeof window !== 'undefined') {
      this.isOnline = navigator.onLine;
      
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.notifyListeners();
        this.scheduleSync();
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        this.notifyListeners();
      });
    }
  }

  isOnlineStatus(): boolean {
    return this.isOnline;
  }

  async checkServerReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async sync(): Promise<TaskList | null> {
    if (this.isSyncing) {
      return null;
    }

    this.isSyncing = true;
    
    try {
      const taskList = await this.storage.loadTaskList();
      if (!taskList) {
        const initialList = createTaskList();
        await this.storage.saveTaskList(initialList, false);
        return initialList;
      }

      const response = await fetch(`${this.apiBaseUrl}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: this.storage.getUserId(),
          task_list: taskList
        })
      });

      if (!response.ok) {
        throw new Error(`Sync failed with status: ${response.status}`);
      }

      const result: SyncResponse = await response.json();
      
      if (result.success) {
        await this.storage.saveTaskList(result.task_list, false);
        this.notifyListeners();
        return result.task_list;
      } else {
        throw new Error(result.message || 'Sync failed');
      }
    } catch (error) {
      this.isOnline = false;
      this.notifyErrorListeners(error as Error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  async fetchRemote(): Promise<TaskList> {
    const response = await fetch(`${this.apiBaseUrl}/api/tasks/${this.storage.getUserId()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tasks: ${response.status}`);
    }

    const result: SyncResponse = await response.json();
    
    if (result.success) {
      return result.task_list;
    } else {
      throw new Error(result.message || 'Failed to fetch tasks');
    }
  }

  startBackgroundSync(): void {
    if (this.syncTimer !== null) {
      return;
    }

    const syncLoop = async () => {
      try {
        if (this.isOnline && await this.storage.hasPendingSync()) {
          await this.sync();
        }
      } catch {
      }
    };

    syncLoop();
    
    this.syncTimer = window.setInterval(syncLoop, this.syncIntervalMs);
  }

  stopBackgroundSync(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  scheduleSync(): void {
    setTimeout(async () => {
      try {
        if (this.isOnline) {
          await this.sync();
        }
      } catch {
      }
    }, 1000);
  }

  addChangeListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addErrorListener(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private notifyErrorListeners(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}
