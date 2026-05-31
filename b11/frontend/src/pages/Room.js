import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoomStore, useAuthStore } from '../store';
import { roomAPI, codeAPI } from '../services/api';
import { socketService } from '../services/socket';
import FileTree from '../components/FileTree';
import Editor from '../components/Editor';
import UsersPanel from '../components/UsersPanel';
import ExecutionPanel from '../components/ExecutionPanel';
import CommentPanel from '../components/CommentPanel';
import VersionPanel from '../components/VersionPanel';
import AIPanel from '../components/AIPanel';
import {
  ChevronLeft, Users, Terminal, Menu, X, RefreshCw,
  MessageSquare, GitCommit, Sparkles
} from 'lucide-react';

const savedVersions = new Map();
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 1000;

function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUsers, setShowUsers] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [selectedEditorText, setSelectedEditorText] = useState('');

  const socketConnected = useRef(false);
  const reconnectTimeoutRef = useRef(null);
  const wasConnectedRef = useRef(false);
  const lastVersionsRef = useRef({});

  const {
    setRoomState,
    setCurrentRoom,
    addUser,
    removeUser,
    updateCursor,
    updateStructure,
    openFile,
    canEdit,
    clear,
    activeFile,
    fileContents,
    addComment,
    updateComment,
    removeComment
  } = useRoomStore();

  const { user } = useAuthStore();

  const collectLastVersions = useCallback(() => {
    const versions = {};
    Object.keys(fileContents).forEach(fileId => {
      const version = savedVersions.get(fileId);
      if (version) {
        versions[fileId] = version;
      }
    });
    lastVersionsRef.current = versions;
    return versions;
  }, [fileContents]);

  useEffect(() => {
    initRoom();
    return () => {
      cleanup();
    };
  }, [roomId]);

  const initRoom = async () => {
    try {
      setLoading(true);
      const [roomRes, structRes] = await Promise.all([
        roomAPI.getRoom(roomId),
        roomAPI.getStructure(roomId)
      ]);

      setCurrentRoom(roomRes.data);
      setRoomState({
        structure: structRes.data.structure
      });

      setupSocket();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load room');
    } finally {
      setLoading(false);
    }
  };

  const handleReconnect = useCallback(() => {
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      setError('Connection failed. Please refresh the page.');
      return;
    }

    setIsReconnecting(true);
    setReconnectAttempt(prev => prev + 1);

    const versions = collectLastVersions();

    if (socketService.socket) {
      socketService.socket.disconnect();
    }
    socketConnected.current = false;

    reconnectTimeoutRef.current = setTimeout(() => {
      const socket = socketService.connect();
      if (socket) {
        socket.once('connect', () => {
          socketService.emit('join-room', {
            roomId,
            reconnect: true,
            lastVersions: versions
          });
        });
      }
    }, RECONNECT_DELAY * (reconnectAttempt + 1));
  }, [roomId, reconnectAttempt, collectLastVersions]);

  const setupSocket = () => {
    const socket = socketService.connect();
    if (!socket) return;

    socket.on('connect', () => {
      console.log('Socket connected');
      const versions = collectLastVersions();
      socketService.emit('join-room', {
        roomId,
        reconnect: wasConnectedRef.current,
        lastVersions: wasConnectedRef.current ? versions : {}
      });
      wasConnectedRef.current = true;
      setIsReconnecting(false);
      setReconnectAttempt(0);
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      socketConnected.current = false;

      if (reason !== 'io client disconnect' && reason !== 'io server disconnect') {
        handleReconnect();
      }
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log('Socket reconnected after', attemptNumber, 'attempts');
      const versions = collectLastVersions();
      socketService.emit('join-room', {
        roomId,
        reconnect: true,
        lastVersions: versions
      });
      setIsReconnecting(false);
      setReconnectAttempt(0);
    });

    socket.on('connect_error', () => {
      console.log('Connection error');
      if (wasConnectedRef.current) {
        handleReconnect();
      }
    });

    socket.on('room-state', (data) => {
      console.log('Room state received, reconnect:', data.reconnect);
      setRoomState(data);
      socketConnected.current = true;
    });

    socket.on('user-joined', (userData) => {
      addUser(userData);
    });

    socket.on('user-left', ({ userId }) => {
      removeUser(userId);
    });

    socket.on('user-reconnected', ({ userId }) => {
      console.log('User reconnected:', userId);
    });

    socket.on('user-disconnected-temporarily', ({ userId }) => {
      console.log('User temporarily disconnected:', userId);
    });

    socket.on('cursor-update', ({ userId, fileId, position, selection }) => {
      updateCursor(userId, { fileId, position, selection });
    });

    socket.on('file-opened', ({ fileId, content, language, serverState }) => {
      if (serverState) {
        savedVersions.set(fileId, serverState.version);
      }
      openFile(fileId, content, language);
      if (serverState) {
        const fileData = fileContents[fileId];
        if (fileData) {
          fileData.serverState = serverState;
        }
      }
    });

    socket.on('file-operation', ({ structure, action, payload, timestamp }) => {
      updateStructure(structure);
    });

    socket.on('file-op-ack', ({ action, structure }) => {
      updateStructure(structure);
    });

    socket.on('operation-ack', ({ fileId, serverVersion }) => {
      savedVersions.set(fileId, serverVersion);
    });

    socket.on('comment-created', ({ comment }) => {
      addComment(comment);
    });

    socket.on('comment-updated', ({ comment, commentId }) => {
      updateComment(commentId || comment._id || comment.id, comment);
    });

    socket.on('comment-deleted', ({ commentId }) => {
      removeComment(commentId);
    });

    socket.on('comment-resolved', ({ commentId, resolved, comment }) => {
      updateComment(commentId, { resolved, ...comment });
    });

    socket.on('error', (data) => {
      console.error('Socket error:', data);
    });

    socketConnected.current = true;
  };

  const cleanup = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (socketConnected.current) {
      socketService.leaveRoom();
      socketService.disconnect();
      socketConnected.current = false;
    }
    wasConnectedRef.current = false;
    clear();
    savedVersions.clear();
  };

  const handleExecuteCode = async (language, code) => {
    setShowTerminal(true);
    setExecutionResult({ loading: true });

    try {
      const response = await codeAPI.execute(language, code, roomId);
      setExecutionResult({
        ...response.data,
        loading: false
      });
    } catch (err) {
      setExecutionResult({
        loading: false,
        success: false,
        stderr: err.response?.data?.error || 'Execution failed'
      });
    }
  };

  const goBack = () => {
    navigate('/dashboard');
  };

  const handleManualReconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    setReconnectAttempt(0);
    handleReconnect();
  };

  const handleTextSelection = (text) => {
    setSelectedEditorText(text);
  };

  const togglePanel = (panel) => {
    setShowUsers(false);
    setShowComments(false);
    setShowVersions(false);
    setShowAI(false);
    setShowTerminal(false);

    switch (panel) {
      case 'users':
        setShowUsers(true);
        break;
      case 'comments':
        setShowComments(true);
        break;
      case 'versions':
        setShowVersions(true);
        break;
      case 'ai':
        setShowAI(true);
        break;
      case 'terminal':
        setShowTerminal(true);
        break;
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading room...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-screen">
        <h2>Error</h2>
        <p>{error}</p>
        <div className="error-actions">
          <button onClick={handleManualReconnect} className="btn-secondary">
            <RefreshCw size={16} />
            Retry
          </button>
          <button onClick={goBack} className="btn-primary">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const hasRightPanel = showUsers || showComments || showVersions || showAI;

  return (
    <div className="room-page">
      {isReconnecting && (
        <div className="reconnect-banner reconnecting">
          <RefreshCw size={14} className="spinning" />
          Reconnecting... (Attempt {reconnectAttempt} of {MAX_RECONNECT_ATTEMPTS})
        </div>
      )}

      <header className="room-header">
        <div className="header-left">
          <button onClick={goBack} className="btn-icon">
            <ChevronLeft size={20} />
          </button>
          <h2 className="room-title">Collaborative Editor</h2>
          <span className="room-id-badge">{roomId}</span>
          <span className={`role-badge ${canEdit() ? 'editor' : 'viewer'}`}>
            {canEdit() ? 'Editor' : 'Viewer'}
          </span>
        </div>
        <div className="header-right">
          <button
            onClick={() => setMobileMenu(!mobileMenu)}
            className="btn-icon mobile-menu-btn"
          >
            {mobileMenu ? <X size={20} /> : <Menu size={20} />}
          </button>
          <button
            onClick={() => togglePanel('comments')}
            className={`btn-icon ${showComments ? 'active' : ''}`}
            title="Code Review"
          >
            <MessageSquare size={20} />
          </button>
          <button
            onClick={() => togglePanel('versions')}
            className={`btn-icon ${showVersions ? 'active' : ''}`}
            title="Version History"
          >
            <GitCommit size={20} />
          </button>
          <button
            onClick={() => togglePanel('ai')}
            className={`btn-icon ${showAI ? 'active' : ''}`}
            title="AI Assistant"
          >
            <Sparkles size={20} />
          </button>
          <button
            onClick={() => togglePanel('users')}
            className={`btn-icon ${showUsers ? 'active' : ''}`}
            title="Users"
          >
            <Users size={20} />
          </button>
          <button
            onClick={() => togglePanel('terminal')}
            className={`btn-icon ${showTerminal ? 'active' : ''}`}
            title="Terminal"
          >
            <Terminal size={20} />
          </button>
        </div>
      </header>

      <div className={`room-layout ${mobileMenu ? 'mobile-menu-open' : ''}`}>
        <aside className="sidebar">
          <FileTree onExecute={handleExecuteCode} />
        </aside>

        <main className="main-content">
          <Editor
            onExecute={handleExecuteCode}
            onTextSelection={handleTextSelection}
          />
        </main>

        {hasRightPanel && (
          <aside className="side-panel right-panel multi-panel">
            {showUsers && (
              <div className="panel-wrapper">
                <UsersPanel />
              </div>
            )}
            {showComments && (
              <div className="panel-wrapper">
                <CommentPanel
                  roomId={roomId}
                  activeFile={activeFile}
                  onClose={() => setShowComments(false)}
                />
              </div>
            )}
            {showVersions && (
              <div className="panel-wrapper">
                <VersionPanel
                  roomId={roomId}
                  activeFile={activeFile}
                  onClose={() => setShowVersions(false)}
                />
              </div>
            )}
            {showAI && (
              <div className="panel-wrapper">
                <AIPanel
                  roomId={roomId}
                  activeFile={activeFile}
                  fileContents={fileContents}
                  selectedText={selectedEditorText}
                  onClose={() => setShowAI(false)}
                />
              </div>
            )}
          </aside>
        )}

        {showTerminal && (
          <ExecutionPanel
            result={executionResult}
            onClose={() => setShowTerminal(false)}
          />
        )}
      </div>
    </div>
  );
}

export default Room;
