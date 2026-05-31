export interface HealthResponse {
  status: string;
  version: string;
  document_count: number;
  embedding_model: string;
  pdfplumber_available: boolean;
  total_documents: number;
}

export interface DocumentInfo {
  document_id: string;
  filename: string;
  total_chunks: number;
  total_pages: number | null;
  total_tables: number | null;
  uploaded_at: string;
  file_size_kb: number | null;
}

export interface DocumentListResponse {
  documents: DocumentInfo[];
  total: number;
}

export interface RetrievedDocument {
  content: string;
  source: string;
  chunk_index: number;
  score: number | null;
  is_table_chunk: boolean;
  document_id: string | null;
}

export interface QueryRequest {
  question: string;
  top_k?: number;
  document_ids?: string[];
}

export interface QueryResponse {
  answer: string;
  retrieved_documents: RetrievedDocument[];
  selected_document_ids: string[] | null;
}

export interface UploadResponse {
  success: boolean;
  message: string;
  filename: string | null;
  total_chunks: number;
  document_id: string | null;
  total_pages: number | null;
  total_tables: number | null;
  table_chunks: number | null;
  extractor: string | null;
}

export interface DeleteDocumentResponse {
  success: boolean;
  message: string;
  deleted_chunks: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: RetrievedDocument[];
  selected_document_ids?: string[] | null;
  timestamp: Date;
}

export interface UploadState {
  file: File | null;
  uploading: boolean;
  progress: number;
  error: string | null;
  success: boolean;
}
