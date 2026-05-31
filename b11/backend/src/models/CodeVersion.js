const mongoose = require('mongoose');

const codeVersionSchema = new mongoose.Schema({
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
  commitHash: {
    type: String,
    required: true,
    unique: true
  },
  authorId: {
    type: String,
    required: true
  },
  authorName: {
    type: String,
    required: true
  },
  message: {
    type: String,
    default: 'Auto-save'
  },
  content: {
    type: String
  },
  language: {
    type: String
  },
  changes: {
    type: String
  },
  parentCommit: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

codeVersionSchema.index({ roomId: 1, fileId: 1, createdAt: -1 });

module.exports = mongoose.model('CodeVersion', codeVersionSchema);
