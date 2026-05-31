const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    index: true
  },
  fileId: {
    type: String,
    required: true,
    index: true
  },
  lineNumber: {
    type: Number,
    required: true
  },
  startLineNumber: {
    type: Number
  },
  endLineNumber: {
    type: Number
  },
  authorId: {
    type: String,
    required: true
  },
  authorName: {
    type: String,
    required: true
  },
  authorColor: {
    type: String
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  mentions: [{
    userId: String,
    username: String
  }],
  resolved: {
    type: Boolean,
    default: false
  },
  resolvedBy: {
    type: String
  },
  resolvedAt: {
    type: Date
  },
  replies: [{
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    authorId: { type: String, required: true },
    authorName: { type: String, required: true },
    authorColor: { type: String },
    content: { type: String, required: true },
    mentions: [{
      userId: String,
      username: String
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }],
  snippet: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

commentSchema.index({ roomId: 1, fileId: 1, lineNumber: 1 });
commentSchema.index({ roomId: 1, resolved: 1 });

module.exports = mongoose.model('Comment', commentSchema);
