const mongoose = require('mongoose');

/**
 * TrainingSession Schema
 * 
 * Tracks individual client training contributions. Each document represents
 * one client's local training run and their submitted weight update.
 * 
 * PRIVACY NOTE: We store weight deltas only — never raw training data.
 * The raw drawings never leave the client's browser.
 */
const trainingSessionSchema = new mongoose.Schema({
  // Unique session identifier (UUID v4)
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Client identifier (anonymous, generated client-side)
  clientId: {
    type: String,
    required: true,
    index: true
  },

  // Which global model version the client trained from
  baseModelVersion: {
    type: Number,
    required: true
  },

  // Which aggregation round this contribution belongs to
  roundNumber: {
    type: Number,
    required: true,
    index: true
  },

  // Local training metrics reported by the client
  localMetrics: {
    accuracy: { type: Number },
    loss: { type: Number },
    epochs: { type: Number },
    samplesUsed: { type: Number, default: 0 },
    trainingDurationMs: { type: Number }
  },

  // Weight updates (deltas from base model, NOT absolute weights)
  // Stored as array of { name, shape, data } to match GlobalModel format
  weightUpdates: [{
    name: { type: String, required: true },
    shape: [{ type: Number }],
    dtype: { type: String, default: 'float32' },
    data: { type: [Number], required: true }
  }],

  // Processing status
  status: {
    type: String,
    enum: ['pending', 'validated', 'aggregated', 'rejected'],
    default: 'pending'
  },

  // Rejection reason if status is 'rejected'
  rejectionReason: { type: String },

  // Timestamps
  submittedAt: { type: Date, default: Date.now },
  processedAt: { type: Date }
});

// Get all pending contributions for a specific round
trainingSessionSchema.statics.getPendingForRound = async function (roundNumber) {
  return this.find({ roundNumber, status: 'pending' }).exec();
};

// Get contribution count for a specific round
trainingSessionSchema.statics.getContributionCount = async function (roundNumber) {
  return this.countDocuments({ roundNumber, status: { $in: ['pending', 'validated'] } }).exec();
};

// Mark contributions as aggregated
trainingSessionSchema.statics.markAggregated = async function (sessionIds) {
  return this.updateMany(
    { sessionId: { $in: sessionIds } },
    { $set: { status: 'aggregated', processedAt: new Date() } }
  ).exec();
};

module.exports = mongoose.model('TrainingSession', trainingSessionSchema);
