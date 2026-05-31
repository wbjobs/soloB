import React, { useState, useEffect } from 'react';
import {
  Sparkles, Lightbulb, Bug, Wand2, X, RefreshCw,
  Check, AlertTriangle, AlertCircle, Info
} from 'lucide-react';
import { useRoomStore } from '../store/roomStore';
import { aiAPI } from '../services/api';

const AI_MODES = {
  EXPLAIN: 'explain',
  DETECT_BUGS: 'detect-bugs',
  REFACTOR: 'refactor',
  SUGGEST: 'suggest'
};

function AIPanel({ roomId, activeFile, fileContents, selectedText, onClose }) {
  const {
    aiEnabled,
    setAIEnabled,
    aiLoading,
    setAILoading,
    aiResult,
    setAIResult,
    aiError,
    setAIError,
    clearAIResult
  } = useRoomStore();

  const [activeMode, setActiveMode] = useState(null);
  const [statusChecked, setStatusChecked] = useState(false);

  useEffect(() => {
    if (!statusChecked) {
      checkAIStatus();
    }
  }, [statusChecked]);

  const checkAIStatus = async () => {
    try {
      const res = await aiAPI.getStatus();
      setAIEnabled(res.data.enabled);
      setStatusChecked(true);
    } catch (error) {
      setAIEnabled(false);
      setStatusChecked(true);
    }
  };

  const getCurrentCode = () => {
    if (selectedText) return selectedText;
    if (activeFile && fileContents[activeFile]) {
      return fileContents[activeFile].content;
    }
    return '';
  };

  const getLanguage = () => {
    if (activeFile && fileContents[activeFile]) {
      return fileContents[activeFile].language || 'javascript';
    }
    return 'javascript';
  };

  const handleExplainCode = async () => {
    const code = getCurrentCode();
    if (!code) return;

    setAILoading(true);
    setActiveMode(AI_MODES.EXPLAIN);
    clearAIResult();

    try {
      const res = await aiAPI.explainCode(roomId, {
        code,
        language: getLanguage(),
        selectedCode: selectedText || ''
      });
      setAIResult({ type: 'explain', data: res.data });
    } catch (error) {
      setAIError('Failed to get explanation');
    } finally {
      setAILoading(false);
    }
  };

  const handleDetectBugs = async () => {
    const code = getCurrentCode();
    if (!code) return;

    setAILoading(true);
    setActiveMode(AI_MODES.DETECT_BUGS);
    clearAIResult();

    try {
      const res = await aiAPI.detectBugs(roomId, {
        code,
        language: getLanguage()
      });
      setAIResult({ type: 'bugs', data: res.data });
    } catch (error) {
      setAIError('Failed to detect bugs');
    } finally {
      setAILoading(false);
    }
  };

  const handleRefactor = async () => {
    const code = getCurrentCode();
    if (!code) return;

    setAILoading(true);
    setActiveMode(AI_MODES.REFACTOR);
    clearAIResult();

    try {
      const res = await aiAPI.refactor(roomId, {
        code,
        language: getLanguage()
      });
      setAIResult({ type: 'refactor', data: res.data });
    } catch (error) {
      setAIError('Failed to get refactor suggestions');
    } finally {
      setAILoading(false);
    }
  };

  const renderResult = () => {
    if (aiLoading) {
      return (
        <div className="ai-loading">
          <div className="loading-spinner" />
          <p>AI is thinking...</p>
        </div>
      );
    }

    if (aiError) {
      return (
        <div className="ai-error">
          <AlertCircle size={24} className="error-icon" />
          <p>{aiError}</p>
        </div>
      );
    }

    if (!aiResult) {
      return (
        <div className="ai-empty">
          <Sparkles size={32} className="empty-icon" />
          <p>Select an action to get AI assistance</p>
          {selectedText && (
            <p className="hint">Selected: {selectedText.substring(0, 50)}...</p>
          )}
        </div>
      );
    }

    switch (aiResult.type) {
      case 'explain':
        return <ExplainResult data={aiResult.data} />;
      case 'bugs':
        return <BugsResult data={aiResult.data} />;
      case 'refactor':
        return <RefactorResult data={aiResult.data} />;
      default:
        return null;
    }
  };

  if (!statusChecked) {
    return (
      <div className="ai-panel loading">
        <div className="loading-spinner" />
        <p>Checking AI status...</p>
      </div>
    );
  }

  if (!aiEnabled) {
    return (
      <div className="ai-panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <Sparkles size={16} />
            <h3>AI Assistant</h3>
          </div>
          {onClose && (
            <button className="close-btn" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
        <div className="ai-disabled">
          <Sparkles size={32} className="disabled-icon" />
          <h4>AI Assistant Not Available</h4>
          <p>Please configure OpenAI API key in the backend to enable AI features.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <Sparkles size={16} className="ai-enabled" />
          <h3>AI Assistant</h3>
        </div>
        <div className="panel-header-right">
          <button
            className="refresh-btn"
            onClick={checkAIStatus}
            title="Refresh status"
          >
            <RefreshCw size={14} />
          </button>
          {onClose && (
            <button className="close-btn" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="ai-actions">
        <button
          className={`ai-action-btn ${activeMode === AI_MODES.EXPLAIN ? 'active' : ''}`}
          onClick={handleExplainCode}
          disabled={aiLoading || !getCurrentCode()}
        >
          <Lightbulb size={16} />
          Explain Code
        </button>
        <button
          className={`ai-action-btn ${activeMode === AI_MODES.DETECT_BUGS ? 'active' : ''}`}
          onClick={handleDetectBugs}
          disabled={aiLoading || !getCurrentCode()}
        >
          <Bug size={16} />
          Detect Bugs
        </button>
        <button
          className={`ai-action-btn ${activeMode === AI_MODES.REFACTOR ? 'active' : ''}`}
          onClick={handleRefactor}
          disabled={aiLoading || !getCurrentCode()}
        >
          <Wand2 size={16} />
          Refactor
        </button>
      </div>

      {selectedText && (
        <div className="selection-indicator">
          <Info size={12} />
          Analyzing selected code ({selectedText.length} chars)
        </div>
      )}

      <div className="ai-result">
        {renderResult()}
      </div>
    </div>
  );
}

function ExplainResult({ data }) {
  return (
    <div className="explain-result">
      <h4 className="result-title">
        <Lightbulb size={16} />
        Code Explanation
      </h4>
      <div
        className="markdown-content"
        dangerouslySetInnerHTML={{
          __html: formatMarkdown(data.explanation || '')
        }}
      />
      {data.hasSelection && (
        <div className="result-note">
          <Info size={12} />
          Explaining selected code
        </div>
      )}
    </div>
  );
}

function BugsResult({ data }) {
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'text-error';
      case 'warning': return 'text-warning';
      default: return 'text-info';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <AlertCircle size={16} className="text-error" />;
      case 'warning': return <AlertTriangle size={16} className="text-warning" />;
      default: return <Info size={16} className="text-info" />;
    }
  };

  return (
    <div className="bugs-result">
      <div className="bugs-summary">
        <h4 className="result-title">
          <Bug size={16} />
          Bug Detection Results
        </h4>
        <div className="bugs-count">
          <span className={`count critical`}>
            <AlertCircle size={12} />
            {data.criticalCount || 0} Critical
          </span>
          <span className={`count warning`}>
            <AlertTriangle size={12} />
            {data.warningCount || 0} Warning
          </span>
        </div>
        <p className="bugs-summary-text">{data.summary}</p>
      </div>

      {data.issues && data.issues.length > 0 ? (
        <div className="bugs-list">
          {data.issues.map((issue, idx) => (
            <div key={idx} className={`bug-item ${issue.severity}`}>
              <div className="bug-header">
                {getSeverityIcon(issue.severity)}
                <span className={`bug-severity ${getSeverityColor(issue.severity)}`}>
                  {issue.severity.toUpperCase()}
                </span>
                {issue.lineNumber && (
                  <span className="bug-line">Line {issue.lineNumber}</span>
                )}
              </div>
              <div className="bug-description">{issue.description}</div>
              {issue.suggestion && (
                <div className="bug-suggestion">
                  <Check size={12} />
                  <span>{issue.suggestion}</span>
                </div>
              )}
              {issue.codeSnippet && (
                <pre className="bug-snippet">{issue.codeSnippet}</pre>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="no-bugs">
          <Check size={32} className="success-icon" />
          <p>No issues detected!</p>
          <p className="hint">The code appears to be clean.</p>
        </div>
      )}
    </div>
  );
}

function RefactorResult({ data }) {
  if (!data.suggestions || data.suggestions.length === 0) {
    return (
      <div className="refactor-result">
        <div className="no-suggestions">
          <Wand2 size={32} className="success-icon" />
          <p>No refactor suggestions available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="refactor-result">
      <h4 className="result-title">
        <Wand2 size={16} />
        Refactor Suggestions
      </h4>
      <div className="refactor-list">
        {data.suggestions.map((suggestion, idx) => (
          <div key={idx} className="refactor-item">
            <div className="refactor-header">
              <span className={`refactor-type ${suggestion.type}`}>
                {suggestion.type}
              </span>
              <span className="refactor-title">{suggestion.title}</span>
            </div>
            <div className="refactor-description">{suggestion.description}</div>
            {suggestion.before && (
              <div className="refactor-code">
                <div className="code-label">Before:</div>
                <pre className="code-before">{suggestion.before}</pre>
              </div>
            )}
            {suggestion.after && (
              <div className="refactor-code">
                <div className="code-label">After:</div>
                <pre className="code-after">{suggestion.after}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatMarkdown(text) {
  if (!text) return '';

  let html = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br />');

  return `<p>${html}</p>`;
}

export default AIPanel;
