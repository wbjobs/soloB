import React, { useMemo, useState } from 'react';

const SERVICE_COLORS = {
  gateway: { bg: '#4ecdc4', text: '#1a1a2e' },
  'user-service': { bg: '#ffe66d', text: '#1a1a2e' },
  user: { bg: '#ffe66d', text: '#1a1a2e' },
  database: { bg: '#ff6b6b', text: '#fff' },
  db: { bg: '#ff6b6b', text: '#fff' },
  order: { bg: '#a29bfe', text: '#fff' },
  payment: { bg: '#fd79a8', text: '#fff' },
  cache: { bg: '#00b894', text: '#fff' },
  default: { bg: '#6c757d', text: '#fff' }
};

const getServiceColor = (serviceName) => {
  const name = (serviceName || '').toLowerCase();
  for (const [key, color] of Object.entries(SERVICE_COLORS)) {
    if (name.includes(key)) {
      return color;
    }
  }
  return SERVICE_COLORS.default;
};

const formatDuration = (microseconds) => {
  if (!microseconds) return '-';
  if (microseconds < 1000) return `${microseconds} µs`;
  if (microseconds < 1000000) return `${(microseconds / 1000).toFixed(2)} ms`;
  return `${(microseconds / 1000000).toFixed(2)} s`;
};

const buildServiceGraph = (spans) => {
  if (!spans || spans.length === 0) {
    return { nodes: [], edges: [] };
  }

  const spanMap = new Map();
  spans.forEach(span => {
    spanMap.set(span.spanId, span);
  });

  const serviceSet = new Set();
  const edgeMap = new Map();

  spans.forEach(span => {
    const currentService = span.serviceName || 'unknown';
    serviceSet.add(currentService);

    if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
      const parentSpan = spanMap.get(span.parentSpanId);
      const parentService = parentSpan.serviceName || 'unknown';

      if (parentService !== currentService) {
        const edgeKey = `${parentService}->${currentService}`;
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, {
            source: parentService,
            target: currentService,
            count: 0,
            totalDuration: 0,
            avgDuration: 0
          });
        }
        const edge = edgeMap.get(edgeKey);
        edge.count++;
        edge.totalDuration += span.duration || 0;
        edge.avgDuration = edge.totalDuration / edge.count;
      }
    }
  });

  const serviceStats = new Map();
  serviceSet.forEach(service => {
    const serviceSpans = spans.filter(s => (s.serviceName || 'unknown') === service);
    const totalDuration = serviceSpans.reduce((sum, s) => sum + (s.duration || 0), 0);
    const avgDuration = serviceSpans.length > 0 ? totalDuration / serviceSpans.length : 0;

    serviceStats.set(service, {
      name: service,
      spanCount: serviceSpans.length,
      totalDuration,
      avgDuration
    });
  });

  const nodes = Array.from(serviceSet).map(service => ({
    id: service,
    label: service,
    ...serviceStats.get(service),
    color: getServiceColor(service)
  }));

  const edges = Array.from(edgeMap.values());

  return { nodes, edges };
};

const calculateLayout = (nodes, edges) => {
  if (nodes.length === 0) return {};

  const nodePositions = {};
  const visited = new Set();
  const levels = [];

  const inDegree = new Map();
  nodes.forEach(node => inDegree.set(node.id, 0));

  edges.forEach(edge => {
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  });

  const queue = [];
  nodes.forEach(node => {
    if ((inDegree.get(node.id) || 0) === 0) {
      queue.push({ node, level: 0 });
    }
  });

  while (queue.length > 0) {
    const { node, level } = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);

    if (!levels[level]) levels[level] = [];
    levels[level].push(node);

    edges.forEach(edge => {
      if (edge.source === node.id && !visited.has(edge.target)) {
        const remaining = (inDegree.get(edge.target) || 1) - 1;
        inDegree.set(edge.target, remaining);
        if (remaining <= 0) {
          queue.push({ node: nodes.find(n => n.id === edge.target), level: level + 1 });
        }
      }
    });
  }

  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      if (!levels[levels.length - 1]) levels[levels.length - 1] = [];
      levels[levels.length - 1].push(node);
    }
  });

  const canvasWidth = 800;
  const canvasHeight = 400;
  const nodeRadius = 45;
  const levelCount = levels.length;

  levels.forEach((levelNodes, levelIndex) => {
    const y = canvasHeight * (levelIndex + 1) / (levelCount + 1);
    const count = levelNodes.length;

    levelNodes.forEach((node, nodeIndex) => {
      const spacing = canvasWidth / (count + 1);
      const x = spacing * (nodeIndex + 1);
      nodePositions[node.id] = { x, y, r: nodeRadius };
    });
  });

  return nodePositions;
};

