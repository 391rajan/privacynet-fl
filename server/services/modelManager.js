/**
 * modelManager.js — PrivacyNet FL Server
 * 
 * Manages the lifecycle of the global federated model:
 *   - Initializes the seed model (version 0)
 *   - Stores aggregated models to MongoDB
 *   - Retrieves the latest model for client download
 *   - Tracks training round state
 */

const tf = require('@tensorflow/tfjs');
const GlobalModel = require('../models/GlobalModel');

// ─── Model Architecture (must match client-side) ────────────────────────────────

const INPUT_SIZE = 784;
const DENSE_1_UNITS = 128;
const DENSE_2_UNITS = 64;
const NUM_CLASSES = 10;
const DROPOUT_RATE = 0.2;

/**
 * Creates the canonical model architecture on the server.
 * This must exactly mirror the client-side initializeModel() in tensorflowService.js.
 * 
 * @returns {tf.Sequential} Compiled model
 */
function createModel() {
  const model = tf.sequential();

  model.add(tf.layers.dense({
    inputShape: [INPUT_SIZE],
    units: DENSE_1_UNITS,
    activation: 'relu',
    kernelInitializer: 'heNormal',
    name: 'dense_128'
  }));

  model.add(tf.layers.dropout({
    rate: DROPOUT_RATE,
    name: 'dropout_02'
  }));

  model.add(tf.layers.dense({
    units: DENSE_2_UNITS,
    activation: 'relu',
    kernelInitializer: 'heNormal',
    name: 'dense_64'
  }));

  model.add(tf.layers.dense({
    units: NUM_CLASSES,
    activation: 'softmax',
    name: 'output_softmax'
  }));

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  });

  return model;
}

/**
 * Extracts weights from a tf.Sequential into serializable format.
 * 
 * @param {tf.Sequential} model
 * @returns {Array<{name: string, shape: number[], data: number[]}>}
 */
function extractWeightsFromModel(model) {
  const weights = model.getWeights();
  const serialized = weights.map((tensor, i) => ({
    name: `weight_${i}`,
    shape: tensor.shape.slice(),
    data: Array.from(tensor.dataSync())
  }));
  // IMPORTANT: Do NOT dispose these tensors.
  // model.getWeights() returns REFERENCES to internal LayerVariable tensors.
  // Disposing them corrupts the model. model.dispose() cleans them up.
  return serialized;
}

/**
 * Initializes the seed global model (version 0) if none exists in MongoDB.
 * Called once during server startup.
 * 
 * @returns {Promise<{version: number, weights: Array}>}
 */
async function initializeSeedModel() {
  const existing = await GlobalModel.getLatest();

  if (existing) {
    console.log(`[ModelManager] Global model already exists — version ${existing.version}`);
    return {
      version: existing.version,
      weights: existing.weights
    };
  }

  console.log('[ModelManager] No global model found. Creating seed model (version 0)...');

  // Create model, extract initial random weights
  const model = createModel();
  const weights = extractWeightsFromModel(model);
  model.dispose();

  // Convert to the [[Number]] format expected by the simplified schema
  const weightsAsNestedArrays = weights.map(w => w.data);

  // Save version 0 to MongoDB
  const seedModel = new GlobalModel({
    version: 0,
    weights: weightsAsNestedArrays,
    accuracy: 0,
    participantCount: 0,
    trainingRound: 0
  });

  await seedModel.save();
  console.log('[ModelManager] Seed model (version 0) saved to MongoDB');

  return {
    version: 0,
    weights   // Return the rich format for socket transmission
  };
}

/**
 * Retrieves the latest global model.
 * 
 * @returns {Promise<{version: number, weights: Array, accuracy: number}|null>}
 */
async function getLatestModel() {
  const model = await GlobalModel.getLatest();

  if (!model) {
    console.warn('[ModelManager] No global model in database');
    return null;
  }

  // Convert from [[Number]] back to the rich descriptor format
  // We need shape info — reconstruct from the canonical architecture
  const refModel = createModel();
  const refWeights = refModel.getWeights();
  const shapes = refWeights.map(t => t.shape.slice());
  // Do NOT dispose refWeights individually — they're internal to refModel
  refModel.dispose(); // This disposes everything including the weight tensors

  const richWeights = model.weights.map((data, i) => ({
    name: `weight_${i}`,
    shape: shapes[i],
    data: Array.from(data)  // Ensure plain Array for socket serialization
  }));

  return {
    version: model.version,
    weights: richWeights,
    accuracy: model.accuracy,
    participantCount: model.participantCount,
    trainingRound: model.trainingRound
  };
}

/**
 * Saves a new version of the global model after aggregation.
 * 
 * @param {Array<{name: string, shape: number[], data: number[]}>} weights - Aggregated weights
 * @param {number} accuracy - Average accuracy from contributors
 * @param {number} participantCount - How many clients contributed
 * @param {number} trainingRound - Round number
 * @returns {Promise<{version: number}>}
 */
async function saveAggregatedModel(weights, accuracy, participantCount, trainingRound) {
  const currentVersion = await GlobalModel.getLatestVersion();
  const newVersion = currentVersion + 1;

  // Convert to [[Number]] for storage
  const weightsAsNestedArrays = weights.map(w => w.data);

  const newModel = new GlobalModel({
    version: newVersion,
    weights: weightsAsNestedArrays,
    accuracy,
    participantCount,
    trainingRound
  });

  await newModel.save();
  console.log(`[ModelManager] Saved aggregated model — version ${newVersion}, round ${trainingRound}, accuracy ${(accuracy * 100).toFixed(1)}%`);

  return { version: newVersion };
}

/**
 * Returns model history for analytics.
 * 
 * @param {number} [limit=20] - Number of recent versions to return
 * @returns {Promise<Array<{version, accuracy, participantCount, trainingRound, createdAt}>>}
 */
async function getModelHistory(limit = 20) {
  return GlobalModel.find()
    .sort({ version: -1 })
    .limit(limit)
    .select('version accuracy participantCount trainingRound createdAt')
    .lean()
    .exec();
}

module.exports = {
  createModel,
  initializeSeedModel,
  getLatestModel,
  saveAggregatedModel,
  getModelHistory,
  extractWeightsFromModel
};
