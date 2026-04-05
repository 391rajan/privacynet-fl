/**
 * server.js — PrivacyNet FL Aggregation Server (Phase 2)
 * 
 * Entry point for the federated learning backend.
 * 
 * Responsibilities:
 *   1. Express HTTP server (health check, analytics, model metadata)
 *   2. Socket.io WebSocket server (real-time federated protocol)
 *   3. MongoDB connection (global model + training session persistence)
 *   4. Seed model initialization on startup
 *   5. Uncaught error handling — server never crashes silently
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const { setupTrainingSocket } = require('./sockets/trainingSocket');
const modelManager = require('./services/modelManager');
const TrainingSession = require('./models/TrainingSession');
const GlobalModel = require('./models/GlobalModel');

// ─── Configuration ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/privacynet';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// ─── Express App ────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: CLIENT_URL,
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));  // Large payload for weight transfers

// ─── REST API Routes ────────────────────────────────────────────────────────────

// Health check — exact format requested: { status: "ok", timestamp }
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Legacy health endpoint (keep for backwards compatibility)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Analytics stats — totalRounds, currentAccuracy, version
app.get('/api/analytics/stats', async (req, res) => {
  try {
    const latestModel = await GlobalModel.getLatest();
    const totalSessions = await TrainingSession.countDocuments().exec();
    const aggregatedSessions = await TrainingSession.countDocuments({ status: 'aggregated' }).exec();

    // Get unique round count by distinct roundNumber values
    const distinctRounds = await TrainingSession.distinct('roundNumber', { status: 'aggregated' }).exec();

    res.json({
      totalRounds: latestModel ? latestModel.trainingRound : 0,
      currentAccuracy: latestModel ? latestModel.accuracy : 0,
      version: latestModel ? latestModel.version : 0,
      totalSubmissions: totalSessions,
      aggregatedSubmissions: aggregatedSessions,
      uniqueRounds: distinctRounds.length,
      modelCreatedAt: latestModel ? latestModel.createdAt : null,
      participantCount: latestModel ? latestModel.participantCount : 0
    });
  } catch (err) {
    console.error('[API] Error fetching analytics stats:', err);
    res.status(500).json({ error: 'Failed to fetch analytics stats' });
  }
});

// Get current global model metadata (weights fetched via WebSocket — too large for REST)
app.get('/api/model/latest', async (req, res) => {
  try {
    const model = await modelManager.getLatestModel();
    if (!model) {
      return res.status(404).json({ error: 'No model available' });
    }
    res.json({
      version: model.version,
      accuracy: model.accuracy,
      participantCount: model.participantCount,
      trainingRound: model.trainingRound
    });
  } catch (err) {
    console.error('[API] Error fetching model:', err);
    res.status(500).json({ error: 'Failed to fetch model' });
  }
});

// Get model version history
app.get('/api/model/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const history = await modelManager.getModelHistory(limit);
    res.json(history);
  } catch (err) {
    console.error('[API] Error fetching history:', err);
    res.status(500).json({ error: 'Failed to fetch model history' });
  }
});

// ─── Socket.io Server ───────────────────────────────────────────────────────────

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',  // Accept from any origin in dev
    methods: ['GET', 'POST'],
    credentials: true
  },
  maxHttpBufferSize: 50 * 1024 * 1024,  // 50MB — weight arrays can be large
  pingTimeout: 60000,
  pingInterval: 25000
});

// Register WebSocket event handlers
setupTrainingSocket(io);

// ─── MongoDB Connection ─────────────────────────────────────────────────────────

let dbRetryCount = 0;
const MAX_DB_RETRIES = 10;

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    dbRetryCount = 0;
    console.log(`[MongoDB] Connected to ${MONGODB_URI}`);

    // Initialize seed model if this is a fresh database
    await modelManager.initializeSeedModel();

  } catch (err) {
    dbRetryCount++;
    console.error(`[MongoDB] Connection failed (attempt ${dbRetryCount}/${MAX_DB_RETRIES}):`, err.message);

    if (dbRetryCount < MAX_DB_RETRIES) {
      const delay = Math.min(5000 * dbRetryCount, 30000); // Exponential backoff, max 30s
      console.log(`[MongoDB] Retrying in ${delay / 1000}s...`);
      setTimeout(connectDB, delay);
    } else {
      console.error('[MongoDB] Max retries exceeded. Server will run without database.');
      console.error('[MongoDB] IMPORTANT: All aggregation data will be lost on restart.');
    }
  }
}

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] Connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Disconnected from database');
});

mongoose.connection.on('reconnected', () => {
  console.log('[MongoDB] Reconnected to database');
});

// ─── Global Error Handlers ──────────────────────────────────────────────────────
// Ensure the server NEVER crashes silently

process.on('uncaughtException', (err) => {
  console.error('╔══════════════════════════════════════════════════════════╗');
  console.error('║  UNCAUGHT EXCEPTION — SERVER WOULD HAVE CRASHED        ║');
  console.error('╚══════════════════════════════════════════════════════════╝');
  console.error('[FATAL] Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  // In production, you'd want to exit and let a process manager restart.
  // In development, keep running so the developer sees the error.
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('╔══════════════════════════════════════════════════════════╗');
  console.error('║  UNHANDLED PROMISE REJECTION                           ║');
  console.error('╚══════════════════════════════════════════════════════════╝');
  console.error('[FATAL] Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);

  // Close Socket.io connections
  io.close(() => {
    console.log('[Socket] All connections closed');
  });

  // Close MongoDB
  try {
    await mongoose.connection.close();
    console.log('[MongoDB] Connection closed');
  } catch (err) {
    console.error('[MongoDB] Error closing connection:', err);
  }

  // Close HTTP server
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─── Start ──────────────────────────────────────────────────────────────────────

async function start() {
  await connectDB();

  server.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║  PrivacyNet FL — Aggregation Server (Phase 2)           ║`);
    console.log(`║  HTTP:      http://localhost:${PORT}                       ║`);
    console.log(`║  Socket:    ws://localhost:${PORT}                         ║`);
    console.log(`║  Health:    http://localhost:${PORT}/health                ║`);
    console.log(`║  Analytics: http://localhost:${PORT}/api/analytics/stats   ║`);
    console.log(`║  MongoDB:   ${MONGODB_URI.padEnd(42)} ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝\n`);
  });
}

start().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
