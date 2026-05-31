import { v4 as uuidv4 } from 'uuid';
import type { Dot, TaskItem, Task, TaskList, CreateTaskOptions, TaskItemOptions } from './types';

export function createDot(replicaId: string, counter: number): Dot {
  return {
    replica_id: replicaId,
    counter
  };
}

export function dotKey(dot: Dot): string {
  return `${dot.replica_id}:${dot.counter}`;
}

export function dotEquals(a: Dot, b: Dot): boolean {
  return a.replica_id === b.replica_id && a.counter === b.counter;
}

export function dotsEqual(a: Dot[], b: Dot[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map(dotKey));
  return b.every(dot => setA.has(dotKey(dot)));
}

export function taskItemKey(item: TaskItem): string {
  return item.id;
}

export function taskKey(task: Task): string {
  return task.id;
}

export function serializeTaskItem(item: TaskItem): string {
  return JSON.stringify({
    id: item.id,
    content: item.content,
    completed: item.completed,
    created_at: item.created_at,
    updated_at: item.updated_at
  });
}

export function deserializeTaskItem(key: string, data: string): TaskItem {
  return JSON.parse(data) as TaskItem;
}

export function serializeTask(task: Task): string {
  return JSON.stringify({
    id: task.id,
    title: task.title,
    description: task.description,
    items: task.items,
    created_at: task.created_at,
    updated_at: task.updated_at
  });
}

export function deserializeTask(key: string, data: string): Task {
  return JSON.parse(data) as Task;
}

export function createORSet<T>(
  getKey: (item: T) => string,
  serialize: (item: T) => string,
  deserialize: (key: string, data: string) => T
) {
  return {
    elements: {} as Record<string, Dot[]>,
    tombstones: {} as Record<string, Dot[]>,
    getKey,
    _serialize: serialize,
    _deserialize: deserialize,

    add(value: T, dot: Dot): void {
      const key = getKey(value);
      const serialized = serialize(value);
      if (!this.elements[serialized]) {
        this.elements[serialized] = [];
      }
      if (!this.elements[serialized].some(d => dotEquals(d, dot))) {
        this.elements[serialized].push(dot);
      }
    },

    remove(value: T, dot: Dot): void {
      const serialized = serialize(value);
      if (this.elements[serialized]) {
        const dots = [...this.elements[serialized]];
        delete this.elements[serialized];

        if (!this.tombstones[serialized]) {
          this.tombstones[serialized] = [];
        }
        for (const d of dots) {
          if (!this.tombstones[serialized].some(td => dotEquals(td, d))) {
            this.tombstones[serialized].push(d);
          }
        }
        if (!this.tombstones[serialized].some(td => dotEquals(td, dot))) {
          this.tombstones[serialized].push(dot);
        }
      }
    },

    contains(value: T): boolean {
      const serialized = serialize(value);
      return !!this.elements[serialized];
    },

    iter(): T[] {
      return Object.entries(this.elements).map(([serialized, _]) => 
        deserialize(getKey(JSON.parse(serialized) as T), serialized)
      );
    },

    len(): number {
      return Object.keys(this.elements).length;
    },

    isEmpty(): boolean {
      return this.len() === 0;
    },

    merge(other: any): void {
      for (const [serialized, dots] of Object.entries(other.elements || {})) {
        if (!this.elements[serialized]) {
          this.elements[serialized] = [];
        }
        for (const dot of dots as Dot[]) {
          if (!this.elements[serialized].some(d => dotEquals(d, dot))) {
            this.elements[serialized].push(dot);
          }
        }
      }

      for (const [serialized, dots] of Object.entries(other.tombstones || {})) {
        if (!this.tombstones[serialized]) {
          this.tombstones[serialized] = [];
        }
        for (const dot of dots as Dot[]) {
          if (!this.tombstones[serialized].some(d => dotEquals(d, dot))) {
            this.tombstones[serialized].push(dot);
          }
        }
      }

      const elementKeys = Object.keys(this.elements);
      for (const serialized of elementKeys) {
        const tombstoneDots = this.tombstones[serialized];
        const elementDots = this.elements[serialized];
        
        if (tombstoneDots && elementDots) {
          const allCovered = elementDots.every(ed => 
            tombstoneDots.some(td => dotEquals(ed, td))
          );
          if (allCovered) {
            delete this.elements[serialized];
          }
        }
      }
    }
  };
}

export function createTaskItemORSet() {
  return createORSet<TaskItem>(taskItemKey, serializeTaskItem, deserializeTaskItem);
}

export function createTaskORSet() {
  return createORSet<Task>(taskKey, serializeTask, deserializeTask);
}

export function createTask(options: CreateTaskOptions, replicaId: string): { task: Task; dot: Dot } {
  const now = new Date().toISOString();
  const task: Task = {
    id: uuidv4(),
    title: options.title,
    description: options.description || null,
    items: createTaskItemORSet() as any,
    created_at: now,
    updated_at: now
  };
  const dot = createDot(replicaId, 0);
  return { task, dot };
}

export function createTaskItem(options: TaskItemOptions): TaskItem {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    content: options.content,
    completed: options.completed ?? false,
    created_at: now,
    updated_at: now
  };
}

export function updateTaskItem(item: TaskItem, updates: { content?: string; completed?: boolean }): TaskItem {
  return {
    ...item,
    ...(updates.content !== undefined ? { content: updates.content } : {}),
    ...(updates.completed !== undefined ? { completed: updates.completed } : {}),
    updated_at: new Date().toISOString()
  };
}

export function updateTask(task: Task, updates: { title?: string; description?: string | null }): Task {
  return {
    ...task,
    ...(updates.title !== undefined ? { title: updates.title } : {}),
    ...(updates.description !== undefined ? { description: updates.description } : {}),
    updated_at: new Date().toISOString()
  };
}

export function createTaskList(): TaskList {
  return {
    tasks: createTaskORSet() as any,
    last_sync_at: null
  };
}

export function mergeTaskLists(local: TaskList, remote: TaskList): TaskList {
  const result: TaskList = {
    tasks: createTaskORSet() as any,
    last_sync_at: new Date().toISOString()
  };
  
  result.tasks.merge(local.tasks);
  result.tasks.merge(remote.tasks);
  
  return result;
}
