/**
 * trainingSocket.js — PrivacyNet FL Server
 * 
 * WebSocket event handlers for the federated learning protocol.
 * 
 * Protocol Flow:
 *   1. Client connects → 'join_training' → server tracks participant
 *   2. Client requests model → 'request_global_model' → server sends weights
 *   3. Client trains locally, then → 'submit_weights' → server buffers update
 *   4. When enough clients submit → server runs FedAvg → 'model_updated' broadcast
 * 
 * The aggregation threshold (MIN_CLIENTS_FOR_AGGREGATION) is configurable.
 * Default is 2 — set higher in production for better privacy guarantees.
 */

const { federatedAverage, validateClientWeights } = require('../services/federatedAveraging');
const modelManager = require('../services/modelManager');
const TrainingSession = require('../models/TrainingSession');
const { v4: uuidv4 } = require('uuid');

// ─── State ──────────────────────────────────────────────────────────────────────

// In-memory buffer of weight submissions for the current aggregation round
const pendingSubmissions = new Map(); // clientId → { weights, accuracy, samplesUsed, socketId }

let currentRound = 0;
let participantCount = 0;
let isAggregating = false; // BUG #5 FIX: Mutex to prevent concurrent aggregation runs

// Aggregation triggers when this many clients have submitted
const MIN_CLIENTS = parseInt(process.env.MIN_CLIENTS_FOR_AGGREGATION || '2', 10);

// ─── Setup ──────────────────────────────────────────────────────────────────────

/**
 * Registers all Socket.io event handlers for a given io server instance.
 * Called once during server startup.
 * 
 * @param {import('socket.io').Server} io
 */
function setupTrainingSocket(io) {
  io.on('connection', (socket) => {
    participantCount++;
    console.log(`[Socket] Client connected: ${socket.id} (Total: ${participantCount})`);

    // Broadcast updated participant count to ALL clients
    io.emit('participant_count', { count: participantCount });

    // ── join_training ─────────────────────────────────────────────────────────

    socket.on('join_training', (data) => {
      const clientId = data?.clientId || socket.id;
      console.log(`[Socket] Client joined training: ${clientId}`);

      // Store metadata on the socket for later reference
      socket.clientId = clientId;

      // Send current state to the newly joined client
      socket.emit('training_state', {
        currentRound,
        participantCount,
        pendingSubmissions: pendingSubmissions.size,
        minClientsRequired: MIN_CLIENTS
      });
    });

    // ── request_global_model ──────────────────────────────────────────────────

    socket.on('request_global_model', async () => {
      try {
        const model = await modelManager.getLatestModel();

        if (!model) {
          socket.emit('server_error', {
            message: 'No global model available. Server may still be initializing.'
          });
          return;
        }

        socket.emit('model_updated', {
          version: model.version,
          weights: model.weights,
          accuracy: model.accuracy,
          trainingRound: model.trainingRound
        });

        console.log(`[Socket] Sent global model v${model.version} to ${socket.clientId || socket.id}`);
      } catch (err) {
        console.error('[Socket] Error fetching global model:', err);
        socket.emit('server_error', { message: 'Failed to retrieve global model' });
      }
    });

    // ── submit_weights ────────────────────────────────────────────────────────

    socket.on('submit_weights', async (data) => {
      const clientId = data?.clientId || socket.clientId || socket.id;

      try {
        console.log(`[Socket] Received weights from ${clientId}`);

        // Validate incoming weights
        const validation = validateClientWeights(data.weights);
        if (!validation.valid) {
          console.warn(`[Socket] Rejected weights from ${clientId}: ${validation.reason}`);
          socket.emit('server_error', {
            message: `Weight submission rejected: ${validation.reason}`
          });
          return;
        }

        // Store in pending buffer (overwrite if client resubmits)
        pendingSubmissions.set(clientId, {
          weights: data.weights,
          accuracy: data.localAccuracy || 0,
          samplesUsed: data.samplesUsed || 0,
          socketId: socket.id,
          timestamp: new Date()
        });

        // Persist to MongoDB for audit trail
        const session = new TrainingSession({
          sessionId: uuidv4(),
          clientId,
          baseModelVersion: data.baseModelVersion || 0,
          roundNumber: currentRound,
          localMetrics: {
            accuracy: data.localAccuracy || 0,
            loss: data.localLoss || null,
            epochs: data.epochs || 0,
            samplesUsed: data.samplesUsed || 0
          },
          weightUpdates: data.weights,
          status: 'pending'
        });
        await session.save();

        // Acknowledge receipt
        socket.emit('weight_received', {
          clientId,
          round: currentRound,
          pendingCount: pendingSubmissions.size,
          threshold: MIN_CLIENTS
        });

        // Broadcast progress to all clients
        io.emit('submission_progress', {
          currentSubmissions: pendingSubmissions.size,
          requiredSubmissions: MIN_CLIENTS,
          round: currentRound
        });

        console.log(`[Socket] Pending submissions: ${pendingSubmissions.size}/${MIN_CLIENTS}`);

        // ── Trigger aggregation if threshold reached ────────────────────────
        if (pendingSubmissions.size >= MIN_CLIENTS) {
          // BUG #5 FIX: Guard against concurrent aggregation.
          // Without this, a new submission arriving while performAggregation() awaits
          // MongoDB can trigger a second aggregation before pendingSubmissions.clear() runs.
          if (!isAggregating) {
            await performAggregation(io);
          } else {
            console.log('[Socket] Aggregation already in progress — submission queued for next round');
          }
        }

      } catch (err) {
        console.error(`[Socket] Error processing weights from ${clientId}:`, err);
        socket.emit('server_error', { message: 'Failed to process weight submission' });
      }
    });

    // ── disconnect ────────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      participantCount = Math.max(0, participantCount - 1);
      console.log(`[Socket] Client disconnected: ${socket.clientId || socket.id} — reason: ${reason} (Total: ${participantCount})`);

      // BUG #10 FIX: Remove pending submissions robustly.
      // socket.clientId is only set if the client sent 'join_training' first.
      // Fall back to socket.id, then sweep by socketId to catch all cases.
      if (socket.clientId) {
        pendingSubmissions.delete(socket.clientId);
      }
      // Sweep the entire map for any entry tied to this socket connection
      for (const [key, value] of pendingSubmissions) {
        if (value.socketId === socket.id) {
          pendingSubmissions.delete(key);
          console.log(`[Socket] Removed orphaned submission for key '${key}' tied to disconnected socket`);
        }
      }

      // Broadcast updated count
      io.emit('participant_count', { count: participantCount });
    });
  });

  console.log(`[Socket] Training socket handlers registered (min clients for aggregation: ${MIN_CLIENTS})`);
}

