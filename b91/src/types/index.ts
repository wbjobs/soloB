export interface Participant {
  id: string;
  stream?: MediaStream;
  videoEnabled: boolean;
  audioEnabled: boolean;
}

export interface RoomInfo {
  id: string;
  name: string;
  hasVoiceprintLock: boolean;
}

export interface BackgroundOption {
  id: string;
  name: string;
  type: 'blur' | 'color' | 'image';
  value: string;
  thumbnail?: string;
}

export interface RecordingState {
  isRecording: boolean;
  startTime: number | null;
  duration: number;
}
