import { IndexedDBStorage, generateReplicaId } from './storage';
import { SyncManager } from './sync';
import {
  createTask,
  createTaskItem,
  createTaskList,
  updateTask,
  updateTaskItem,
  createTaskORSet,
  createTaskItemORSet,
  serializeTask,
  serializeTaskItem
} from './crdt';
import type {
  Dot,
  Task,
  TaskItem,
  TaskList,
  CreateTaskOptions,
  TaskItemOptions,
  UpdateTaskOptions
} from './types';

export * from './types';
export { IndexedDBStorage, SyncManager, generateReplicaId };

export interface TaskCRDTSDKOptions {
  userId: string;
  apiBaseUrl: string;
  replicaId?: string;
  syncIntervalMs?: number;
  autoStartSync?: boolean;
}

export class TaskCRDTSDK {
  private storage: IndexedDBStorage;
  private syncManager: SyncManager;
  private taskList: TaskList | null = null;
  private listeners: Set<() => void> = new Set();

  constructor(options: TaskCRDTSDKOptions) {
    const replicaId = options.replicaId || generateReplicaId();
    this.storage = new IndexedDBStorage(options.userId, replicaId);
    this.syncManager = new SyncManager({
      apiBaseUrl: options.apiBaseUrl,
      storage: this.storage,
      syncIntervalMs: options.syncIntervalMs
    });

    this.syncManager.addChangeListener(() => {
      this.reloadFromStorage();
      this.notifyListeners();
    });

    if (options.autoStartSync !== false) {
      this.syncManager.startBackgroundSync();
    }
  }

  async initialize(): Promise<void> {
    const stored = await this.storage.loadTaskList();
    if (stored) {
      this.taskList = stored;
    } else {
      this.taskList = createTaskList();
      await this.storage.saveTaskList(this.taskList, false);
    }
    
    try {
      if (this.syncManager.isOnlineStatus()) {
        await this.syncManager.sync();
      }
    } catch {
    }
  }

  private async reloadFromStorage(): Promise<void> {
    const stored = await this.storage.loadTaskList();
    if (stored) {
      this.taskList = stored;
    }
  }

  private ensureTaskList(): TaskList {
    if (!this.taskList) {
      this.taskList = createTaskList();
    }
    return this.taskList;
  }

  private async persist(): Promise<void> {
    if (this.taskList) {
      await this.storage.saveTaskList(this.taskList, true);
      this.notifyListeners();
    }
  }

