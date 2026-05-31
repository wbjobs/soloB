export interface Dot {
  replica_id: string;
  counter: number;
}

export interface TaskItem {
  id: string;
  content: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ORSetElements<T> {
  [key: string]: Dot[];
}

export interface ORSet<T> {
  elements: Record<string, Dot[]>;
  tombstones: Record<string, Dot[]>;
  getKey: (item: T) => string;
  merge: (other: any) => void;
  add: (value: T, dot: Dot) => void;
  remove: (value: T, dot: Dot) => void;
  contains: (value: T) => boolean;
  iter: () => T[];
  len: () => number;
  isEmpty: () => boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  items: ORSet<TaskItem>;
  created_at: string;
  updated_at: string;
}

export interface TaskList {
  tasks: ORSet<Task>;
  last_sync_at: string | null;
}

export interface CreateTaskOptions {
  title: string;
  description?: string;
}

export interface TaskItemOptions {
  content: string;
  completed?: boolean;
}

export interface UpdateTaskOptions {
  title?: string;
  description?: string;
}

export interface SyncResponse {
  success: boolean;
  task_list: TaskList;
  message?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
