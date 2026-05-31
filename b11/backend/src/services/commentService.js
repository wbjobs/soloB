const Comment = require('../models/Comment');

const extractMentions = (content, roomUsers = []) => {
  const mentionPattern = /@(\w+)/g;
  const mentions = [];
  let match;

  while ((match = mentionPattern.exec(content)) !== null) {
    const username = match[1];
    const user = roomUsers.find(u => u.username === username || u.id === username);
    if (user) {
      mentions.push({
        userId: user.id || user._id?.toString(),
        username: user.username
      });
    }
  }

  return mentions;
};

const createComment = async ({
  roomId,
  fileId,
  lineNumber,
  startLineNumber,
  endLineNumber,
  authorId,
  authorName,
  authorColor,
  content,
  snippet,
  roomUsers = []
}) => {
  const mentions = extractMentions(content, roomUsers);

  const comment = new Comment({
    roomId,
    fileId,
    lineNumber,
    startLineNumber: startLineNumber || lineNumber,
    endLineNumber: endLineNumber || lineNumber,
    authorId,
    authorName,
    authorColor,
    content,
    mentions,
    snippet
  });

  await comment.save();
  return comment.toObject();
};

const getComments = async (roomId, fileId, options = {}) => {
  const { includeResolved = false } = options;

  const query = { roomId };
  if (fileId) {
    query.fileId = fileId;
  }
  if (!includeResolved) {
    query.resolved = false;
  }

  return Comment.find(query)
    .sort({ lineNumber: 1, createdAt: 1 })
    .lean();
};

const getCommentById = async (commentId) => {
  return Comment.findById(commentId).lean();
};

const updateComment = async (commentId, updates, userId) => {
  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  if (comment.authorId !== userId) {
    throw new Error('Permission denied');
  }

  if (updates.content !== undefined) {
    comment.content = updates.content;
  }

  comment.updatedAt = Date.now();
  await comment.save();
  return comment.toObject();
};

const deleteComment = async (commentId, userId) => {
  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  if (comment.authorId !== userId) {
    throw new Error('Permission denied');
  }

  await comment.deleteOne();
  return true;
};

const toggleResolved = async (commentId, userId, resolved) => {
  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  comment.resolved = resolved;
  if (resolved) {
    comment.resolvedBy = userId;
    comment.resolvedAt = Date.now();
  } else {
    comment.resolvedBy = undefined;
    comment.resolvedAt = undefined;
  }
  comment.updatedAt = Date.now();

  await comment.save();
  return comment.toObject();
};

const addReply = async (commentId, replyData, roomUsers = []) => {
  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  const mentions = extractMentions(replyData.content, roomUsers);

  const reply = {
    authorId: replyData.authorId,
    authorName: replyData.authorName,
    authorColor: replyData.authorColor,
    content: replyData.content,
    mentions,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  comment.replies.push(reply);
  comment.updatedAt = Date.now();

  await comment.save();
  return comment.toObject();
};

const updateReply = async (commentId, replyId, updates, userId) => {
  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  const reply = comment.replies.id(replyId);
  if (!reply) {
    throw new Error('Reply not found');
  }

  if (reply.authorId !== userId) {
    throw new Error('Permission denied');
  }

  if (updates.content !== undefined) {
    reply.content = updates.content;
    reply.updatedAt = Date.now();
  }

  comment.updatedAt = Date.now();
  await comment.save();
  return comment.toObject();
};

const deleteReply = async (commentId, replyId, userId) => {
  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new Error('Comment not found');
  }

  const reply = comment.replies.id(replyId);
  if (!reply) {
    throw new Error('Reply not found');
  }

  if (reply.authorId !== userId) {
    throw new Error('Permission denied');
  }

  reply.deleteOne();
  comment.updatedAt = Date.now();
  await comment.save();
  return comment.toObject();
};

const adjustCommentsOnEdit = async (roomId, fileId, editPosition, editType, length = 1) => {
  const comments = await Comment.find({
    roomId,
    fileId,
    resolved: false
  });

  if (comments.length === 0) return;

  for (const comment of comments) {
    let needsUpdate = false;

    if (editType === 'insert') {
      if (comment.lineNumber >= editPosition) {
        comment.lineNumber += length;
        needsUpdate = true;
      }
      if (comment.startLineNumber >= editPosition) {
        comment.startLineNumber += length;
        needsUpdate = true;
      }
      if (comment.endLineNumber >= editPosition) {
        comment.endLineNumber += length;
        needsUpdate = true;
      }
    } else if (editType === 'delete') {
      const deleteEnd = editPosition + length;
      if (comment.lineNumber > deleteEnd) {
        comment.lineNumber -= length;
        needsUpdate = true;
      }
      if (comment.startLineNumber > deleteEnd) {
        comment.startLineNumber -= length;
        needsUpdate = true;
      }
      if (comment.endLineNumber > deleteEnd) {
        comment.endLineNumber -= length;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await comment.save();
    }
  }
};

module.exports = {
  createComment,
  getComments,
  getCommentById,
  updateComment,
  deleteComment,
  toggleResolved,
  addReply,
  updateReply,
  deleteReply,
  adjustCommentsOnEdit
};
