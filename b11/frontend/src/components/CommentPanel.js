import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, CheckCircle, XCircle, ChevronDown, ChevronUp,
  Send, Edit2, Trash2, Reply, Users, AtSign, X
} from 'lucide-react';
import { useRoomStore } from '../store/roomStore';
import { commentAPI } from '../services/api';

function CommentPanel({ roomId, activeFile, onLineClick, onClose }) {
  const {
    comments,
    setComments,
    addComment,
    updateComment,
    removeComment,
    users,
    canEdit
  } = useRoomStore();

  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyContent, setReplyContent] = useState('');
  const [selectedLine, setSelectedLine] = useState(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (roomId && activeFile) {
      loadComments();
    }
  }, [roomId, activeFile, includeResolved]);

  const loadComments = async () => {
    if (!roomId || !activeFile) return;
    setLoading(true);
    try {
      const res = await commentAPI.getComments(roomId, activeFile, includeResolved);
      setComments(res.data);
    } catch (error) {
      console.error('Failed to load comments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim() || !roomId || !activeFile) return;

    try {
      const snippet = selectedLine ? `Line ${selectedLine}` : '';
      const res = await commentAPI.createComment(roomId, {
        fileId: activeFile,
        lineNumber: selectedLine || 1,
        content: newComment.trim(),
        snippet
      });
      addComment(res.data);
      setNewComment('');
      setSelectedLine(null);
    } catch (error) {
      console.error('Failed to create comment:', error);
    }
  };

  const handleUpdateComment = async (commentId) => {
    if (!editContent.trim()) return;
    try {
      const res = await commentAPI.updateComment(roomId, commentId, editContent.trim());
      updateComment(commentId, { content: editContent.trim(), updatedAt: Date.now() });
      setEditingComment(null);
      setEditContent('');
    } catch (error) {
      console.error('Failed to update comment:', error);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) return;
    try {
      await commentAPI.deleteComment(roomId, commentId);
      removeComment(commentId);
    } catch (error) {
      console.error('Failed to delete comment:', error);
    }
  };

  const handleToggleResolved = async (commentId, resolved) => {
    try {
      const res = await commentAPI.toggleResolved(roomId, commentId, resolved);
      updateComment(commentId, res.data);
    } catch (error) {
      console.error('Failed to toggle resolved:', error);
    }
  };

  const handleAddReply = async (commentId) => {
    if (!replyContent.trim()) return;
    try {
      const res = await commentAPI.addReply(roomId, commentId, replyContent.trim());
      const updatedComment = res.data;
      updateComment(commentId, { replies: updatedComment.replies });
      setReplyingTo(null);
      setReplyContent('');
    } catch (error) {
      console.error('Failed to add reply:', error);
    }
  };

  const handleKeyDown = (e, action, commentId = null) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (action === 'new') handleSubmitComment();
      else if (action === 'edit') handleUpdateComment(commentId);
      else if (action === 'reply') handleAddReply(commentId);
    }
  };

  const handleTextareaChange = (e, type) => {
    const value = e.target.value;
    if (type === 'new') {
      setNewComment(value);
      checkMention(value);
    } else if (type === 'reply') {
      setReplyContent(value);
      checkMention(value);
    }
  };

  const checkMention = (value) => {
    const match = value.match(/@(\w*)$/);
    if (match) {
      setMentionFilter(match[1]);
      setShowMentionMenu(true);
    } else {
      setShowMentionMenu(false);
    }
  };

  const insertMention = (username) => {
    if (textareaRef.current) {
      const currentValue = textareaRef.current.value;
      const newValue = currentValue.replace(/@(\w*)$/, `@${username} `);
      setNewComment(newValue);
      textareaRef.current.value = newValue;
    }
    setShowMentionMenu(false);
    setMentionFilter('');
  };

  const filteredUsers = users.filter(u =>
    u.username?.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  const formatTime = (date) => {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleString();
  };

  const lineCommentsMap = comments.reduce((acc, comment) => {
    const line = comment.lineNumber;
    if (!acc[line]) acc[line] = [];
    acc[line].push(comment);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="comment-panel loading">
        <div className="loading-spinner" />
        <p>Loading comments...</p>
      </div>
    );
  }

  return (
    <div className="comment-panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <MessageSquare size={16} />
          <h3>Code Review</h3>
          <span className="comment-count">
            ({comments.filter(c => !c.resolved).length} unresolved)
          </span>
        </div>
        <div className="panel-header-right">
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(e) => setIncludeResolved(e.target.checked)}
            />
            <span>Show resolved</span>
          </label>
          {onClose && (
            <button className="close-btn" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="panel-content">
        {canEdit() && (
          <div className="new-comment">
            <div className="comment-input-wrapper">
              <textarea
                ref={textareaRef}
                className="comment-input"
                placeholder="Add a comment... Use @ to mention users (Ctrl+Enter to submit)"
                value={newComment}
                onChange={(e) => handleTextareaChange(e, 'new')}
                onKeyDown={(e) => handleKeyDown(e, 'new')}
                rows={3}
              />
              {showMentionMenu && filteredUsers.length > 0 && (
                <div className="mention-menu">
                  {filteredUsers.map(user => (
                    <button
                      key={user.id}
                      className="mention-item"
                      onClick={() => insertMention(user.username || user.id.substring(0, 8))}
                    >
                      <span
                        className="user-color-dot"
                        style={{ backgroundColor: user.color }}
                      />
                      {user.username || user.id.substring(0, 8)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="comment-input-footer">
              {selectedLine && (
                <span className="line-indicator">Line {selectedLine}</span>
              )}
              <button
                className="btn-primary submit-btn"
                onClick={handleSubmitComment}
                disabled={!newComment.trim()}
              >
                <Send size={14} />
                Post Comment
              </button>
            </div>
          </div>
        )}

        <div className="comments-list">
          {comments.length === 0 ? (
            <div className="empty-comments">
              <MessageSquare size={32} className="empty-icon" />
              <p>No comments yet</p>
              <p className="hint">Click line numbers to add comments</p>
            </div>
          ) : (
            Object.entries(lineCommentsMap).map(([lineNum, lineComments]) => (
              <div key={lineNum} className="line-comment-group">
                <div
                  className="line-header"
                  onClick={() => onLineClick && onLineClick(parseInt(lineNum))}
                >
                  <span className="line-number-badge">Line {lineNum}</span>
                  <span className="line-comment-count">
                    {lineComments.filter(c => !c.resolved).length} unresolved
                  </span>
                </div>

                {lineComments.map(comment => (
                  <div
                    key={comment._id || comment.id}
                    className={`comment-item ${comment.resolved ? 'resolved' : ''}`}
                  >
                    <div className="comment-header">
                      <div className="comment-author">
                        <span
                          className="user-avatar-small"
                          style={{ backgroundColor: comment.authorColor || '#888' }}
                        />
                        <span className="author-name">{comment.authorName}</span>
                        <span className="comment-time">
                          {formatTime(comment.createdAt)}
                        </span>
                      </div>
                      <div className="comment-actions">
                        {canEdit() && (
                          <>
                            <button
                              className={`action-btn ${comment.resolved ? 'resolved-btn' : 'resolve-btn'}`}
                              title={comment.resolved ? 'Mark unresolved' : 'Mark resolved'}
                              onClick={() => handleToggleResolved(
                                comment._id || comment.id,
                                !comment.resolved
                              )}
                            >
                              {comment.resolved ? (
                                <CheckCircle size={14} className="resolved" />
                              ) : (
                                <XCircle size={14} />
                              )}
                            </button>
                            <button
                              className="action-btn reply-btn"
                              title="Reply"
                              onClick={() => {
                                setReplyingTo(comment._id || comment.id);
                                setReplyContent('');
                              }}
                            >
                              <Reply size={14} />
                            </button>
                            <button
                              className="action-btn edit-btn"
                              title="Edit"
                              onClick={() => {
                                setEditingComment(comment._id || comment.id);
                                setEditContent(comment.content);
                              }}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              className="action-btn delete-btn"
                              title="Delete"
                              onClick={() => handleDeleteComment(comment._id || comment.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {editingComment === (comment._id || comment.id) ? (
                      <div className="edit-comment">
                        <textarea
                          className="comment-input"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, 'edit', comment._id || comment.id)}
                          rows={3}
                        />
                        <div className="edit-actions">
                          <button
                            className="btn-primary"
                            onClick={() => handleUpdateComment(comment._id || comment.id)}
                          >
                            Save
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => setEditingComment(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="comment-content">
                        {comment.content}
                      </div>
                    )}

                    {comment.mentions && comment.mentions.length > 0 && (
                      <div className="comment-mentions">
                        <AtSign size={12} />
                        {comment.mentions.map((m, i) => (
                          <span key={i} className="mention-tag">
                            @{m.username}
                          </span>
                        ))}
                      </div>
                    )}

                    {comment.replies && comment.replies.length > 0 && (
                      <div className="comment-replies">
                        {comment.replies.map(reply => (
                          <div key={reply._id} className="reply-item">
                            <div className="reply-header">
                              <span
                                className="user-avatar-small"
                                style={{ backgroundColor: reply.authorColor || '#888' }}
                              />
                              <span className="author-name">{reply.authorName}</span>
                              <span className="comment-time">
                                {formatTime(reply.createdAt)}
                              </span>
                            </div>
                            <div className="reply-content">{reply.content}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {replyingTo === (comment._id || comment.id) && (
                      <div className="reply-input-wrapper">
                        <textarea
                          className="comment-input reply-input"
                          placeholder="Write a reply..."
                          value={replyContent}
                          onChange={(e) => handleTextareaChange(e, 'reply')}
                          onKeyDown={(e) => handleKeyDown(e, 'reply', comment._id || comment.id)}
                          rows={2}
                        />
                        <div className="reply-actions">
                          <button
                            className="btn-primary small-btn"
                            onClick={() => handleAddReply(comment._id || comment.id)}
                          >
                            Reply
                          </button>
                          <button
                            className="btn-secondary small-btn"
                            onClick={() => setReplyingTo(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default CommentPanel;
