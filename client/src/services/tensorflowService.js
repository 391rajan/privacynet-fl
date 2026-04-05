/**
 * tensorflowService.js — PrivacyNet FL
 * 
 * Client-side ML engine using TensorFlow.js.
 * Handles model creation, local training, weight extraction/loading, and prediction.
 * 
 * Architecture:
 *   Input(784) → Dense(128, ReLU) → Dropout(0.2) → Dense(64, ReLU) → Dense(10, Softmax)
 * 
 * MEMORY MANAGEMENT:
 *   - All tensor ops wrapped in tf.tidy() where possible
 *   - Manual disposal for tensors that escape tidy scope (training results, etc.)
 *   - tf.memory().numTensors logged after every public function for leak detection
 */

import * as tf from '@tensorflow/tfjs';

// ─── Constants ──────────────────────────────────────────────────────────────────

const INPUT_SIZE = 784;       // 28 * 28 flattened grayscale
const NUM_CLASSES = 10;       // digits 0–9
const DENSE_1_UNITS = 128;
const DENSE_2_UNITS = 64;
const DROPOUT_RATE = 0.2;
const DEFAULT_EPOCHS = 10;
const DEFAULT_BATCH_SIZE = 32;
const LEARNING_RATE = 0.001;

// ─── Utility: Tensor Memory Logger ──────────────────────────────────────────────

function logMemory(label) {
  const mem = tf.memory();
  console.log(`[TF Memory] ${label}: ${mem.numTensors} tensors, ${(mem.numBytes / 1024 / 1024).toFixed(2)} MB`);
}

// ─── 1. initializeModel ─────────────────────────────────────────────────────────

/**
 * Creates and compiles a fresh Sequential digit-classification model.
 * 
 * Architecture:
 *   - Flatten input: 784 neurons (28×28 grayscale image)
 *   - Dense: 128 units, ReLU activation
 *   - Dropout: 20% rate (only active during training)
 *   - Dense: 64 units, ReLU activation
 *   - Dense output: 10 units, Softmax activation (probability per digit class)
 * 
 * @returns {Promise<tf.Sequential>} Compiled TF.js model ready for training or inference
 */
export async function initializeModel() {
  const model = tf.sequential();

  // Hidden layer 1: Dense 128, ReLU
  model.add(tf.layers.dense({
    inputShape: [INPUT_SIZE],
    units: DENSE_1_UNITS,
    activation: 'relu',
    kernelInitializer: 'heNormal',
    name: 'dense_128'
  }));

  // Dropout: 20% — prevents overfitting on small local datasets
  model.add(tf.layers.dropout({
    rate: DROPOUT_RATE,
    name: 'dropout_02'
  }));

  // Hidden layer 2: Dense 64, ReLU
  model.add(tf.layers.dense({
    units: DENSE_2_UNITS,
    activation: 'relu',
    kernelInitializer: 'heNormal',
    name: 'dense_64'
  }));

  // Output layer: 10 classes with softmax probabilities
  model.add(tf.layers.dense({
    units: NUM_CLASSES,
    activation: 'softmax',
    name: 'output_softmax'
  }));

  // Compile with Adam optimizer and categorical cross-entropy loss
  model.compile({
    optimizer: tf.train.adam(LEARNING_RATE),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  });

  console.log('[TensorFlow] Model initialized:');
  model.summary();
  logMemory('After initializeModel');

  return model;
}

// ─── 2. trainLocalModel ─────────────────────────────────────────────────────────

