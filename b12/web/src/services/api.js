import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000
})

export const healthApi = {
  check: () => api.get('/health')
}

export const jobsApi = {
  list: () => api.get('/jobs'),
  get: (id) => api.get(`/jobs/${id}`),
  create: (data) => api.post('/jobs', data),
  update: (id, data) => api.put(`/jobs/${id}`, data),
  delete: (id) => api.delete(`/jobs/${id}`),
  trigger: (id) => api.post(`/jobs/${id}/trigger`),
  pause: (id) => api.post(`/jobs/${id}/pause`),
  resume: (id) => api.post(`/jobs/${id}/resume`),
  executions: (id) => api.get(`/jobs/${id}/executions`)
}

export const pipelinesApi = {
  list: () => api.get('/pipelines'),
  get: (id) => api.get(`/pipelines/${id}`),
  create: (data) => api.post('/pipelines', data),
  delete: (id) => api.delete(`/pipelines/${id}`),
  start: (id) => api.post(`/pipelines/${id}/start`),
  stop: (id) => api.post(`/pipelines/${id}/stop`)
}

export const executorsApi = {
  list: () => api.get('/executors')
}

export default api
