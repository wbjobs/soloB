import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (username, password) =>
    api.post('/api/auth/login', { username, password }),
  register: (username, password) =>
    api.post('/api/auth/register', { username, password }),
  getMe: () => api.get('/api/auth/me')
};

export const roomAPI = {
  create: (name, password) =>
    api.post('/api/rooms', { name, password }),
  join: (roomId, password) =>
    api.post('/api/rooms/join', { roomId, password }),
  getMyRooms: () => api.get('/api/rooms/my-rooms'),
  getRoom: (roomId) => api.get(`/api/rooms/${roomId}`),
  getStructure: (roomId) => api.get(`/api/rooms/${roomId}/structure`),
  setRole: (roomId, targetUserId, role) =>
    api.post(`/api/rooms/${roomId}/role`, { targetUserId, role })
};

export const codeAPI = {
  execute: (language, code, roomId) =>
    api.post('/api/code/execute', { language, code, roomId })
};

export const commentAPI = {
  getComments: (roomId, fileId, includeResolved = false) =>
    api.get(`/api/reviews/${roomId}/comments`, {
      params: { fileId, includeResolved }
    }),

  createComment: (roomId, data) =>
    api.post(`/api/reviews/${roomId}/comments`, data),

  updateComment: (roomId, commentId, content) =>
    api.put(`/api/reviews/${roomId}/comments/${commentId}`, { content }),

  deleteComment: (roomId, commentId) =>
    api.delete(`/api/reviews/${roomId}/comments/${commentId}`),

  toggleResolved: (roomId, commentId, resolved = true) =>
    api.post(`/api/reviews/${roomId}/comments/${commentId}/resolve`, { resolved }),

  addReply: (roomId, commentId, content) =>
    api.post(`/api/reviews/${roomId}/comments/${commentId}/replies`, { content }),

  updateReply: (roomId, commentId, replyId, content) =>
    api.put(`/api/reviews/${roomId}/comments/${commentId}/replies/${replyId}`, { content }),

  deleteReply: (roomId, commentId, replyId) =>
    api.delete(`/api/reviews/${roomId}/comments/${commentId}/replies/${replyId}`)
};

export const versionAPI = {
  getHistory: (roomId, fileId, limit = 50, offset = 0) =>
    api.get(`/api/versions/${roomId}/versions`, {
      params: { fileId, limit, offset }
    }),

  getVersion: (roomId, commitHash) =>
    api.get(`/api/versions/${roomId}/versions/${commitHash}`),

  compareVersions: (roomId, fileId, fromCommit, toCommit) =>
    api.post(`/api/versions/${roomId}/versions/compare`, {
      fileId,
      fromCommit,
      toCommit
    }),

  rollback: (roomId, fileId, commitHash) =>
    api.post(`/api/versions/${roomId}/versions/${commitHash}/rollback`, {
      fileId
    }),

  saveVersion: (roomId, fileId, message, fileName) =>
    api.post(`/api/versions/${roomId}/versions/save`, {
      fileId,
      message,
      fileName
    })
};

export const aiAPI = {
  getStatus: () => api.get('/api/ai/status'),

  getSuggestions: (roomId, data) =>
    api.post(`/api/ai/${roomId}/suggestions`, data),

  explainCode: (roomId, data) =>
    api.post(`/api/ai/${roomId}/explain`, data),

  detectBugs: (roomId, data) =>
    api.post(`/api/ai/${roomId}/detect-bugs`, data),

  refactor: (roomId, data) =>
    api.post(`/api/ai/${roomId}/refactor`, data)
};

export default api;
