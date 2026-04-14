const mongoose = require('mongoose');

/**
 * GlobalModel Schema
 * 
 * Stores the federated global model after each aggregation round.
 * Weights are stored as nested arrays of Numbers (serialized from Float32Arrays).
 * Each document = one version of the aggregated global model.
 */
const GlobalModelSchema = new mongoose.Schema({
  // Monotonically increasing version — unique per aggregation round
  version: {
    type: Number,
    required: true,
    unique: true
  },

  // Nested arrays of weight values. Each element = one layer's weights flattened.
  // Structure mirrors tf.Model.getWeights() output order.
  weights: {
    type: [[Number]],
    required: true
  },

  // Global accuracy estimate (average of contributors' local accuracies)
  accuracy: {
    type: Number,
    default: 0
  },

  // How many clients contributed to this round
  participantCount: {
    type: Number,
    default: 0
  },

  // Which training round produced this model
  trainingRound: {
    type: Number,
    required: true
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  // Per-digit accuracy breakdown (keys: "0" through "9", values: 0-1)
  digitAccuracy: {
    type: Map,
    of: Number,
    default: {}
  }
});

// Convenience: get the latest active global model
GlobalModelSchema.statics.getLatest = async function () {
  return this.findOne().sort({ version: -1 }).exec();
};

// Convenience: get current version number
GlobalModelSchema.statics.getLatestVersion = async function () {
  const latest = await this.findOne().sort({ version: -1 }).select('version').exec();
  return latest ? latest.version : 0;
};

module.exports = mongoose.model('GlobalModel', GlobalModelSchema);
