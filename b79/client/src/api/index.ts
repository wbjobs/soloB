import axios from 'axios'
import type { DataSourceType, IPerformancePrediction } from '../types'

const api = axios.create({
  baseURL: '/api',
  timeout: 300000
})

export const dataSourceApi = {
  getAll: () => api.get('/data-sources'),
  getById: (id: string) => api.get(`/data-sources/${id}`),
  create: (data: any) => api.post('/data-sources', data),
  update: (id: string, data: any) => api.put(`/data-sources/${id}`, data),
  delete: (id: string) => api.delete(`/data-sources/${id}`),
  generateCode: (data: any) => api.post('/data-sources/generate-code', data),
  testConnection: (id: string) => api.post(`/data-sources/${id}/test-connection`),
  createTestContainer: (type: DataSourceType) => api.post('/data-sources/test-container', { type }),
  stopTestContainer: (containerId: string) => api.delete(`/data-sources/test-container/${containerId}`),
  exportNpm: (id: string, version: string) => api.post(`/data-sources/${id}/export-npm`, 
    { version },
    { responseType: 'blob' }
  ),
  predictPerformance: (type: DataSourceType, config: any, testDuration?: number) => 
    api.post<IPerformancePrediction>('/data-sources/predict-performance', { 
      type, 
      config, 
      testDuration 
    }),
  exportPerformanceReport: (id: string, testDuration?: number) => 
    api.post(`/data-sources/${id}/performance-report`, 
      { testDuration },
      { responseType: 'blob' }
    )
}

export default api
