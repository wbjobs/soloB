import { makeAutoObservable, runInAction } from 'mobx';
import { api } from '@/services/api';

class AuthStore {
  token: string | null = null;
  user: any = null;
  loading = false;
  error: string | null = null;

  constructor() {
    makeAutoObservable(this);
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('token');
    }
  }

  get isAuthenticated() {
    return !!this.token;
  }

  get isAdmin() {
    return this.user?.roles?.includes('admin') ?? false;
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', token);
    }
  }

  clearToken() {
    this.token = null;
    this.user = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
    }
  }

  async login(email: string, password: string) {
    this.loading = true;
    this.error = null;
    try {
      const response = await api.auth.login(email, password);
      runInAction(() => {
        this.token = response.data.access_token;
        this.user = response.data.user;
        if (typeof window !== 'undefined') {
          localStorage.setItem('token', response.data.access_token);
        }
      });
      return response.data;
    } catch (err: any) {
      runInAction(() => {
        this.error = err.response?.data?.message || 'Login failed';
      });
      throw err;
    } finally {
      runInAction(() => {
        this.loading = false;
      });
    }
  }

  async register(data: { email: string; password: string; username: string; organizationName: string }) {
    this.loading = true;
    this.error = null;
    try {
      const response = await api.auth.register(data);
      runInAction(() => {
        this.token = response.data.access_token;
        this.user = response.data.user;
        if (typeof window !== 'undefined') {
          localStorage.setItem('token', response.data.access_token);
        }
      });
      return response.data;
    } catch (err: any) {
      runInAction(() => {
        this.error = err.response?.data?.message || 'Registration failed';
      });
      throw err;
    } finally {
      runInAction(() => {
        this.loading = false;
      });
    }
  }

  logout() {
    this.clearToken();
  }
}

export const authStore = new AuthStore();
