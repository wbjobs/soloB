const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

export interface CitationSource {
  ref_id: string;
  document_index: number;
  source_file: string;
  source_path: string;
  page_number?: number;
  content_preview: string;
  full_content: string;
  distance: number;
  similarity: number;
  rerank_score?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  citations?: CitationSource[];
  answerWithCitations?: string;
}

export interface ChatResponse {
  question: string;
  answer: string;
  answer_with_citations: string;
  context: string;
  citations: CitationSource[];
  debug_info?: Record<string, unknown>;
}

export interface StreamEvent {
  type: 'start' | 'content' | 'done';
  content: string;
  citations?: CitationSource[];
  answer_with_citations?: string;
  context?: string;
  debug_info?: Record<string, unknown>;
}

export async function chat(question: string, stream: boolean = false): Promise<ChatResponse | AsyncIterable<StreamEvent>> {
  if (stream) {
    return chatStream(question);
  }

  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question, stream: false }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json() as Promise<ChatResponse>;
}

export async function* chatStream(question: string): AsyncIterable<StreamEvent> {
  const response = await fetch(`${API_BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question, stream: true }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('Failed to get reader from response body');
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as StreamEvent;
        yield event;
      } catch (e) {
        console.error('Failed to parse stream event:', e);
      }
    }
  }
}

export interface CollectionStats {
  collection_name: string;
  document_count: number;
  embedding_model: string;
  llm_model: string;
}

export async function getStats(): Promise<CollectionStats> {
  const response = await fetch(`${API_BASE_URL}/stats`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json() as Promise<CollectionStats>;
}

export async function uploadDocuments(files: File[]): Promise<{ success: boolean; message: string; document_count?: number }> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));

  const response = await fetch(`${API_BASE_URL}/documents/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export async function clearCollection(): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/collection`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}
