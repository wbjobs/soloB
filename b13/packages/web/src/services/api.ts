import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const api = {
  auth: {
    login: (email: string, password: string) =>
      apiClient.post('/auth/login', { email, password }),
    register: (data: { email: string; password: string; username: string; organizationName: string }) =>
      apiClient.post('/auth/register', data),
    me: () => apiClient.get('/auth/me'),
  },
  users: {
    list: () => apiClient.get('/users'),
    create: (data: any) => apiClient.post('/users', data),
    update: (id: string, data: any) => apiClient.put(`/users/${id}`, data),
    delete: (id: string) => apiClient.delete(`/users/${id}`),
  },
  roles: {
    list: () => apiClient.get('/roles'),
    create: (data: any) => apiClient.post('/roles', data),
    update: (id: string, data: any) => apiClient.put(`/roles/${id}`, data),
    delete: (id: string) => apiClient.delete(`/roles/${id}`),
  },
  applications: {
    list: () => apiClient.get('/applications'),
    get: (id: string) => apiClient.get(`/applications/${id}`),
    create: (data: any) => apiClient.post('/applications', data),
    update: (id: string, data: any) => apiClient.put(`/applications/${id}`, data),
    delete: (id: string) => apiClient.delete(`/applications/${id}`),
    createVersion: (id: string, data: any) =>
      apiClient.post(`/applications/${id}/versions`, data),
    getVersions: (id: string) => apiClient.get(`/applications/${id}/versions`),
  },
  pages: {
    list: (appId: string) => apiClient.get(`/applications/${appId}/pages`),
    get: (appId: string, id: string) => apiClient.get(`/applications/${appId}/pages/${id}`),
    create: (appId: string, data: any) => apiClient.post(`/applications/${appId}/pages`, data),
    update: (appId: string, id: string, data: any) =>
      apiClient.put(`/applications/${appId}/pages/${id}`, data),
    delete: (appId: string, id: string) =>
      apiClient.delete(`/applications/${appId}/pages/${id}`),
  },
  dataModels: {
    list: (appId: string) => apiClient.get(`/applications/${appId}/data-models`),
    get: (appId: string, id: string) => apiClient.get(`/applications/${appId}/data-models/${id}`),
    create: (appId: string, data: any) => apiClient.post(`/applications/${appId}/data-models`, data),
    update: (appId: string, id: string, data: any) =>
      apiClient.put(`/applications/${appId}/data-models/${id}`, data),
    delete: (appId: string, id: string) =>
      apiClient.delete(`/applications/${appId}/data-models/${id}`),
  },
  workflows: {
    list: (appId: string) => apiClient.get(`/applications/${appId}/workflows`),
    get: (appId: string, id: string) => apiClient.get(`/applications/${appId}/workflows/${id}`),
    create: (appId: string, data: any) => apiClient.post(`/applications/${appId}/workflows`, data),
    update: (appId: string, id: string, data: any) =>
      apiClient.put(`/applications/${appId}/workflows/${id}`, data),
    delete: (appId: string, id: string) =>
      apiClient.delete(`/applications/${appId}/workflows/${id}`),
    startInstance: (appId: string, id: string, variables: any = {}) =>
      apiClient.post(`/applications/${appId}/workflows/${id}/instances`, { variables }),
    getInstances: (appId: string, id: string) =>
      apiClient.get(`/applications/${appId}/workflows/${id}/instances`),
  },
  tasks: {
    my: () => apiClient.get('/workflow-tasks/my'),
    complete: (id: string, data: any) =>
      apiClient.post(`/workflow-tasks/${id}/complete`, { data }),
  },
  generator: {
    preview: (appId: string) => apiClient.get(`/applications/${appId}/generate`),
    download: (appId: string) =>
      apiClient.post(`/applications/${appId}/generate/zip`, null, {
        responseType: 'blob',
      }),
  },
  environments: {
    list: (appId: string) => apiClient.get(`/applications/${appId}/environments`),
  },
  deployments: {
    list: (envId: string) => apiClient.get(`/environments/${envId}/deployments`),
    deploy: (envId: string, versionId: string) =>
      apiClient.post(`/environments/${envId}/deployments`, { versionId }),
    rollback: (deploymentId: string) =>
      apiClient.post(`/environments/_/deployments/${deploymentId}/rollback`),
  },
  customComponents: {
    list: (filters?: { category?: string; search?: string }) =>
      apiClient.get('/custom-components', { params: filters }),
    get: (id: string) => apiClient.get(`/custom-components/${id}`),
    create: (data: any) => apiClient.post('/custom-components', data),
    update: (id: string, data: any) => apiClient.put(`/custom-components/${id}`, data),
    delete: (id: string) => apiClient.delete(`/custom-components/${id}`),
    listVersions: (id: string) => apiClient.get(`/custom-components/${id}/versions`),
    createVersion: (id: string, data: any) =>
      apiClient.post(`/custom-components/${id}/versions`, data),
    getLatestVersion: (id: string) => apiClient.get(`/custom-components/${id}/versions/latest`),
    download: (id: string) => apiClient.post(`/custom-components/${id}/download`),
  },
  dataSources: {
    list: (applicationId?: string) =>
      apiClient.get('/data-sources', { params: { applicationId } }),
    get: (id: string) => apiClient.get(`/data-sources/${id}`),
    create: (data: any) => apiClient.post('/data-sources', data),
    update: (id: string, data: any) => apiClient.put(`/data-sources/${id}`, data),
    delete: (id: string) => apiClient.delete(`/data-sources/${id}`),
    testConnection: (id: string) => apiClient.post(`/data-sources/${id}/test`),
    listTables: (id: string) => apiClient.get(`/data-sources/${id}/tables`),
    getTypeMappings: () => apiClient.get('/data-sources/type-mappings'),
  },
  collaboration: {
    getSession: (resourceId: string, resourceType: string) =>
      apiClient.get('/collaboration/session', { params: { resourceId, resourceType } }),
    getActiveSessions: () => apiClient.get('/collaboration/sessions'),
    getSessionHistory: (sessionId: string) =>
      apiClient.get(`/collaboration/session/${sessionId}/history`),
    getParticipantCount: (sessionId: string) =>
      apiClient.get(`/collaboration/session/${sessionId}/participants`),
    endSession: (sessionId: string) => apiClient.delete(`/collaboration/session/${sessionId}`),
  },
  ai: {
    listPrompts: (category?: string) =>
      apiClient.get('/ai/prompts', { params: { category } }),
    createConversation: (data: any) => apiClient.post('/ai/conversations', data),
    listConversations: (applicationId?: string) =>
      apiClient.get('/ai/conversations', { params: { applicationId } }),
    getConversation: (id: string) => apiClient.get(`/ai/conversations/${id}`),
    deleteConversation: (id: string) => apiClient.delete(`/ai/conversations/${id}`),
    sendMessage: (id: string, data: any) =>
      apiClient.post(`/ai/conversations/${id}/messages`, data),
    generatePage: (data: any) => apiClient.post('/ai/generate/page', data),
    suggestComponents: (data: any) => apiClient.post('/ai/suggest/components', data),
    generateDataModel: (data: any) => apiClient.post('/ai/generate/data-model', data),
    generateWorkflow: (data: any) => apiClient.post('/ai/generate/workflow', data),
    rateContent: (id: string, data: any) =>
      apiClient.put(`/ai/generated/${id}/rate`, data),
    listGenerated: (filters?: { applicationId?: string; contentType?: string }) =>
      apiClient.get('/ai/generated', { params: filters }),
  },
};

export default apiClient;
