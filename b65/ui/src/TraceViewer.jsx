import React, { useState, useMemo } from 'react';
import ServiceGraph from './ServiceGraph';

const getServiceColorClass = (serviceName) => {
  const name = serviceName?.toLowerCase() || '';
  if (name.includes('gateway')) return 'service-gateway';
  if (name.includes('user')) return 'service-user';
  if (name.includes('database') || name.includes('db')) return 'service-database';
  return 'service-default';
};

const formatDuration = (microseconds) => {
  if (microseconds < 1000) return `${microseconds} µs`;
  if (microseconds < 1000000) return `${(microseconds / 1000).toFixed(2)} ms`;
  return `${(microseconds / 1000000).toFixed(2)} s`;
};

const buildSpanTree = (spans) => {
  if (!spans || spans.length === 0) return [];

  const spanMap = new Map();
  const rootSpans = [];

  spans.forEach(span => {
    spanMap.set(span.spanId, { ...span, children: [] });
  });

  spans.forEach(span => {
    const node = spanMap.get(span.spanId);
    if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
      const parent = spanMap.get(span.parentSpanId);
      parent.children.push(node);
    } else {
      rootSpans.push(node);
    }
  });

  const sortByStartTime = (a, b) => 
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime();

  rootSpans.sort(sortByStartTime);
  spanMap.forEach(node => {
    node.children.sort(sortByStartTime);
  });

  return rootSpans;
};

const getTraceTimeRange = (spans) => {
  if (!spans || spans.length === 0) {
    return { minTime: 0, maxTime: 1, totalDuration: 1 };
  }

  let minTime = Infinity;
  let maxTime = -Infinity;

  spans.forEach(span => {
    const start = new Date(span.startTime).getTime();
    const end = new Date(span.endTime).getTime();
    if (start < minTime) minTime = start;
    if (end > maxTime) maxTime = end;
  });

  return {
    minTime,
    maxTime,
    totalDuration: maxTime - minTime
  };
};

const flattenTree = (node, depth = 0, result = []) => {
  result.push({ node, depth });
  node.children.forEach(child => flattenTree(child, depth + 1, result));
  return result;
};

