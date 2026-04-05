/**
 * integration-test.mjs — PrivacyNet FL Phase 2 Integration Test
 * 
 * Verifies the full end-to-end federated learning pipeline:
 *   1. Server starts without errors
 *   2. /health endpoint returns 200 + { status: "ok" }
 *   3. 3 simulated clients connect via WebSocket
 *   4. Each client "trains" and submits weights
 *   5. FedAvg runs and broadcasts new model to all clients
 *   6. /api/analytics/stats returns updated round data
 *   7. MongoDB has the new global model
 * 
 * Prerequisites:
 *   - MongoDB running on localhost:27017
 *   - Server running: cd server && node server.js
 * 
 * Run: node integration-test.mjs
 */

import { io } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const NUM_CLIENTS = 3;  // Must match or exceed MIN_CLIENTS_FOR_AGGREGATION

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ ${testName}`);
    failed++;
  }
}

// ─── Generate synthetic weights matching model architecture ─────────────────────

function generateFakeWeights() {
  const shapes = [
    [784, 128], [128], [128, 64], [64], [64, 10], [10]
  ];
  return shapes.map((shape, i) => {
    const size = shape.reduce((a, b) => a * b, 1);
    const data = Array.from({ length: size }, () => (Math.random() - 0.5) * 0.1);
    return { name: `weight_${i}`, shape, data };
  });
}

// ─── Test 1: Health Endpoint ────────────────────────────────────────────────────

async function testHealthEndpoint() {
  console.log('\n── TEST 1: Health Endpoint ───────────────────────────────────');
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    assert(res.status === 200, '/health returns 200');
    const data = await res.json();
    assert(data.status === 'ok', 'status is "ok"');
    assert(typeof data.timestamp === 'number', 'timestamp is a number');
    assert(data.mongodb === 'connected', 'MongoDB is connected');
  } catch (err) {
    console.error(`  ❌ Health endpoint failed: ${err.message}`);
    failed += 4;
  }
}

// ─── Test 2: API Analytics Stats ────────────────────────────────────────────────

async function testAnalyticsStats() {
  console.log('\n── TEST 2: Analytics Stats ──────────────────────────────────');
  try {
    const res = await fetch(`${SERVER_URL}/api/analytics/stats`);
    assert(res.status === 200, '/api/analytics/stats returns 200');
    const data = await res.json();
    assert(typeof data.totalRounds === 'number', 'totalRounds is a number');
    assert(typeof data.currentAccuracy === 'number', 'currentAccuracy is a number');
    assert(typeof data.version === 'number', 'version is a number');
    console.log(`  Stats: rounds=${data.totalRounds}, accuracy=${data.currentAccuracy}, version=v${data.version}`);
    return data;
  } catch (err) {
    console.error(`  ❌ Analytics stats failed: ${err.message}`);
    failed += 4;
    return null;
  }
}

// ─── Test 3: Model Latest ───────────────────────────────────────────────────────

async function testModelLatest() {
  console.log('\n── TEST 3: Model Latest Endpoint ────────────────────────────');
  try {
    const res = await fetch(`${SERVER_URL}/api/model/latest`);
    assert(res.status === 200, '/api/model/latest returns 200');
    const data = await res.json();
    assert(typeof data.version === 'number', 'version exists');
    assert(typeof data.accuracy === 'number', 'accuracy exists');
    console.log(`  Latest model: v${data.version}, accuracy=${data.accuracy}`);
  } catch (err) {
    console.error(`  ❌ Model latest failed: ${err.message}`);
    failed += 2;
  }
}

// ─── Test 4: WebSocket Connection + Full Federated Pipeline ─────────────────────

function testFederatedPipeline() {
  return new Promise((resolve) => {
    console.log('\n── TEST 4: Full Federated Pipeline ──────────────────────────');
    console.log(`  Simulating ${NUM_CLIENTS} clients...`);

    const clients = [];
    const clientIds = [];
    let connectedCount = 0;
    let initialModelsReceived = 0;
    let weightsSubmitted = false;
    let aggregationCompleteCount = 0;
    let postAggregationModelCount = 0;

    const timeout = setTimeout(() => {
      console.error('  ❌ Pipeline timed out after 30s');
      failed++;
      cleanup();
      resolve();
    }, 30000);

    function cleanup() {
      clearTimeout(timeout);
      clients.forEach(c => { try { c.disconnect(); } catch (_) {} });
    }

    for (let i = 0; i < NUM_CLIENTS; i++) {
      const clientId = `test_client_${i}_${Date.now()}`;
      clientIds.push(clientId);

      const client = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: false,
        timeout: 10000
      });

      // Track if this client has received the initial model
      let hasInitialModel = false;

      client.on('connect', () => {
        connectedCount++;
        console.log(`  Client ${i} connected (${connectedCount}/${NUM_CLIENTS})`);
        client.emit('join_training', { clientId, timestamp: new Date().toISOString() });
      });

      // Use the one-time response pattern: request_global_model triggers a direct model_updated
      // We'll listen for 'model_updated' events, distinguishing initial vs post-aggregation
      client.on('model_updated', (data) => {
        if (!hasInitialModel) {
          // This is the initial model download (response to request_global_model)
          hasInitialModel = true;
          initialModelsReceived++;
          console.log(`  Client ${i} received initial model v${data.version}`);

          if (initialModelsReceived === NUM_CLIENTS) {
            assert(true, `All ${NUM_CLIENTS} clients received initial model`);

            // Now submit weights from all clients
            if (!weightsSubmitted) {
              weightsSubmitted = true;
              console.log(`  Submitting weights from all ${NUM_CLIENTS} clients...`);
              clients.forEach((c, idx) => {
                const weights = generateFakeWeights();
                c.emit('submit_weights', {
                  clientId: clientIds[idx],
                  weights,
                  localAccuracy: 0.7 + Math.random() * 0.2,
                  samplesUsed: 50 + idx * 10,
                  epochs: 10
                });
              });
            }
          }
        } else {
          // This is a post-aggregation model broadcast
          postAggregationModelCount++;
          console.log(`  Client ${i} received aggregated model v${data.version}`);

          if (postAggregationModelCount === NUM_CLIENTS) {
            assert(true, `All ${NUM_CLIENTS} clients received aggregated model`);
            assert(data.version >= 1, `Model version incremented (v${data.version})`);
            assert(typeof data.accuracy === 'number' && data.accuracy > 0, `Aggregated accuracy present (${(data.accuracy * 100).toFixed(1)}%)`);
            assert(Array.isArray(data.weights) && data.weights.length === 6, `Correct weight structure (${data.weights?.length} tensors)`);

            cleanup();
            resolve();
          }
        }
      });

      client.on('aggregation_complete', (data) => {
        aggregationCompleteCount++;
        if (aggregationCompleteCount === 1) {
          assert(true, `Aggregation round ${data.round} completed`);
          assert(data.participantCount >= NUM_CLIENTS, `${data.participantCount} clients contributed`);
          console.log(`  FedAvg round ${data.round}: ${data.participantCount} contributors, accuracy ${(data.avgAccuracy * 100).toFixed(1)}%, took ${data.durationMs}ms`);
        }
      });

      client.on('connect_error', (err) => {
        console.error(`  ❌ Client ${i} connection error: ${err.message}`);
        failed++;
      });

      clients.push(client);
    }

    // After all connected, request models (staggered to avoid race)
    const requestInterval = setInterval(() => {
      if (connectedCount === NUM_CLIENTS) {
        clearInterval(requestInterval);
        clients.forEach((c) => {
          c.emit('request_global_model', {});
        });
      }
    }, 100);
  });
}

// ─── Test 5: Verify MongoDB Persistence ─────────────────────────────────────────

async function testMongoDBPersistence() {
  console.log('\n── TEST 5: MongoDB Persistence Verification ─────────────────');
  try {
    const res = await fetch(`${SERVER_URL}/api/analytics/stats`);
    const stats = await res.json();
    assert(stats.totalRounds >= 1, `Total rounds >= 1 (got ${stats.totalRounds})`);
    assert(stats.version >= 1, `Model version >= 1 (got ${stats.version})`);
    assert(stats.currentAccuracy > 0, `Current accuracy > 0 (got ${(stats.currentAccuracy * 100).toFixed(1)}%)`);

    const historyRes = await fetch(`${SERVER_URL}/api/model/history?limit=5`);
    const history = await historyRes.json();
    assert(Array.isArray(history) && history.length >= 2, `Model history has >= 2 entries (got ${history.length})`);

    if (history.length > 0) {
      console.log(`  Latest model in history: v${history[0].version}, accuracy=${history[0].accuracy}, round=${history[0].trainingRound}`);
    }
  } catch (err) {
    console.error(`  ❌ MongoDB persistence check failed: ${err.message}`);
    failed += 4;
  }
}

// ─── Run All Tests ──────────────────────────────────────────────────────────────

async function runIntegrationTests() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  PrivacyNet FL — Phase 2 Integration Test Suite         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Server: ${SERVER_URL}`);
  console.log(`  Simulated clients: ${NUM_CLIENTS}`);

  try {
    await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    console.error(`\n  ❌ FATAL: Cannot reach server at ${SERVER_URL}`);
    console.error('  Make sure the server is running: cd server && node server.js');
    process.exit(1);
  }

  await testHealthEndpoint();
  await testAnalyticsStats();
  await testModelLatest();
  await testFederatedPipeline();
  await testMongoDBPersistence();

  // ─── Summary ────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  if (failed === 0) {
    console.log(`║  ALL ${passed} TESTS PASSED ✅${''.padEnd(Math.max(0, 38 - String(passed).length))}║`);
  } else {
    console.log(`║  ${passed}/${total} PASSED, ${failed} FAILED ❌${''.padEnd(Math.max(0, 36 - String(passed).length - String(total).length - String(failed).length))}║`);
  }
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  process.exit(failed > 0 ? 1 : 0);
}

runIntegrationTests().catch(err => {
  console.error('❌ Integration test crashed:', err);
  process.exit(1);
});
