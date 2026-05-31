import { create } from 'zustand';
import axios from 'axios';

const useStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  scores: [],
  currentScore: null,
  currentPage: 1,
  annotations: [],
  versions: [],
  onlineUsers: [],
  tool: 'select',
  color: '#ff0000',
  isLoading: false,

  setToken: (token) => {
    localStorage.setItem('token', token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    set({ token });
  },

  logout: () => {
    localStorage.removeItem('token');
    delete axios.defaults.headers.common['Authorization'];
    set({
      user: null,
      token: null,
      scores: [],
      currentScore: null,
      annotations: [],
      onlineUsers: []
    });
  },

  setUser: (user) => set({ user }),
  setScores: (scores) => set({ scores }),
  setCurrentScore: (score) => set({ currentScore: score }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setAnnotations: (annotations) => set({ annotations }),
  setVersions: (versions) => set({ versions }),
  setOnlineUsers: (users) => set({ onlineUsers: users }),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setLoading: (isLoading) => set({ isLoading }),

  addAnnotation: (annotation) => {
    set((state) => ({
      annotations: [...state.annotations, annotation]
    }));
  },

  updateAnnotation: (id, data) => {
    set((state) => ({
      annotations: state.annotations.map(a =>
        a._id === id ? { ...a, data } : a
      )
    }));
  },

  deleteAnnotation: (id) => {
    set((state) => ({
      annotations: state.annotations.filter(a => a._id !== id)
    }));
  },

  fetchMe: async () => {
    try {
      const res = await axios.get('/api/auth/me');
      set({ user: res.data.user });
    } catch (error) {
      get().logout();
    }
  },

  fetchScores: async () => {
    set({ isLoading: true });
    try {
      const res = await axios.get('/api/scores');
      set({ scores: res.data.scores });
    } catch (error) {
      console.error('获取乐谱列表失败:', error);
    }
    set({ isLoading: false });
  },

  fetchScore: async (id) => {
    set({ isLoading: true });
    try {
      const res = await axios.get(`/api/scores/${id}`);
      set({ currentScore: res.data.score });
    } catch (error) {
      console.error('获取乐谱详情失败:', error);
    }
    set({ isLoading: false });
  },

  fetchAnnotations: async (scoreId, page) => {
    try {
      const res = await axios.get(`/api/scores/${scoreId}/annotations?page=${page}`);
      set({ annotations: res.data.annotations });
    } catch (error) {
      console.error('获取批注失败:', error);
    }
  },

  fetchVersions: async (scoreId) => {
    try {
      const res = await axios.get(`/api/scores/${scoreId}/versions`);
      set({ versions: res.data.versions });
    } catch (error) {
      console.error('获取版本列表失败:', error);
    }
  }
}));

const token = useStore.getState().token;
if (token) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export default useStore;
