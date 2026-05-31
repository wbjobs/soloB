const API_BASE = '/api';

const request = async (url, options = {}) => {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Network error' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
};

export const getTasks = () => request('/tasks');

export const createTask = (task) => 
  request('/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  });

export const updateTask = (id, updates) =>
  request(`/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });

export const deleteTask = (id) =>
  request(`/tasks/${id}`, {
    method: 'DELETE',
  });

export const triggerTask = (id) =>
  request(`/tasks/${id}/trigger`, {
    method: 'POST',
  });

export const stopTask = (id) =>
  request(`/tasks/${id}/stop`, {
    method: 'POST',
  });

export const getTaskExecutions = (id, page = 1, pageSize = 20) =>
  request(`/tasks/${id}/executions?page=${page}&pageSize=${pageSize}`);

export const getTaskStats = (id) =>
  request(`/tasks/${id}/executions/stats`);

export const getDependencyGraph = () =>
  request('/dependencies/graph');

export const getAllDependencies = () =>
  request('/dependencies');

export const createDependency = (upstream_task_id, downstream_task_id) =>
  request('/dependencies', {
    method: 'POST',
    body: JSON.stringify({ upstream_task_id, downstream_task_id }),
  });

export const deleteDependency = (id) =>
  request(`/dependencies/${id}`, {
    method: 'DELETE',
  });

export const deleteDependencyByTasks = (upstream_task_id, downstream_task_id) =>
  request(`/dependencies/by-tasks?upstream_task_id=${upstream_task_id}&downstream_task_id=${downstream_task_id}`, {
    method: 'DELETE',
  });

export const getUpstreamTasks = (taskId) =>
  request(`/dependencies/upstream/${taskId}`);

export const getDownstreamTasks = (taskId) =>
  request(`/dependencies/downstream/${taskId}`);
