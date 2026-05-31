import React, { useEffect, useRef, useState, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import SyncManager from './sync/SyncManager';
import ClientCRDTEngine from './sync/ClientCRDTEngine';
import ConflictManager from './sync/ConflictManager';

function CollaborativeEditor({ documentId = 'default-doc' }) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const syncManagerRef = useRef(null);
  const crdtEngineRef = useRef(null);
  const conflictManagerRef = useRef(null);
  const decorationIdsRef = useRef([]);
  const isApplyingRemoteRef = useRef(false);
  const cursorPositionRef = useRef(null);
  const selectionRef = useRef(null);
  
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [selectedConflict, setSelectedConflict] = useState(null);
  const [showConflictPanel, setShowConflictPanel] = useState(false);

  const getLinearPosition = useCallback((lineNumber, column) => {
    if (!editorRef.current) return 0;
    
    const model = editorRef.current.getModel();
    let position = 0;
    
    for (let line = 1; line < lineNumber; line++) {
      const lineContent = model.getLineContent(line);
      position += lineContent.length + 1;
    }
    
    position += column - 1;
    return position;
  }, []);

  const getLineColumnFromPosition = useCallback((position) => {
    if (!editorRef.current) return { lineNumber: 1, column: 1 };
    
    const model = editorRef.current.getModel();
    const value = model.getValue();
    
    let lineNumber = 1;
    let column = 1;
    let currentPos = 0;
    
    while (currentPos < position && currentPos < value.length) {
      if (value[currentPos] === '\n') {
        lineNumber++;
        column = 1;
      } else {
        column++;
      }
      currentPos++;
    }
    
    return { lineNumber, column };
  }, []);

  const saveCursorPosition = useCallback(() => {
    if (!editorRef.current) return;
    
    try {
      const selection = editorRef.current.getSelection();
      if (selection) {
        selectionRef.current = {
          selectionStartLineNumber: selection.selectionStartLineNumber,
          selectionStartColumn: selection.selectionStartColumn,
          positionLineNumber: selection.positionLineNumber,
          positionColumn: selection.positionColumn
        };
        
        cursorPositionRef.current = {
          start: getLinearPosition(selection.selectionStartLineNumber, selection.selectionStartColumn),
          end: getLinearPosition(selection.positionLineNumber, selection.positionColumn)
        };
      }
    } catch (e) {
      console.warn('Failed to save cursor position:', e);
    }
  }, [getLinearPosition]);

  const restoreCursorPosition = useCallback((operation, operationPosition) => {
    if (!editorRef.current || !cursorPositionRef.current || !selectionRef.current) {
      return;
    }
    
    try {
      let { start, end } = cursorPositionRef.current;
      const opLength = operation.type === 'insert' ? operation.value.length : 1;
      
      if (operation.type === 'insert') {
        if (operationPosition < start) {
          start += opLength;
        }
        if (operationPosition < end) {
          end += opLength;
        }
      } else if (operation.type === 'delete') {
        if (operationPosition < start) {
          start -= opLength;
        } else if (operationPosition >= start && operationPosition < end) {
          end -= opLength;
        }
        if (operationPosition < end && operationPosition >= start) {
          end = Math.max(start, end - opLength);
        }
      }
      
      start = Math.max(0, start);
      end = Math.max(start, end);
      
      const model = editorRef.current.getModel();
      const maxLength = model.getValueLength();
      start = Math.min(start, maxLength);
      end = Math.min(end, maxLength);
      
      const startPos = getLineColumnFromPosition(start);
      const endPos = getLineColumnFromPosition(end);
      
      const newSelection = {
        selectionStartLineNumber: startPos.lineNumber,
        selectionStartColumn: startPos.column,
        positionLineNumber: endPos.lineNumber,
        positionColumn: endPos.column
      };
      
      editorRef.current.setSelection(newSelection);
      
      cursorPositionRef.current = { start, end };
      selectionRef.current = newSelection;
    } catch (e) {
      console.warn('Failed to restore cursor position:', e);
    }
  }, [getLineColumnFromPosition]);

  const highlightConflicts = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) return;
    
    const model = editorRef.current.getModel();
    const activeConflicts = conflictManagerRef.current?.getActiveConflicts() || [];
    
    const decorations = activeConflicts.map(conflict => {
      const startPos = getLineColumnFromPosition(conflict.startPosition);
      const endPos = getLineColumnFromPosition(Math.max(conflict.startPosition + 1, conflict.endPosition));
      
      return {
        range: new monacoRef.current.Range(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column
        ),
        options: {
          isWholeLine: false,
          className: 'conflict-decoration',
          inlineClassName: 'conflict-inline-decoration',
          overviewRuler: {
            color: '#ff0000',
            darkColor: '#ff0000',
            position: monacoRef.current.OverviewRulerLane.Right
          },
          minimap: {
            color: { id: 'minimap.errorHighlight' },
            position: 1
          },
          zIndex: 100
        }
      };
    });
    
    decorationIdsRef.current = model.deltaDecorations(decorationIdsRef.current, decorations);
  }, [getLineColumnFromPosition]);

  const handleConflictDetected = useCallback((conflict) => {
    console.log('Conflict detected:', conflict);
    setConflicts(prev => [...prev.filter(c => c.id !== conflict.id), conflict]);
    highlightConflicts();
    setShowConflictPanel(true);
  }, [highlightConflicts]);

  const handleConflictResolved = useCallback((conflict) => {
    console.log('Conflict resolved:', conflict);
    setConflicts(prev => prev.filter(c => c.id !== conflict.id));
    setSelectedConflict(null);
    highlightConflicts();
    
    if (conflictManagerRef.current?.getActiveConflicts().length === 0) {
      setShowConflictPanel(false);
    }
  }, [highlightConflicts]);

  const applyRemoteOperation = useCallback((operation, fromUserId) => {
    if (!crdtEngineRef.current || !editorRef.current) {
      return;
    }
    
    saveCursorPosition();
    
    isApplyingRemoteRef.current = true;
    
    try {
      const position = crdtEngineRef.current.applyOperation(operation);
      
      if (position >= 0) {
        const model = editorRef.current.getModel();
        
        if (operation.type === 'insert') {
          const pos = getLineColumnFromPosition(position);
          const range = {
            startLineNumber: pos.lineNumber,
            startColumn: pos.column,
            endLineNumber: pos.lineNumber,
            endColumn: pos.column
          };
          
          model.pushEditOperations(
            [],
            [{ range, text: operation.value }],
            () => null
          );
        } else if (operation.type === 'delete') {
          const pos = getLineColumnFromPosition(position);
          const endPos = getLineColumnFromPosition(position + 1);
          const range = {
            startLineNumber: pos.lineNumber,
            startColumn: pos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column
          };
          
          model.pushEditOperations(
            [],
            [{ range, text: '' }],
            () => null
          );
        }
        
        if (conflictManagerRef.current) {
          conflictManagerRef.current.recordRemoteOperation(
            operation,
            position,
            fromUserId
          );
        }
        
        restoreCursorPosition(operation, position);
      }
    } finally {
      isApplyingRemoteRef.current = false;
    }
  }, [saveCursorPosition, getLineColumnFromPosition, restoreCursorPosition]);

  const handleLocalChange = useCallback((change) => {
    if (!crdtEngineRef.current || !syncManagerRef.current) {
      return;
    }
    
    const { range, text, rangeLength } = change;
    
    if (rangeLength > 0) {
      const startPos = getLinearPosition(range.startLineNumber, range.startColumn);
      for (let i = 0; i < rangeLength; i++) {
        const operation = crdtEngineRef.current.delete(startPos);
        if (operation) {
          syncManagerRef.current.sendOperation(operation);
          
          if (conflictManagerRef.current) {
            conflictManagerRef.current.recordLocalOperation(operation, startPos);
          }
        }
      }
    }
    
    if (text.length > 0) {
      const startPos = getLinearPosition(range.startLineNumber, range.startColumn);
      for (let i = 0; i < text.length; i++) {
        const operation = crdtEngineRef.current.insert(startPos + i, text[i]);
        if (operation) {
          syncManagerRef.current.sendOperation(operation);
          
          if (conflictManagerRef.current) {
            conflictManagerRef.current.recordLocalOperation(operation, startPos + i);
          }
        }
      }
    }
  }, [getLinearPosition]);

  const handleEditorDidMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    monaco.editor.defineTheme('conflict-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editorError.foreground': '#ff4444',
      }
    });
    
    editor.onDidChangeModelContent((event) => {
      if (isApplyingRemoteRef.current) {
        return;
      }
      
      const changes = event.changes;
      for (const change of changes) {
        handleLocalChange(change);
      }
    });
    
    editor.onDidChangeCursorPosition(() => {
      if (!isApplyingRemoteRef.current) {
        saveCursorPosition();
      }
    });
    
    editor.onDidChangeCursorSelection(() => {
      if (!isApplyingRemoteRef.current) {
        saveCursorPosition();
      }
    });
  }, [handleLocalChange, saveCursorPosition]);

  const resolveConflict = useCallback((conflictId, choice) => {
    if (!conflictManagerRef.current) return;
    
    const conflict = conflictManagerRef.current.resolveConflict(conflictId, choice);
    handleConflictResolved(conflict);
  }, [handleConflictResolved]);

  const resolveAllConflicts = useCallback((choice) => {
    if (!conflictManagerRef.current) return;
    
    const resolved = conflictManagerRef.current.resolveAllConflicts(choice);
    resolved.forEach(conflict => handleConflictResolved(conflict));
  }, [handleConflictResolved]);

  const navigateToConflict = useCallback((conflict) => {
    if (!editorRef.current) return;
    
    const startPos = getLineColumnFromPosition(conflict.startPosition);
    const endPos = getLineColumnFromPosition(conflict.endPosition);
    
    const range = new monacoRef.current.Range(
      startPos.lineNumber,
      startPos.column,
      endPos.lineNumber,
      endPos.column
    );
    
    editorRef.current.revealRangeInCenter(range);
    editorRef.current.setSelection(range);
    setSelectedConflict(conflict);
  }, [getLineColumnFromPosition]);

  useEffect(() => {
    crdtEngineRef.current = new ClientCRDTEngine();
    syncManagerRef.current = new SyncManager();
    conflictManagerRef.current = new ConflictManager(
      crdtEngineRef.current.siteId,
      {
        conflictWindowMs: 3000,
        conflictRangeThreshold: 10,
        onConflictDetected: handleConflictDetected,
        onConflictResolved: handleConflictResolved
      }
    );
    
    const callbacks = {
      onContentChange: (content, operationData, fromUserId) => {
        if (content !== null && content !== undefined) {
          if (crdtEngineRef.current) {
            crdtEngineRef.current.setDocument(content);
          }
          if (editorRef.current) {
            isApplyingRemoteRef.current = true;
            const model = editorRef.current.getModel();
            model.setValue(content);
            isApplyingRemoteRef.current = false;
          }
        } else if (operationData) {
          applyRemoteOperation(operationData.operation, fromUserId);
        }
      },
      onUserJoined: (data) => {
        setConnectedUsers(data.clients);
      },
      onUserLeft: (data) => {
        setConnectedUsers(data.clients);
      },
      onHistoryReceived: (data) => {
        setHistory(data.versions);
        setShowHistory(true);
      },
      onVersionRestored: (data) => {
        setVersion(data.version);
        setShowHistory(false);
        
        if (crdtEngineRef.current && editorRef.current) {
          isApplyingRemoteRef.current = true;
          crdtEngineRef.current.setDocument(data.content);
          const model = editorRef.current.getModel();
          model.setValue(data.content);
          isApplyingRemoteRef.current = false;
        }
      },
      onError: (errorMessage) => {
        setError(errorMessage);
        setTimeout(() => setError(null), 5000);
      }
    };
    
    syncManagerRef.current.connect(documentId, callbacks);
    
    return () => {
      if (syncManagerRef.current) {
        syncManagerRef.current.disconnect();
      }
      if (conflictManagerRef.current) {
        conflictManagerRef.current.clearConflicts();
      }
    };
  }, [documentId, applyRemoteOperation, handleConflictDetected, handleConflictResolved]);

  const handleGetHistory = () => {
    if (syncManagerRef.current) {
      syncManagerRef.current.getHistory();
    }
  };

  const handleRestoreVersion = (versionToRestore) => {
    if (syncManagerRef.current) {
      syncManagerRef.current.restoreVersion(versionToRestore);
    }
  };

  const activeConflicts = conflicts.filter(c => !c.resolved);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ 
        padding: '10px 20px', 
        background: '#1e1e1e', 
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #333'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>
            📝 Collaborative Code Editor
          </h2>
          <span style={{ color: '#888', fontSize: '14px' }}>
            Document: {documentId}
          </span>
          <span style={{ color: '#4CAF50', fontSize: '14px' }}>
            Version: {version}
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          {activeConflicts.length > 0 && (
            <div 
              onClick={() => setShowConflictPanel(!showConflictPanel)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: '#ff4444',
                borderRadius: '4px',
                cursor: 'pointer',
                animation: 'pulse 2s infinite'
              }}
            >
              <span>⚠️</span>
              <span style={{ fontWeight: 'bold' }}>{activeConflicts.length} Conflict{activeConflicts.length > 1 ? 's' : ''}</span>
            </div>
          )}
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ color: '#888', fontSize: '14px' }}>
              Online: {connectedUsers.length}
            </span>
            <div style={{ display: 'flex', gap: '3px' }}>
              {connectedUsers.map((userId, index) => (
                <div
                  key={userId}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: `hsl(${(index * 137) % 360}, 70%, 50%)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    fontWeight: 'bold'
                  }}
                  title={userId}
                >
                  {userId.charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
          </div>
          
          <button
            onClick={handleGetHistory}
            style={{
              padding: '8px 16px',
              background: '#0078d4',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            🕐 History
          </button>
        </div>
      </div>
      
      {error && (
        <div style={{
          padding: '10px 20px',
          background: '#f44336',
          color: 'white',
          fontSize: '14px'
        }}>
          Error: {error}
        </div>
      )}
      
      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Editor
            height="100%"
            defaultLanguage="javascript"
            defaultValue="// Start typing to collaborate in real-time..."
            theme="vs-dark"
            onMount={handleEditorDidMount}
            options={{
              fontSize: 14,
              minimap: { enabled: true },
              wordWrap: 'on',
              automaticLayout: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              renderLineHighlight: 'line',
              scrollBeyondLastLine: false
            }}
          />
        </div>
        
        {showConflictPanel && activeConflicts.length > 0 && (
          <div style={{
            width: '350px',
            background: '#252526',
            borderLeft: '1px solid #333',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '15px',
              background: '#ff4444',
              color: 'white',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: '16px' }}>
                ⚠️ {activeConflicts.length} Conflict{activeConflicts.length > 1 ? 's' : ''} Detected
              </h3>
              <button
                onClick={() => setShowConflictPanel(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'white',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '0 5px'
                }}
              >
                ✕
              </button>
            </div>
            
            {activeConflicts.length > 1 && (
              <div style={{
                padding: '10px 15px',
                background: '#2d2d2d',
                borderBottom: '1px solid #333',
                display: 'flex',
                gap: '10px'
              }}>
                <button
                  onClick={() => resolveAllConflicts('local')}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    background: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Accept All Mine
                </button>
                <button
                  onClick={() => resolveAllConflicts('remote')}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    background: '#0078d4',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Accept All Theirs
                </button>
              </div>
            )}
            
            <div style={{ flex: 1, overflow: 'auto', padding: '10px' }}>
              {activeConflicts.map((conflict, index) => (
                <div
                  key={conflict.id}
                  onClick={() => navigateToConflict(conflict)}
                  style={{
                    background: selectedConflict?.id === conflict.id ? '#3c3c3c' : '#2d2d2d',
                    border: `1px solid ${selectedConflict?.id === conflict.id ? '#ff4444' : '#444'}`,
                    borderRadius: '6px',
                    padding: '12px',
                    marginBottom: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '10px',
                    alignItems: 'center'
                  }}>
                    <span style={{ 
                      color: '#ff4444', 
                      fontWeight: 'bold',
                      fontSize: '13px'
                    }}>
                      Conflict #{index + 1}
                    </span>
                    <span style={{ 
                      color: '#888', 
                      fontSize: '11px' 
                    }}>
                      {new Date(conflict.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#aaa',
                    marginBottom: '8px',
                    fontFamily: 'monospace',
                    background: '#1e1e1e',
                    padding: '6px',
                    borderRadius: '3px'
                  }}>
                    Position: Line {getLineColumnFromPosition(conflict.startPosition).lineNumber}
                  </div>
                  
                  <div style={{
                    background: '#1e1e1e',
                    padding: '8px',
                    borderRadius: '4px',
                    marginBottom: '10px'
                  }}>
                    <div style={{
                      color: '#4CAF50',
                      fontSize: '11px',
                      marginBottom: '4px',
                      fontWeight: 'bold'
                    }}>
                      🔵 Your change:
                    </div>
                    <div style={{
                      color: '#ddd',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all'
                    }}>
                      {conflict.localOperation.preview}
                    </div>
                  </div>
                  
                  <div style={{
                    background: '#1e1e1e',
                    padding: '8px',
                    borderRadius: '4px',
                    marginBottom: '12px'
                  }}>
                    <div style={{
                      color: '#ff9800',
                      fontSize: '11px',
                      marginBottom: '4px',
                      fontWeight: 'bold'
                    }}>
                      🟠 Their change:
                    </div>
                    <div style={{
                      color: '#ddd',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all'
                    }}>
                      {conflict.remoteOperation.preview}
                    </div>
                    <div style={{
                      color: '#888',
                      fontSize: '10px',
                      marginTop: '4px'
                    }}>
                      User: {conflict.remoteOperation.fromUserId?.substring(0, 8) || 'Unknown'}...
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        resolveConflict(conflict.id, 'local');
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}
                    >
                      ✓ Keep Mine
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        resolveConflict(conflict.id, 'remote');
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        background: '#0078d4',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}
                    >
                      ✓ Accept Theirs
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {showHistory && (
        <>
          <div
            onClick={() => setShowHistory(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 999
            }}
          />
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#1e1e1e',
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '20px',
            minWidth: '500px',
            maxHeight: '70vh',
            overflow: 'auto',
            zIndex: 1000
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: 'white' }}>🕐 Version History</h3>
              <button
                onClick={() => setShowHistory(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  fontSize: '20px',
                  cursor: 'pointer'
                }}
              >
                ✕
              </button>
            </div>
            
            {history.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center' }}>No history available yet</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {history.map((entry, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '12px',
                      background: '#2d2d2d',
                      borderRadius: '4px',
                      border: '1px solid #333'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ color: 'white', fontWeight: 'bold' }}>
                        Version {entry.version}
                      </span>
                      <span style={{ color: '#888', fontSize: '12px' }}>
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ 
                      background: '#1a1a1a', 
                      padding: '8px', 
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: '#aaa',
                      maxHeight: '100px',
                      overflow: 'auto',
                      fontFamily: 'monospace',
                      marginBottom: '8px'
                    }}>
                      {entry.content.substring(0, 200)}
                      {entry.content.length > 200 && '...'}
                    </div>
                    <button
                      onClick={() => handleRestoreVersion(entry.version)}
                      style={{
                        padding: '6px 12px',
                        background: '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Restore this version
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        
        .conflict-decoration {
          background-color: rgba(255, 0, 0, 0.2);
          border-bottom: 2px solid #ff0000;
        }
        
        .conflict-inline-decoration {
          text-decoration: underline wavy #ff0000;
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
        }
      `}</style>
    </div>
  );
}

export default CollaborativeEditor;
