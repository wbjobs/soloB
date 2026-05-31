import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Folder, FolderOpen, File, ChevronRight, ChevronDown,
  Plus, Trash2, Edit2, FileCode, FileText, MoreVertical,
  FolderPlus, RefreshCw, GripVertical
} from 'lucide-react';
import { useRoomStore } from '../store/roomStore';
import { socketService } from '../services/socket';

const FILE_ICONS = {
  js: FileCode,
  ts: FileCode,
  py: FileCode,
  java: FileCode,
  json: FileText,
  md: FileText,
  html: FileText,
  css: FileText,
  default: File
};

const structureVersions = new Map();
const pendingFileOps = [];

const getFileIcon = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  const Icon = FILE_ICONS[ext] || FILE_ICONS.default;
  return <Icon size={16} />;
};

const findNodePath = (node, targetId, path = []) => {
  if (node.id === targetId) {
    return [...path, node];
  }
  if (node.children) {
    for (const child of node.children) {
      const result = findNodePath(child, targetId, [...path, node]);
      if (result) return result;
    }
  }
  return null;
};

const findParentAndIndex = (node, targetId, parent = null) => {
  if (node.children) {
    const index = node.children.findIndex(child => child.id === targetId);
    if (index !== -1) {
      return { parent: node, index };
    }
    for (const child of node.children) {
      const result = findParentAndIndex(child, targetId, node);
      if (result) return result;
    }
  }
  return null;
};

