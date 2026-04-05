/**
 * modelHelpers.js — PrivacyNet FL
 * 
 * Utility functions shared across services.
 * Contains data generation, normalization, and debugging tools.
 */

import * as tf from '@tensorflow/tfjs';

// ─── Dummy Data Generation (for testing) ────────────────────────────────────────

/**
 * Generates synthetic training samples for testing without a drawing canvas.
 * Creates crude digit-like patterns in 28×28 grids.
 * 
 * NOT for production use — only for unit testing and development.
 * 
 * @param {number} count - Number of samples to generate
 * @returns {Array<{pixels: Float32Array, label: number}>}
 */
export function generateDummyTrainingData(count = 50) {
  const data = [];

  for (let i = 0; i < count; i++) {
    const label = Math.floor(Math.random() * 10);
    const pixels = new Float32Array(784);

    // Create a simple pattern based on the label:
    // Each digit gets a distinctive pixel region activated
    const startRow = Math.floor(label / 3) * 8 + 2;
    const startCol = (label % 3) * 8 + 2;

    for (let row = startRow; row < Math.min(startRow + 7, 28); row++) {
      for (let col = startCol; col < Math.min(startCol + 7, 28); col++) {
        const idx = row * 28 + col;
        if (idx < 784) {
          // Add some noise to make it non-trivial
          pixels[idx] = 0.7 + Math.random() * 0.3;
        }
      }
    }

    // Add random noise elsewhere
    for (let j = 0; j < 784; j++) {
      if (pixels[j] === 0) {
        pixels[j] = Math.random() * 0.1;
      }
    }

    data.push({ pixels, label });
  }

  console.log(`[ModelHelpers] Generated ${count} dummy training samples`);
  return data;
}

// ─── Weight Utilities ───────────────────────────────────────────────────────────

/**
 * Computes the delta (difference) between two sets of serialized weights.
 * Used to send only the change from the base model, reducing bandwidth.
 * 
 * @param {Array<{name: string, shape: number[], data: number[]}>} baseWeights
 * @param {Array<{name: string, shape: number[], data: number[]}>} trainedWeights
 * @returns {Array<{name: string, shape: number[], data: number[]}>} Weight deltas
 */
export function computeWeightDeltas(baseWeights, trainedWeights) {
  if (baseWeights.length !== trainedWeights.length) {
    throw new Error(
      `Weight count mismatch: base has ${baseWeights.length}, trained has ${trainedWeights.length}`
    );
  }

  return trainedWeights.map((trained, i) => {
    const base = baseWeights[i];
    const delta = new Float32Array(trained.data.length);

    for (let j = 0; j < trained.data.length; j++) {
      delta[j] = trained.data[j] - base.data[j];
    }

    return {
      name: trained.name,
      shape: trained.shape.slice(),
      data: Array.from(delta)
    };
  });
}

/**
 * Applies weight deltas to a base set of weights.
 * Inverse operation of computeWeightDeltas.
 * 
 * @param {Array<{name: string, shape: number[], data: number[]}>} baseWeights
 * @param {Array<{name: string, shape: number[], data: number[]}>} deltas
 * @returns {Array<{name: string, shape: number[], data: number[]}>} Resulting weights
 */
export function applyWeightDeltas(baseWeights, deltas) {
  return baseWeights.map((base, i) => {
    const delta = deltas[i];
    const result = new Float32Array(base.data.length);

    for (let j = 0; j < base.data.length; j++) {
      result[j] = base.data[j] + delta.data[j];
    }

    return {
      name: base.name,
      shape: base.shape.slice(),
      data: Array.from(result)
    };
  });
}

// ─── Data Normalization ─────────────────────────────────────────────────────────

/**
 * Normalizes pixel values from [0, 255] to [0, 1] range.
 * 
 * @param {Uint8Array|number[]} pixels - Raw pixel values 0–255
 * @returns {Float32Array} Normalized values 0–1
 */
export function normalizePixels(pixels) {
  const normalized = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    normalized[i] = pixels[i] / 255.0;
  }
  return normalized;
}

/**
 * Inverts pixel values (useful for white-on-black → black-on-white conversion).
 * Some canvas implementations draw white strokes on black bg,
 * but MNIST convention is inverted.
 * 
 * @param {Float32Array} pixels - Normalized pixel values
 * @returns {Float32Array} Inverted values
 */
export function invertPixels(pixels) {
  const inverted = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    inverted[i] = 1.0 - pixels[i];
  }
  return inverted;
}

// ─── Memory Debugging ───────────────────────────────────────────────────────────

/**
 * Returns a snapshot of TF.js memory usage.
 * Call this at debug intervals to detect tensor leaks.
 * 
 * @returns {{numTensors: number, numBytes: number, numBytesFormatted: string}}
 */
export function getMemorySnapshot() {
  const mem = tf.memory();
  return {
    numTensors: mem.numTensors,
    numBytes: mem.numBytes,
    numBytesFormatted: `${(mem.numBytes / 1024 / 1024).toFixed(2)} MB`,
    unreliable: mem.unreliable || false
  };
}

/**
 * Validates that a serialized weights array has the expected structure.
 * 
 * @param {Array} weights - Serialized weights from extractWeights()
 * @param {number} [expectedCount] - Expected number of weight tensors
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateWeights(weights, expectedCount = null) {
  const errors = [];

  if (!Array.isArray(weights)) {
    return { valid: false, errors: ['Weights is not an array'] };
  }

  if (expectedCount !== null && weights.length !== expectedCount) {
    errors.push(`Expected ${expectedCount} weight tensors, got ${weights.length}`);
  }

  weights.forEach((w, i) => {
    if (!w.shape || !Array.isArray(w.shape)) {
      errors.push(`Weight ${i}: missing or invalid shape`);
    }
    if (!w.data || !Array.isArray(w.data)) {
      errors.push(`Weight ${i}: missing or invalid data`);
    }
    if (w.shape && w.data) {
      const expectedSize = w.shape.reduce((a, b) => a * b, 1);
      if (w.data.length !== expectedSize) {
        errors.push(`Weight ${i}: shape ${w.shape} implies ${expectedSize} values, got ${w.data.length}`);
      }
    }
    // Check for NaN/Infinity in weight data
    if (w.data) {
      const badValues = w.data.filter(v => !Number.isFinite(v));
      if (badValues.length > 0) {
        errors.push(`Weight ${i}: contains ${badValues.length} non-finite values (NaN/Infinity)`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}