/**
 * Trains the model on locally-collected drawing data.
 * 
 * Data never leaves the browser — only the resulting weight deltas
 * are shared via the federation protocol.
 * 
 * @param {tf.Sequential} model - The model to train (will be mutated in-place)
 * @param {Array<{pixels: Float32Array|number[], label: number}>} trainingData
 *   Each entry is one drawing: 784-element pixel array (0–1 normalized) + digit label
 * @param {Object} [options] - Optional overrides
 * @param {number} [options.epochs=10] - Number of training epochs
 * @param {number} [options.batchSize=32] - Batch size
 * @param {Function} [options.onEpochEnd] - Callback(epoch, logs) fired after each epoch
 * @returns {Promise<{trainedWeights: Array, finalAccuracy: number, finalLoss: number, epochHistory: Array}>}
 */
export async function trainLocalModel(model, trainingData, options = {}) {
  const {
    epochs = DEFAULT_EPOCHS,
    batchSize = DEFAULT_BATCH_SIZE,
    onEpochEnd = null
  } = options;

  if (!trainingData || trainingData.length === 0) {
    throw new Error('[trainLocalModel] trainingData is empty. Need at least 1 sample.');
  }

  console.log(`[TensorFlow] Starting local training: ${trainingData.length} samples, ${epochs} epochs, batch ${batchSize}`);

  const tensorsBefore = tf.memory().numTensors;

  // ── Build input tensors ────────────────────────────────────────────────────

  // Stack all pixel arrays into a [N, 784] tensor
  const xsData = new Float32Array(trainingData.length * INPUT_SIZE);
  for (let i = 0; i < trainingData.length; i++) {
    const pixels = trainingData[i].pixels;
    for (let j = 0; j < INPUT_SIZE; j++) {
      xsData[i * INPUT_SIZE + j] = pixels[j];
    }
  }
  const xs = tf.tensor2d(xsData, [trainingData.length, INPUT_SIZE]);

  // One-hot encode labels into a [N, 10] tensor
  const labels = trainingData.map(d => d.label);
  const labelTensor = tf.tensor1d(labels, 'int32');          // intermediate — must be disposed
  const ys = tf.oneHot(labelTensor, NUM_CLASSES).cast('float32');
  labelTensor.dispose();                                      // BUG #1 FIX: prevents +2 tensor leak per training call

  // ── Train ──────────────────────────────────────────────────────────────────

  const epochHistory = [];

  const history = await model.fit(xs, ys, {
    epochs,
    batchSize,
    shuffle: true,
    validationSplit: 0.1,  // hold out 10% of local data for validation
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        const entry = {
          epoch: epoch + 1,
          loss: parseFloat(logs.loss.toFixed(4)),
          accuracy: parseFloat(logs.acc.toFixed(4)),
          valLoss: logs.val_loss != null ? parseFloat(logs.val_loss.toFixed(4)) : null,
          valAccuracy: logs.val_acc != null ? parseFloat(logs.val_acc.toFixed(4)) : null
        };
        epochHistory.push(entry);
        console.log(
          `[TensorFlow] Epoch ${entry.epoch}/${epochs} — ` +
          `loss: ${entry.loss}, accuracy: ${entry.accuracy}` +
          (entry.valLoss != null ? `, val_loss: ${entry.valLoss}, val_acc: ${entry.valAccuracy}` : '')
        );
        if (onEpochEnd) onEpochEnd(epoch, logs);
      }
    }
  });

  // ── Extract results ────────────────────────────────────────────────────────

  const finalAccuracy = epochHistory.length > 0
    ? epochHistory[epochHistory.length - 1].accuracy
    : 0;

  const finalLoss = epochHistory.length > 0
    ? epochHistory[epochHistory.length - 1].loss
    : Infinity;

  const trainedWeights = extractWeights(model);

  // ── Dispose training tensors ───────────────────────────────────────────────

  xs.dispose();
  ys.dispose();

  const tensorsAfter = tf.memory().numTensors;
  console.log(`[TensorFlow] Training complete. Tensors before: ${tensorsBefore}, after: ${tensorsAfter}, delta: ${tensorsAfter - tensorsBefore}`);
  logMemory('After trainLocalModel');

  return {
    trainedWeights,
    finalAccuracy,
    finalLoss,
    epochHistory
  };
}

