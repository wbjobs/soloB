import { RecordingSession, Subtitle } from '../types';

const API_BASE = '/api';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  return data.data as T;
}

export const api = {
  async getSessions(): Promise<RecordingSession[]> {
    return request<{ success: boolean; data: RecordingSession[] }>('/sessions').then(
      (res) => res
    );
  },

  async getSession(id: string): Promise<RecordingSession> {
    return request<{ success: boolean; data: RecordingSession }>(`/sessions/${id}`).then(
      (res) => res
    );
  },

  async getSubtitles(sessionId: string): Promise<Subtitle[]> {
    return request<{ success: boolean; data: Subtitle[] }>(`/sessions/${sessionId}/subtitles`).then(
      (res) => res
    );
  },

  async deleteSession(id: string): Promise<void> {
    await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' });
  },

  async retryProcessing(id: string): Promise<void> {
    await fetch(`${API_BASE}/sessions/${id}/retry`, { method: 'POST' });
  },

  getVideoUrl(sessionId: string): string {
    return `${API_BASE}/sessions/${sessionId}/video`;
  },
};
