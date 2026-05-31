import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ReactECharts from 'echarts-for-react';

const API_BASE = 'http://localhost:8080/api';

function App() {
  const [tasks, setTasks] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [entropyHistory, setEntropyHistory] = useState([]);
  const [entropyPrediction, setEntropyPrediction] = useState([]);
  const [queues, setQueues] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState([]);

  const [taskForm, setTaskForm] = useState({
    name: '',
    priority: 1,
    burstTime: 1.0
  });

  const [queueConfigs, setQueueConfigs] = useState([
    { queue_id: 0, priority: 1, time_quantum: 0.5, name: 'High Priority' },
    { queue_id: 1, priority: 2, time_quantum: 1.0, name: 'Medium Priority' },
    { queue_id: 2, priority: 3, time_quantum: 2.0, name: 'Low Priority' }
  ]);

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, statusRes, queuesRes, entropyRes, historyRes, predictionRes] = await Promise.all([
        axios.get(`${API_BASE}/tasks`),
        axios.get(`${API_BASE}/scheduler/status`),
        axios.get(`${API_BASE}/scheduler/queues`),
        axios.get(`${API_BASE}/scheduler/entropy`),
        axios.get(`${API_BASE}/history`),
        axios.get(`${API_BASE}/scheduler/entropy/prediction?steps=5`),
      ]);

      setTasks(tasksRes.data);
      setTimeline(statusRes.data.timeline || []);
      setIsRunning(statusRes.data.running);
      setQueues(queuesRes.data);
      setEntropyHistory(entropyRes.data);
      setEntropyPrediction(predictionRes.data.predictions || []);
      setHistory(historyRes.data);
    } catch (error) {
      console.error('Fetch error:', error);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 500);
    return () => clearInterval(interval);
  }, [fetchData]);

  const submitTask = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/tasks`, {
        name: taskForm.name,
        priority: parseInt(taskForm.priority),
        burst_time: parseFloat(taskForm.burstTime)
      });
      setTaskForm({ name: '', priority: 1, burstTime: 1.0 });
      fetchData();
    } catch (error) {
      console.error('Submit task error:', error);
    }
  };

  const startScheduler = async () => {
    await axios.post(`${API_BASE}/scheduler/start`);
    fetchData();
  };

  const stopScheduler = async () => {
    await axios.post(`${API_BASE}/scheduler/stop`);
    fetchData();
  };

  const resetScheduler = async () => {
    await axios.post(`${API_BASE}/scheduler/reset`);
    fetchData();
  };

  const updateQueueConfigs = async () => {
    await axios.put(`${API_BASE}/scheduler/queues`, queueConfigs);
    fetchData();
  };

  const getGanttOption = () => {
    if (!timeline || timeline.length === 0) {
      return {
        title: { text: '任务调度甘特图', left: 'center' },
        tooltip: { trigger: 'axis' },
        grid: { left: '10%', right: '10%', top: '15%', bottom: '10%' },
        xAxis: {
          type: 'value',
          name: '时间 (s)',
          min: 0,
          max: 10
        },
        yAxis: {
          type: 'category',
          data: [],
          inverse: true
        },
        series: []
      };
    }

    const taskNames = [...new Set(timeline.map(t => t.task_name))];
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];

    const data = taskNames.map((name, idx) => {
      const taskTimeline = timeline.filter(t => t.task_name === name);
      const intervals = [];

      taskTimeline.forEach(t => {
        intervals.push([t.time, t.time + t.duration]);
      });

      return {
        name,
        value: intervals.map(i => [i[0], i[1] - i[0]]),
        itemStyle: { color: colors[idx % colors.length] }
      };
    });

    return {
      title: { text: '任务调度甘特图', left: 'center' },
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params || params.length === 0) return '';
          const p = params[0];
          if (!p || !p.value) return '';
          return `${p.seriesName}<br/>开始: ${p.value[0].toFixed(2)}s<br/>持续: ${p.value[1].toFixed(2)}s`;
        }
      },
      grid: { left: '10%', right: '10%', top: '15%', bottom: '10%' },
      xAxis: {
        type: 'value',
        name: '时间 (s)',
        min: 0,
        max: timeline.length > 0 ? Math.max(10, ...timeline.map(t => t.time + t.duration)) : 10
      },
      yAxis: {
        type: 'category',
        data: taskNames,
        inverse: true
      },
      series: data.map(d => ({
        type: 'custom',
        name: d.name,
        renderItem: (params, api) => {
          const categoryIndex = api.value(0);
          const start = api.coord([api.value(1), categoryIndex]);
          const end = api.coord([api.value(1) + api.value(2), categoryIndex]);
          
          if (!start || !end) return {};
          
          const size = api.size([0, 1]);
          if (!size || size.length < 2) return {};
          
          const height = size[1] * 0.6;

          return {
            type: 'rect',
            shape: {
              x: start[0],
              y: start[1] - height / 2,
              width: end[0] - start[0],
              height: height
            },
            style: api.style()
          };
        },
        dimensions: ['start', 'duration'],
        data: d.value.map(v => [taskNames.indexOf(d.name), v[0], v[1]]),
        itemStyle: d.itemStyle
      }))
    };
  };

  const getEntropyOption = () => {
    const data = entropyHistory && entropyHistory.length > 0 
      ? entropyHistory.map(e => [e.time, e.entropy]) 
      : [];
    
    return {
      title: { text: '调度熵值变化', left: 'center' },
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params || params.length === 0) return '';
          const p = params[0];
          if (!p || !p.value) return '';
          return `时间: ${p.value[0].toFixed(2)}s<br/>熵值: ${p.value[1].toFixed(4)}`;
        }
      },
      grid: { left: '10%', right: '10%', top: '15%', bottom: '10%' },
      xAxis: {
        type: 'value',
        name: '时间 (s)',
        min: 0,
        max: data.length > 0 ? Math.max(10, ...data.map(d => d[0])) : 10
      },
      yAxis: {
        type: 'value',
        name: '熵值',
        min: 0
      },
      series: [{
        type: 'line',
        smooth: true,
        data: data,
        lineStyle: { color: '#4ECDC4' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(78, 205, 196, 0.5)' },
              { offset: 1, color: 'rgba(78, 205, 196, 0.1)' }
            ]
          }
        }
      }]
    };
  };

  const getPredictionOption = () => {
    if (!entropyPrediction || entropyPrediction.length === 0) {
      return {
        title: { text: '调度熵值预测', left: 'center' },
        tooltip: { trigger: 'axis' },
        legend: { data: ['实际熵值', '预测熵值'], top: 30 },
        grid: { left: '10%', right: '10%', top: '20%', bottom: '10%' },
        xAxis: {
          type: 'value',
          name: '时间 (s)',
          min: 0,
          max: 10
        },
        yAxis: {
          type: 'value',
          name: '熵值',
          min: 0
        },
        series: []
      };
    }

    const actualData = entropyPrediction.filter(p => p.is_actual).map(p => [p.time, p.entropy]);
    const predictedData = entropyPrediction.filter(p => !p.is_actual).map(p => [p.time, p.entropy]);

    const allTimes = entropyPrediction.map(p => p.time);

    return {
      title: { text: '调度熵值预测', left: 'center' },
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          if (!params || params.length === 0) return '';
          let result = '';
          params.forEach(p => {
            if (p && p.value) {
              result += `${p.seriesName}<br/>时间: ${p.value[0].toFixed(2)}s<br/>熵值: ${p.value[1].toFixed(4)}<br/>`;
            }
          });
          return result;
        }
      },
      legend: { data: ['实际熵值', '预测熵值'], top: 30 },
      grid: { left: '10%', right: '10%', top: '20%', bottom: '10%' },
      xAxis: {
        type: 'value',
        name: '时间 (s)',
        min: 0,
        max: allTimes.length > 0 ? Math.max(...allTimes) * 1.1 : 10
      },
      yAxis: {
        type: 'value',
        name: '熵值',
        min: 0
      },
      series: [
        {
          name: '实际熵值',
          type: 'line',
          smooth: true,
          data: actualData,
          lineStyle: { color: '#4ECDC4', width: 2 },
          itemStyle: { color: '#4ECDC4' },
          symbolSize: 6,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(78, 205, 196, 0.3)' },
                { offset: 1, color: 'rgba(78, 205, 196, 0.05)' }
              ]
            }
          }
        },
        {
          name: '预测熵值',
          type: 'line',
          smooth: true,
          data: predictedData,
          lineStyle: { 
            color: '#FF6B6B', 
            width: 2, 
            type: 'dashed' 
          },
          itemStyle: { color: '#FF6B6B' },
          symbolSize: 8,
          symbol: 'diamond',
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(255, 107, 107, 0.2)' },
                { offset: 1, color: 'rgba(255, 107, 107, 0.02)' }
              ]
            }
          },
          markPoint: {
            data: predictedData.length > 0 ? [
              { 
                name: '最终预测', 
                coord: predictedData[predictedData.length - 1], 
                value: predictedData[predictedData.length - 1][1].toFixed(3),
                itemStyle: { color: '#FF6B6B' }
              }
            ] : [],
            label: {
              formatter: '{b}: {c}'
            }
          }
        }
      ]
    };
  };

  const styles = {
    container: { padding: '20px', maxWidth: '1400px', margin: '0 auto' },
    header: { textAlign: 'center', marginBottom: '30px', color: '#333' },
    card: {
      background: 'white',
      borderRadius: '8px',
      padding: '20px',
      marginBottom: '20px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
    },
    form: { display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap' },
    formGroup: { display: 'flex', flexDirection: 'column', gap: '5px' },
    input: {
      padding: '8px 12px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      fontSize: '14px'
    },
    button: {
      padding: '10px 20px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500'
    },
    buttonPrimary: { backgroundColor: '#4ECDC4', color: 'white' },
    buttonSuccess: { backgroundColor: '#96CEB4', color: 'white' },
    buttonDanger: { backgroundColor: '#FF6B6B', color: 'white' },
    buttonWarning: { backgroundColor: '#FFEAA7', color: '#333' },
    buttonGroup: { display: 'flex', gap: '10px' },
    status: {
      display: 'inline-block',
      padding: '5px 15px',
      borderRadius: '20px',
      fontWeight: '500',
      marginBottom: '15px'
    },
    statusRunning: { backgroundColor: '#96CEB4', color: '#2d5a3a' },
    statusStopped: { backgroundColor: '#FFEAA7', color: '#5a4a2d' },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      marginTop: '15px'
    },
    th: {
      padding: '12px',
      textAlign: 'left',
      borderBottom: '2px solid #eee',
      backgroundColor: '#f8f9fa'
    },
    td: {
      padding: '12px',
      borderBottom: '1px solid #eee'
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px'
    },
    queueConfig: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    },
    queueItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '15px',
      padding: '10px',
      backgroundColor: '#f8f9fa',
      borderRadius: '4px'
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>任务调度模拟系统</h1>

      <div style={styles.card}>
        <h3>调度器控制</h3>
        <div>
          <span style={{
            ...styles.status,
            ...(isRunning ? styles.statusRunning : styles.statusStopped)
          }}>
            {isRunning ? '运行中' : '已停止'}
          </span>
        </div>
        <div style={styles.buttonGroup}>
          <button
            onClick={startScheduler}
            disabled={isRunning}
            style={{
              ...styles.button,
              ...styles.buttonSuccess,
              opacity: isRunning ? 0.5 : 1
            }}
          >
            开始调度
          </button>
          <button
            onClick={stopScheduler}
            disabled={!isRunning}
            style={{
              ...styles.button,
              ...styles.buttonDanger,
              opacity: !isRunning ? 0.5 : 1
            }}
          >
            停止调度
          </button>
          <button
            onClick={resetScheduler}
            style={{ ...styles.button, ...styles.buttonWarning }}
          >
            重置
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <h3>提交任务</h3>
        <form onSubmit={submitTask} style={styles.form}>
          <div style={styles.formGroup}>
            <label>任务名称</label>
            <input
              type="text"
              value={taskForm.name}
              onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })}
              style={styles.input}
              required
            />
          </div>
          <div style={styles.formGroup}>
            <label>优先级 (1-3)</label>
            <select
              value={taskForm.priority}
              onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
              style={styles.input}
            >
              <option value={1}>1 (高)</option>
              <option value={2}>2 (中)</option>
              <option value={3}>3 (低)</option>
            </select>
          </div>
          <div style={styles.formGroup}>
            <label>执行时间 (秒)</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={taskForm.burstTime}
              onChange={(e) => setTaskForm({ ...taskForm, burstTime: e.target.value })}
              style={styles.input}
              required
            />
          </div>
          <button type="submit" style={{ ...styles.button, ...styles.buttonPrimary }}>
            提交任务
          </button>
        </form>
      </div>

      <div style={styles.card}>
        <h3>队列配置</h3>
        <div style={styles.queueConfig}>
          {queueConfigs.map((queue, idx) => (
            <div key={idx} style={styles.queueItem}>
              <span style={{ width: '120px' }}>{queue.name}</span>
              <span>优先级: {queue.priority}</span>
              <label>
                时间片:
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={queue.time_quantum}
                  onChange={(e) => {
                    const newConfigs = [...queueConfigs];
                    newConfigs[idx].time_quantum = parseFloat(e.target.value);
                    setQueueConfigs(newConfigs);
                  }}
                  style={{ ...styles.input, width: '80px', marginLeft: '10px' }}
                />
                s
              </label>
              <span>当前任务数: {queues[idx]?.task_count || 0}</span>
            </div>
          ))}
          <button
            onClick={updateQueueConfigs}
            style={{ ...styles.button, ...styles.buttonPrimary, alignSelf: 'flex-start' }}
          >
            更新配置
          </button>
        </div>
      </div>

      <div style={{ ...styles.grid, gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div style={styles.card}>
          <ReactECharts option={getGanttOption()} style={{ height: '400px' }} />
        </div>
        <div style={styles.card}>
          <ReactECharts option={getEntropyOption()} style={{ height: '400px' }} />
        </div>
        <div style={styles.card}>
          <ReactECharts option={getPredictionOption()} style={{ height: '400px' }} />
        </div>
      </div>

      <div style={styles.card}>
        <h3>当前任务列表</h3>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>任务名称</th>
              <th style={styles.th}>优先级</th>
              <th style={styles.th}>总执行时间 (s)</th>
              <th style={styles.th}>剩余时间 (s)</th>
              <th style={styles.th}>等待时间 (s)</th>
              <th style={styles.th}>周转时间 (s)</th>
              <th style={styles.th}>抢占次数</th>
              <th style={styles.th}>状态</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td style={styles.td}>{task.name}</td>
                <td style={styles.td}>{task.priority}</td>
                <td style={styles.td}>{task.burst_time.toFixed(2)}</td>
                <td style={styles.td}>{task.remaining_time.toFixed(2)}</td>
                <td style={styles.td}>{task.waiting_time.toFixed(2)}</td>
                <td style={styles.td}>{task.turnaround_time.toFixed(2)}</td>
                <td style={styles.td}>{task.preempt_count}</td>
                <td style={styles.td}>{task.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.card}>
        <h3>历史记录</h3>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>任务名称</th>
              <th style={styles.th}>优先级</th>
              <th style={styles.th}>执行时间 (s)</th>
              <th style={styles.th}>等待时间 (s)</th>
              <th style={styles.th}>周转时间 (s)</th>
              <th style={styles.th}>抢占次数</th>
              <th style={styles.th}>状态</th>
            </tr>
          </thead>
          <tbody>
            {history.map((record) => (
              <tr key={record.id}>
                <td style={styles.td}>{record.name}</td>
                <td style={styles.td}>{record.priority}</td>
                <td style={styles.td}>{record.burst_time.toFixed(2)}</td>
                <td style={styles.td}>{record.waiting_time.toFixed(2)}</td>
                <td style={styles.td}>{record.turnaround_time.toFixed(2)}</td>
                <td style={styles.td}>{record.preempt_count}</td>
                <td style={styles.td}>{record.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
