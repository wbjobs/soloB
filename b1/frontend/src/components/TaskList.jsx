import React from 'react';
import TaskStats from './TaskStats';

const TaskList = ({
  tasks,
  onEdit,
  onDelete,
  onTrigger,
  onStop,
  onViewLogs,
  selectedTaskId,
  onSelectTask,
}) => {
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const getStatusBadge = (status, isRunning) => {
    if (isRunning) {
      return <span className="badge badge-info">运行中</span>;
    }
    const styles = {
      success: 'badge-success',
      failed: 'badge-danger',
      running: 'badge-info',
      stopped: 'badge-warning',
      timeout: 'badge-danger',
    };
    const labels = {
      success: '成功',
      failed: '失败',
      running: '运行中',
      stopped: '已停止',
      timeout: '超时',
    };
    const displayStatus = labels[status] || status || '未执行';
    return (
      <span className={`badge ${styles[status] || 'badge-gray'}`}>
        {displayStatus}
      </span>
    );
  };

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2>任务列表</h2>
        </div>
        
        {tasks.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#718096', padding: '40px' }}>
            暂无任务，点击上方按钮创建新任务
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>任务名称</th>
                <th>CRON 表达式</th>
                <th>状态</th>
                <th>最近执行</th>
                <th>启用</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.id}</td>
                  <td style={{ fontWeight: 500 }}>{task.name}</td>
                  <td>
                    <code
                      style={{
                        background: '#f7fafc',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontFamily: 'monospace',
                        fontSize: '13px',
                      }}
                    >
                      {task.cron_expression}
                    </code>
                  </td>
                  <td>{getStatusBadge(task.last_status, task.is_running)}</td>
                  <td style={{ fontSize: '13px', color: '#718096' }}>
                    {formatDate(task.last_run)}
                  </td>
                  <td>
                    <span className={`badge ${task.enabled ? 'badge-success' : 'badge-gray'}`}>
                      {task.enabled ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onSelectTask(task.id)}
                        title="查看统计"
                      >
                        统计
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => onViewLogs(task.id)}
                        title="查看日志"
                      >
                        日志
                      </button>
                      {task.is_running ? (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => onStop(task.id)}
                        >
                          停止
                        </button>
                      ) : (
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => onTrigger(task.id)}
                          disabled={task.is_running}
                        >
                          触发
                        </button>
                      )}
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => onEdit(task)}
                      >
                        编辑
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => onDelete(task.id)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedTaskId && (
        <TaskStats
          taskId={selectedTaskId}
          taskName={tasks.find((t) => t.id === selectedTaskId)?.name}
        />
      )}
    </>
  );
};

export default TaskList;
