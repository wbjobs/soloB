export interface ProgressUpdate {
  step: number;
  total: number;
  message: string;
}

export interface AlignmentResult {
  aligned_a: string;
  aligned_b: string;
  alignment_string: string;
  score: number;
  progress: ProgressUpdate[];
}

export interface UploadResponse {
  task_id: string;
  result: AlignmentResult;
}

export interface AlignmentTask {
  id: string;
  task_id: string;
  created_at: string;
  sequence_a_length: number;
  sequence_b_length: number;
  final_score: number;
  file_name_a: string;
  file_name_b: string;
  aligned_a: string;
  aligned_b: string;
  alignment_string: string;
}