function FileTree() {
  const { structure, activeFile, canEdit, openFiles, openFile, updateStructure } = useRoomStore();
  const [expanded, setExpanded] = useState(new Set(['root']));
  const [editingNode, setEditingNode] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [creating, setCreating] = useState(null);
  const [draggedNode, setDraggedNode] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [dropPosition, setDropPosition] = useState(null);

  const localStructureRef = useRef(structure);

  useEffect(() => {
    localStructureRef.current = structure;
  }, [structure]);

  const toggleExpand = (nodeId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleClick = (node) => {
    if (node.type === 'folder') {
      toggleExpand(node.id);
    } else {
      socketService.sendFileOperation('open', { fileId: node.id });
    }
  };

  const getCurrentVersion = (roomId) => {
    return structureVersions.get(roomId) || 0;
  };

  const setCurrentVersion = (roomId, version) => {
    structureVersions.set(roomId, version);
  };

  const queueOperation = (action, payload) => {
    pendingFileOps.push({ action, payload, timestamp: Date.now() });
  };

  const processQueuedOperations = useCallback(() => {
    if (pendingFileOps.length === 0) return;

    const op = pendingFileOps.shift();
    const roomId = window.location.pathname.split('/room/')[1]?.split('/')[0];

    socketService.emit('file-operation', {
      action: op.action,
      payload: op.payload,
      expectedVersion: getCurrentVersion(roomId),
      timestamp: Date.now()
    });
  }, []);

  const handleCreate = (parentId, type) => {
    setCreating({ parentId, type });
    setEditValue(type === 'file' ? 'newfile.js' : 'New Folder');
    setContextMenu(null);
  };

  const handleRename = (node) => {
    setEditingNode(node.id);
    setEditValue(node.name);
    setContextMenu(null);
  };

  const handleDelete = (node) => {
    if (window.confirm(`Are you sure you want to delete "${node.name}"?`)) {
      const roomId = window.location.pathname.split('/room/')[1]?.split('/')[0];
      queueOperation('delete', { nodeId: node.id });
      socketService.emit('file-operation', {
        action: 'delete',
        payload: { nodeId: node.id },
        expectedVersion: getCurrentVersion(roomId),
        timestamp: Date.now()
      });
    }
    setContextMenu(null);
  };

  const submitCreate = () => {
    if (!editValue.trim()) {
      setCreating(null);
      return;
    }

    const roomId = window.location.pathname.split('/room/')[1]?.split('/')[0];
    socketService.emit('file-operation', {
      action: 'create',
      payload: {
        parentId: creating.parentId,
        name: editValue.trim(),
        type: creating.type
      },
      expectedVersion: getCurrentVersion(roomId),
      timestamp: Date.now()
    });

    setCreating(null);
    setEditValue('');
    setExpanded(prev => new Set([...prev, creating.parentId]));
  };

  const submitRename = () => {
    if (!editValue.trim() || editingNode === null) {
      setEditingNode(null);
      return;
    }

    const roomId = window.location.pathname.split('/room/')[1]?.split('/')[0];
    socketService.emit('file-operation', {
      action: 'rename',
      payload: {
        nodeId: editingNode,
        newName: editValue.trim()
      },
      expectedVersion: getCurrentVersion(roomId),
      timestamp: Date.now()
    });

    setEditingNode(null);
    setEditValue('');
  };

  const handleKeyDown = (e, action) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (action === 'create') submitCreate();
      else if (action === 'rename') submitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setCreating(null);
      setEditingNode(null);
      setEditValue('');
    }
  };

  const handleContextMenu = (e, node) => {
    e.preventDefault();
    if (!canEdit()) return;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node
    });
  };

  const handleDragStart = (e, node) => {
    if (!canEdit() || node.id === 'root') {
      e.preventDefault();
      return;
    }
    setDraggedNode(node);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);
  };

  const handleDragOver = (e, node, index = 0) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!draggedNode || node.id === draggedNode.id) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    const position = y < height * 0.33 ? 'before' : (y > height * 0.66 ? 'after' : 'inside');

    if (node.type === 'folder') {
      if (position === 'inside') {
        setDropTarget(node.id);
        setDropPosition('inside');
      } else {
        setDropTarget(node.id);
        setDropPosition(position);
      }
    } else {
      setDropTarget(node.id);
      setDropPosition(position);
    }
  };

  const handleDragLeave = () => {
    setDropTarget(null);
    setDropPosition(null);
  };

  const handleDrop = (e, targetNode, parentNode = null) => {
    e.preventDefault();

    if (!draggedNode || !canEdit()) {
      setDraggedNode(null);
      setDropTarget(null);
      setDropPosition(null);
      return;
    }

    const draggedId = draggedNode.id;
    const targetId = targetNode.id;

    if (draggedId === targetId) {
      setDraggedNode(null);
      setDropTarget(null);
      setDropPosition(null);
      return;
    }

    const currentStructure = localStructureRef.current;
    const roomId = window.location.pathname.split('/room/')[1]?.split('/')[0];

    const draggedPath = findNodePath(currentStructure, draggedId);
    if (!draggedPath) {
      setDraggedNode(null);
      setDropTarget(null);
      setDropPosition(null);
      return;
    }

    let newParentId;
    let targetIndex;

    if (dropPosition === 'inside' && targetNode.type === 'folder') {
      newParentId = targetId;
      targetIndex = targetNode.children?.length || 0;
    } else {
      const targetInfo = findParentAndIndex(currentStructure, targetId);
      if (!targetInfo) {
        setDraggedNode(null);
        setDropTarget(null);
        setDropPosition(null);
        return;
      }

      newParentId = targetInfo.parent.id;
      targetIndex = dropPosition === 'after' ? targetInfo.index + 1 : targetInfo.index;
    }

    const isDescendant = (ancestor, descendantId) => {
      if (ancestor.id === descendantId) return true;
      if (ancestor.children) {
        for (const child of ancestor.children) {
          if (isDescendant(child, descendantId)) return true;
        }
      }
      return false;
    };

    if (draggedNode.type === 'folder' && isDescendant(draggedNode, newParentId)) {
      setDraggedNode(null);
      setDropTarget(null);
      setDropPosition(null);
      return;
    }

    socketService.emit('file-operation', {
      action: 'move',
      payload: {
        nodeId: draggedId,
        newParentId,
        targetIndex
      },
      expectedVersion: getCurrentVersion(roomId),
      timestamp: Date.now()
    });

    setDraggedNode(null);
    setDropTarget(null);
    setDropPosition(null);
  };

  const handleDragEnd = () => {
    setDraggedNode(null);
    setDropTarget(null);
    setDropPosition(null);
  };

  useEffect(() => {
    if (!socketService.socket) return;

    const handleFileOp = ({ structure, version, action }) => {
      const roomId = window.location.pathname.split('/room/')[1]?.split('/')[0];
      if (version !== undefined) {
        setCurrentVersion(roomId, version);
      }
      updateStructure(structure);
    };

    const handleFileOpAck = ({ structure, version }) => {
      const roomId = window.location.pathname.split('/room/')[1]?.split('/')[0];
      if (version !== undefined) {
        setCurrentVersion(roomId, version);
      }
      updateStructure(structure);
    };

    const handleFileOpError = ({ latestStructure, currentVersion, action }) => {
      const roomId = window.location.pathname.split('/room/')[1]?.split('/')[0];
      setCurrentVersion(roomId, currentVersion);
      updateStructure(latestStructure);
    };

    socketService.socket.on('file-operation', handleFileOp);
    socketService.socket.on('file-op-ack', handleFileOpAck);
    socketService.socket.on('file-operation-error', handleFileOpError);

    return () => {
      socketService.socket?.off('file-operation', handleFileOp);
      socketService.socket?.off('file-op-ack', handleFileOpAck);
      socketService.socket?.off('file-operation-error', handleFileOpError);
    };
  }, [updateStructure]);

  const renderNode = (node, level = 0, parent = null, index = 0) => {
    const isExpanded = expanded.has(node.id);
    const isActive = activeFile === node.id;
    const isEditing = editingNode === node.id;
    const isCreatingNew = creating && creating.parentId === node.id;
    const isDragging = draggedNode?.id === node.id;
    const isDropTarget = dropTarget === node.id;

    const Icon = node.type === 'folder'
      ? (isExpanded ? FolderOpen : Folder)
      : null;

    let dropIndicatorClass = '';
    if (isDropTarget && dropPosition === 'before') dropIndicatorClass = 'drop-before';
    else if (isDropTarget && dropPosition === 'after') dropIndicatorClass = 'drop-after';
    else if (isDropTarget && dropPosition === 'inside') dropIndicatorClass = 'drop-inside';

    return (
      <div key={node.id} className={`tree-node-wrapper ${dropIndicatorClass}`}>
        <div
          className={`tree-node ${isActive ? 'active' : ''} ${node.type === 'folder' ? 'folder' : 'file'} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => !isEditing && handleClick(node)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          draggable={canEdit() && node.id !== 'root'}
          onDragStart={(e) => handleDragStart(e, node)}
          onDragOver={(e) => handleDragOver(e, node, index)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node, parent)}
          onDragEnd={handleDragEnd}
        >
          {canEdit() && node.id !== 'root' && (
            <span className="drag-handle">
              <GripVertical size={12} />
            </span>
          )}

          {node.type === 'folder' && (
            <span className="expand-icon" onClick={(e) => {
              e.stopPropagation();
              toggleExpand(node.id);
            }}>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          )}

          {node.type === 'folder' ? (
            <Icon size={16} className="node-icon folder-icon" />
          ) : (
            <span className="node-icon file-icon">{getFileIcon(node.name)}</span>
          )}

          {isEditing ? (
            <input
              className="node-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'rename')}
              onBlur={submitRename}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="node-name">{node.name}</span>
          )}

          {canEdit() && node.type === 'folder' && !isEditing && (
            <button
              className="node-action"
              onClick={(e) => {
                e.stopPropagation();
                handleContextMenu(e, node);
              }}
            >
              <MoreVertical size={14} />
            </button>
          )}
        </div>

        {node.type === 'folder' && isExpanded && node.children && (
          <div className="tree-children">
            {node.children.map((child, idx) => renderNode(child, level + 1, node, idx))}

            {isCreatingNew && (
              <div
                className="tree-node creating"
                style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
              >
                {creating.type === 'folder' ? (
                  <FolderPlus size={16} className="node-icon folder-icon" />
                ) : (
                  <FileCode size={16} className="node-icon file-icon" />
                )}
                <input
                  className="node-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, 'create')}
                  onBlur={submitCreate}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (!structure) {
    return (
      <div className="file-tree-loading">
        <RefreshCw size={24} className="spinning" />
        <p>Loading files...</p>
      </div>
    );
  }

  return (
    <div className="file-tree">
      <div className="tree-header">
        <h3>Files</h3>
        {canEdit() && (
          <div className="tree-actions">
            <button
              title="New File"
              onClick={() => handleCreate('root', 'file')}
            >
              <FileCode size={18} />
            </button>
            <button
              title="New Folder"
              onClick={() => handleCreate('root', 'folder')}
            >
              <FolderPlus size={18} />
            </button>
          </div>
        )}
      </div>

      <div className="tree-content">
        {renderNode(structure)}

        {creating && creating.parentId === 'root' && !expanded.has('root') && (
          <div
            className="tree-node creating"
            style={{ paddingLeft: '24px' }}
          >
            {creating.type === 'folder' ? (
              <FolderPlus size={16} className="node-icon folder-icon" />
            ) : (
              <FileCode size={16} className="node-icon file-icon" />
            )}
            <input
              className="node-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, 'create')}
              onBlur={submitCreate}
              autoFocus
            />
          </div>
        )}
      </div>

      {contextMenu && (
        <>
          <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} />
          <div
            className="context-menu"
            style={{
              left: contextMenu.x,
              top: contextMenu.y
            }}
          >
            {contextMenu.node.type === 'folder' && (
              <>
                <button onClick={() => handleCreate(contextMenu.node.id, 'file')}>
                  <Plus size={14} />
                  New File
                </button>
                <button onClick={() => handleCreate(contextMenu.node.id, 'folder')}>
                  <FolderPlus size={14} />
                  New Folder
                </button>
                <div className="menu-divider" />
              </>
            )}
            <button onClick={() => handleRename(contextMenu.node)}>
              <Edit2 size={14} />
              Rename
            </button>
            <button
              onClick={() => handleDelete(contextMenu.node)}
              className="danger"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default FileTree;
