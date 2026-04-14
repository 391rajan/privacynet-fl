/**
 * App.jsx — PrivacyNet FL Client (Phase 2 + Nicknames + Live Feed)
 * 
 * Root component. Wires all ML services, data flows, nickname gate,
 * live activity feed, and Agent B components together.
 * 
 * Nickname Flow:
 *   1. On load → check sessionStorage for existing nickname
 *   2. If none → show NicknameModal (blocks main UI)
 *   3. On join → save to sessionStorage, set on socketService, connect
 *   4. Nickname shown in header, sent with weight submissions
 *   5. Server broadcasts participant list → FederatedDashboard renders it
 * 
 * Live Feed:
 *   1. Server emits 'feed_event' at every significant moment
 *   2. App prepends to feedEvents[] (max 50), persists last 20 to sessionStorage
 *   3. LiveFeed renders scrollable timeline with animated entries
 * 
 * Data Flow (unchanged):
 *   DrawingCanvas saves → preprocessCanvasData → IndexedDB → drawingCounts update
 *   TrainingPanel trains → getTrainingData → trainLocalModel → accuracy state update
 *   TrainingPanel submits → extractWeights → WebSocket → server aggregation
 *   Server broadcasts 'model_updated' → loadWeights → modelVersion increments
 *   TestingArea draws → predictDigit → prediction/confidences state update
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import {
  initializeModel,
  trainLocalModel,
  extractWeights,
  loadWeights,
  predictDigit,
  preprocessCanvasData,
  getModelSummary,
  disposeModel
} from './services/tensorflowService';
import {
  saveDrawing,
  getAllDrawings,
  getDrawingCount,
  getDrawingCountsByLabel,
  getTrainingData,
  clearAllDrawings
} from './services/indexedDBService';
import socketService from './services/socketService';
import { getMemorySnapshot } from './utils/modelHelpers';
import {
  getNicknameFromSession,
  saveNicknameToSession,
  getAvatarColor,
  getInitial
} from './utils/nicknameUtils';
import { saveFeedToSession, loadFeedFromSession } from './utils/timeUtils';

// ─── Components ─────────────────────────────────────────────────────────────────
import { NicknameModal } from './components/NicknameModal';
import { DrawingCanvas } from './components/DrawingCanvas';
import { TrainingPanel } from './components/TrainingPanel';
import { FederatedDashboard } from './components/FederatedDashboard';
import { TestingArea } from './components/TestingArea';
import { PrivacyPanel } from './components/PrivacyPanel';
import { LiveFeed } from './components/LiveFeed';
import { AccuracyPanel } from './components/AccuracyPanel';
import { GlobalBanners } from './components/AppStates';

// ─── Server URL Configuration ───────────────────────────────────────────────────
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

function App() {
  const shouldReduceMotion = useReducedMotion();

  // ─── Nickname State ─────────────────────────────────────────────────────────
  const [nickname, setNickname] = useState(null);   // null = not set yet
  const [showModal, setShowModal] = useState(false); // Controls modal visibility
  const [appReady, setAppReady] = useState(false);   // True once nickname is set + init done

  // ─── Model State ────────────────────────────────────────────────────────────
  const modelRef = useRef(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelVersion, setModelVersion] = useState(0);
  const [modelSummary, setModelSummary] = useState(null);

  // ─── Training State ─────────────────────────────────────────────────────────
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(null);
  const [lastTrainingResult, setLastTrainingResult] = useState(null);

  // ─── Data State ─────────────────────────────────────────────────────────────
  const [drawingCount, setDrawingCount] = useState(0);
  const [drawingCounts, setDrawingCounts] = useState({});
  const [recentDrawings, setRecentDrawings] = useState([]);

  // ─── Network State ──────────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [participants, setParticipants] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionProgress, setSubmissionProgress] = useState(null);

  // ─── Prediction State ───────────────────────────────────────────────────────
  const [prediction, setPrediction] = useState(null);

  // ─── Aggregation State ──────────────────────────────────────────────────────
  const [aggregationInfo, setAggregationInfo] = useState(null);

  // ─── Status ─────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState('Initializing...');
  const [memoryInfo, setMemoryInfo] = useState(null);

  // ─── Live Feed State ────────────────────────────────────────────────────────
  const [feedEvents, setFeedEvents] = useState(() => loadFeedFromSession());
  const [unreadCount, setUnreadCount] = useState(0);
  const [showMobileFeed, setShowMobileFeed] = useState(false);
  const MAX_FEED_EVENTS = 50;

  // ─── Accuracy Panel State ──────────────────────────────────────────────────
  const [analyticsData, setAnalyticsData] = useState(null);
  const [baselineAccuracy] = useState(0.1); // ~10% for random 10-class guessing
  const [prevLocalAccuracy, setPrevLocalAccuracy] = useState(null);
  const [prevGlobalAccuracy, setPrevGlobalAccuracy] = useState(null);
  const [trainingHistory, setTrainingHistory] = useState([]);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Check for existing nickname in sessionStorage
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const saved = getNicknameFromSession();
    if (saved) {
      // Returning user in same session — skip modal, join directly
      setNickname(saved);
      setShowModal(false);
    } else {
      // First visit — show modal
      setShowModal(true);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Once nickname is set, initialize everything
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!nickname) return; // Wait for nickname

    let mounted = true;

    async function init() {
      try {
        // 1. Initialize the local TF.js model
        setStatus('Loading TensorFlow.js model...');
        const model = await initializeModel();
        if (!mounted) { model.dispose(); return; }
        modelRef.current = model;
        setModelReady(true);
        setModelSummary(getModelSummary(model));

        // 2. Load local drawing counts from IndexedDB
        try {
          const count = await getDrawingCount();
          const counts = await getDrawingCountsByLabel();
          const drawings = await getAllDrawings();
          if (mounted) {
            setDrawingCount(count);
            setDrawingCounts(counts);
            setRecentDrawings(drawings.slice(0, 20));
          }
        } catch (dbErr) {
          console.warn('[App] IndexedDB read failed:', dbErr.message);
        }

        // 3. Set nickname on socket service BEFORE connecting
        socketService.setNickname(nickname);

        // 4. Set up socket event listeners BEFORE connecting
        socketService.onParticipantCount(({ count }) => {
          if (mounted) setParticipantCount(count);
        });

        socketService.onParticipantsUpdate((data) => {
          if (mounted) setParticipants(data);
        });

        socketService.onModelUpdate((data) => {
          if (!mounted || !modelRef.current) return;
          try {
            loadWeights(modelRef.current, data.weights);
            setModelVersion(data.version);
            setStatus(`Global model updated → v${data.version} (accuracy: ${(data.accuracy * 100).toFixed(1)}%)`);

            // Refresh analytics data after model update
            fetchAnalytics();
          } catch (err) {
            console.error('[App] Failed to load global model update:', err);
            setStatus('Warning: Failed to apply global model update');
          }
        });

        socketService.onAggregationComplete((data) => {
          if (mounted) {
            setAggregationInfo({
              round: data.round,
              version: data.version,
              participantCount: data.participantCount,
              avgAccuracy: data.avgAccuracy,
              durationMs: data.durationMs,
              timestamp: Date.now()
            });
          }
        });

        socketService.onWeightReceived((data) => {
          if (mounted) {
            setSubmissionProgress({
              pendingCount: data.pendingCount,
              threshold: data.threshold,
              round: data.round
            });
            setStatus(`Weights accepted — ${data.pendingCount}/${data.threshold} submissions for round ${data.round}`);
          }
        });

        socketService.onDisconnect(() => {
          if (mounted) {
            setIsConnected(false);
            setStatus('Disconnected from server — working offline');
          }
        });

        socketService.onConnect(() => {
          if (mounted) {
            setIsConnected(true);
            setStatus('Connected to aggregation server');
          }
        });

        socketService.onError((data) => {
          if (mounted) {
            console.error('[App] Socket error:', data.message);
            setStatus(`Server error: ${data.message}`);
          }
        });

        // Live feed event listener
        socketService.onFeedEvent((event) => {
          if (!mounted) return;
          setFeedEvents((prev) => {
            const updated = [event, ...prev].slice(0, MAX_FEED_EVENTS);
            saveFeedToSession(updated);
            return updated;
          });
          setUnreadCount((prev) => prev + 1);
        });

        // 5. Connect to the aggregation server
        setStatus('Connecting to aggregation server...');
        try {
          await socketService.connect(SERVER_URL);
          if (mounted) setIsConnected(true);

          // 6. Request the latest global model weights
          socketService.requestGlobalModel((data) => {
            if (!mounted || !modelRef.current) return;
            try {
              if (data.weights) {
                loadWeights(modelRef.current, data.weights);
                setModelVersion(data.version || 0);
                setStatus(`Loaded global model v${data.version}`);
              }
            } catch (err) {
              console.error('[App] Failed to load initial global model:', err);
            }
          });
        } catch (err) {
          console.warn('[App] Server connection failed — working offline:', err.message);
          if (mounted) {
            setIsConnected(false);
            setStatus('Working offline — server unavailable');
          }
        }

        // Fetch initial analytics data
        fetchAnalytics();

        if (mounted) {
          setMemoryInfo(getMemorySnapshot());
          setAppReady(true);
          if (!socketService.isConnected()) {
            setStatus('Ready (offline mode)');
          }
        }

      } catch (err) {
        console.error('[App] Initialization failed:', err);
        if (mounted) setStatus(`Error: ${err.message}`);
      }
    }

    init();

    return () => {
      mounted = false;
      socketService.disconnect();
      if (modelRef.current) {
        disposeModel(modelRef.current);
        modelRef.current = null;
      }
    };
  }, [nickname]);

  // ─── Fetch Analytics Helper ────────────────────────────────────────────────

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/analytics/stats`);
      if (res.ok) {
        const data = await res.json();
        // Use functional update to capture current accuracy as prev before overwriting
        setAnalyticsData(prev => {
          if (prev?.currentAccuracy != null) {
            setPrevGlobalAccuracy(prev.currentAccuracy);
          }
          return data;
        });

        // Build training history for the chart
        if (data.history) {
          setTrainingHistory(prev => {
            // Merge local accuracy values into history rounds
            return data.history.map((h, i) => {
              const existing = prev.find(p => p.round === h.round);
              return {
                round: h.round,
                globalAccuracy: h.globalAccuracy,
                localAccuracy: existing?.localAccuracy ?? null
              };
            });
          });
        }
      }
    } catch (err) {
      console.warn('[App] Failed to fetch analytics:', err.message);
    }
  }, []);  // No dependencies — uses functional state updates only

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Nickname Join Handler ────────────────────────────────────────────────

  const handleNicknameJoin = useCallback((chosenNickname) => {
    // Check if this is a returning user (already had a session nickname)
    const wasReturning = getNicknameFromSession() !== null;

    // Save to session and state
    saveNicknameToSession(chosenNickname);
    setNickname(chosenNickname);
    setShowModal(false);

    // Show welcome-back toast if returning user
    if (wasReturning) {
      toast(`Welcome back, ${chosenNickname}!`, {
        icon: '👋',
        style: { background: '#1E293B', color: '#fff' }
      });
    }
  }, []);

  // ─── Drawing Save ─────────────────────────────────────────────────────────

  const handleSaveDrawing = useCallback(async (drawingData) => {
    try {
      const { label, thumbnail } = drawingData;
      const pixelData = await canvasDataURLToPixels(thumbnail);
      const id = await saveDrawing(pixelData, label);

      const count = await getDrawingCount();
      const counts = await getDrawingCountsByLabel();
      const drawings = await getAllDrawings();

      setDrawingCount(count);
      setDrawingCounts(counts);
      setRecentDrawings(drawings.slice(0, 20));
      setStatus(`Saved drawing #${id} (digit ${label}) — ${count} total`);
      return id;
    } catch (err) {
      console.error('[App] Failed to save drawing:', err);
      setStatus(`Save error: ${err.message}`);
      return null;
    }
  }, []);

  // ─── Local Training ───────────────────────────────────────────────────────

  const handleTrain = useCallback(async () => {
    if (!modelRef.current || isTraining) return;

    setIsTraining(true);
    setTrainingProgress(null);
    setStatus('Training locally...');

    // Notify server we're training
    socketService.updateStatus('training');

    try {
      const data = await getTrainingData();

      if (data.length === 0) {
        setStatus('No drawings yet — draw some digits before training!');
        setIsTraining(false);
        socketService.updateStatus('waiting');
        return;
      }

      const result = await trainLocalModel(modelRef.current, data, {
        epochs: 10,
        batchSize: 32,
        onEpochEnd: (epoch, logs) => {
          setTrainingProgress({
            epoch: epoch + 1,
            totalEpochs: 10,
            loss: parseFloat(logs.loss.toFixed(4)),
            accuracy: parseFloat(logs.acc.toFixed(4))
          });
        }
      });

      setPrevLocalAccuracy(lastTrainingResult?.finalAccuracy ?? null);
      setLastTrainingResult({
        finalAccuracy: result.finalAccuracy,
        finalLoss: result.finalLoss,
        epochHistory: result.epochHistory,
        samplesUsed: data.length,
        timestamp: Date.now()
      });
      setTrainingProgress(null);
      setMemoryInfo(getMemorySnapshot());

      // Update training history with local accuracy for current round
      setTrainingHistory(prev => {
        const currentRound = prev.length > 0 ? prev[prev.length - 1].round : 0;
        const lastEntry = prev[prev.length - 1];
        if (lastEntry) {
          return prev.map((h, i) => i === prev.length - 1
            ? { ...h, localAccuracy: result.finalAccuracy }
            : h
          );
        }
        return [...prev, { round: currentRound + 1, localAccuracy: result.finalAccuracy, globalAccuracy: null }];
      });
      setStatus(`Training complete — accuracy: ${(result.finalAccuracy * 100).toFixed(1)}% on ${data.length} samples`);

    } catch (err) {
      console.error('[App] Training failed:', err);
      setStatus(`Training error: ${err.message}`);
    } finally {
      setIsTraining(false);
      // Don't reset status to waiting yet — user might submit
    }
  }, [isTraining]);

  // ─── Weight Submission ────────────────────────────────────────────────────

  const handleSubmitWeights = useCallback(async () => {
    if (!modelRef.current || !socketService.isConnected() || isSubmitting) return;

    if (!lastTrainingResult) {
      setStatus('Train the model first before submitting weights');
      return;
    }

    setIsSubmitting(true);
    setStatus('Submitting weights to server...');

    try {
      const weights = extractWeights(modelRef.current);
      const accuracy = lastTrainingResult.finalAccuracy;
      const samplesUsed = lastTrainingResult.samplesUsed || await getDrawingCount();

      socketService.submitWeights(weights, accuracy, {
        samplesUsed,
        epochs: 10,
        baseModelVersion: modelVersion
      });

      setStatus('Weights submitted — waiting for aggregation...');
    } catch (err) {
      console.error('[App] Weight submission failed:', err);
      setStatus(`Submission error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, lastTrainingResult, modelVersion]);

  // ─── Prediction ───────────────────────────────────────────────────────────

  const handlePredict = useCallback(async (imageData) => {
    if (!modelRef.current) {
      setStatus('Model not ready for prediction');
      return null;
    }

    try {
      let pixelData;
      if (typeof imageData === 'string') {
        pixelData = await canvasDataURLToPixels(imageData);
      } else if (imageData instanceof Float32Array || Array.isArray(imageData)) {
        pixelData = imageData;
      } else if (imageData instanceof ImageData) {
        pixelData = preprocessCanvasData(imageData);
      } else {
        throw new Error('Unsupported image data format');
      }

      const result = await predictDigit(modelRef.current, pixelData);
      setPrediction(result);
      return result;
    } catch (err) {
      console.error('[App] Prediction failed:', err);
      setStatus(`Prediction error: ${err.message}`);
      return null;
    }
  }, []);

  // ─── Data Clear ───────────────────────────────────────────────────────────

  const handleClearData = useCallback(async () => {
    try {
      await clearAllDrawings();
      setDrawingCount(0);
      setDrawingCounts({});
      setRecentDrawings([]);
      setLastTrainingResult(null);
      setPrediction(null);
      setStatus('All local drawings cleared');
    } catch (err) {
      console.error('[App] Clear data failed:', err);
      setStatus(`Clear error: ${err.message}`);
    }
  }, []);

  // ─── Canvas Data URL → 28×28 Grayscale ────────────────────────────────────

  async function canvasDataURLToPixels(dataURL) {
    if (!dataURL) throw new Error('No canvas data URL provided');

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 28;
          canvas.height = 28;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, 28, 28);
          ctx.drawImage(img, 0, 0, 28, 28);
          const imageData = ctx.getImageData(0, 0, 28, 28);
          const grayscale = preprocessCanvasData(imageData);
          resolve(grayscale);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Failed to load canvas image'));
      img.src = dataURL;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  // Compute avatar for header
  const avatarColor = nickname ? getAvatarColor(nickname) : '#94A3B8';
  const avatarInitial = nickname ? getInitial(nickname) : '?';

  return (
    <>
      {/* ─── Toast Container ──────────────────────────────────────── */}
      <Toaster position="top-center" />

      {/* ─── Nickname Gate ────────────────────────────────────────── */}
      <NicknameModal
        isVisible={showModal}
        onJoin={handleNicknameJoin}
      />

      {/* ─── Main App (only visible after nickname set) ───────────── */}
      <AnimatePresence>
        {nickname && (
          <motion.div
            key="main-app"
            className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800 pb-12"
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <GlobalBanners 
              isOffline={status.includes('offline') || status.includes('network')} 
              websocketError={!isConnected && !status.includes('offline')} 
            />

            {/* ─── Header with Nickname ──────────────────────────────── */}
            <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 px-6 py-4 shadow-sm mt-8">
              <div className="max-w-[90rem] mx-auto flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                    PrivacyNet FL
                  </h1>
                </div>

                <div className="flex items-center gap-4">
                  <button className="min-h-[44px] px-3 font-medium text-blue-500 hover:text-blue-700 transition-colors focus:ring-2 outline-none rounded-lg focus:ring-blue-200">
                    How it Works
                  </button>

                  {/* ── User Avatar + Nickname in Header ──────────────── */}
                  <motion.div
                    className="flex items-center gap-2.5 bg-slate-50 pl-1.5 pr-4 py-1.5 rounded-full border border-slate-200"
                    initial={shouldReduceMotion ? {} : { opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3, duration: 0.4 }}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
                      style={{ backgroundColor: avatarColor }}
                    >
                      {avatarInitial}
                    </div>
                    <div className="leading-tight">
                      <p className="text-sm font-semibold text-slate-700 truncate max-w-[120px]">
                        {nickname}
                      </p>
                      <p className="text-[10px] text-slate-400 font-medium -mt-0.5">You</p>
                    </div>
                  </motion.div>
                </div>
              </div>
            </header>

            {/* ─── Main Layout ─────────────────────────────────────── */}
            <main className="max-w-[100rem] mx-auto w-full px-4 sm:px-6 py-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 lg:gap-8">
                
                {/* Left Column: Drawing + Testing */}
                <div className="flex flex-col gap-6 md:col-span-1 lg:col-span-1">
                  <DrawingCanvas onSaveDrawing={handleSaveDrawing} />
                  <TestingArea 
                    onPredict={handlePredict} 
                    predictions={prediction?.confidences || []} 
                    isPredicting={false}
                  />
                </div>

                {/* Middle Column: Training + Privacy (mobile) */}
                <div className="flex flex-col gap-6 md:col-span-1 lg:col-span-1">
                  <TrainingPanel 
                    drawingCount={drawingCount}
                    thumbnails={recentDrawings.map(d => d.thumbnail).filter(Boolean)}
                    onStartTraining={handleTrain}
                    trainingProgress={trainingProgress ? (trainingProgress.epoch / trainingProgress.totalEpochs) * 100 : 0}
                    localAccuracy={lastTrainingResult ? lastTrainingResult.finalAccuracy : 0}
                    isTraining={isTraining}
                    hasTrained={!!lastTrainingResult}
                    onSubmitToNetwork={handleSubmitWeights}
                    isSubmitting={isSubmitting}
                  />
                  <div className="block lg:hidden">
                    <PrivacyPanel 
                      localDataSize={drawingCount} 
                      onExportData={() => {}} 
                      onDeleteData={handleClearData} 
                    />
                  </div>
                </div>

                {/* Right Column: Dashboard + Privacy (desktop) */}
                <div className="flex flex-col gap-6 md:col-span-2 lg:col-span-1">
                  <FederatedDashboard 
                    isConnected={isConnected}
                    participantCount={participantCount}
                    participants={participants}
                    globalModelVersion={modelVersion}
                    trainingHistory={[]}
                    onDownloadModel={() => {}}
                  />
                  <div className="hidden lg:block w-full">
                    <PrivacyPanel 
                      localDataSize={drawingCount} 
                      onExportData={() => {}} 
                      onDeleteData={handleClearData} 
                    />
                  </div>
                </div>

                {/* 4th Column: Live Feed (visible on xl+, full-width below) */}
                <div className="flex flex-col gap-6 md:col-span-2 lg:col-span-3 xl:col-span-1">
                  <div className="hidden xl:block relative">
                    <LiveFeed events={feedEvents} />
                  </div>
                </div>

              </div>

              {/* ── Live Feed below grid on lg and smaller screens ────── */}
              <div className="xl:hidden mt-8">
                <LiveFeed events={feedEvents} />
              </div>

              {/* ── Accuracy Comparison Panel (full width) ──────────────── */}
              <div className="mt-8">
                <AccuracyPanel
                  baselineAccuracy={baselineAccuracy}
                  localAccuracy={lastTrainingResult?.finalAccuracy ?? null}
                  globalAccuracy={analyticsData?.currentAccuracy ?? null}
                  prevLocalAccuracy={prevLocalAccuracy}
                  prevGlobalAccuracy={prevGlobalAccuracy}
                  trainingHistory={trainingHistory}
                  digitAccuracy={analyticsData?.digitAccuracy ? { global: analyticsData.digitAccuracy } : null}
                  globalModelVersion={modelVersion}
                />
              </div>
            </main>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default App;
