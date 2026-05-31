import React, { useEffect, useState } from 'react';
import { getTaskExecutions } from '../api';

const ExecutionLog = ({ taskId, onClose }) => {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });

  useEffect(() => {
    loadExecutions();
    const interval = setInterval(loadExecutions, 2000);
    return () => clearInterval(interval);
  }, [taskId, pagination.page]);

  const loadExecutions = async () => {
    try {
      const result = await getTaskExecutions(taskId, pagination.page, pagination.pageSize);
      setExecutions(result.data);
      setPagination((prev) => ({
        ...prev,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
      }));
    } catch (error) {
      console.error('Failed to load executions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPagination((prev) => ({ ...prev, page: newPage }));
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const getStatusBadge = (status, execution) => {
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
    const displayStatus = labels[status] || status || '未知';
    return <span className={`badge ${styles[status] || 'badge-gray'}`}>{displayStatus}</span>;
  };

  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px' }}>
        <div className="modal-header">
          <div>
            <h3>任务执行日志</h3>
            <small style={{ color: '#718096' }}>共 {pagination.total} 条记录</small>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>
        
        {loading ? (
          <p>加载中...</p>
        ) : executions.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#718096', padding: '40px' }}>
            暂无执行记录
          </p>
        ) : (
          <>
            <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {executions.map((exec) => (
                <div key={exec.id} style={{ marginBottom: '12px' }}>
                  <div
                    className="accordion-header"
                    onClick={() => setExpandedId(expandedId === exec.id ? null : exec.id)}
                  >
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <span style={{ fontWeight: 500 }}>#{exec.id}</span>
                      {getStatusBadge(exec.status, exec)}
                      <span style={{ color: '#718096', fontSize: '13px' }}>
                        {formatDate(exec.start_time)}
                      </span>
                    </div>
                    <span style={{ color: '#718096' }}>
                      {exec.duration_ms ? `${exec.duration_ms}ms` : '-'}
                      {expandedId === exec.id ? ' ▲' : ' ▼'}
                    </span>
                  </div>
                  
                  {expandedId === exec.id && (
                    <div className="accordion-content">
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          <div>
                            <small style={{ color: '#718096' }}>开始时间</small>
                            <p style={{ marginTop: '4px' }}>{formatDate(exec.start_time)}</p>
                          </div>
                          <div>
                            <small style={{ color: '#718096' }}>结束时间</small>
                            <p style={{ marginTop: '4px' }}>{formatDate(exec.end_time)}</p>
                          </div>
                          <div>
                            <small style={{ color: '#718096' }}>执行耗时</small>
                            <p style={{ marginTop: '4px' }}>
                              {exec.duration_ms ? `${exec.duration_ms}ms` : '-'}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      {exec.stdout && (
                        <div style={{ marginBottom: '12px' }}>
                          <small style={{ color: '#718096' }}>标准输出 (stdout)</small>
                          <pre className="log-output" style={{ marginTop: '4px' }}>
                            {exec.stdout}
                          </pre>
                        </div>
                      )}
                      
                      {exec.stderr && (
                        <div>
                          <small style={{ color: '#718096' }}>错误输出 (stderr)</small>
                          <pre className="log-output stderr" style={{ marginTop: '4px' }}>
                            {exec.stderr}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            {pagination.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                >
                  上一页
                </button>
                <span style={{ fontSize: '14px', color: '#718096' }}>
                  第 {pagination.page} / {pagination.totalPages} 页
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ExecutionLog;
