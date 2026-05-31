const mongoose = require('mongoose');

const annotationSchema = new mongoose.Schema({
  scoreId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Score',
    required: true,
    index: true
  },
  page: {
    type: Number,
    required: true,
    default: 1
  },
  type: {
    type: String,
    enum: ['highlight', 'pen', 'text', 'metronome'],
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  color: {
    type: String,
    default: '#ff0000'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Annotation', annotationSchema);
