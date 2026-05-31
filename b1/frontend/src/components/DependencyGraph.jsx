import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  Handle,
  Position,
  ConnectionLineType,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  getDependencyGraph,
  createDependency,
  deleteDependencyByTasks,
} from '../api';

const CustomNode = ({ data, selected }) => {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        background: selected ? '#667eea' : data.enabled ? '#ffffff' : '#f7fafc',
        border: selected ? '2px solid #5a67d8' : '2px solid #e2e8f0',
        boxShadow: selected ? '0 4px 12px rgba(102, 126, 234, 0.3)' : '0 2px 4px rgba(0,0,0,0.05)',
        minWidth: '140px',
        cursor: 'move',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#667eea', width: 12, height: 12 }}
      />
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontWeight: 600,
            color: selected ? '#ffffff' : data.enabled ? '#1a1a1a' : '#a0aec0',
            fontSize: '13px',
            marginBottom: '4px',
          }}
        >
          {data.name}
        </div>
        <div
          style={{
            fontSize: '11px',
            color: selected ? '#e2e8f0' : '#718096',
          }}
        >
          #{data.taskId}
        </div>
        {!data.enabled && (
          <div style={{ fontSize: '10px', color: '#a0aec0', marginTop: '4px' }}>
            已禁用
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#667eea', width: 12, height: 12 }}
      />
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

const FlowContent = ({ onError, refreshKey }) => {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { screenToFlowPosition } = useReactFlow();
  const [loading, setLoading] = useState(true);

  const layoutNodes = (rawNodes, rawEdges) => {
    const nodeMap = new Map();
    rawNodes.forEach((n) => nodeMap.set(n.id, n));

    const inDegree = new Map();
    const outEdges = new Map();

    rawNodes.forEach((n) => {
      inDegree.set(n.id, 0);
      outEdges.set(n.id, []);
    });

    rawEdges.forEach((e) => {
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
      outEdges.set(e.source, [...(outEdges.get(e.source) || []), e.target]);
    });

    const levels = [];
    const visited = new Set();
    const queue = [];

    inDegree.forEach((deg, id) => {
      if (deg === 0) queue.push(id);
    });

    while (queue.length > 0) {
      const level = [];
      const levelSize = queue.length;
      for (let i = 0; i < levelSize; i++) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        level.push(id);

        (outEdges.get(id) || []).forEach((nextId) => {
          inDegree.set(nextId, inDegree.get(nextId) - 1);
          if (inDegree.get(nextId) === 0) {
            queue.push(nextId);
          }
        });
      }
      if (level.length > 0) levels.push(level);
    }

    rawNodes.forEach((n) => {
      if (!visited.has(n.id)) {
        levels.push([n.id]);
      }
    });

    const horizontalGap = 180;
    const verticalGap = 120;

    const layoutedNodes = rawNodes.map((node) => {
      let levelIndex = -1;
      let nodeIndex = -1;
      levels.forEach((level, li) => {
        const idx = level.indexOf(node.id);
        if (idx !== -1) {
          levelIndex = li;
          nodeIndex = idx;
        }
      });

      const level = levels[levelIndex] || [];
      const x = nodeIndex * horizontalGap + 50;
      const y = levelIndex * verticalGap + 50;

      return {
        ...node,
        type: 'custom',
        position: { x, y },
        data: {
          ...node,
          label: node.name,
        },
      };
    });

    return { layoutedNodes, layoutedEdges: rawEdges };
  };

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const graph = await getDependencyGraph();

      if (graph.nodes.length === 0) {
        setNodes([]);
        setEdges([]);
        return;
      }

      const { layoutedNodes, layoutedEdges } = layoutNodes(graph.nodes, graph.edges);
      setNodes(layoutedNodes);
      setEdges(
        layoutedEdges.map((e) => ({
          ...e,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#667eea', strokeWidth: 2 },
          labelStyle: { fill: '#667eea', fontWeight: 700 },
          markerEnd: {
            type: 'arrowclosed',
            color: '#667eea',
          },
        }))
      );
    } catch (error) {
      console.error('Failed to load dependency graph:', error);
      onError?.('加载依赖图失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges, onError]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph, refreshKey]);

  const onConnect = useCallback(
    async (params) => {
      try {
        const upstreamTaskId = params.source.replace('task-', '');
        const downstreamTaskId = params.target.replace('task-', '');

        await createDependency(parseInt(upstreamTaskId), parseInt(downstreamTaskId));

        setEdges((eds) =>
          addEdge(
            {
              ...params,
              type: 'smoothstep',
              animated: true,
              style: { stroke: '#667eea', strokeWidth: 2 },
              markerEnd: {
                type: 'arrowclosed',
                color: '#667eea',
              },
            },
            eds
          )
        );
      } catch (error) {
        onError?.('创建依赖失败: ' + error.message);
      }
    },
    [setEdges, onError]
  );

  const onEdgeClick = useCallback(
    async (event, edge) => {
      if (confirm('确定要删除这条依赖关系吗？')) {
        try {
          const upstreamTaskId = edge.source.replace('task-', '');
          const downstreamTaskId = edge.target.replace('task-', '');

          await deleteDependencyByTasks(parseInt(upstreamTaskId), parseInt(downstreamTaskId));

          setEdges((eds) => eds.filter((e) => e.id !== edge.id));
        } catch (error) {
          onError?.('删除依赖失败: ' + error.message);
        }
      }
    },
    [setEdges, onError]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  if (loading) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#718096',
        }}
      >
        加载中...
      </div>
    );
  }

  return (
    <div ref={reactFlowWrapper} style={{ height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
        onDragOver={onDragOver}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#667eea', strokeWidth: 2 }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-left"
      >
        <Controls />
        <Background color="#e2e8f0" gap={16} />
      </ReactFlow>
    </div>
  );
};

const DependencyGraph = ({ onError, refreshKey = 0 }) => {
  return (
    <ReactFlowProvider>
      <FlowContent onError={onError} refreshKey={refreshKey} />
    </ReactFlowProvider>
  );
};

export default DependencyGraph;
