import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const TopologyGraph = ({ data }) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }

    if (!data || !data.nodes || !data.edges) {
      const emptyOption = {
        backgroundColor: 'transparent',
        title: {
          text: '暂无拓扑数据',
          left: 'center',
          top: 'center',
          textStyle: { color: '#888', fontSize: 14 },
        },
      };
      chartInstance.current.setOption(emptyOption, true);
      return;
    }

    const { nodes, edges } = data;

    if (nodes.length === 0) {
      const emptyOption = {
        backgroundColor: 'transparent',
        title: {
          text: '暂无拓扑数据',
          left: 'center',
          top: 'center',
          textStyle: { color: '#888', fontSize: 14 },
        },
      };
      chartInstance.current.setOption(emptyOption, true);
      return;
    }

    const categories = [
      { name: 'Process', itemStyle: { color: '#00d4ff' } },
      { name: 'Endpoint', itemStyle: { color: '#00ff88' } },
    ];

    const validNodes = nodes.filter(node => node && node.id && node.name && node.type);

    const graphNodes = validNodes.map((node) => {
      const nodeName = node.name.length > 30 ? node.name.substring(0, 30) + '...' : node.name;
      return {
        id: String(node.id),
        name: nodeName,
        category: node.type === 'process' ? 0 : 1,
        symbolSize: node.type === 'process' ? 50 : 30,
        label: {
          show: true,
          position: node.type === 'process' ? 'bottom' : 'right',
          fontSize: 10,
          color: '#eee',
        },
      };
    });

    const validNodeIds = new Set(graphNodes.map(n => n.id));

    const graphLinks = edges
      .filter(edge => edge && edge.source && edge.target && validNodeIds.has(String(edge.source)) && validNodeIds.has(String(edge.target)))
      .map((edge) => ({
        source: String(edge.source),
        target: String(edge.target),
        lineStyle: {
          width: Math.min((edge.count || 1) / 10, 5) + 1,
          curveness: 0.2,
        },
        label: {
          show: true,
          formatter: () => String(edge.count || 0),
          fontSize: 10,
          color: '#888',
        },
      }));

    const option = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#16213e',
        borderColor: '#0f3460',
        textStyle: { color: '#eee' },
        formatter: (params) => {
          if (params.dataType === 'edge') {
            return `${params.data.source} → ${params.data.target}<br/>Count: ${params.data.count || 0}`;
          }
          return params.name;
        },
      },
      legend: {
        x: 'center',
        top: 10,
        data: categories.map((c) => c.name),
        textStyle: { color: '#888' },
      },
      animationDurationUpdate: 1500,
      animationEasingUpdate: 'quinticInOut',
      series: [
        {
          type: 'graph',
          layout: 'force',
          force: {
            repulsion: 200,
            edgeLength: [100, 200],
            gravity: 0.1,
          },
          roam: true,
          label: {
            show: true,
          },
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: [0, 8],
          edgeLabel: {
            fontSize: 10,
          },
          data: graphNodes,
          links: graphLinks,
          categories: categories,
          lineStyle: {
            color: 'source',
            curveness: 0.3,
          },
          emphasis: {
            focus: 'adjacency',
            lineStyle: {
              width: 10,
            },
          },
        },
      ],
    };

    chartInstance.current.setOption(option, true);

    const handleResize = () => {
      chartInstance.current?.resize();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [data]);

  return <div ref={chartRef} style={{ height: '400px', width: '100%' }} />;
};

export default TopologyGraph;
