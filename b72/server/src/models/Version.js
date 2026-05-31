const mongoose = require('mongoose');

const versionSchema = new mongoose.Schema({
  scoreId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Score',
    required: true,
    index: true
  },
  version: {
    type: Number,
    required: true
  },
  snapshot: [{
    page: Number,
    type: String,
    data: mongoose.Schema.Types.Mixed,
    color: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: Date
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  description: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Version', versionSchema);
