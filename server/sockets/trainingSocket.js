/**
 * trainingSocket.js — PrivacyNet FL Server
 * 
 * WebSocket event handlers for the federated learning protocol.
 * 
 * Protocol Flow:
 *   1. Client connects → 'join_training' → server tracks participant with nickname
 *   2. Client requests model → 'request_global_model' → server sends weights
 *   3. Client trains locally, then → 'submit_weights' → server buffers update
 *   4. When enough clients submit → server runs FedAvg → 'model_updated' broadcast
 * 
 * Nickname System:
 *   - Each client sends { nickname } with join_training
 *   - Server stores in connectedClients Map: socketId → { nickname, joinedAt, status }
 *   - On join/leave/submit, broadcasts 'participants_update' with full participant list
 *   - Status values: "waiting" | "training" | "submitted"
 * 
 * The aggregation threshold (MIN_CLIENTS_FOR_AGGREGATION) is configurable.
 * Default is 2 — set higher in production for better privacy guarantees.
 */

const { federatedAverage, validateClientWeights } = require('../services/federatedAveraging');
const modelManager = require('../services/modelManager');
const TrainingSession = require('../models/TrainingSession');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ─── State ──────────────────────────────────────────────────────────────────────

// In-memory buffer of weight submissions for the current aggregation round
const pendingSubmissions = new Map(); // clientId → { weights, accuracy, samplesUsed, socketId }

// Connected clients with nickname metadata
// socketId → { nickname, clientId, joinedAt, status, hasSubmitted, localAccuracy }
const connectedClients = new Map();

let currentRound = 0;
let participantCount = 0;
let isAggregating = false; // BUG #5 FIX: Mutex to prevent concurrent aggregation runs

// Aggregation triggers when this many clients have submitted
const MIN_CLIENTS = parseInt(process.env.MIN_CLIENTS_FOR_AGGREGATION || '2', 10);

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Builds the participants list array for broadcasting.
 * Maps the connectedClients Map to a clean payload for all clients.
 * 
 * @returns {Array<{nickname: string, status: string, joinedAt: number}>}
 */
function getParticipantsList() {
  const list = [];
  for (const [, client] of connectedClients) {
    list.push({
      nickname: client.nickname,
      status: client.status,
      joinedAt: client.joinedAt
    });
  }
  return list;
}

/**
 * Broadcasts the current participants list to all connected clients.
 * Called on: join, disconnect, status change (submit weights).
 * 
 * @param {import('socket.io').Server} io
 */
function broadcastParticipants(io) {
  const participants = getParticipantsList();
  io.emit('participants_update', participants);
  io.emit('participant_count', { count: participants.length });
}

/**
 * Broadcasts a structured feed event to ALL connected clients.
 * Each event has a unique ID, type, optional nickname, timestamp, and data payload.
 * 
 * @param {import('socket.io').Server} io
 * @param {string} type - One of: USER_JOINED, USER_LEFT, TRAINING_STARTED, WEIGHTS_SUBMITTED,
 *                        AGGREGATION_STARTED, MODEL_UPDATED, ROUND_COMPLETE
 * @param {Object} data - Event-specific data (nickname, accuracy, version, etc.)
 */
