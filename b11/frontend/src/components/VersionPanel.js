import React, { useState, useEffect } from 'react';
import {
  GitCommit, GitCompare, RotateCcw, ChevronRight, X,
  Clock, User, FileCode, ArrowLeftRight, Eye
} from 'lucide-react';
import { useRoomStore } from '../store/roomStore';
import { versionAPI } from '../services/api';

function VersionPanel({ roomId, activeFile, onClose }) {
  const {
    versions,
    setVersions,
    setVersionsLoading,
    selectedVersion,
    setSelectedVersion,
    compareMode,
    setCompareMode,
    compareFrom,
    setCompareFrom,
    compareTo,
    setCompareTo,
    diffData,
    setDiffData,
    canEdit,
    fileContents,
    updateFileContent
  } = useRoomStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (roomId && activeFile) {
      loadVersions();
    }
  }, [roomId, activeFile]);

  const loadVersions = async () => {
    if (!roomId || !activeFile) return;
    setLoading(true);
    setVersionsLoading(true);
    try {
      const res = await versionAPI.getHistory(roomId, activeFile, 50, 0);
      setVersions(res.data);
    } catch (err) {
      console.error('Failed to load versions:', err);
      setError('Failed to load version history');
    } finally {
      setLoading(false);
      setVersionsLoading(false);
    }
  };

  const handleSaveVersion = async () => {
    if (!roomId || !activeFile || !fileContents[activeFile]) return;
    setSaving(true);
    try {
      const fileName = `v${Date.now()}.txt`;
      await versionAPI.saveVersion(
        roomId,
        activeFile,
        `Manual save - ${new Date().toLocaleString()}`,
        fileName
      );
      await loadVersions();
    } catch (err) {
      console.error('Failed to save version:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectVersion = (version) => {
    if (compareMode) {
      if (!compareFrom) {
        setCompareFrom(version);
      } else if (!compareTo) {
        setCompareTo(version);
        handleCompare(compareFrom, version);
      } else {
        setCompareFrom(version);
        setCompareTo(null);
        setDiffData(null);
      }
    } else {
      setSelectedVersion(version);
    }
  };

  const handleCompare = async (from, to) => {
    if (!roomId || !activeFile) return;
    try {
      const res = await versionAPI.compareVersions(
        roomId,
        activeFile,
        from.commitHash,
        to.commitHash
      );
      setDiffData(res.data);
    } catch (err) {
      console.error('Failed to compare versions:', err);
    }
  };

  const handleRollback = async (version) => {
    if (!window.confirm(`Rollback to version ${version.commitHash.slice(0, 7)}?`)) {
      return;
    }
    try {
      const res = await versionAPI.rollback(roomId, activeFile, version.commitHash);
      if (res.data && res.data.content !== undefined) {
        updateFileContent(activeFile, res.data.content);
      }
      await loadVersions();
      setSelectedVersion(null);
    } catch (err) {
      console.error('Failed to rollback:', err);
    }
  };

  const handleViewVersion = (version) => {
    if (version.content !== undefined) {
      updateFileContent(activeFile, version.content);
    }
    setSelectedVersion(version);
  };

  const toggleCompareMode = () => {
    setCompareMode(!compareMode);
    setCompareFrom(null);
    setCompareTo(null);
    setDiffData(null);
  };

  const formatTime = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString();
  };

  const renderDiff = () => {
    if (!diffData) return null;

    return (
      <div className="diff-view">
        <div className="diff-header">
          <div className="diff-meta">
            <GitCommit size={14} />
            <span>From: {compareFrom?.commitHash?.slice(0, 7)}</span>
            <ArrowLeftRight size={14} />
            <span>To: {compareTo?.commitHash?.slice(0, 7)}</span>
          </div>
          <button className="close-btn" onClick={() => setDiffData(null)}>
            <X size={14} />
          </button>
        </div>
        <div className="diff-content">
          {diffData.hunks && diffData.hunks.length > 0 ? (
            diffData.hunks.map((hunk, idx) => (
              <div key={idx} className="diff-hunk">
                <div className="hunk-header">{hunk.header}</div>
                <div className="hunk-lines">
                  {hunk.changes.map((change, cIdx) => (
                    <div
                      key={cIdx}
                      className={`diff-line ${change.type}`}
                    >
                      <span className="line-marker">
                        {change.type === 'add' ? '+' : change.type === 'remove' ? '-' : ' '}
                      </span>
                      <span className="line-content">{change.content}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="no-changes">
              <FileCode size={32} />
              <p>No changes detected</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderVersionDetail = () => {
    if (!selectedVersion) return null;

    return (
      <div className="version-detail">
        <div className="detail-header">
          <h4>Version Details</h4>
          <button className="close-btn" onClick={() => setSelectedVersion(null)}>
            <X size={14} />
          </button>
        </div>
        <div className="detail-content">
          <div className="detail-row">
            <GitCommit size={14} className="detail-icon" />
            <span className="detail-label">Commit:</span>
            <span className="detail-value">{selectedVersion.commitHash}</span>
          </div>
          <div className="detail-row">
            <User size={14} className="detail-icon" />
            <span className="detail-label">Author:</span>
            <span className="detail-value">{selectedVersion.authorName}</span>
          </div>
          <div className="detail-row">
            <Clock size={14} className="detail-icon" />
            <span className="detail-label">Time:</span>
            <span className="detail-value">{formatTime(selectedVersion.createdAt)}</span>
          </div>
          <div className="detail-row">
            <FileCode size={14} className="detail-icon" />
            <span className="detail-label">Message:</span>
            <span className="detail-value">{selectedVersion.message}</span>
          </div>
        </div>
        <div className="detail-actions">
          {selectedVersion.content !== undefined && (
            <button
              className="btn-secondary small-btn"
              onClick={() => handleViewVersion(selectedVersion)}
            >
              <Eye size={14} />
              View
            </button>
          )}
          {canEdit() && (
            <button
              className="btn-primary small-btn"
              onClick={() => handleRollback(selectedVersion)}
            >
              <RotateCcw size={14} />
              Rollback
            </button>
          )}
        </div>
      </div>
    );
  };

  if (loading && versions.length === 0) {
    return (
      <div className="version-panel loading">
        <div className="loading-spinner" />
        <p>Loading version history...</p>
      </div>
    );
  }

  return (
    <div className="version-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <GitCommit size={16} />
          <h3>Version History</h3>
        </div>
        <div className="panel-header-right">
          {canEdit() && (
            <button
              className="save-version-btn"
              onClick={handleSaveVersion}
              disabled={saving}
            >
              {saving ? (
                <>
                  <div className="loading-spinner small" />
                  Saving...
                </>
              ) : (
                <>
                  <GitCommit size={14} />
                  Save Version
                </>
              )}
            </button>
          )}
          <button
            className={`compare-toggle ${compareMode ? 'active' : ''}`}
            onClick={toggleCompareMode}
            title="Compare versions"
          >
            <GitCompare size={14} />
            Compare
          </button>
          {onClose && (
            <button className="close-btn" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {compareMode && (
        <div className="compare-indicator">
          <span>Select two versions to compare</span>
          <div className="compare-selection">
            <span className={`version-tag ${compareFrom ? 'selected' : ''}`}>
              {compareFrom ? compareFrom.commitHash.slice(0, 7) : 'Select 1st'}
            </span>
            <ChevronRight size={14} />
            <span className={`version-tag ${compareTo ? 'selected' : ''}`}>
              {compareTo ? compareTo.commitHash.slice(0, 7) : 'Select 2nd'}
            </span>
          </div>
        </div>
      )}

      <div className="panel-content">
        {diffData && renderDiff()}

        {selectedVersion && !diffData && renderVersionDetail()}

        <div className="versions-list">
          {versions.length === 0 ? (
            <div className="empty-versions">
              <GitCommit size={32} className="empty-icon" />
              <p>No versions yet</p>
              <p className="hint">Click "Save Version" to create a snapshot</p>
            </div>
          ) : (
            versions.map((version, index) => {
              const isSelected = compareMode
                ? compareFrom?.commitHash === version.commitHash ||
                  compareTo?.commitHash === version.commitHash
                : selectedVersion?.commitHash === version.commitHash;

              return (
                <div
                  key={version._id || version.commitHash}
                  className={`version-item ${isSelected ? 'selected' : ''} ${compareMode ? 'compare-mode' : ''}`}
                  onClick={() => handleSelectVersion(version)}
                >
                  <div className="version-main">
                    <div className="version-commit">
                      <GitCommit size={14} className="commit-icon" />
                      <span className="commit-hash">
                        {version.commitHash.slice(0, 7)}
                      </span>
                      <span className="version-message">
                        {version.message || 'Auto-save'}
                      </span>
                    </div>
                    <div className="version-meta">
                      <div className="meta-item">
                        <User size={12} />
                        {version.authorName}
                      </div>
                      <div className="meta-item">
                        <Clock size={12} />
                        {formatTime(version.createdAt)}
                      </div>
                    </div>
                  </div>
                  {!compareMode && canEdit() && (
                    <div className="version-actions">
                      <button
                        className="action-btn"
                        title="View this version"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewVersion(version);
                        }}
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        className="action-btn"
                        title="Rollback to this version"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRollback(version);
                        }}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default VersionPanel;
