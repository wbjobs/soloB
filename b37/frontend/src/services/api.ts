import {
  DeleteDocumentResponse,
  DocumentListResponse,
  HealthResponse,
  QueryRequest,
  QueryResponse,
  UploadResponse
} from '../types';

const API_BASE_URL = '/api';

export const apiService = {
  async getHealth(): Promise<HealthResponse> {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }
    return response.json();
  },

  async getDocuments(): Promise<DocumentListResponse> {
    const response = await fetch(`${API_BASE_URL}/documents`);
    if (!response.ok) {
      throw new Error(`Failed to fetch documents: ${response.statusText}`);
    }
    return response.json();
  },

  async deleteDocument(documentId: string): Promise<DeleteDocumentResponse> {
    const response = await fetch(`${API_BASE_URL}/documents/${documentId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Failed to delete document: ${response.statusText}`);
    }

    return response.json();
  },

  async uploadPDF(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Upload failed: ${response.statusText}`);
    }

    return response.json();
  },

  async query(question: string, topK?: number, documentIds?: string[]): Promise<QueryResponse> {
    const request: QueryRequest = {
      question,
      ...(topK !== undefined && { top_k: topK }),
      ...(documentIds !== undefined && documentIds.length > 0 && { document_ids: documentIds }),
    };

    const response = await fetch(`${API_BASE_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Query failed: ${response.statusText}`);
    }

    return response.json();
  },

  async queryStream(
    question: string,
    onChunk: (chunk: string) => void,
    topK?: number,
    documentIds?: string[]
  ): Promise<void> {
    const request: QueryRequest = {
      question,
      ...(topK !== undefined && { top_k: topK }),
      ...(documentIds !== undefined && documentIds.length > 0 && { document_ids: documentIds }),
    };

    const response = await fetch(`${API_BASE_URL}/query/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Query failed: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      onChunk(chunk);
    }
  },

  async clearDocuments(): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/documents`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to clear documents: ${response.statusText}`);
    }

    return response.json();
  },
};