  getTasks(): Task[] {
    const list = this.ensureTaskList();
    const tasks: Task[] = [];
    
    for (const [serialized, _] of Object.entries(list.tasks.elements || {})) {
      try {
        const task = JSON.parse(serialized) as Task;
        tasks.push(task);
      } catch {
      }
    }
    
    return tasks.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  getTask(taskId: string): Task | null {
    const list = this.ensureTaskList();
    
    for (const [serialized, _] of Object.entries(list.tasks.elements || {})) {
      try {
        const task = JSON.parse(serialized) as Task;
        if (task.id === taskId) {
          return task;
        }
      } catch {
      }
    }
    
    return null;
  }

  async createTask(options: CreateTaskOptions): Promise<Task> {
    const list = this.ensureTaskList();
    const { task, dot } = createTask(options, this.storage.getReplicaId());
    
    const serialized = serializeTask(task);
    if (!list.tasks.elements) {
      list.tasks.elements = {};
    }
    list.tasks.elements[serialized] = [dot];
    
    await this.persist();
    return task;
  }

  async updateTask(taskId: string, options: UpdateTaskOptions): Promise<Task | null> {
    const list = this.ensureTaskList();
    let foundTask: Task | null = null;
    let foundDots: Dot[] | null = null;
    let foundSerialized: string | null = null;

    for (const [serialized, dots] of Object.entries(list.tasks.elements || {})) {
      try {
        const task = JSON.parse(serialized) as Task;
        if (task.id === taskId) {
          foundTask = task;
          foundDots = dots as Dot[];
          foundSerialized = serialized;
          break;
        }
      } catch {
      }
    }

    if (!foundTask || !foundDots || !foundSerialized) {
      return null;
    }

    const updated = updateTask(foundTask, {
      title: options.title,
      description: options.description ?? undefined
    });

    delete list.tasks.elements[foundSerialized];
    
    const newSerialized = serializeTask(updated);
    list.tasks.elements[newSerialized] = foundDots;
    
    await this.persist();
    return updated;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const list = this.ensureTaskList();
    const dot = this.storage.getNextDot();

    for (const [serialized, dots] of Object.entries(list.tasks.elements || {})) {
      try {
        const task = JSON.parse(serialized) as Task;
        if (task.id === taskId) {
          if (!list.tasks.tombstones) {
            list.tasks.tombstones = {};
          }
          if (!list.tasks.tombstones[serialized]) {
            list.tasks.tombstones[serialized] = [];
          }
          for (const d of dots as Dot[]) {
            if (!list.tasks.tombstones[serialized].some(td => 
              td.replica_id === d.replica_id && td.counter === d.counter
            )) {
              list.tasks.tombstones[serialized].push(d);
            }
          }
          if (!list.tasks.tombstones[serialized].some(td => 
            td.replica_id === dot.replica_id && td.counter === dot.counter
          )) {
            list.tasks.tombstones[serialized].push(dot);
          }
          delete list.tasks.elements[serialized];
          
          await this.persist();
          return true;
        }
      } catch {
      }
    }

    return false;
  }

  getTaskItems(taskId: string): TaskItem[] {
    const task = this.getTask(taskId);
    if (!task) return [];

    const items: TaskItem[] = [];
    
    for (const [serialized, _] of Object.entries(task.items.elements || {})) {
      try {
        const item = JSON.parse(serialized) as TaskItem;
        items.push(item);
      } catch {
      }
    }
    
    return items.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async addTaskItem(taskId: string, options: TaskItemOptions): Promise<TaskItem | null> {
    const list = this.ensureTaskList();
    const dot = this.storage.getNextDot();
    const item = createTaskItem(options);

    for (const [serialized, dots] of Object.entries(list.tasks.elements || {})) {
      try {
        const task = JSON.parse(serialized) as Task;
        if (task.id === taskId) {
          if (!task.items.elements) {
            task.items.elements = {};
          }
          const itemSerialized = serializeTaskItem(item);
          if (!task.items.elements[itemSerialized]) {
            task.items.elements[itemSerialized] = [];
          }
          task.items.elements[itemSerialized].push(dot);
          task.updated_at = new Date().toISOString();

          const newTaskSerialized = serializeTask(task);
          delete list.tasks.elements[serialized];
          list.tasks.elements[newTaskSerialized] = dots as Dot[];
          
          await this.persist();
          return item;
        }
      } catch {
      }
    }

    return null;
  }

  async updateTaskItem(taskId: string, itemId: string, updates: { content?: string; completed?: boolean }): Promise<TaskItem | null> {
    const list = this.ensureTaskList();

    for (const [serialized, dots] of Object.entries(list.tasks.elements || {})) {
      try {
        const task = JSON.parse(serialized) as Task;
        if (task.id === taskId) {
          let foundItem: TaskItem | null = null;
          let foundItemSerialized: string | null = null;

          for (const [itemSer, itemDots] of Object.entries(task.items.elements || {})) {
            try {
              const item = JSON.parse(itemSer) as TaskItem;
              if (item.id === itemId) {
                foundItem = item;
                foundItemSerialized = itemSer;
                break;
              }
            } catch {
            }
          }

          if (!foundItem || !foundItemSerialized) {
            return null;
          }

          const updated = updateTaskItem(foundItem, updates);
          delete task.items.elements[foundItemSerialized];
          
          const newItemSerialized = serializeTaskItem(updated);
          task.items.elements[newItemSerialized] = task.items.elements[foundItemSerialized] || [];
          task.updated_at = new Date().toISOString();

          const newTaskSerialized = serializeTask(task);
          delete list.tasks.elements[serialized];
          list.tasks.elements[newTaskSerialized] = dots as Dot[];
          
          await this.persist();
          return updated;
        }
      } catch {
      }
    }

    return null;
  }

  async removeTaskItem(taskId: string, itemId: string): Promise<boolean> {
    const list = this.ensureTaskList();
    const dot = this.storage.getNextDot();

    for (const [serialized, dots] of Object.entries(list.tasks.elements || {})) {
      try {
        const task = JSON.parse(serialized) as Task;
        if (task.id === taskId) {
          for (const [itemSer, itemDots] of Object.entries(task.items.elements || {})) {
            try {
              const item = JSON.parse(itemSer) as TaskItem;
              if (item.id === itemId) {
                if (!task.items.tombstones) {
                  task.items.tombstones = {};
                }
                if (!task.items.tombstones[itemSer]) {
                  task.items.tombstones[itemSer] = [];
                }
                for (const d of itemDots as Dot[]) {
                  if (!task.items.tombstones[itemSer].some(td => 
                    td.replica_id === d.replica_id && td.counter === d.counter
                  )) {
                    task.items.tombstones[itemSer].push(d);
                  }
                }
                if (!task.items.tombstones[itemSer].some(td => 
                  td.replica_id === dot.replica_id && td.counter === dot.counter
                )) {
                  task.items.tombstones[itemSer].push(dot);
                }
                delete task.items.elements[itemSer];
                task.updated_at = new Date().toISOString();

                const newTaskSerialized = serializeTask(task);
                delete list.tasks.elements[serialized];
                list.tasks.elements[newTaskSerialized] = dots as Dot[];
                
                await this.persist();
                return true;
              }
            } catch {
            }
          }
        }
      } catch {
      }
    }

    return false;
  }

  async sync(): Promise<void> {
    await this.syncManager.sync();
  }

  isOnline(): boolean {
    return this.syncManager.isOnlineStatus();
  }

  startBackgroundSync(): void {
    this.syncManager.startBackgroundSync();
  }

  stopBackgroundSync(): void {
    this.syncManager.stopBackgroundSync();
  }

  addChangeListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getLastSyncAt(): string | null {
    return this.taskList?.last_sync_at || null;
  }

  getReplicaId(): string {
    return this.storage.getReplicaId();
  }

  getUserId(): string {
    return this.storage.getUserId();
  }
}

export default TaskCRDTSDK;
