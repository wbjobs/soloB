const { v4: uuidv4 } = require('uuid');

const structureVersions = new Map();
const MAX_HISTORY = 50;
const operationQueue = new Map();

const findNodeById = (node, id) => {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
};

const findParentNode = (node, id, parent = null) => {
  if (node.id === id) return parent;
  if (node.children) {
    for (const child of node.children) {
      const found = findParentNode(child, id, node);
      if (found) return found;
    }
  }
  return null;
};

const getOrCreateVersion = (roomId) => {
  if (!structureVersions.has(roomId)) {
    structureVersions.set(roomId, {
      version: 0,
      history: []
    });
  }
  return structureVersions.get(roomId);
};

const incrementVersion = (roomId, action, payload) => {
  const versionInfo = getOrCreateVersion(roomId);
  versionInfo.version++;

  versionInfo.history.push({
    version: versionInfo.version,
    action,
    payload,
    timestamp: Date.now()
  });

  if (versionInfo.history.length > MAX_HISTORY) {
    versionInfo.history.shift();
  }

  return versionInfo.version;
};

const sortChildren = (children) => {
  return [...children].sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
    }

    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }

    if (a.createdAt && b.createdAt) {
      return a.createdAt - b.createdAt;
    }

    return a.name.localeCompare(b.name);
  });
};

const reorderChildren = (children, targetIndex, draggedIndex) => {
  const newChildren = [...children];
  const [draggedItem] = newChildren.splice(draggedIndex, 1);
  newChildren.splice(targetIndex, 0, draggedItem);

  newChildren.forEach((child, index) => {
    child.order = index;
  });

  return newChildren;
};

const createFile = (room, roomId, parentId, name, type, content = '', options = {}) => {
  if (options.expectedVersion !== undefined) {
    const versionInfo = getOrCreateVersion(roomId);
    if (options.expectedVersion !== versionInfo.version) {
      return {
        error: 'Structure version mismatch',
        currentVersion: versionInfo.version,
        retry: true
      };
    }
  }

  const parent = findNodeById(room.structure, parentId);
  if (!parent || parent.type !== 'folder') {
    return { error: 'Invalid parent folder' };
  }

  const exists = parent.children.some(child => child.name === name);
  if (exists) {
    return { error: 'Name already exists' };
  }

  const maxOrder = parent.children.length > 0
    ? Math.max(...parent.children.map(c => c.order !== undefined ? c.order : parent.children.indexOf(c)))
    : -1;

  const newNode = {
    id: uuidv4(),
    name,
    type,
    createdAt: Date.now(),
    order: maxOrder + 1
  };

  if (type === 'folder') {
    newNode.children = [];
  }

  parent.children.push(newNode);
  parent.children = sortChildren(parent.children);

  if (type === 'file') {
    room.files.set(newNode.id, {
      content,
      language: detectLanguage(name)
    });
  }

  const newVersion = incrementVersion(roomId, 'create', { parentId, name, type });

  return {
    node: newNode,
    structure: room.structure,
    version: newVersion
  };
};

const detectLanguage = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  const languages = {
    'js': 'javascript',
    'ts': 'typescript',
    'py': 'python',
    'java': 'java',
    'json': 'json',
    'html': 'html',
    'css': 'css'
  };
  return languages[ext] || 'plaintext';
};

const deleteNode = (room, roomId, nodeId, options = {}) => {
  if (options.expectedVersion !== undefined) {
    const versionInfo = getOrCreateVersion(roomId);
    if (options.expectedVersion !== versionInfo.version) {
      return {
        error: 'Structure version mismatch',
        currentVersion: versionInfo.version,
        retry: true
      };
    }
  }

  if (nodeId === 'root') {
    return { error: 'Cannot delete root' };
  }

  const parent = findParentNode(room.structure, nodeId);
  if (!parent) {
    return { error: 'Node not found' };
  }

  const collectFileIds = (node, ids = []) => {
    if (node.type === 'file') {
      ids.push(node.id);
    }
    if (node.children) {
      for (const child of node.children) {
        collectFileIds(child, ids);
      }
    }
    return ids;
  };

  const nodeToDelete = findNodeById(room.structure, nodeId);
  const fileIds = collectFileIds(nodeToDelete);
  fileIds.forEach(id => room.files.delete(id));

  const index = parent.children.findIndex(child => child.id === nodeId);
  if (index > -1) {
    parent.children.splice(index, 1);
    parent.children.forEach((child, i) => {
      child.order = i;
    });
  }

  const newVersion = incrementVersion(roomId, 'delete', { nodeId });

  return {
    success: true,
    structure: room.structure,
    version: newVersion
  };
};

