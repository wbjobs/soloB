import axios from 'axios';
import { UploadResponse, AlignmentTask } from './types';

const api = axios.create({
  baseURL: '/api',
});

export const uploadFiles = async (file1: File, file2: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file1', file1);
  formData.append('file2', file2);

  const response = await api.post<UploadResponse>('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

export const getTasks = async (): Promise<AlignmentTask[]> => {
  const response = await api.get<AlignmentTask[]>('/tasks');
  return response.data;
};

export const getTask = async (taskId: string): Promise<AlignmentTask> => {
  const response = await api.get<AlignmentTask>(`/tasks/${taskId}`);
  return response.data;
};