// ─── 3. extractWeights ──────────────────────────────────────────────────────────

/**
 * Extracts model weights as plain JavaScript arrays — safe for JSON
 * serialization and WebSocket transmission.
 * 
 * Each layer's weights are converted from tf.Tensor → Array<number>.
 * Shape metadata is preserved alongside the flat data.
 * 
 * @param {tf.Sequential} model - Trained model to extract weights from
 * @returns {Array<{name: string, shape: number[], data: number[]}>}
 *   Array of weight descriptors, one per trainable tensor
 */
export function extractWeights(model) {
  const weights = model.getWeights();
  const serialized = [];

  for (let i = 0; i < weights.length; i++) {
    const tensor = weights[i];
    const data = Array.from(tensor.dataSync());  // Float32Array → plain Array
    serialized.push({
      name: `weight_${i}`,
      shape: tensor.shape.slice(),               // copy shape array
      data
    });
    // IMPORTANT: Do NOT dispose these tensors.
    // model.getWeights() in @tensorflow/tfjs returns REFERENCES to the model's
    // internal LayerVariable tensors, NOT copies. Disposing them corrupts the model.
    // (Running tensor.dispose() here causes: "LayersVariable is already disposed")
    // The model's own dispose() cleans these up when the model is destroyed.
  }

  logMemory('After extractWeights');

  return serialized;
}

// ─── 4. loadWeights ─────────────────────────────────────────────────────────────

/**
 * Loads serialized weight arrays back into a model.
 * Used when receiving the global aggregated model from the server.
 * 
 * @param {tf.Sequential} model - Model to load weights into (must have matching architecture)
 * @param {Array<{name: string, shape: number[], data: number[]}>} weightsArray
 *   Serialized weights in the same format produced by extractWeights()
 */
export function loadWeights(model, weightsArray) {
  if (!weightsArray || weightsArray.length === 0) {
    console.warn('[TensorFlow] loadWeights called with empty array — skipping.');
    return;
  }

  // BUG #2 FIX: Validate for NaN/Infinity BEFORE touching the model.
  // A corrupted update would permanently poison the model for this session.
  for (let i = 0; i < weightsArray.length; i++) {
    const w = weightsArray[i];
    if (!w.data || !Array.isArray(w.data)) {
      console.error(`[TensorFlow] loadWeights: layer ${i} missing data array — aborting, keeping current model.`);
      return;
    }
    const hasNonFinite = w.data.some(v => !Number.isFinite(v));
    if (hasNonFinite) {
      console.error(`[TensorFlow] loadWeights: layer ${i} contains NaN/Infinity — rejecting update, keeping current model.`);
      return;
    }
  }

  // Build new weight tensors from the serialized data
  const tensors = weightsArray.map(w => tf.tensor(w.data, w.shape));

  try {
    // Validate count and shapes against the model.
    // IMPORTANT: getWeights() returns LIVE REFERENCES — do NOT dispose them here.
    // Only use them to read .shape, then let them go out of scope.
    const modelWeightSpecs = model.getWeights().map(t => t.shape.slice());

    if (modelWeightSpecs.length !== tensors.length) {
      throw new Error(
        `Weight count mismatch: model has ${modelWeightSpecs.length} weight tensors, ` +
        `but received ${tensors.length}`
      );
    }

    for (let i = 0; i < modelWeightSpecs.length; i++) {
      const expected = modelWeightSpecs[i].toString();
      const received = tensors[i].shape.toString();
      if (expected !== received) {
        throw new Error(
          `Shape mismatch at weight index ${i}: model expects [${expected}], got [${received}]`
        );
      }
    }

    // setWeights() copies data from our tensors into the model's internal variables.
    model.setWeights(tensors);

    console.log(`[TensorFlow] Loaded ${tensors.length} weight tensors into model.`);
  } finally {
    // Dispose the temporary tensors we created — setWeights already copied the data
    tensors.forEach(t => {
      if (!t.isDisposed) t.dispose();
    });
  }

  logMemory('After loadWeights');
}