// ─── Aggregation ────────────────────────────────────────────────────────────────

/**
 * Performs federated averaging on all pending submissions and broadcasts
 * the new global model to all connected clients.
 * 
 * @param {import('socket.io').Server} io
 */
async function performAggregation(io) {
  isAggregating = true; // BUG #5 FIX: Lock so concurrent threshold hits don't double-aggregate
  const startTime = Date.now();
  console.log(`\n[FedAvg] ═══════════════════════════════════════════════════`);
  console.log(`[FedAvg] Starting aggregation round ${currentRound + 1}`);
  console.log(`[FedAvg] Contributors: ${pendingSubmissions.size}`);

  // Notify clients that aggregation is in progress
  io.emit('aggregation_started', {
    round: currentRound + 1,
    contributorCount: pendingSubmissions.size
  });

  try {
    // Collect all client weights
    const clientWeights = [];
    const sampleCounts = [];
    const accuracies = [];
    const contributorIds = [];

    for (const [clientId, submission] of pendingSubmissions) {
      clientWeights.push(submission.weights);
      sampleCounts.push(submission.samplesUsed || 1);
      accuracies.push(submission.accuracy);
      contributorIds.push(clientId);
    }

    // Run FedAvg with sample-weighted averaging
    const averagedWeights = federatedAverage(clientWeights, sampleCounts);

    // Compute average accuracy across contributors
    const avgAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;

    // Increment round
    currentRound++;

    // Save to MongoDB
    const { version } = await modelManager.saveAggregatedModel(
      averagedWeights,
      avgAccuracy,
      contributorIds.length,
      currentRound
    );

    // Mark training sessions as aggregated
    await TrainingSession.updateMany(
      { roundNumber: currentRound - 1, status: 'pending' },
      { $set: { status: 'aggregated', processedAt: new Date() } }
    );

    const durationMs = Date.now() - startTime;

    // Broadcast the new model to ALL connected clients
    io.emit('model_updated', {
      version,
      weights: averagedWeights,
      accuracy: avgAccuracy,
      trainingRound: currentRound,
      participantCount: contributorIds.length,
      aggregationDurationMs: durationMs
    });

    io.emit('aggregation_complete', {
      round: currentRound,
      version,
      participantCount: contributorIds.length,
      avgAccuracy: parseFloat(avgAccuracy.toFixed(4)),
      durationMs
    });

    // Clear pending buffer for next round
    pendingSubmissions.clear();

    console.log(`[FedAvg] Round ${currentRound} complete — version ${version}, avg accuracy ${(avgAccuracy * 100).toFixed(1)}%, took ${durationMs}ms`);
    console.log(`[FedAvg] ═══════════════════════════════════════════════════\n`);

  } catch (err) {
    console.error('[FedAvg] Aggregation failed:', err);
    io.emit('server_error', {
      message: 'Aggregation failed. Pending updates preserved for retry.'
    });
    // Don't clear pendingSubmissions — let clients retry
  } finally {
    isAggregating = false; // BUG #5 FIX: Always release the lock, even on error
  }
}

module.exports = { setupTrainingSocket };
