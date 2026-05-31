import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FlowchartCRDT,
  createNode,
  createEdge,
  createOperation,
  NodeType,
  OperationType,
  MessageType,
  OperationLabelMap,
  parseTimestamp,
} from 'shared';

const WS_URL = 'ws://localhost:3001';

const nodeTypes = [
  { type: NodeType.START, label: '开始', color: '#4CAF50' },
  { type: NodeType.END, label: '结束', color: '#F44336' },
  { type: NodeType.PROCESS, label: '处理', color: '#2196F3' },
  { type: NodeType.DECISION, label: '判断', color: '#FF9800' },
  { type: NodeType.INPUT, label: '输入', color: '#9C27B0' },
  { type: NodeType.OUTPUT, label: '输出', color: '#00BCD4' },
];

function generateId() {
  return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getNodeCenter(node) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function isPointInNode(point, node) {
  return (
    point.x >= node.x &&
    point.x <= node.x + node.width &&
    point.y >= node.y &&
    point.y <= node.y + node.height
  );
}

function formatTime(tsStr) {
  try {
    const ts = parseTimestamp(tsStr);
    const date = new Date(ts.ms);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function App() {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const crdtRef = useRef(null);
  const clientIdRef = useRef(null);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('连接中...');

  const [checkpoints, setCheckpoints] = useState([]);
  const [history, setHistory] = useState([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [newCheckpointLabel, setNewCheckpointLabel] = useState('');

  const dragState = useRef({
    isDragging: false,
    nodeId: null,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
  });

  const edgeState = useRef({
    isCreating: false,
    sourceId: null,
    mouseX: 0,
    mouseY: 0,
  });

  const syncCrdt = useCallback(() => {
    if (crdtRef.current) {
      setNodes(crdtRef.current.getNodes());
      setEdges(crdtRef.current.getEdges());
      setCanUndo(crdtRef.current.canUndo());
      setCanRedo(crdtRef.current.canRedo());
      setCheckpoints(crdtRef.current.getCheckpoints());
      setHistory(crdtRef.current.getHistory(100));
    }
  }, []);

  const sendMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const sendOperation = useCallback((operation) => {
    sendMessage({
      type: MessageType.OPERATION,
      operation,
    });
  }, [sendMessage]);

  const applyAndSendOperation = useCallback(
    (type, entityType, entityId, data) => {
      if (!crdtRef.current || !clientIdRef.current) return;

      const operation = createOperation(
        type,
        entityType,
        entityId,
        data,
        clientIdRef.current
      );

      crdtRef.current.applyOperation(operation);
      syncCrdt();
      sendOperation(operation);
    },
    [syncCrdt, sendOperation]
  );

  const handleUndo = useCallback(() => {
    sendMessage({ type: MessageType.UNDO });
  }, [sendMessage]);

  const handleRedo = useCallback(() => {
    sendMessage({ type: MessageType.REDO });
  }, [sendMessage]);

  const handleCreateCheckpoint = useCallback(() => {
    const label = newCheckpointLabel.trim() || `检查点 ${checkpoints.length + 1}`;
    sendMessage({ type: MessageType.CHECKPOINT, label });
    setNewCheckpointLabel('');
  }, [sendMessage, newCheckpointLabel, checkpoints.length]);

  const handleRevertToCheckpoint = useCallback(
    (checkpointId) => {
      if (window.confirm('确定要回滚到此检查点吗？当前未保存的更改将丢失。')) {
        sendMessage({ type: MessageType.REVERT_TO_CHECKPOINT, checkpointId });
      }
    },
    [sendMessage]
  );

  const requestHistory = useCallback(() => {
    sendMessage({ type: MessageType.HISTORY_REQUEST, limit: 100 });
  }, [sendMessage]);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setStatus('已连接');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'init':
              clientIdRef.current = message.clientId;
              if (message.state) {
                crdtRef.current = FlowchartCRDT.fromState(message.state);
                if (message.checkpoints) {
                  crdtRef.current.checkpoints = message.checkpoints;
                }
                syncCrdt();
              }
              break;

            case MessageType.OPERATION:
              if (crdtRef.current) {
                const applied = crdtRef.current.applyOperation(message.operation, true);
                if (applied) {
                  syncCrdt();
                }
              }
              break;

            case MessageType.CHECKPOINT:
              if (crdtRef.current && message.checkpoint) {
                crdtRef.current.checkpoints.push(message.checkpoint);
                crdtRef.current.snapshotMap.set(
                  message.checkpoint.id,
                  message.checkpoint.state
                );
                syncCrdt();
              }
              break;

            case MessageType.REVERT_TO_CHECKPOINT:
              if (crdtRef.current && message.state) {
                crdtRef.current = FlowchartCRDT.fromState(message.state);
                if (message.checkpoint) {
                  crdtRef.current.checkpoints = [message.checkpoint, ...crdtRef.current.checkpoints.filter(c => c.id !== message.checkpoint.id)];
                }
                syncCrdt();
              }
              break;

            case MessageType.HISTORY_RESPONSE:
              if (message.history) {
                setHistory(message.history);
              }
              if (message.checkpoints) {
                setCheckpoints(message.checkpoints);
                if (crdtRef.current) {
                  crdtRef.current.checkpoints = message.checkpoints;
                }
              }
              break;

            case MessageType.SYNC_RESPONSE:
              if (message.state && crdtRef.current) {
                crdtRef.current.merge(message.state);
                if (message.checkpoints) {
                  crdtRef.current.checkpoints = message.checkpoints;
                }
                syncCrdt();
              }
              break;
          }
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setStatus('断开连接，3秒后重连...');
        setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setStatus('连接错误');
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [syncCrdt]);

  useEffect(() => {
    if (!crdtRef.current) {
      crdtRef.current = new FlowchartCRDT('local');
    }
  }, []);

  const getCanvasCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const handleCanvasMouseDown = useCallback(
    (e) => {
      const point = getCanvasCoords(e);

      for (const node of nodes) {
        if (isPointInNode(point, node)) {
          setSelectedNodeId(node.id);
          setSelectedEdgeId(null);

          dragState.current = {
            isDragging: true,
            nodeId: node.id,
            offsetX: point.x - node.x,
            offsetY: point.y - node.y,
            startX: node.x,
            startY: node.y,
          };

          return;
        }
      }

      for (const edge of edges) {
        const sourceNode = nodes.find((n) => n.id === edge.sourceId);
        const targetNode = nodes.find((n) => n.id === edge.targetId);
        if (!sourceNode || !targetNode) continue;

        const start = getNodeCenter(sourceNode);
        const end = getNodeCenter(targetNode);

        const dist = distanceToSegment(point, start, end);
        if (dist < 10) {
          setSelectedEdgeId(edge.id);
          setSelectedNodeId(null);
          return;
        }
      }

      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    },
    [getCanvasCoords, nodes, edges]
  );

  const handleCanvasMouseMove = useCallback(
    (e) => {
      const point = getCanvasCoords(e);

      if (edgeState.current.isCreating) {
        edgeState.current.mouseX = point.x;
        edgeState.current.mouseY = point.y;
        renderCanvas();
        return;
      }

      if (dragState.current.isDragging) {
        const { nodeId, offsetX, offsetY } = dragState.current;
        const newX = point.x - offsetX;
        const newY = point.y - offsetY;

        applyAndSendOperation(
          OperationType.UPDATE_NODE,
          'node',
          nodeId,
          { x: newX, y: newY }
        );
      }
    },
    [getCanvasCoords, applyAndSendOperation]
  );

  const handleCanvasMouseUp = useCallback(() => {
    dragState.current.isDragging = false;
    dragState.current.nodeId = null;
  }, []);

  const handleDoubleClick = useCallback(
    (e) => {
      const point = getCanvasCoords(e);

      for (const node of nodes) {
        if (isPointInNode(point, node)) {
          const newLabel = prompt('输入节点标签:', node.label || '');
          if (newLabel !== null) {
            applyAndSendOperation(
              OperationType.UPDATE_NODE,
              'node',
              node.id,
              { label: newLabel }
            );
          }
          return;
        }
      }
    },
    [getCanvasCoords, nodes, applyAndSendOperation]
  );

  const handleAddNode = useCallback(
    (nodeType) => {
      const typeConfig = nodeTypes.find((t) => t.type === nodeType);
      const node = createNode(
        generateId(),
        nodeType,
        100 + Math.random() * 200,
        100 + Math.random() * 200,
        typeConfig.label
      );
      node.properties.color = typeConfig.color;

      applyAndSendOperation(OperationType.ADD_NODE, 'node', node.id, node);
    },
    [applyAndSendOperation]
  );

  const startEdgeCreation = useCallback(() => {
    if (!selectedNodeId) {
      alert('请先选择一个节点作为起点');
      return;
    }
    edgeState.current.isCreating = true;
    edgeState.current.sourceId = selectedNodeId;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    edgeState.current.mouseX = rect.width / 2;
    edgeState.current.mouseY = rect.height / 2;
  }, [selectedNodeId]);

  const handleCanvasClick = useCallback(
    (e) => {
      if (edgeState.current.isCreating) {
        const point = getCanvasCoords(e);

        for (const node of nodes) {
          if (isPointInNode(point, node) && node.id !== edgeState.current.sourceId) {
            const edge = createEdge(
              generateId(),
              edgeState.current.sourceId,
              node.id,
              ''
            );
            applyAndSendOperation(OperationType.ADD_EDGE, 'edge', edge.id, edge);
            edgeState.current.isCreating = false;
            edgeState.current.sourceId = null;
            return;
          }
        }

        edgeState.current.isCreating = false;
        edgeState.current.sourceId = null;
      }
    },
    [getCanvasCoords, nodes, applyAndSendOperation]
  );

  const handleDelete = useCallback(() => {
    if (selectedNodeId) {
      const edgesToRemove = edges.filter(
        (e) => e.sourceId === selectedNodeId || e.targetId === selectedNodeId
      );
      for (const edge of edgesToRemove) {
        applyAndSendOperation(OperationType.REMOVE_EDGE, 'edge', edge.id, null);
      }
      applyAndSendOperation(
        OperationType.REMOVE_NODE,
        'node',
        selectedNodeId,
        null
      );
      setSelectedNodeId(null);
    }

    if (selectedEdgeId) {
      applyAndSendOperation(OperationType.REMOVE_EDGE, 'edge', selectedEdgeId, null);
      setSelectedEdgeId(null);
    }
  }, [selectedNodeId, selectedEdgeId, edges, applyAndSendOperation]);

  const handleUpdateProperty = useCallback(
    (key, value) => {
      if (selectedNodeId) {
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (!node) return;

        if (key === 'label' || key === 'x' || key === 'y') {
          applyAndSendOperation(
            OperationType.UPDATE_NODE,
            'node',
            selectedNodeId,
            { [key]: value }
          );
        } else {
          applyAndSendOperation(
            OperationType.UPDATE_NODE,
            'node',
            selectedNodeId,
            { properties: { ...node.properties, [key]: value } }
          );
        }
      }

      if (selectedEdgeId) {
        const edge = edges.find((e) => e.id === selectedEdgeId);
        if (!edge) return;

        if (key === 'label') {
          applyAndSendOperation(
            OperationType.UPDATE_EDGE,
            'edge',
            selectedEdgeId,
            { [key]: value }
          );
        } else {
          applyAndSendOperation(
            OperationType.UPDATE_EDGE,
            'edge',
            selectedEdgeId,
            { properties: { ...edge.properties, [key]: value } }
          );
        }
      }
    },
    [selectedNodeId, selectedEdgeId, nodes, edges, applyAndSendOperation]
  );

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    for (const edge of edges) {
      const sourceNode = nodes.find((n) => n.id === edge.sourceId);
      const targetNode = nodes.find((n) => n.id === edge.targetId);
      if (!sourceNode || !targetNode) continue;

      const start = getNodeCenter(sourceNode);
      const end = getNodeCenter(targetNode);

      ctx.strokeStyle =
        edge.id === selectedEdgeId ? '#2196F3' : edge.properties.color || '#333';
      ctx.lineWidth = edge.properties.lineWidth || 2;

      const arrowSize = 10;
      const angle = Math.atan2(end.y - start.y, end.x - start.x);

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x - Math.cos(angle) * 30, end.y - Math.sin(angle) * 30);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - arrowSize * Math.cos(angle - Math.PI / 6),
        end.y - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        end.x - arrowSize * Math.cos(angle + Math.PI / 6),
        end.y - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle =
        edge.id === selectedEdgeId ? '#2196F3' : edge.properties.color || '#333';
      ctx.fill();

      if (edge.label) {
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        ctx.fillStyle = '#fff';
        ctx.fillRect(midX - 30, midY - 10, 60, 20);
        ctx.fillStyle = '#333';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(edge.label, midX, midY);
      }
    }

    if (edgeState.current.isCreating) {
      const sourceNode = nodes.find((n) => n.id === edgeState.current.sourceId);
      if (sourceNode) {
        const start = getNodeCenter(sourceNode);
        const end = {
          x: edgeState.current.mouseX,
          y: edgeState.current.mouseY,
        };

        ctx.strokeStyle = '#2196F3';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const node of nodes) {
      ctx.fillStyle = node.properties.color || '#fff';
      ctx.strokeStyle =
        node.id === selectedNodeId ? '#2196F3' : '#ccc';
      ctx.lineWidth = node.id === selectedNodeId ? 3 : 1;

      if (node.type === NodeType.DECISION) {
        ctx.beginPath();
        ctx.moveTo(node.x + node.width / 2, node.y);
        ctx.lineTo(node.x + node.width, node.y + node.height / 2);
        ctx.lineTo(node.x + node.width / 2, node.y + node.height);
        ctx.lineTo(node.x, node.y + node.height / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(node.x, node.y, node.width, node.height);
        ctx.strokeRect(node.x, node.y, node.width, node.height);
      }

      ctx.fillStyle = node.properties.textColor || '#333';
      ctx.font = `${node.properties.fontSize || 14}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        node.label || '',
        node.x + node.width / 2,
        node.y + node.height / 2
      );
    }
  }, [nodes, edges, selectedNodeId, selectedEdgeId]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) handleRedo();
        } else {
          if (canUndo) handleUndo();
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement.tagName !== 'INPUT') {
          handleDelete();
        }
      }

      if (e.key === 'Escape') {
        edgeState.current.isCreating = false;
        edgeState.current.sourceId = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDelete, handleUndo, handleRedo, canUndo, canRedo]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <div
        style={{
          width: 240,
          background: '#fff',
          borderRight: '1px solid #e0e0e0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: 16, borderBottom: '1px solid #e0e0e0' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#333' }}>协同流程图</h3>
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              title="撤销 (Ctrl+Z)"
              style={{
                flex: 1,
                padding: '8px 12px',
                border: 'none',
                background: canUndo ? '#f0f0f0' : '#f5f5f5',
                color: canUndo ? '#333' : '#ccc',
                borderRadius: 4,
                cursor: canUndo ? 'pointer' : 'not-allowed',
                fontSize: 14,
              }}
            >
              ↶ 撤销
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              title="重做 (Ctrl+Shift+Z)"
              style={{
                flex: 1,
                padding: '8px 12px',
                border: 'none',
                background: canRedo ? '#f0f0f0' : '#f5f5f5',
                color: canRedo ? '#333' : '#ccc',
                borderRadius: 4,
                cursor: canRedo ? 'pointer' : 'not-allowed',
                fontSize: 14,
              }}
            >
              ↷ 重做
            </button>
          </div>

          <button
            onClick={() => setShowHistoryPanel(!showHistoryPanel)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              background: '#2196F3',
              color: '#fff',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {showHistoryPanel ? '关闭历史' : '📜 历史记录'}
          </button>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, color: '#666' }}>节点工具</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nodeTypes.map((t) => (
              <button
                key={t.type}
                onClick={() => handleAddNode(t.type)}
                style={{
                  padding: '10px 16px',
                  border: `2px solid ${t.color}`,
                  background: t.color + '20',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #e0e0e0', paddingTop: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, color: '#666' }}>操作</h4>
          <button
            onClick={startEdgeCreation}
            disabled={!selectedNodeId}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: selectedNodeId ? '#2196F3' : '#ccc',
              color: '#fff',
              borderRadius: 6,
              cursor: selectedNodeId ? 'pointer' : 'not-allowed',
              fontSize: 14,
              marginBottom: 8,
              width: '100%',
            }}
          >
            创建连线
          </button>
          <button
            onClick={handleDelete}
            disabled={!selectedNodeId && !selectedEdgeId}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: selectedNodeId || selectedEdgeId ? '#F44336' : '#ccc',
              color: '#fff',
              borderRadius: 6,
              cursor: selectedNodeId || selectedEdgeId ? 'pointer' : 'not-allowed',
              fontSize: 14,
              width: '100%',
            }}
          >
            删除选中
          </button>
        </div>

        <div style={{ marginTop: 'auto', padding: 16, borderTop: '1px solid #e0e0e0' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: '#666',
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: isConnected ? '#4CAF50' : '#F44336',
              }}
            />
            {status}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              cursor:
                edgeState.current.isCreating
                  ? 'crosshair'
                  : dragState.current.isDragging
                  ? 'grabbing'
                  : 'default',
            }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onDoubleClick={handleDoubleClick}
            onClick={handleCanvasClick}
          />

          {edgeState.current.isCreating && (
            <div
              style={{
                position: 'absolute',
                top: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#2196F3',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: 4,
                fontSize: 14,
              }}
            >
              点击另一个节点完成连线，或点击空白处取消
            </div>
          )}
        </div>

        {showHistoryPanel && (
          <div
            style={{
              height: 280,
              background: '#fafafa',
              borderTop: '1px solid #e0e0e0',
              display: 'flex',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: 260,
                borderRight: '1px solid #e0e0e0',
                padding: 12,
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  value={newCheckpointLabel}
                  onChange={(e) => setNewCheckpointLabel(e.target.value)}
                  placeholder="检查点名称..."
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    fontSize: 13,
                  }}
                />
                <button
                  onClick={handleCreateCheckpoint}
                  style={{
                    padding: '6px 12px',
                    border: 'none',
                    background: '#2196F3',
                    color: '#fff',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  保存
                </button>
              </div>

              <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#666' }}>
                检查点 ({checkpoints.length})
              </h4>

              {checkpoints.length === 0 ? (
                <p style={{ color: '#999', fontSize: 12 }}>暂无检查点</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {checkpoints.map((cp) => (
                    <div
                      key={cp.id}
                      style={{
                        padding: 10,
                        background: '#fff',
                        borderRadius: 4,
                        border: '1px solid #e0e0e0',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#333' }}>
                          {cp.label}
                        </span>
                        <span style={{ fontSize: 11, color: '#999' }}>
                          {formatTime(cp.timestamp)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                        {cp.operationCount || 0} 个操作
                      </div>
                      <button
                        onClick={() => handleRevertToCheckpoint(cp.id)}
                        style={{
                          width: '100%',
                          padding: '4px 8px',
                          border: '1px solid #F44336',
                          background: 'transparent',
                          color: '#F44336',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        回滚到此版本
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                flex: 1,
                padding: 12,
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <h4 style={{ margin: 0, fontSize: 13, color: '#666' }}>
                  操作历史 (最近 {history.length} 条)
                </h4>
                <button
                  onClick={requestHistory}
                  style={{
                    padding: '4px 8px',
                    border: 'none',
                    background: 'transparent',
                    color: '#2196F3',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  刷新
                </button>
              </div>

              {history.length === 0 ? (
                <p style={{ color: '#999', fontSize: 12 }}>暂无操作记录</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {history.map((op, index) => (
                    <div
                      key={op.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 10px',
                        background: index === 0 ? '#e3f2fd' : '#fff',
                        borderRadius: 4,
                        border: '1px solid #e0e0e0',
                        fontSize: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background:
                            op.type === OperationType.ADD_NODE
                              ? '#4CAF50'
                              : op.type === OperationType.REMOVE_NODE ||
                                op.type === OperationType.REMOVE_EDGE
                              ? '#F44336'
                              : '#FF9800',
                        }}
                      />
                      <span style={{ flex: 1, color: '#333' }}>
                        {OperationLabelMap[op.type] || op.type}
                      </span>
                      <span style={{ color: '#999', fontSize: 11 }}>
                        {formatTime(op.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          width: 280,
          background: '#fff',
          borderLeft: '1px solid #e0e0e0',
          padding: 16,
        }}
      >
        <h3 style={{ marginBottom: 16, fontSize: 16, color: '#333' }}>属性编辑</h3>

        {selectedNode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}>
                标签
              </label>
              <input
                type="text"
                value={selectedNode.label || ''}
                onChange={(e) => handleUpdateProperty('label', e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label
                  style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}
                >
                  X
                </label>
                <input
                  type="number"
                  value={Math.round(selectedNode.x)}
                  onChange={(e) =>
                    handleUpdateProperty('x', parseFloat(e.target.value) || 0)
                  }
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    fontSize: 14,
                  }}
                />
              </div>
              <div>
                <label
                  style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}
                >
                  Y
                </label>
                <input
                  type="number"
                  value={Math.round(selectedNode.y)}
                  onChange={(e) =>
                    handleUpdateProperty('y', parseFloat(e.target.value) || 0)
                  }
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    fontSize: 14,
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}>
                背景色
              </label>
              <input
                type="color"
                value={selectedNode.properties.color || '#ffffff'}
                onChange={(e) => handleUpdateProperty('color', e.target.value)}
                style={{
                  width: '100%',
                  height: 40,
                  border: 'none',
                  cursor: 'pointer',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}>
                文字颜色
              </label>
              <input
                type="color"
                value={selectedNode.properties.textColor || '#333333'}
                onChange={(e) => handleUpdateProperty('textColor', e.target.value)}
                style={{
                  width: '100%',
                  height: 40,
                  border: 'none',
                  cursor: 'pointer',
                }}
              />
            </div>
          </div>
        )}

        {selectedEdge && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}>
                标签
              </label>
              <input
                type="text"
                value={selectedEdge.label || ''}
                onChange={(e) => handleUpdateProperty('label', e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  fontSize: 14,
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}>
                线条颜色
              </label>
              <input
                type="color"
                value={selectedEdge.properties.color || '#333333'}
                onChange={(e) => handleUpdateProperty('color', e.target.value)}
                style={{
                  width: '100%',
                  height: 40,
                  border: 'none',
                  cursor: 'pointer',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#666' }}>
                线条宽度: {selectedEdge.properties.lineWidth || 2}px
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={selectedEdge.properties.lineWidth || 2}
                onChange={(e) =>
                  handleUpdateProperty('lineWidth', parseInt(e.target.value))
                }
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}

        {!selectedNode && !selectedEdge && (
          <div>
            <p style={{ color: '#999', fontSize: 14, marginBottom: 16 }}>
              请选择一个节点或边来编辑属性
            </p>

            <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 6, fontSize: 12, color: '#666' }}>
              <p style={{ margin: '0 0 8px', fontWeight: 500 }}>快捷键</p>
              <p style={{ margin: '4px 0' }}>• Ctrl+Z: 撤销</p>
              <p style={{ margin: '4px 0' }}>• Ctrl+Shift+Z: 重做</p>
              <p style={{ margin: '4px 0' }}>• Delete: 删除选中</p>
              <p style={{ margin: '4px 0' }}>• 双击节点: 编辑标签</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function distanceToSegment(point, start, end) {
  const A = point.x - start.x;
  const B = point.y - start.y;
  const C = end.x - start.x;
  const D = end.y - start.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;

  if (param < 0) {
    xx = start.x;
    yy = start.y;
  } else if (param > 1) {
    xx = end.x;
    yy = end.y;
  } else {
    xx = start.x + param * C;
    yy = start.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

export default App;