const ServiceGraph = ({ spans }) => {
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);

  const graph = useMemo(() => buildServiceGraph(spans), [spans]);
  const positions = useMemo(() => calculateLayout(graph.nodes, graph.edges), [graph.nodes, graph.edges]);

  if (graph.nodes.length === 0) {
    return (
      <div className="empty-state">
        <p>No service data available</p>
      </div>
    );
  }

  return (
    <div className="service-graph">
      <div className="graph-header">
        <h3 style={{ color: '#00d9ff', marginBottom: 8 }}>服务拓扑图</h3>
        <div style={{ color: '#888', fontSize: '0.85rem' }}>
          {graph.nodes.length} 个服务 · {graph.edges.length} 条调用关系
        </div>
      </div>

      <div className="graph-container">
        <svg viewBox="0 0 800 400" className="graph-svg">
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#00d9ff" />
            </marker>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {graph.edges.map((edge, index) => {
            const sourcePos = positions[edge.source];
            const targetPos = positions[edge.target];
            if (!sourcePos || !targetPos) return null;

            const dx = targetPos.x - sourcePos.x;
            const dy = targetPos.y - sourcePos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const unitX = dx / distance;
            const unitY = dy / distance;

            const startX = sourcePos.x + unitX * (sourcePos.r + 5);
            const startY = sourcePos.y + unitY * (sourcePos.r + 5);
            const endX = targetPos.x - unitX * (targetPos.r + 10);
            const endY = targetPos.y - unitY * (targetPos.r + 10);

            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2;

            const isHovered = hoveredEdge === index;

            return (
              <g key={`edge-${index}`}>
                <line
                  x1={startX}
                  y1={startY}
                  x2={endX}
                  y2={endY}
                  stroke={isHovered ? '#00d9ff' : '#4a5568'}
                  strokeWidth={isHovered ? 3 : 2}
                  markerEnd="url(#arrowhead)"
                  className="graph-edge"
                  onMouseEnter={() => setHoveredEdge(index)}
                  onMouseLeave={() => setHoveredEdge(null)}
                />
                {isHovered && (
                  <g>
                    <rect
                      x={midX - 60}
                      y={midY - 25}
                      width="120"
                      height="50"
                      rx="6"
                      fill="#0f3460"
                      stroke="#00d9ff"
                      strokeWidth="1"
                    />
                    <text
                      x={midX}
                      y={midY - 8}
                      textAnchor="middle"
                      fill="#00d9ff"
                      fontSize="11"
                      fontWeight="bold"
                    >
                      {edge.count} 次调用
                    </text>
                    <text
                      x={midX}
                      y={midY + 12}
                      textAnchor="middle"
                      fill="#eaeaea"
                      fontSize="10"
                    >
                      平均: {formatDuration(Math.round(edge.avgDuration))}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {graph.nodes.map((node) => {
            const pos = positions[node.id];
            if (!pos) return null;

            const isHovered = hoveredNode === node.id;

            return (
              <g
                key={node.id}
                className="graph-node"
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={pos.r}
                  fill={node.color.bg}
                  stroke={isHovered ? '#00d9ff' : 'transparent'}
                  strokeWidth={isHovered ? 3 : 0}
                  filter={isHovered ? 'url(#glow)' : undefined}
                  style={{ transition: 'all 0.2s' }}
                />

                <text
                  x={pos.x}
                  y={pos.y - 5}
                  textAnchor="middle"
                  fill={node.color.text}
                  fontSize="12"
                  fontWeight="bold"
                  style={{ pointerEvents: 'none' }}
                >
                  {node.label.length > 10 ? node.label.substring(0, 10) + '...' : node.label}
                </text>

                <text
                  x={pos.x}
                  y={pos.y + 12}
                  textAnchor="middle"
                  fill={node.color.text}
                  fontSize="10"
                  opacity="0.9"
                  style={{ pointerEvents: 'none' }}
                >
                  {node.spanCount} spans
                </text>

                <text
                  x={pos.x}
                  y={pos.y + 28}
                  textAnchor="middle"
                  fill={node.color.text}
                  fontSize="9"
                  opacity="0.8"
                  style={{ pointerEvents: 'none' }}
                >
                  {formatDuration(Math.round(node.avgDuration))}
                </text>

                {isHovered && (
                  <g>
                    <rect
                      x={pos.x - 90}
                      y={pos.y - pos.r - 95}
                      width="180"
                      height="80"
                      rx="6"
                      fill="#0f3460"
                      stroke="#00d9ff"
                      strokeWidth="1"
                    />
                    <text
                      x={pos.x}
                      y={pos.y - pos.r - 75}
                      textAnchor="middle"
                      fill="#00d9ff"
                      fontSize="12"
                      fontWeight="bold"
                    >
                      {node.label}
                    </text>
                    <text
                      x={pos.x}
                      y={pos.y - pos.r - 55}
                      textAnchor="middle"
                      fill="#eaeaea"
                      fontSize="10"
                    >
                      Span 数量: {node.spanCount}
                    </text>
                    <text
                      x={pos.x}
                      y={pos.y - pos.r - 38}
                      textAnchor="middle"
                      fill="#eaeaea"
                      fontSize="10"
                    >
                      总耗时: {formatDuration(node.totalDuration)}
                    </text>
                    <text
                      x={pos.x}
                      y={pos.y - pos.r - 21}
                      textAnchor="middle"
                      fill="#eaeaea"
                      fontSize="10"
                    >
                      平均耗时: {formatDuration(Math.round(node.avgDuration))}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="graph-legend">
        <div className="legend-title">图例</div>
        <div className="legend-items">
          {Object.entries(SERVICE_COLORS)
            .filter(([key]) => key !== 'default')
            .map(([key, color]) => (
              <div key={key} className="legend-item">
                <span
                  className="legend-dot"
                  style={{ backgroundColor: color.bg }}
                ></span>
                <span>{key}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default ServiceGraph;
