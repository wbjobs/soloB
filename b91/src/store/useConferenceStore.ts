import { create } from 'zustand';
import { Participant, RoomInfo, BackgroundOption, RecordingState } from '../types';

interface ConferenceState {
  userId: string;
  roomId: string | null;
  roomInfo: RoomInfo | null;
  participants: Map<string, Participant>;
  localStream: MediaStream | null;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  currentBackground: BackgroundOption | null;
  backgroundEnabled: boolean;
  isVoiceprintVerified: boolean;
  recording: RecordingState;
  sidebarOpen: boolean;
  sidebarTab: 'background' | 'voiceprint' | 'participants' | 'recording';
  socketConnected: boolean;
  
  setUserId: (id: string) => void;
  setRoomId: (id: string | null) => void;
  setRoomInfo: (info: RoomInfo | null) => void;
  addParticipant: (participant: Participant) => void;
  removeParticipant: (id: string) => void;
  updateParticipant: (id: string, updates: Partial<Participant>) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  toggleVideo: () => void;
  toggleAudio: () => void;
  setCurrentBackground: (bg: BackgroundOption | null) => void;
  setBackgroundEnabled: (enabled: boolean) => void;
  setVoiceprintVerified: (verified: boolean) => void;
  setSocketConnected: (connected: boolean) => void;
  startRecording: () => void;
  stopRecording: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: 'background' | 'voiceprint' | 'participants' | 'recording') => void;
  reset: () => void;
}

export const useConferenceStore = create<ConferenceState>((set, get) => ({
  userId: '',
  roomId: null,
  roomInfo: null,
  participants: new Map(),
  localStream: null,
  isVideoEnabled: true,
  isAudioEnabled: true,
  currentBackground: null,
  backgroundEnabled: false,
  isVoiceprintVerified: false,
  recording: {
    isRecording: false,
    startTime: null,
    duration: 0
  },
  sidebarOpen: true,
  sidebarTab: 'background',
  socketConnected: false,

  setUserId: (id) => set({ userId: id }),
  setRoomId: (id) => set({ roomId: id }),
  setRoomInfo: (info) => set({ roomInfo: info }),
  
  addParticipant: (participant) => {
    const { participants } = get();
    const newParticipants = new Map(participants);
    newParticipants.set(participant.id, participant);
    set({ participants: newParticipants });
  },
  
  removeParticipant: (id) => {
    const { participants } = get();
    const newParticipants = new Map(participants);
    newParticipants.delete(id);
    set({ participants: newParticipants });
  },
  
  updateParticipant: (id, updates) => {
    const { participants } = get();
    const participant = participants.get(id);
    if (participant) {
      const newParticipants = new Map(participants);
      newParticipants.set(id, { ...participant, ...updates });
      set({ participants: newParticipants });
    }
  },
  
  setLocalStream: (stream) => set({ localStream: stream }),
  
  toggleVideo: () => {
    const { isVideoEnabled, localStream } = get();
    localStream?.getVideoTracks().forEach(track => {
      track.enabled = !isVideoEnabled;
    });
    set({ isVideoEnabled: !isVideoEnabled });
  },
  
  toggleAudio: () => {
    const { isAudioEnabled, localStream } = get();
    localStream?.getAudioTracks().forEach(track => {
      track.enabled = !isAudioEnabled;
    });
    set({ isAudioEnabled: !isAudioEnabled });
  },
  
  setCurrentBackground: (bg) => set({ currentBackground: bg }),
  setBackgroundEnabled: (enabled) => set({ backgroundEnabled: enabled }),
  setVoiceprintVerified: (verified) => {
    console.log('[Voiceprint] Setting verified state to:', verified);
    set({ isVoiceprintVerified: verified });
  },
  setSocketConnected: (connected) => set({ socketConnected: connected }),
  
  startRecording: () => set({
    recording: {
      isRecording: true,
      startTime: Date.now(),
      duration: 0
    }
  }),
  
  stopRecording: () => set({
    recording: {
      isRecording: false,
      startTime: null,
      duration: 0
    }
  }),
  
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  
  reset: () => set({
    roomId: null,
    roomInfo: null,
    participants: new Map(),
    localStream: null,
    isVideoEnabled: true,
    isAudioEnabled: true,
    currentBackground: null,
    backgroundEnabled: false,
    isVoiceprintVerified: false,
    recording: {
      isRecording: false,
      startTime: null,
      duration: 0
    }
  })
}));
