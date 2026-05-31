import React from 'react';
import { X, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';

function ExecutionPanel({ result, onClose }) {
  if (!result) return null;

  return (
    <div className="execution-panel">
      <div className="panel-header">
        <h3>Output</h3>
        <button onClick={onClose} className="btn-icon">
          <X size={18} />
        </button>
      </div>

      <div className="panel-content">
        {result.loading ? (
          <div className="loading-result">
            <Loader2 size={24} className="spinning" />
            <p>Executing code...</p>
            <small>Max execution time: 5 seconds</small>
          </div>
        ) : result.timedOut ? (
          <div className="result-error">
            <div className="result-header">
              <Clock size={20} className="icon-warning" />
              <span className="status-text">Time Limit Exceeded</span>
            </div>
            <pre className="result-message">{result.stderr}</pre>
          </div>
        ) : result.memoryError ? (
          <div className="result-error">
            <div className="result-header">
              <XCircle size={20} className="icon-error" />
              <span className="status-text">Memory Limit Exceeded</span>
            </div>
            <pre className="result-message">{result.stderr}</pre>
          </div>
        ) : result.success ? (
          <div className="result-success">
            <div className="result-header">
              <CheckCircle size={20} className="icon-success" />
              <span className="status-text">Execution Successful</span>
            </div>
            {result.stdout && (
              <div className="output-section">
                <h4>stdout:</h4>
                <pre className="stdout">{result.stdout}</pre>
              </div>
            )}
            {result.stderr && (
              <div className="output-section">
                <h4>stderr:</h4>
                <pre className="stderr">{result.stderr}</pre>
              </div>
            )}
          </div>
        ) : (
          <div className="result-error">
            <div className="result-header">
              <XCircle size={20} className="icon-error" />
              <span className="status-text">Execution Failed</span>
            </div>
            {result.stderr && <pre className="result-message">{result.stderr}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

export default ExecutionPanel;
