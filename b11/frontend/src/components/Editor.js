import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { useRoomStore } from '../store/roomStore';
import { socketService } from '../services/socket';
import OTDocument from '../utils/ot';
import { Play, X, ChevronDown } from 'lucide-react';

const LANGUAGE_MAP = {
  javascript: 'javascript',
  python: 'python',
  java: 'java',
  typescript: 'typescript',
  json: 'json',
  html: 'html',
  css: 'css',
  plaintext: 'plaintext'
};

const documents = new Map();
const decoratorMap = new Map();
const pendingOperations = new Map();
const acknowledgedVersions = new Map();

const LARGE_FILE_THRESHOLD = 10000;

function CodeEditor({ onExecute, onTextSelection }) {
  const {
    openFiles,
    activeFile,
    fileContents,
    cursors,
    users,
    closeFile,
    setActiveFile,
    canEdit,
    updateFileContent
  } = useRoomStore();

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const isLocalChangeRef = useRef(false);
  const reconnectingRef = useRef(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [virtualScrollingEnabled, setVirtualScrollingEnabled] = useState(true);

  const applyEditsToEditor = useCallback((ops) => {
    if (!editorRef.current || !ops || ops.length === 0) return;

    const model = editorRef.current.getModel();
    const edits = ops.map(op => {
      if (op.type === 'insert') {
        const position = model.getPositionAt(op.position);
        return {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column
          },
          text: op.character
        };
      } else {
        const startPos = model.getPositionAt(op.position);
        const endPos = model.getPositionAt(Math.min(op.position + 1, model.getValueLength()));
        return {
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column
          },
          text: ''
        };
      }
    });

    isLocalChangeRef.current = false;
    model.applyEdits(edits);
    isLocalChangeRef.current = true;
  }, []);

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onDidChangeModelContent((e) => {
      if (!isLocalChangeRef.current || !activeFile) return;

      const doc = documents.get(activeFile);
      if (!doc) return;

      const localUserId = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')).id : 'local';

      e.changes.forEach(change => {
        if (change.text.length > 0) {
          const ops = [];
          for (let i = 0; i < change.text.length; i++) {
            const op = doc.insert(
              change.rangeOffset + i,
              change.text[i],
              localUserId
            );
            ops.push(op);

            if (socketService.socket) {
              socketService.sendOperation(activeFile, op, acknowledgedVersions.get(activeFile) || 0);
            }
          }

          if (!pendingOperations.has(activeFile)) {
            pendingOperations.set(activeFile, []);
          }
          pendingOperations.get(activeFile).push(...ops);
        } else {
          const ops = [];
          for (let i = change.rangeLength - 1; i >= 0; i--) {
            const op = doc.delete(
              change.rangeOffset + i,
              localUserId
            );
            if (op) {
              ops.push(op);
              if (socketService.socket) {
                socketService.sendOperation(activeFile, op, acknowledgedVersions.get(activeFile) || 0);
              }
            }
          }

          if (!pendingOperations.has(activeFile)) {
            pendingOperations.set(activeFile, []);
          }
          pendingOperations.get(activeFile).push(...ops);
        }
      });

      updateFileContent(activeFile, editor.getModel().getValue());
    });

    editor.onDidChangeCursorPosition((e) => {
      if (!activeFile || !canEdit()) return;

      const position = {
        lineNumber: e.position.lineNumber,
        column: e.position.column
      };

      socketService.sendCursorUpdate(activeFile, position, null);
    });

    editor.onDidChangeCursorSelection((e) => {
      if (!activeFile || !canEdit()) return;

      const model = editor.getModel();
      const selection = e.selection;

      if (selection.startLineNumber !== selection.endLineNumber ||
          selection.startColumn !== selection.endColumn) {
        const range = new monaco.Range(
          selection.startLineNumber,
          selection.startColumn,
          selection.endLineNumber,
          selection.endColumn
        );
        const selectedText = model.getValueInRange(range);
        if (onTextSelection) {
          onTextSelection(selectedText);
        }
      } else if (onTextSelection) {
        onTextSelection('');
      }

      const selectionData = {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn
      };

      socketService.sendCursorUpdate(activeFile, null, selectionData);
    });

    editor.onDidChangeModel((e) => {
      const newModel = editor.getModel();
      if (newModel) {
        const lineCount = newModel.getLineCount();
        const isLarge = lineCount > LARGE_FILE_THRESHOLD;
        setIsLargeFile(isLarge);

        if (isLarge && virtualScrollingEnabled) {
          editor.updateOptions({
            scrollBeyondLastLine: false,
            automaticLayout: true
          });
        }
      }
    });
  };

  useEffect(() => {
    if (!socketService.socket) return;

    const handleOperation = ({ userId, fileId, operation, state }) => {
      if (!editorRef.current) return;

      const localUserId = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')).id : 'local';
      if (userId === localUserId) return;

      const doc = documents.get(fileId);
      if (!doc) return;

      const result = doc.applyRemoteOperation(operation, localUserId);

      if (result.applied && fileId === activeFile) {
        applyEditsToEditor([result.op]);
        updateFileContent(fileId, doc.getContent());
      }
    };

    const handleOperationAck = ({ fileId, serverVersion, op }) => {
      const doc = documents.get(fileId);
      if (doc && op) {
        doc.acknowledgeOp(op.version);
      }
      acknowledgedVersions.set(fileId, serverVersion);

      const pending = pendingOperations.get(fileId);
      if (pending) {
        const index = pending.findIndex(o => o.version === op?.version);
        if (index !== -1) {
          pending.splice(index, 1);
        }
      }
    };

    const handleOperationError = ({ fileId, error, state }) => {
      console.log('Operation error, syncing:', fileId, error);
      syncFileState(fileId);
    };

    const handleCatchupOperations = ({ fileId, operations, fromVersion }) => {
      console.log(`Catchup ops for ${fileId}: ${operations.length} ops from version ${fromVersion}`);

      const doc = documents.get(fileId);
      if (!doc) return;

      const localUserId = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')).id : 'local';
      const editorOps = [];

      for (const op of operations) {
        const result = doc.applyRemoteOperation(op, localUserId);
        if (result.applied) {
          editorOps.push(result.op);
        }
      }

      if (editorOps.length > 0 && fileId === activeFile && editorRef.current) {
        applyEditsToEditor(editorOps);
        updateFileContent(fileId, doc.getContent());
      }
    };

    const handleSyncResponse = ({ fileId, serverState, missingOperations }) => {
      const doc = documents.get(fileId);
      if (!doc) return;

      const model = editorRef.current?.getModel();
      const currentContent = model?.getValue() || fileContents[fileId]?.content || '';

      if (missingOperations.length === 0 && serverState.content === currentContent) {
        return;
      }

      const localUserId = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')).id : 'local';
      const editorOps = [];

      if (missingOperations.length > 0) {
        for (const op of missingOperations) {
          const result = doc.applyRemoteOperation(op, localUserId);
          if (result.applied) {
            editorOps.push(result.op);
          }
        }
      }

      const finalContent = doc.getContent();
      if (fileId === activeFile && editorRef.current) {
        if (editorOps.length > 0 && editorOps.length < 50) {
          applyEditsToEditor(editorOps);
        } else {
          isLocalChangeRef.current = false;
          editorRef.current.getModel().setValue(finalContent);
          isLocalChangeRef.current = true;
        }
        updateFileContent(fileId, finalContent);
      }

      reconnectingRef.current = false;
      setIsReconnecting(false);
    };

    socketService.socket.on('operation', handleOperation);
    socketService.socket.on('operation-ack', handleOperationAck);
    socketService.socket.on('operation-error', handleOperationError);
    socketService.socket.on('catchup-operations', handleCatchupOperations);
    socketService.socket.on('sync-response', handleSyncResponse);

    return () => {
      socketService.socket?.off('operation', handleOperation);
      socketService.socket?.off('operation-ack', handleOperationAck);
      socketService.socket?.off('operation-error', handleOperationError);
      socketService.socket?.off('catchup-operations', handleCatchupOperations);
      socketService.socket?.off('sync-response', handleSyncResponse);
    };
  }, [activeFile, applyEditsToEditor, updateFileContent, fileContents]);

  const syncFileState = useCallback((fileId) => {
    if (!socketService.socket) return;
    socketService.emit('sync-request', {
      fileId,
      clientVersion: acknowledgedVersions.get(fileId) || 0
    });
  }, []);

  useEffect(() => {
    if (!activeFile || !editorRef.current) return;

    const model = editorRef.current.getModel();
    const newDecorations = [];

    Object.entries(cursors).forEach(([userId, cursor]) => {
      if (cursor.fileId !== activeFile) return;

      const user = users.find(u => u.id === userId);
      const color = user?.color || '#FF6B6B';

      if (cursor.position) {
        const range = new monacoRef.current.Range(
          cursor.position.lineNumber,
          cursor.position.column,
          cursor.position.lineNumber,
          cursor.position.column + 1
        );

        newDecorations.push({
          range,
          options: {
            className: 'remote-cursor',
            hoverMessage: { value: `User: ${userId.substring(0, 6)}...` },
            beforeContentClassName: `remote-cursor-${userId.replace(/-/g, '')}`
          }
        });

        const styleId = `cursor-style-${userId.replace(/-/g, '')}`;
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            .remote-cursor-${userId.replace(/-/g, '')}::before {
              content: '';
              position: absolute;
              left: -2px;
              top: 0;
              height: 100%;
              width: 2px;
              background-color: ${color};
            }
          `;
          document.head.appendChild(style);
        }
      }

      if (cursor.selection && cursor.selection.startLineNumber) {
        const range = new monacoRef.current.Range(
          cursor.selection.startLineNumber,
          cursor.selection.startColumn,
          cursor.selection.endLineNumber,
          cursor.selection.endColumn
        );

        newDecorations.push({
          range,
          options: {
            className: 'remote-selection',
            inlineClassName: `remote-selection-${userId.replace(/-/g, '')}`
          }
        });

        const selectStyleId = `selection-style-${userId.replace(/-/g, '')}`;
        if (!document.getElementById(selectStyleId)) {
          const style = document.createElement('style');
          style.id = selectStyleId;
          style.textContent = `
            .remote-selection-${userId.replace(/-/g, '')} {
              background-color: ${color}33 !important;
            }
          `;
          document.head.appendChild(style);
        }
      }
    });

    const oldDecorations = decoratorMap.get(activeFile) || [];
    const newDecorationIds = editorRef.current.deltaDecorations(oldDecorations, newDecorations);
    decoratorMap.set(activeFile, newDecorationIds);
  }, [cursors, activeFile, users]);

  useEffect(() => {
    if (!activeFile || !fileContents[activeFile]) return;

    const content = fileContents[activeFile].content;
    const serverState = fileContents[activeFile].serverState;

    const isLarge = content.split('\n').length > LARGE_FILE_THRESHOLD;
    setIsLargeFile(isLarge);

    if (!documents.has(activeFile)) {
      documents.set(activeFile, new OTDocument(content));
    }

    const doc = documents.get(activeFile);

    if (serverState) {
      acknowledgedVersions.set(activeFile, serverState.version);
      if (doc.getState().version < serverState.version) {
        doc.setState(serverState);
      }
    }

    if (editorRef.current) {
      isLocalChangeRef.current = false;
      const model = editorRef.current.getModel();
      if (model && model.getValue() !== doc.getContent()) {
        model.setValue(doc.getContent());
      }
      isLocalChangeRef.current = true;
    }
  }, [activeFile]);

  const handleExecute = () => {
    if (!activeFile || !fileContents[activeFile]) return;
    const fileData = fileContents[activeFile];
    onExecute(fileData.language, fileData.content);
  };

  const currentLanguage = activeFile ? fileContents[activeFile]?.language : 'plaintext';

  const getEditorOptions = () => {
    const baseOptions = {
      minimap: { enabled: !isLargeFile },
      scrollBeyondLastLine: false,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      tabSize: 2,
      wordWrap: isLargeFile ? 'on' : 'on',
      folding: !isLargeFile,
      lineNumbers: 'on',
      renderLineHighlight: 'line',
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      formatOnPaste: true,
      formatOnType: true,
      readOnly: !canEdit(),
      bracketPairColorization: {
        enabled: !isLargeFile
      },
      guides: {
        bracketPairs: !isLargeFile,
        indentation: !isLargeFile
      }
    };

    if (isLargeFile && virtualScrollingEnabled) {
      return {
        ...baseOptions,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fastScrollSensitivity: 5,
        mouseWheelScrollSensitivity: 5
      };
    }

    return baseOptions;
  };

  if (!activeFile) {
    return (
      <div className="editor-placeholder">
        <div className="placeholder-content">
          <h2>Select a file to edit</h2>
          <p>Choose a file from the file tree to start coding</p>
          {isReconnecting && (
            <p className="reconnecting">Reconnecting and syncing state...</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="editor-container">
      {isReconnecting && (
        <div className="reconnecting-banner">
          Reconnecting... Syncing document state
        </div>
      )}

      {isLargeFile && (
        <div className="large-file-banner">
          <span>Large file detected ({fileContents[activeFile]?.content?.split('\n').length} lines)</span>
          <button
            className={`toggle-btn ${virtualScrollingEnabled ? 'active' : ''}`}
            onClick={() => setVirtualScrollingEnabled(!virtualScrollingEnabled)}
          >
            Virtual Scrolling: {virtualScrollingEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      )}

      <div className="editor-tabs">
        {openFiles.map(fileId => (
          <div
            key={fileId}
            className={`editor-tab ${activeFile === fileId ? 'active' : ''}`}
            onClick={() => setActiveFile(fileId)}
          >
            <span className="tab-name">{fileId.substring(0, 8)}...</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeFile(fileId);
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="editor-toolbar">
        <div className="language-selector">
          <button
            className="language-btn"
            onClick={() => setShowLanguageMenu(!showLanguageMenu)}
          >
            {currentLanguage}
            <ChevronDown size={14} />
          </button>
        </div>

        <div className="toolbar-actions">
          <button
            onClick={handleExecute}
            disabled={!canEdit()}
            className="btn-execute"
          >
            <Play size={16} />
            Run
          </button>
        </div>
      </div>

      <div className="monaco-wrapper">
        <Editor
          height="100%"
          theme="vs-dark"
          language={LANGUAGE_MAP[currentLanguage] || 'plaintext'}
          defaultValue=""
          onMount={handleEditorMount}
          options={getEditorOptions()}
        />
      </div>
    </div>
  );
}

export default CodeEditor;
