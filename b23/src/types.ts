export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface NoteHistory {
  id: string;
  note_id: string;
  title: string;
  content: string;
  version_at: string;
  version_number: number;
}