const renameNode = (room, roomId, nodeId, newName, options = {}) => {
  if (options.expectedVersion !== undefined) {
    const versionInfo = getOrCreateVersion(roomId);
    if (options.expectedVersion !== versionInfo.version) {
      return {
        error: 'Structure version mismatch',
        currentVersion: versionInfo.version,
        retry: true
      };
    }
  }

  const node = findNodeById(room.structure, nodeId);
  if (!node) {
    return { error: 'Node not found' };
  }

  if (nodeId === 'root') {
    return { error: 'Cannot rename root' };
  }

  const parent = findParentNode(room.structure, nodeId);
  const exists = parent.children.some(child => child.id !== nodeId && child.name === newName);
  if (exists) {
    return { error: 'Name already exists' };
  }

  node.name = newName;
  if (node.type === 'file') {
    const fileData = room.files.get(nodeId);
    if (fileData) {
      fileData.language = detectLanguage(newName);
    }
  }

  const newVersion = incrementVersion(roomId, 'rename', { nodeId, newName });

  return {
    success: true,
    structure: room.structure,
    version: newVersion
  };
};

const moveNode = (room, roomId, nodeId, newParentId, targetIndex, options = {}) => {
  if (options.expectedVersion !== undefined) {
    const versionInfo = getOrCreateVersion(roomId);
    if (options.expectedVersion !== versionInfo.version) {
      return {
        error: 'Structure version mismatch',
        currentVersion: versionInfo.version,
        retry: true
      };
    }
  }

  if (nodeId === 'root') {
    return { error: 'Cannot move root' };
  }

  const node = findNodeById(room.structure, nodeId);
  const newParent = findNodeById(room.structure, newParentId);

  if (!node || !newParent || newParent.type !== 'folder') {
    return { error: 'Invalid move target' };
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

  if (isDescendant(node, newParentId)) {
    return { error: 'Cannot move a folder into its child' };
  }

  const currentParent = findParentNode(room.structure, nodeId);

  const exists = newParent.children.some(
    child => child.id !== nodeId && child.name === node.name
  );
  if (exists) {
    return { error: 'Name already exists in target folder' };
  }

  const oldIndex = currentParent.children.findIndex(child => child.id === nodeId);

  if (currentParent.id === newParentId) {
    if (targetIndex !== undefined) {
      const actualTargetIndex = targetIndex > oldIndex ? targetIndex - 1 : targetIndex;
      currentParent.children = reorderChildren(
        currentParent.children,
        actualTargetIndex,
        oldIndex
      );
    }
  } else {
    if (oldIndex > -1) {
      currentParent.children.splice(oldIndex, 1);
      currentParent.children.forEach((child, i) => {
        child.order = i;
      });
    }

    const insertIndex = targetIndex !== undefined
      ? Math.min(targetIndex, newParent.children.length)
      : newParent.children.length;

    newParent.children.splice(insertIndex, 0, node);
    newParent.children.forEach((child, i) => {
      child.order = i;
    });
  }

  const newVersion = incrementVersion(roomId, 'move', {
    nodeId,
    newParentId,
    targetIndex
  });

  return {
    success: true,
    structure: room.structure,
    version: newVersion
  };
};

const reorderNode = (room, roomId, nodeId, newOrder, options = {}) => {
  if (options.expectedVersion !== undefined) {
    const versionInfo = getOrCreateVersion(roomId);
    if (options.expectedVersion !== versionInfo.version) {
      return {
        error: 'Structure version mismatch',
        currentVersion: versionInfo.version,
        retry: true
      };
    }
  }

  const parent = findParentNode(room.structure, nodeId);
  if (!parent) {
    return { error: 'Node not found' };
  }

  const currentIndex = parent.children.findIndex(child => child.id === nodeId);
  if (currentIndex === -1) {
    return { error: 'Node not found in parent' };
  }

  const actualTargetIndex = Math.max(0, Math.min(newOrder, parent.children.length - 1));

  parent.children = reorderChildren(parent.children, actualTargetIndex, currentIndex);

  const newVersion = incrementVersion(roomId, 'reorder', {
    nodeId,
    newOrder: actualTargetIndex
  });

  return {
    success: true,
    structure: room.structure,
    version: newVersion
  };
};

const getFileContent = (room, fileId) => {
  return room.files.get(fileId);
};

const updateFileContent = (room, fileId, content) => {
  if (room.files.has(fileId)) {
    room.files.set(fileId, {
      ...room.files.get(fileId),
      content
    });
    return { success: true };
  }
  return { error: 'File not found' };
};

const getStructure = (room) => {
  return JSON.parse(JSON.stringify(room.structure));
};

const getStructureVersion = (roomId) => {
  const versionInfo = getOrCreateVersion(roomId);
  return versionInfo.version;
};

const setStructureVersion = (roomId, version) => {
  const versionInfo = getOrCreateVersion(roomId);
  versionInfo.version = version;
};

const getChangesSince = (roomId, sinceVersion) => {
  const versionInfo = getOrCreateVersion(roomId);
  return versionInfo.history.filter(h => h.version > sinceVersion);
};

module.exports = {
  createFile,
  deleteNode,
  renameNode,
  moveNode,
  reorderNode,
  getFileContent,
  updateFileContent,
  getStructure,
  getStructureVersion,
  setStructureVersion,
  getChangesSince
};
