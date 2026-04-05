/**
 * federatedAveraging.js — PrivacyNet FL Server
 * 
 * Implements the Federated Averaging (FedAvg) algorithm.
 * 
 * FedAvg Paper: McMahan et al., "Communication-Efficient Learning of Deep Networks
 *               from Decentralized Data", AISTATS 2017
 * 
 * Algorithm:
 *   For each weight position across all layers:
 *     averaged_weight = (1/n) * Σ(client_weight_i)
 * 
 * Optional: Weighted averaging by number of samples each client trained on.
 */

/**
 * Performs federated averaging on an array of client weight submissions.
 * 
 * Each client's weights are an array of layer descriptors:
 *   [{ name, shape, data: number[] }, ...]
 * 
 * All clients must have the same model architecture (same number of layers,
 * same shapes per layer).
 * 
 * @param {Array<Array<{name: string, shape: number[], data: number[]}>>} clientWeights
 *   Array of weight arrays, one per client
 * @param {Array<number>} [sampleCounts] - Optional: number of samples each client trained on.
 *   If provided, enables weighted averaging (clients with more data have more influence).
 * @returns {Array<{name: string, shape: number[], data: number[]}>} Averaged weights
 */
function federatedAverage(clientWeights, sampleCounts = null) {
  const numClients = clientWeights.length;

  if (numClients === 0) {
    throw new Error('[FedAvg] No client weights provided');
  }

  // ── Edge case: single client → return their weights unchanged ──────────────
  if (numClients === 1) {
    console.log('[FedAvg] Only 1 client — returning their weights directly');
    return clientWeights[0].map(w => ({
      name: w.name,
      shape: w.shape.slice(),
      data: [...w.data]
    }));
  }

  // ── Validate all clients have matching architecture ────────────────────────
  const referenceLayerCount = clientWeights[0].length;

  for (let c = 1; c < numClients; c++) {
    if (clientWeights[c].length !== referenceLayerCount) {
      throw new Error(
        `[FedAvg] Architecture mismatch: client 0 has ${referenceLayerCount} weight tensors, ` +
        `client ${c} has ${clientWeights[c].length}`
      );
    }

    for (let l = 0; l < referenceLayerCount; l++) {
      const refShape = clientWeights[0][l].shape.toString();
      const clientShape = clientWeights[c][l].shape.toString();
      if (refShape !== clientShape) {
        throw new Error(
          `[FedAvg] Shape mismatch at layer ${l}: client 0 has [${refShape}], ` +
          `client ${c} has [${clientShape}]`
        );
      }
    }
  }

  // ── Compute averaging weights ──────────────────────────────────────────────
  let clientContributions;

  if (sampleCounts && sampleCounts.length === numClients) {
    // Weighted average: clients with more samples have proportionally more influence
    const totalSamples = sampleCounts.reduce((a, b) => a + b, 0);
    clientContributions = sampleCounts.map(n => n / totalSamples);
    console.log(`[FedAvg] Weighted averaging — sample counts: [${sampleCounts.join(', ')}], total: ${totalSamples}`);
  } else {
    // Uniform average: all clients contribute equally
    clientContributions = new Array(numClients).fill(1 / numClients);
    console.log(`[FedAvg] Uniform averaging across ${numClients} clients`);
  }

  // ── Perform federated averaging ────────────────────────────────────────────
  const averaged = [];

  for (let layer = 0; layer < referenceLayerCount; layer++) {
    const refWeight = clientWeights[0][layer];
    const dataLength = refWeight.data.length;
    const avgData = new Float64Array(dataLength); // Use Float64 for precision during summation

    // Weighted sum across all clients for this layer
    for (let c = 0; c < numClients; c++) {
      const clientData = clientWeights[c][layer].data;
      const contribution = clientContributions[c];

      for (let i = 0; i < dataLength; i++) {
        avgData[i] += clientData[i] * contribution;
      }
    }

    averaged.push({
      name: refWeight.name,
      shape: refWeight.shape.slice(),
      data: Array.from(new Float32Array(avgData)) // Convert back to Float32 precision
    });
  }

  console.log(`[FedAvg] Averaged ${referenceLayerCount} layers from ${numClients} clients`);

  return averaged;
}

/**
 * Validates incoming weights before aggregation.
 * Rejects weights containing NaN, Infinity, or extreme values
 * that could corrupt the global model.
 * 
 * @param {Array<{name: string, shape: number[], data: number[]}>} weights
 * @returns {{valid: boolean, reason: string|null}}
 */
function validateClientWeights(weights) {
  if (!Array.isArray(weights) || weights.length === 0) {
    return { valid: false, reason: 'Weights array is empty or not an array' };
  }

  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];

    if (!w.data || !w.shape) {
      return { valid: false, reason: `Layer ${i} missing data or shape` };
    }

    // Check for NaN or Infinity — a corrupted update could poison the global model
    for (let j = 0; j < w.data.length; j++) {
      if (!Number.isFinite(w.data[j])) {
        return { valid: false, reason: `Layer ${i} contains non-finite value at index ${j}` };
      }
    }

    // Check for extreme values (possible divergence)
    const maxAbsValue = w.data.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    if (maxAbsValue > 1e6) {
      return {
        valid: false,
        reason: `Layer ${i} has extreme values (max abs: ${maxAbsValue.toFixed(2)}). Possible divergence.`
      };
    }
  }

  return { valid: true, reason: null };
}

module.exports = { federatedAverage, validateClientWeights };
