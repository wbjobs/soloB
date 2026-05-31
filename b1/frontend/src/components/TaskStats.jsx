import React, { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { getTaskStats } from '../api';

const TaskStats = ({ taskId, taskName }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, [taskId]);

  const loadStats = async () => {
    try {
      setLoading(true);
      const stats = await getTaskStats(taskId);
      const formatted = stats.map((item, index) => ({
        index: index + 1,
        duration: item.duration_ms || 0,
        time: new Date(item.start_time).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        success: item.status === 'success' ? (item.duration_ms || 0) : null,
        failed: item.status === 'failed' ? (item.duration_ms || 0) : null,
        timeout: item.status === 'timeout' ? (item.duration_ms || 0) : null,
      }));
      setData(formatted);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>加载中...</div>;
  }

  if (data.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>
        暂无执行数据
      </div>
    );
  }

  const avgDuration = data.reduce((sum, d) => sum + d.duration, 0) / data.length;
  const maxDuration = Math.max(...data.map((d) => d.duration));
  const minDuration = Math.min(...data.map((d) => d.duration));
  const successCount = data.filter((d) => d.success !== null).length;
  const timeoutCount = data.filter((d) => d.timeout !== null).length;

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">总执行次数</div>
          <div className="value" style={{ color: '#667eea' }}>
            {data.length}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">成功次数</div>
          <div className="value" style={{ color: '#48bb78' }}>
            {successCount}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">超时次数</div>
          <div className="value" style={{ color: '#f56565' }}>
            {timeoutCount}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">平均耗时</div>
          <div className="value" style={{ color: '#ed8936' }}>
            {Math.round(avgDuration)}ms
          </div>
        </div>
        <div className="stat-card">
          <div className="label">最大/最小耗时</div>
          <div className="value" style={{ color: '#9f7aea' }}>
            {maxDuration} / {minDuration}ms
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>最近 10 次执行耗时趋势</h3>
          <button className="btn btn-secondary btn-sm" onClick={loadStats}>
            刷新
          </button>
        </div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: '#718096' }}
                angle={-30}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#718096' }}
                label={{ value: 'ms', angle: -90, position: 'insideLeft', fill: '#718096' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                }}
                formatter={(value) => [`${value}ms`, '耗时']}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="success"
                name="成功"
                stroke="#48bb78"
                strokeWidth={2}
                dot={{ fill: '#48bb78' }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="failed"
                name="失败"
                stroke="#f56565"
                strokeWidth={2}
                dot={{ fill: '#f56565' }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="timeout"
                name="超时"
                stroke="#ed8936"
                strokeWidth={2}
                dot={{ fill: '#ed8936' }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default TaskStats;