const FlameBar = ({ span, minTime, totalDuration, maxDepth, onSelect, selectedSpanId }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const startTime = new Date(span.startTime).getTime();
  const endTime = new Date(span.endTime).getTime();
  const offset = ((startTime - minTime) / totalDuration) * 100;
  const width = ((endTime - startTime) / totalDuration) * 100;

  const colorClass = getServiceColorClass(span.serviceName);
  const isSelected = selectedSpanId === span.spanId;

  return (
    <div
      className="flamegraph-row"
      style={{ marginLeft: `${maxDepth > 0 ? 0 : 0}px` }}
    >
      <div
        className={`flamegraph-bar ${colorClass} ${isSelected ? 'selected' : ''}`}
        style={{
          marginLeft: `${offset}%`,
          width: `${Math.max(width, 2)}%`
        }}
        onClick={() => onSelect(span)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <div className="bar-label">
          <span className="bar-name">{span.name}</span>
          <span className="bar-duration">
            {formatDuration(span.duration)}
          </span>
        </div>

        {showTooltip && (
          <div className="flamegraph-tooltip" style={{ top: '100%', left: 0 }}>
            <div className="tooltip-header">
              <div className="tooltip-name">{span.name}</div>
              <div className="tooltip-service">Service: {span.serviceName}</div>
            </div>
            <div className="tooltip-body">
              <div className="tooltip-row">
                <span className="tooltip-label">Duration</span>
                <span className="tooltip-value">{formatDuration(span.duration)}</span>
              </div>
              <div className="tooltip-row">
                <span className="tooltip-label">Trace ID</span>
                <span className="tooltip-value">{span.traceId}</span>
              </div>
              <div className="tooltip-row">
                <span className="tooltip-label">Span ID</span>
                <span className="tooltip-value">{span.spanId}</span>
              </div>
              {span.parentSpanId && (
                <div className="tooltip-row">
                  <span className="tooltip-label">Parent ID</span>
                  <span className="tooltip-value">{span.parentSpanId}</span>
                </div>
              )}
              {span.tags && Object.keys(span.tags).length > 0 && (
                <div className="tags-section">
                  <div className="tags-title">Tags</div>
                  {Object.entries(span.tags).map(([key, value]) => (
                    <span key={key} className="tag">
                      <span className="tag-key">{key}:</span>
                      <span className="tag-value">{String(value)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const FlameGraph = ({ spans, onSpanSelect, selectedSpanId }) => {
  const tree = useMemo(() => buildSpanTree(spans), [spans]);
  const { minTime, totalDuration } = useMemo(() => getTraceTimeRange(spans), [spans]);

  const flattened = useMemo(() => {
    const result = [];
    tree.forEach(root => flattenTree(root, 0, result));
    return result;
  }, [tree]);

  const maxDepth = useMemo(() => {
    return flattened.reduce((max, item) => Math.max(max, item.depth), 0);
  }, [flattened]);

  if (flattened.length === 0) {
    return (
      <div className="empty-state">
        <p>No spans to display</p>
      </div>
    );
  }

  return (
    <div className="flamegraph">
      {flattened.map(({ node, depth }) => (
        <div key={node.spanId} style={{ paddingLeft: `${depth * 24}px` }}>
          <FlameBar
            span={node}
            minTime={minTime}
            totalDuration={totalDuration}
            maxDepth={maxDepth}
            onSelect={onSpanSelect}
            selectedSpanId={selectedSpanId}
          />
        </div>
      ))}
    </div>
  );
};

const TraceViewer = ({ data }) => {
  const [selectedSpan, setSelectedSpan] = useState(null);
  const [activeTab, setActiveTab] = useState('flamegraph');

  if (!data || !data.spans || data.spans.length === 0) {
    return (
      <div className="empty-state">
        <p>No trace data available</p>
      </div>
    );
  }

  return (
    <div className="trace-viewer">
      <div className="trace-detail-header">
        <h2>Trace Details</h2>
        <div>
          <span className="trace-id">{data.traceId}</span>
          <span style={{ marginLeft: 16, color: '#888' }}>
            {data.spans.length} spans
          </span>
        </div>
      </div>

      <div className="view-tabs">
        <button
          className={`tab-btn ${activeTab === 'flamegraph' ? 'active' : ''}`}
          onClick={() => setActiveTab('flamegraph')}
        >
          火焰图
        </button>
        <button
          className={`tab-btn ${activeTab === 'topology' ? 'active' : ''}`}
          onClick={() => setActiveTab('topology')}
        >
          服务拓扑图
        </button>
      </div>

      <div className="view-content">
        {activeTab === 'flamegraph' ? (
          <FlameGraph
            spans={data.spans}
            onSpanSelect={setSelectedSpan}
            selectedSpanId={selectedSpan?.spanId}
          />
        ) : (
          <ServiceGraph spans={data.spans} />
        )}
      </div>

      {selectedSpan && (
        <div className="selected-span-panel">
          <h3 style={{ color: '#00d9ff', marginBottom: 12 }}>Selected Span</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <span style={{ color: '#888' }}>Name: </span>
              <span>{selectedSpan.name}</span>
            </div>
            <div>
              <span style={{ color: '#888' }}>Service: </span>
              <span>{selectedSpan.serviceName}</span>
            </div>
            <div>
              <span style={{ color: '#888' }}>Duration: </span>
              <span style={{ color: '#ff6b6b' }}>{formatDuration(selectedSpan.duration)}</span>
            </div>
            <div>
              <span style={{ color: '#888' }}>Span ID: </span>
              <span className="trace-id">{selectedSpan.spanId}</span>
            </div>
          </div>
          {selectedSpan.tags && Object.keys(selectedSpan.tags).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <span style={{ color: '#888' }}>Tags: </span>
              {Object.entries(selectedSpan.tags).map(([key, value]) => (
                <span key={key} className="tag" style={{ marginLeft: 4 }}>
                  <span className="tag-key">{key}:</span>
                  <span className="tag-value">{String(value)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TraceViewer;
