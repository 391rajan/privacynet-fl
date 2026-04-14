/**
 * socketService.js — PrivacyNet FL
 * 
 * Real-time communication layer between clients and the aggregation server.
 * Uses Socket.io-client for WebSocket transport with automatic reconnection.
 * 
 * Events Emitted (client → server):
 *   'join_training'         — Announce this client with nickname to the training pool
 *   'request_global_model'  — Ask for the latest global model weights
 *   'submit_weights'        — Send locally-trained weight updates (includes nickname)
 *   'update_status'         — Notify server of training status change
 * 
 * Events Received (server → client):
 *   'participant_count'     — Number of connected training participants
 *   'participants_update'   — Full participants list [{nickname, status, joinedAt}]
 *   'model_updated'         — New global model available after aggregation
 *   'aggregation_started'   — Server is beginning aggregation
 *   'aggregation_complete'  — Server finished aggregation with metadata
 *   'error'                 — Server-side error notification
 */

import { io } from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.clientId = this._generateClientId();
    this.nickname = null; // Set via setNickname() before or after connect
    this.callbacks = {};
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 10;
  }

  // ─── Nickname Management ────────────────────────────────────────────────────

  /**
   * Sets the nickname for this client. Must be called before connect()
   * or after connect() (will be sent with the next join_training emit).
   * 
   * @param {string} nickname
   */
  setNickname(nickname) {
    this.nickname = nickname;
  }

  /**
   * @returns {string|null} The current nickname
   */
  getNickname() {
    return this.nickname;
  }

  // ─── Connection Management ──────────────────────────────────────────────────

  /**
   * Connects to the aggregation server.
   * 
   * @param {string} [serverUrl='http://localhost:3001'] - Server URL
   * @returns {Promise<void>} Resolves when connected
   */
  connect(serverUrl = 'http://localhost:3001') {
    return new Promise((resolve, reject) => {
      if (this.socket && this.connected) {
        console.log('[Socket] Already connected');
        resolve();
        return;
      }

      console.log(`[Socket] Connecting to ${serverUrl}...`);

      // BUG #8 FIX: Reject the Promise after a fixed timeout to prevent it hanging forever.
      // Socket.io's reconnect logic is independent from this Promise's lifecycle.
      const connectionTimeout = setTimeout(() => {
        reject(new Error(`[Socket] Connection timed out after ${this._maxReconnectAttempts * 2}s. Server may be unreachable.`));
      }, this._maxReconnectAttempts * 2000);

      this.socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this._maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000
      });

      this.socket.on('connect', () => {
        clearTimeout(connectionTimeout); // BUG #8 FIX: Cancel timeout on success
        this.connected = true;
        this._reconnectAttempts = 0;
        console.log(`[Socket] Connected — id: ${this.socket.id}, clientId: ${this.clientId}, nickname: ${this.nickname}`);

        // Auto-announce to the training pool (now includes nickname)
        this.socket.emit('join_training', {
          clientId: this.clientId,
          nickname: this.nickname,
          timestamp: new Date().toISOString()
        });

        this._fireCallback('connect', { socketId: this.socket.id });
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        this._reconnectAttempts++;
        console.error(`[Socket] Connection error (attempt ${this._reconnectAttempts}):`, err.message);
        this._fireCallback('error', { type: 'connect_error', message: err.message });

        if (this._reconnectAttempts >= this._maxReconnectAttempts) {
          clearTimeout(connectionTimeout);
          reject(new Error(`Failed to connect after ${this._maxReconnectAttempts} attempts`));
        }
      });

      this.socket.on('disconnect', (reason) => {
        this.connected = false;
        console.log(`[Socket] Disconnected: ${reason}`);
        this._fireCallback('disconnect', { reason });
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log(`[Socket] Reconnected after ${attemptNumber} attempts`);
        this.connected = true;
        // Re-announce with nickname on reconnection
        this.socket.emit('join_training', {
          clientId: this.clientId,
          nickname: this.nickname,
          timestamp: new Date().toISOString()
        });
        this._fireCallback('reconnect', { attempts: attemptNumber });
      });

      // ── Set up server event listeners ──────────────────────────────────────

      this.socket.on('participant_count', (data) => {
        console.log(`[Socket] Participants: ${data.count}`);
        this._fireCallback('participant_count', data);
      });

      // NEW: Full participants list with nicknames and statuses
      this.socket.on('participants_update', (data) => {
        console.log(`[Socket] Participants update: ${data.length} connected`);
        this._fireCallback('participants_update', data);
      });

      this.socket.on('model_updated', (data) => {
        console.log(`[Socket] Global model updated — version: ${data.version}`);
        this._fireCallback('model_updated', data);
      });

      this.socket.on('aggregation_started', (data) => {
        console.log('[Socket] Aggregation started on server');
        this._fireCallback('aggregation_started', data);
      });

      this.socket.on('aggregation_complete', (data) => {
        console.log(`[Socket] Aggregation complete — round: ${data.round}, participants: ${data.participantCount}`);
        this._fireCallback('aggregation_complete', data);
      });

      this.socket.on('weight_received', (data) => {
        console.log(`[Socket] Server acknowledged weight submission`);
        this._fireCallback('weight_received', data);
      });

      this.socket.on('server_error', (data) => {
        console.error('[Socket] Server error:', data.message);
        this._fireCallback('error', data);
      });

      // Live activity feed events
      this.socket.on('feed_event', (data) => {
        this._fireCallback('feed_event', data);
      });
    });
  }

  // ─── Model Operations ────────────────────────────────────────────────────────

  /**
   * Requests the latest global model weights from the server.
   * The server responds with a 'model_updated' event containing the weights.
   * 
   * @param {Function} [callback] - Optional one-time callback for model receipt
   */
  requestGlobalModel(callback) {
    if (!this._ensureConnected()) return;

    if (callback) {
      // One-time listener for this specific request
      this.socket.once('model_updated', callback);
    }

    this.socket.emit('request_global_model', {
      clientId: this.clientId,
      timestamp: new Date().toISOString()
    });

    console.log('[Socket] Requested global model');
  }

  /**
   * Submits locally-trained weights to the server for federated aggregation.
   * Now includes the nickname in the payload for the activity feed.
   * 
   * @param {Array<{name: string, shape: number[], data: number[]}>} weights
   *   Serialized weight arrays from tensorflowService.extractWeights()
   * @param {number} localAccuracy - Final accuracy from local training (0–1)
   * @param {Object} [metadata] - Additional training metadata
   * @param {number} [metadata.samplesUsed] - Number of training samples
   * @param {number} [metadata.epochs] - Epochs trained
   */
  submitWeights(weights, localAccuracy, metadata = {}) {
    if (!this._ensureConnected()) return;

    const payload = {
      clientId: this.clientId,
      nickname: this.nickname, // Include nickname for activity feed
      weights,
      localAccuracy,
      samplesUsed: metadata.samplesUsed || 0,
      epochs: metadata.epochs || 0,
      timestamp: new Date().toISOString()
    };

    this.socket.emit('submit_weights', payload);
    console.log(`[Socket] Submitted weights — nickname: ${this.nickname}, accuracy: ${(localAccuracy * 100).toFixed(1)}%, samples: ${metadata.samplesUsed || '?'}`);
  }

  // ─── Status Updates ───────────────────────────────────────────────────────────

  /**
   * Notifies the server of a training status change.
   * 
   * @param {'waiting' | 'training' | 'submitted'} status
   */
  updateStatus(status) {
    if (!this._ensureConnected()) return;
    this.socket.emit('update_status', { status });
  }

  // ─── Event Subscriptions ──────────────────────────────────────────────────────

  /**
   * Register a callback for participant count changes.
   * @param {Function} callback - Receives { count: number }
   */
  onParticipantCount(callback) {
    this.callbacks['participant_count'] = callback;
  }

  /**
   * Register a callback for the full participants list update.
   * @param {Function} callback - Receives [{nickname, status, joinedAt}]
   */
  onParticipantsUpdate(callback) {
    this.callbacks['participants_update'] = callback;
  }

  /**
   * Register a callback for global model updates.
   * @param {Function} callback - Receives { version, weights, accuracy }
   */
  onModelUpdate(callback) {
    this.callbacks['model_updated'] = callback;
  }

  /**
   * Register a callback for aggregation lifecycle events.
   * @param {Function} callback - Receives { round, participantCount }
   */
  onAggregationComplete(callback) {
    this.callbacks['aggregation_complete'] = callback;
  }

  /**
   * Register a callback for connection state changes.
   * @param {Function} callback
   */
  onConnect(callback) {
    this.callbacks['connect'] = callback;
  }

  /**
   * Register a callback for disconnection events.
   * @param {Function} callback
   */
  onDisconnect(callback) {
    this.callbacks['disconnect'] = callback;
  }

  /**
   * Register a callback for errors.
   * @param {Function} callback
   */
  onError(callback) {
    this.callbacks['error'] = callback;
  }

  /**
   * Register a callback for weight submission acknowledgment.
   * @param {Function} callback
   */
  onWeightReceived(callback) {
    this.callbacks['weight_received'] = callback;
  }

  /**
   * Register a callback for live activity feed events.
   * @param {Function} callback - Receives { id, type, nickname, timestamp, data }
   */
  onFeedEvent(callback) {
    this.callbacks['feed_event'] = callback;
  }

  // ─── Disconnect ───────────────────────────────────────────────────────────────

  /**
   * Cleanly disconnects from the server and resets all state.
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      this.callbacks = {};
      console.log('[Socket] Disconnected and cleaned up');
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────────────

  /**
   * @returns {boolean} Whether the socket is currently connected
   */
  isConnected() {
    return this.connected && this.socket?.connected;
  }

  /**
   * @returns {string} The anonymous client ID assigned to this browser
   */
  getClientId() {
    return this.clientId;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────────

  _generateClientId() {
    // BUG #4 FIX: Wrap localStorage access in try/catch.
    // In Safari Private Mode or restricted environments, localStorage throws SecurityError.
    // Fall back to an ephemeral (session-only) ID so the app still functions.
    const storageKey = 'privacynet_client_id';
    try {
      let id = localStorage.getItem(storageKey);
      if (!id) {
        id = 'client_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        localStorage.setItem(storageKey, id);
      }
      return id;
    } catch (err) {
      console.warn('[Socket] localStorage unavailable (Private Mode?), using ephemeral client ID:', err.message);
      return 'client_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }
  }

  _ensureConnected() {
    if (!this.connected || !this.socket) {
      console.error('[Socket] Not connected. Call connect() first.');
      return false;
    }
    return true;
  }

  _fireCallback(event, data) {
    if (this.callbacks[event]) {
      try {
        this.callbacks[event](data);
      } catch (err) {
        console.error(`[Socket] Callback error for '${event}':`, err);
      }
    }
  }
}

// Export singleton instance
export default new SocketService();
