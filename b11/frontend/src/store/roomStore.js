import { create } from 'zustand';

export const useRoomStore = create((set, get) => ({
  currentRoom: null,
  users: [],
  structure: null,
  cursors: {},
  openFiles: [],
  activeFile: null,
  fileContents: {},
  myRole: null,
  self: null,

  comments: [],
  commentsLoading: false,
  selectedComment: null,

  versions: [],
  versionsLoading: false,
  selectedVersion: null,
  compareMode: false,
  compareFrom: null,
  compareTo: null,
  diffData: null,

  aiEnabled: false,
  aiLoading: false,
  aiSuggestions: [],
  aiResult: null,
  aiError: null,

  setRoomState: (data) => set({
    users: data.users || [],
    structure: data.structure,
    cursors: {},
    self: data.self,
    openFiles: [],
    activeFile: null,
    fileContents: {}
  }),

  setCurrentRoom: (room) => set({
    currentRoom: room,
    myRole: room.role
  }),

  addUser: (user) => set((state) => ({
    users: [...state.users, user]
  })),

  removeUser: (userId) => set((state) => ({
    users: state.users.filter(u => u.id !== userId),
    cursors: Object.fromEntries(
      Object.entries(state.cursors).filter(([key]) => key !== userId)
    )
  })),

  updateCursor: (userId, cursor) => set((state) => ({
    cursors: {
      ...state.cursors,
      [userId]: cursor
    }
  })),

  updateStructure: (structure) => set({ structure }),

  openFile: (fileId, content, language) => set((state) => {
    const newOpenFiles = state.openFiles.includes(fileId)
      ? state.openFiles
      : [...state.openFiles, fileId];

    return {
      openFiles: newOpenFiles,
      activeFile: fileId,
      fileContents: {
        ...state.fileContents,
        [fileId]: { content, language }
      }
    };
  }),

  closeFile: (fileId) => set((state) => {
    const index = state.openFiles.indexOf(fileId);
    const newOpenFiles = state.openFiles.filter(f => f !== fileId);
    const newFileContents = { ...state.fileContents };
    delete newFileContents[fileId];

    let newActiveFile = state.activeFile;
    if (state.activeFile === fileId) {
      newActiveFile = newOpenFiles.length > 0
        ? newOpenFiles[Math.max(0, index - 1)]
        : null;
    }

    return {
      openFiles: newOpenFiles,
      activeFile: newActiveFile,
      fileContents: newFileContents,
      comments: [],
      selectedComment: null
    };
  }),

  setActiveFile: (fileId) => set({ activeFile: fileId }),

  updateFileContent: (fileId, content) => set((state) => ({
    fileContents: {
      ...state.fileContents,
      [fileId]: {
        ...state.fileContents[fileId],
        content
      }
    }
  })),

  canEdit: () => {
    const { myRole } = get();
    return myRole === 'owner' || myRole === 'editor';
  },

  clear: () => set({
    currentRoom: null,
    users: [],
    structure: null,
    cursors: {},
    openFiles: [],
    activeFile: null,
    fileContents: {},
    myRole: null,
    self: null,
    comments: [],
    commentsLoading: false,
    selectedComment: null,
    versions: [],
    versionsLoading: false,
    selectedVersion: null,
    compareMode: false,
    compareFrom: null,
    compareTo: null,
    diffData: null,
    aiEnabled: false,
    aiLoading: false,
    aiSuggestions: [],
    aiResult: null,
    aiError: null
  }),

  setComments: (comments) => set({ comments, commentsLoading: false }),

  addComment: (comment) => set((state) => ({
    comments: [...state.comments, comment]
  })),

  updateComment: (commentId, updates) => set((state) => ({
    comments: state.comments.map(c =>
      c._id === commentId || c.id === commentId ? { ...c, ...updates } : c
    ),
    selectedComment: state.selectedComment?._id === commentId || state.selectedComment?.id === commentId
      ? { ...state.selectedComment, ...updates }
      : state.selectedComment
  })),

  removeComment: (commentId) => set((state) => ({
    comments: state.comments.filter(c => c._id !== commentId && c.id !== commentId),
    selectedComment: state.selectedComment?._id === commentId || state.selectedComment?.id === commentId
      ? null
      : state.selectedComment
  })),

  setSelectedComment: (comment) => set({ selectedComment: comment }),

  setVersions: (versions) => set({ versions, versionsLoading: false }),

  setVersionsLoading: (loading) => set({ versionsLoading: loading }),

  setSelectedVersion: (version) => set({ selectedVersion: version }),

  setCompareMode: (enabled) => set({
    compareMode: enabled,
    compareFrom: enabled ? get().compareFrom : null,
    compareTo: enabled ? get().compareTo : null
  }),

  setCompareFrom: (version) => set({ compareFrom: version }),

  setCompareTo: (version) => set({ compareTo: version }),

  setDiffData: (diffData) => set({ diffData }),

  setAIEnabled: (enabled) => set({ aiEnabled: enabled }),

  setAILoading: (loading) => set({ aiLoading: loading }),

  setAISuggestions: (suggestions) => set({ aiSuggestions: suggestions }),

  setAIResult: (result) => set({ aiResult: result }),

  clearAIResult: () => set({ aiResult: null, aiError: null }),

  setAIError: (error) => set({ aiError: error })
}));