function broadcastFeedEvent(io, type, data = {}) {
  const event = {
    id: crypto.randomUUID(),
    type,
    nickname: data.nickname || 'Anonymous',
    timestamp: Date.now(),
    data: {
      accuracy: data.accuracy ?? null,
      version: data.version ?? null,
      round: data.round ?? null,
      participantCount: data.participantCount ?? null,
      contributorCount: data.contributorCount ?? null
    }
  };
  io.emit('feed_event', event);
  console.log(`[Feed] ${type}${data.nickname ? ` — ${data.nickname}` : ''}`);
}

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

    // ── join_training ─────────────────────────────────────────────────────────

    socket.on('join_training', (data) => {
      const clientId = data?.clientId || socket.id;
      const nickname = data?.nickname || `User_${socket.id.slice(0, 6)}`;

      console.log(`[Socket] Client joined training: ${nickname} (${clientId})`);

      // Store metadata on the socket for later reference
      socket.clientId = clientId;
      socket.nickname = nickname;

      // Register in connectedClients map with full metadata
      connectedClients.set(socket.id, {
        nickname,
        clientId,
        joinedAt: Date.now(),
        status: 'waiting',     // Starts as "waiting" — not yet trained
        hasSubmitted: false,
        localAccuracy: null
      });

      // Send current state to the newly joined client
      socket.emit('training_state', {
        currentRound,
        participantCount,
        pendingSubmissions: pendingSubmissions.size,
        minClientsRequired: MIN_CLIENTS
      });

      // Broadcast updated participant list to ALL clients
      broadcastParticipants(io);

      // Feed event: user joined
      broadcastFeedEvent(io, 'USER_JOINED', { nickname });
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

        console.log(`[Socket] Sent global model v${model.version} to ${socket.nickname || socket.clientId || socket.id}`);
      } catch (err) {
        console.error('[Socket] Error fetching global model:', err);
        socket.emit('server_error', { message: 'Failed to retrieve global model' });
      }
    });

    // ── update_status ─────────────────────────────────────────────────────────
    // Client can explicitly update their status (e.g., when they start training)

    socket.on('update_status', (data) => {
      const client = connectedClients.get(socket.id);
      if (client && data?.status) {
        const validStatuses = ['waiting', 'training', 'submitted'];
        if (validStatuses.includes(data.status)) {
          client.status = data.status;
          console.log(`[Socket] ${client.nickname} status → ${data.status}`);
          broadcastParticipants(io);

          // Feed event: training started
          if (data.status === 'training') {
            broadcastFeedEvent(io, 'TRAINING_STARTED', { nickname: client.nickname });
          }
        }
      }
    });

    // ── submit_weights ────────────────────────────────────────────────────────

    socket.on('submit_weights', async (data) => {
      const clientId = data?.clientId || socket.clientId || socket.id;
      const nickname = data?.nickname || socket.nickname || clientId;

      try {
        console.log(`[Socket] Received weights from ${nickname} (${clientId})`);

        // Validate incoming weights
        const validation = validateClientWeights(data.weights);
        if (!validation.valid) {
          console.warn(`[Socket] Rejected weights from ${nickname}: ${validation.reason}`);
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
          nickname,
          timestamp: new Date()
        });

        // Update the client's status to "submitted" in the participants list
        const client = connectedClients.get(socket.id);
        if (client) {
          client.status = 'submitted';
          client.hasSubmitted = true;
          client.localAccuracy = data.localAccuracy || null;
        }

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

        // Broadcast progress to all clients (including updated participant statuses)
        io.emit('submission_progress', {
          currentSubmissions: pendingSubmissions.size,
          requiredSubmissions: MIN_CLIENTS,
          round: currentRound
        });
        broadcastParticipants(io);

        // Feed event: weights submitted
        broadcastFeedEvent(io, 'WEIGHTS_SUBMITTED', {
          nickname,
          accuracy: data.localAccuracy || 0
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
        console.error(`[Socket] Error processing weights from ${nickname}:`, err);
        socket.emit('server_error', { message: 'Failed to process weight submission' });
      }
    });

    // ── disconnect ────────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      participantCount = Math.max(0, participantCount - 1);
      
      // Get nickname for logging before removing from map
      const client = connectedClients.get(socket.id);
      const displayName = client?.nickname || socket.clientId || socket.id;

      console.log(`[Socket] Client disconnected: ${displayName} — reason: ${reason} (Total: ${participantCount})`);

      // Feed event: user left (only if they had actually joined with a nickname)
      if (client?.nickname) {
        broadcastFeedEvent(io, 'USER_LEFT', { nickname: client.nickname });
      }

      // Remove from connectedClients map
      connectedClients.delete(socket.id);

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

      // Broadcast updated participant list
      broadcastParticipants(io);
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

  // Feed event: aggregation started
  broadcastFeedEvent(io, 'AGGREGATION_STARTED', {
    contributorCount: pendingSubmissions.size,
    round: currentRound + 1
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

    // Feed events: model updated + round complete
    broadcastFeedEvent(io, 'MODEL_UPDATED', {
      version,
      accuracy: avgAccuracy
    });
    broadcastFeedEvent(io, 'ROUND_COMPLETE', {
      round: currentRound,
      participantCount: contributorIds.length
    });

    // Clear pending buffer for next round
    pendingSubmissions.clear();

    // Reset all client statuses to "waiting" for the next round
    for (const [, client] of connectedClients) {
      client.status = 'waiting';
      client.hasSubmitted = false;
    }
    broadcastParticipants(io);

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
