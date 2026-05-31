import React, { useState, useEffect, useCallback } from 'react';
import TaskList from './components/TaskList';
import TaskModal from './components/TaskModal';
import ExecutionLog from './components/ExecutionLog';
import DependencyGraph from './components/DependencyGraph';
import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  triggerTask,
  stopTask,
} from './api';

function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [logTaskId, setLogTaskId] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [activeTab, setActiveTab] = useState('list');
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadTasks = async () => {
    try {
      const data = await getTasks();
      setTasks(data);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleError = useCallback((message) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 5000);
  }, []);

  const handleCreate = () => {
    setEditingTask(null);
    setShowModal(true);
  };

  const handleEdit = (task) => {
    setEditingTask(task);
    setShowModal(true);
  };

  const handleSave = async (formData) => {
    try {
      if (editingTask) {
        await updateTask(editingTask.id, formData);
      } else {
        await createTask(formData);
      }
      setShowModal(false);
      setEditingTask(null);
      loadTasks();
      setGraphRefreshKey((k) => k + 1);
    } catch (error) {
      handleError('保存失败: ' + error.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('确定要删除此任务吗？')) return;
    try {
      await deleteTask(id);
      if (selectedTaskId === id) {
        setSelectedTaskId(null);
      }
      loadTasks();
      setGraphRefreshKey((k) => k + 1);
    } catch (error) {
      handleError('删除失败: ' + error.message);
    }
  };

  const handleTrigger = async (id) => {
    try {
      await triggerTask(id);
      loadTasks();
    } catch (error) {
      handleError('触发失败: ' + error.message);
    }
  };

  const handleStop = async (id) => {
    try {
      await stopTask(id);
      loadTasks();
    } catch (error) {
      handleError('停止失败: ' + error.message);
    }
  };

  const handleViewLogs = (id) => {
    setLogTaskId(id);
  };

  const handleSelectTask = (id) => {
    setSelectedTaskId(selectedTaskId === id ? null : id);
  };

  const stats = {
    total: tasks.length,
    running: tasks.filter((t) => t.is_running).length,
    enabled: tasks.filter((t) => t.enabled).length,
    failed: tasks.filter((t) => t.last_status === 'failed' || t.last_status === 'timeout').length,
  };

  return (
    <div className="container">
      <div className="header">
        <h1>分布式任务调度系统</h1>
        <p>管理和监控您的定时任务</p>
      </div>

      {errorMessage && (
        <div
          style={{
            background: '#fed7d7',
            color: '#742a2a',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '20px',
            border: '1px solid #fc8181',
          }}
        >
          {errorMessage}
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">总任务数</div>
          <div className="value" style={{ color: '#667eea' }}>
            {stats.total}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">运行中</div>
          <div className="value" style={{ color: '#48bb78' }}>
            {stats.running}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">已启用</div>
          <div className="value" style={{ color: '#ed8936' }}>
            {stats.enabled}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">最近失败</div>
          <div className="value" style={{ color: '#f56565' }}>
            {stats.failed}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-header">
          <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
            <button
              className={`tab ${activeTab === 'list' ? 'active' : ''}`}
              onClick={() => setActiveTab('list')}
            >
              任务列表
            </button>
            <button
              className={`tab ${activeTab === 'graph' ? 'active' : ''}`}
              onClick={() => setActiveTab('graph')}
            >
              依赖关系图
            </button>
          </div>
          <button className="btn btn-primary" onClick={handleCreate}>
            + 新建任务
          </button>
        </div>
      </div>

      {loading ? (
        <p>加载中...</p>
      ) : activeTab === 'list' ? (
        <TaskList
          tasks={tasks}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onTrigger={handleTrigger}
          onStop={handleStop}
          onViewLogs={handleViewLogs}
          selectedTaskId={selectedTaskId}
          onSelectTask={handleSelectTask}
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <h3 style={{ fontWeight: 600 }}>任务依赖关系图</h3>
              <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                拖拽连线创建依赖，点击连线删除依赖（仅当上游任务成功完成时，下游任务才会自动触发）
              </p>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setGraphRefreshKey((k) => k + 1)}
            >
              刷新
            </button>
          </div>
          <div style={{ height: '500px' }}>
            <DependencyGraph onError={handleError} refreshKey={graphRefreshKey} />
          </div>
        </div>
      )}

      {showModal && (
        <TaskModal
          task={editingTask}
          allTasks={tasks}
          onError={handleError}
          onClose={() => {
            setShowModal(false);
            setEditingTask(null);
          }}
          onSave={handleSave}
        />
      )}

      {logTaskId && (
        <ExecutionLog taskId={logTaskId} onClose={() => setLogTaskId(null)} />
      )}
    </div>
  );
}

export default App;
