const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const commentService = require('../services/commentService');
const roomService = require('../services/roomService');

const router = express.Router();

router.get('/:roomId/comments', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { fileId, includeResolved } = req.query;

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const comments = await commentService.getComments(roomId, fileId, {
      includeResolved: includeResolved === 'true'
    });

    res.json(comments);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

router.post('/:roomId/comments', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { fileId, lineNumber, startLineNumber, endLineNumber, content, snippet } = req.body;

    if (!fileId || lineNumber === undefined || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const userData = room.users.get(req.user.id);
    const roomUsers = Array.from(room.users.entries()).map(([id, data]) => ({
      id,
      username: data.username || id,
      ...data
    }));

    const comment = await commentService.createComment({
      roomId,
      fileId,
      lineNumber,
      startLineNumber,
      endLineNumber,
      authorId: req.user.id,
      authorName: userData?.username || req.user.id,
      authorColor: userData?.color,
      content,
      snippet,
      roomUsers
    });

    req.io?.to(roomId).emit('comment-created', {
      comment,
      authorId: req.user.id
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

router.put('/:roomId/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const { roomId, commentId } = req.params;
    const { content } = req.body;

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const comment = await commentService.updateComment(commentId, { content }, req.user.id);

    req.io?.to(roomId).emit('comment-updated', {
      comment,
      authorId: req.user.id
    });

    res.json(comment);
  } catch (error) {
    console.error('Update comment error:', error);
    if (error.message === 'Comment not found') {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (error.message === 'Permission denied') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

router.delete('/:roomId/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const { roomId, commentId } = req.params;

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    await commentService.deleteComment(commentId, req.user.id);

    req.io?.to(roomId).emit('comment-deleted', {
      commentId,
      authorId: req.user.id
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    if (error.message === 'Comment not found') {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (error.message === 'Permission denied') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

router.post('/:roomId/comments/:commentId/resolve', authenticateToken, async (req, res) => {
  try {
    const { roomId, commentId } = req.params;
    const { resolved = true } = req.body;

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!roomService.canEdit(roomId, req.user.id)) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const comment = await commentService.toggleResolved(commentId, req.user.id, resolved);

    req.io?.to(roomId).emit('comment-resolved', {
      commentId,
      resolved,
      comment
    });

    res.json(comment);
  } catch (error) {
    console.error('Resolve comment error:', error);
    if (error.message === 'Comment not found') {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.status(500).json({ error: 'Failed to resolve comment' });
  }
});

router.post('/:roomId/comments/:commentId/replies', authenticateToken, async (req, res) => {
  try {
    const { roomId, commentId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.users.has(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const userData = room.users.get(req.user.id);
    const roomUsers = Array.from(room.users.entries()).map(([id, data]) => ({
      id,
      username: data.username || id,
      ...data
    }));

    const comment = await commentService.addReply(commentId, {
      authorId: req.user.id,
      authorName: userData?.username || req.user.id,
      authorColor: userData?.color,
      content
    }, roomUsers);

    req.io?.to(roomId).emit('comment-reply-added', {
      commentId,
      reply: comment.replies[comment.replies.length - 1],
      authorId: req.user.id
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error('Add reply error:', error);
    if (error.message === 'Comment not found') {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.status(500).json({ error: 'Failed to add reply' });
  }
});

router.put('/:roomId/comments/:commentId/replies/:replyId', authenticateToken, async (req, res) => {
  try {
    const { roomId, commentId, replyId } = req.params;
    const { content } = req.body;

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const comment = await commentService.updateReply(commentId, replyId, { content }, req.user.id);

    req.io?.to(roomId).emit('comment-reply-updated', {
      commentId,
      replyId,
      content
    });

    res.json(comment);
  } catch (error) {
    console.error('Update reply error:', error);
    if (error.message === 'Comment not found' || error.message === 'Reply not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Permission denied') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    res.status(500).json({ error: 'Failed to update reply' });
  }
});

router.delete('/:roomId/comments/:commentId/replies/:replyId', authenticateToken, async (req, res) => {
  try {
    const { roomId, commentId, replyId } = req.params;

    const room = roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const comment = await commentService.deleteReply(commentId, replyId, req.user.id);

    req.io?.to(roomId).emit('comment-reply-deleted', {
      commentId,
      replyId
    });

    res.json(comment);
  } catch (error) {
    console.error('Delete reply error:', error);
    if (error.message === 'Comment not found' || error.message === 'Reply not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Permission denied') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    res.status(500).json({ error: 'Failed to delete reply' });
  }
});

module.exports = router;