// ─── 5. predictDigit ────────────────────────────────────────────────────────────

/**
 * Runs inference on a single 28×28 grayscale image.
 * 
 * @param {tf.Sequential} model - Trained model
 * @param {Float32Array|number[]} imageData - 784-element array, values 0–1 normalized
 * @returns {Promise<{predictedDigit: number, confidence: number, confidences: number[]}>}
 *   predictedDigit: argmax class (0–9)
 *   confidence: probability of the predicted class
 *   confidences: full 10-element probability distribution
 */
export async function predictDigit(model, imageData) {
  if (!imageData || imageData.length !== INPUT_SIZE) {
    throw new Error(
      `[predictDigit] Expected ${INPUT_SIZE} pixels, got ${imageData ? imageData.length : 0}`
    );
  }

  const result = tf.tidy(() => {
    // Reshape to [1, 784] batch
    const input = tf.tensor2d(Array.from(imageData), [1, INPUT_SIZE]);

    // Forward pass — softmax output gives probabilities
    const prediction = model.predict(input);

    // Extract results
    const confidences = Array.from(prediction.dataSync());
    const predictedDigit = confidences.indexOf(Math.max(...confidences));
    const confidence = confidences[predictedDigit];

    return { predictedDigit, confidence, confidences };
  });

  logMemory('After predictDigit');

  return result;
}

// ─── 6. Utility: preprocessCanvasData ───────────────────────────────────────────

/**
 * Converts raw canvas pixel data (RGBA) to the normalized 784-element
 * grayscale array expected by the model.
 * 
 * @param {ImageData|Uint8ClampedArray} canvasData - Raw RGBA pixel data from a 28×28 canvas
 * @returns {Float32Array} 784-element array with values normalized to [0, 1]
 */
export function preprocessCanvasData(canvasData) {
  const rgba = canvasData instanceof ImageData ? canvasData.data : canvasData;

  if (rgba.length !== 28 * 28 * 4) {
    throw new Error(
      `[preprocessCanvasData] Expected ${28 * 28 * 4} RGBA values, got ${rgba.length}. ` +
      `Ensure the canvas is exactly 28×28.`
    );
  }

  const grayscale = new Float32Array(INPUT_SIZE);

  for (let i = 0; i < INPUT_SIZE; i++) {
    // Use the alpha channel as the intensity (canvas drawings on transparent bg),
    // or average RGB if alpha is fully opaque
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];

    if (a === 0) {
      grayscale[i] = 0; // transparent = background = 0
    } else {
      // Standard luminance formula, normalized to [0, 1]
      grayscale[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
  }

  return grayscale;
}

// ─── 7. Utility: getModelSummary ────────────────────────────────────────────────

/**
 * Returns a structured summary of the model architecture.
 * Useful for debug panels and status displays.
 * 
 * @param {tf.Sequential} model
 * @returns {{layers: Array, totalParams: number, trainableParams: number}}
 */
export function getModelSummary(model) {
  const layers = model.layers.map(layer => ({
    name: layer.name,
    type: layer.getClassName(),
    outputShape: layer.outputShape,
    params: layer.countParams()
  }));

  const totalParams = layers.reduce((sum, l) => sum + l.params, 0);

  return {
    layers,
    totalParams,
    trainableParams: totalParams  // all params are trainable in this architecture
  };
}

// ─── 8. Utility: disposeModel ───────────────────────────────────────────────────

/**
 * Safely disposes a model and all its weight tensors to free GPU/CPU memory.
 * 
 * @param {tf.Sequential} model
 */
export function disposeModel(model) {
  if (model) {
    model.dispose();
    console.log('[TensorFlow] Model disposed.');
    logMemory('After disposeModel');
  }
}
