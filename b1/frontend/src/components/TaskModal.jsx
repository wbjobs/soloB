import React, { useState, useEffect, useCallback } from 'react';
import {
  getUpstreamTasks,
  createDependency,
  deleteDependency,
} from '../api';

const TaskModal = ({ task, onClose, onSave, allTasks, onError }) => {
  const [formData, setFormData] = useState({
    name: '',
    cron_expression: '* * * * *',
    command: '',
    enabled: true,
  });
  const [upstreamTasks, setUpstreamTasks] = useState([]);
  const [selectedUpstream, setSelectedUpstream] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (task) {
      setFormData({
        name: task.name,
        cron_expression: task.cron_expression,
        command: task.command,
        enabled: task.enabled,
      });
      loadUpstreamTasks(task.id);
    } else {
      setUpstreamTasks([]);
    }
  }, [task]);

  const loadUpstreamTasks = useCallback(async (taskId) => {
    try {
      const tasks = await getUpstreamTasks(taskId);
      setUpstreamTasks(tasks);
    } catch (error) {
      console.error('Failed to load upstream tasks:', error);
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleAddDependency = async () => {
    if (!selectedUpstream || !task) return;

    try {
      setLoading(true);
      await createDependency(parseInt(selectedUpstream), task.id);
      await loadUpstreamTasks(task.id);
      setSelectedUpstream('');
    } catch (error) {
      onError?.('添加依赖失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveDependency = async (dependencyId) => {
    if (!confirm('确定要移除这个依赖关系吗？')) return;

    try {
      setLoading(true);
      await deleteDependency(dependencyId);
      await loadUpstreamTasks(task.id);
    } catch (error) {
      onError?.('移除依赖失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const availableUpstreamTasks = allTasks
    ? allTasks.filter(
        (t) =>
          t.id !== task?.id &&
          !upstreamTasks.find((ut) => ut.id === t.id)
      )
    : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
        <div className="modal-header">
          <h3>{task ? '编辑任务' : '新建任务'}</h3>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>任务名称</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="例如：每日数据备份"
            />
          </div>
          <div className="form-group">
            <label>CRON 表达式</label>
            <input
              type="text"
              name="cron_expression"
              value={formData.cron_expression}
              onChange={handleChange}
              required
              placeholder="例如：0 0 * * *"
            />
            <small style={{ color: '#718096', fontSize: '12px' }}>
              格式：秒 分 时 日 月 周 (可选：秒)
            </small>
          </div>
          <div className="form-group">
            <label>执行命令</label>
            <textarea
              name="command"
              value={formData.command}
              onChange={handleChange}
              required
              placeholder="例如：node backup.js"
            />
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span>启用任务</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  name="enabled"
                  checked={formData.enabled}
                  onChange={handleChange}
                />
                <span className="toggle-slider"></span>
              </label>
            </label>
          </div>

          {task && (
            <div
              style={{
                marginTop: '20px',
                paddingTop: '20px',
                borderTop: '1px solid #e2e8f0',
              }}
            >
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontWeight: 600, color: '#4a5568' }}>
                  任务依赖（上游任务）
                </label>
                <p style={{ fontSize: '12px', color: '#718096', marginTop: '4px' }}>
                  以下任务成功完成后，将自动触发当前任务
                </p>
              </div>

              {upstreamTasks.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    {upstreamTasks.map((ut) => (
                      <div
                        key={ut.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 12px',
                          background: '#e6fffa',
                          border: '1px solid #81e6d9',
                          borderRadius: '6px',
                          fontSize: '13px',
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{ut.name}</span>
                        <span style={{ color: '#718096' }}>#{ut.id}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveDependency(ut.dependency_id)}
                          disabled={loading}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#e53e3e',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            padding: '0 4px',
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {availableUpstreamTasks.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label style={{ fontWeight: 'normal' }}>添加上游任务</label>
                    <select
                      value={selectedUpstream}
                      onChange={(e) => setSelectedUpstream(e.target.value)}
                    >
                      <option value="">选择任务...</option>
                      {availableUpstreamTasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          #{t.id} - {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleAddDependency}
                    disabled={!selectedUpstream || loading}
                  >
                    添加
                  </button>
                </div>
              )}

              {availableUpstreamTasks.length === 0 && upstreamTasks.length === 0 && (
                <p style={{ color: '#718096', fontSize: '13px' }}>
                  暂无可用的上游任务（需要先创建其他任务）
                </p>
              )}
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TaskModal;
