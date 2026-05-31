import React from 'react';
import ReactECharts from 'echarts-for-react';

const LatencyChart = ({ data }) => {
  const chartData = data.map((item) => [
    new Date(item.time).toLocaleTimeString(),
    item.avgLatency.toFixed(2),
  ]);

  const option = {
    backgroundColor: 'transparent',
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: chartData.map((item) => item[0]),
      axisLine: { lineStyle: { color: '#0f3460' } },
      axisLabel: { color: '#888' },
    },
    yAxis: {
      type: 'value',
      name: 'ms',
      axisLine: { lineStyle: { color: '#0f3460' } },
      axisLabel: { color: '#888' },
      splitLine: { lineStyle: { color: '#0f3460' } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#16213e',
      borderColor: '#0f3460',
      textStyle: { color: '#eee' },
      formatter: (params) => {
        return `${params[0].name}<br/>平均延迟: ${params[0].value} ms`;
      },
    },
    series: [
      {
        name: '平均延迟',
        type: 'line',
        smooth: true,
        data: chartData.map((item) => item[1]),
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 212, 255, 0.3)' },
              { offset: 1, color: 'rgba(0, 212, 255, 0)' },
            ],
          },
        },
        lineStyle: { color: '#00d4ff', width: 2 },
        itemStyle: { color: '#00d4ff' },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: '300px' }} />;
};

export default LatencyChart;
