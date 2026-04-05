/**
 * App.jsx — PrivacyNet FL Client (Phase 2 Integration)
 * 
 * Root component. Wires all ML services, data flows, and Agent B components together.
 * 
 * Data Flow:
 *   DrawingCanvas saves → preprocessCanvasData → IndexedDB → drawingCounts update
 *   TrainingPanel trains → getTrainingData → trainLocalModel → accuracy state update
 *   TrainingPanel submits → extractWeights → WebSocket → server aggregation
 *   Server broadcasts 'model_updated' → loadWeights → modelVersion increments
 *   TestingArea draws → predictDigit → prediction/confidences state update
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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

// ─── Agent B Components ─────────────────────────────────────────────────────────
// Import all components Agent B created. These receive state/actions as props.
import { DrawingCanvas } from './components/DrawingCanvas';
import { TrainingPanel } from './components/TrainingPanel';
import { FederatedDashboard } from './components/FederatedDashboard';
import { TestingArea } from './components/TestingArea';
import { PrivacyPanel } from './components/PrivacyPanel';
import { GlobalBanners } from './components/AppStates';

// ─── Server URL Configuration ───────────────────────────────────────────────────
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

function App() {
  // ─── State ──────────────────────────────────────────────────────────────────

  // Model
  const modelRef = useRef(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelVersion, setModelVersion] = useState(0);
  const [modelSummary, setModelSummary] = useState(null);

  // Training
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(null);
  const [lastTrainingResult, setLastTrainingResult] = useState(null);

  // Data
  const [drawingCount, setDrawingCount] = useState(0);
  const [drawingCounts, setDrawingCounts] = useState({});
  const [recentDrawings, setRecentDrawings] = useState([]); // For thumbnail grid

  // Network
  const [isConnected, setIsConnected] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionProgress, setSubmissionProgress] = useState(null);

  // Prediction
  const [prediction, setPrediction] = useState(null);

  // Aggregation
  const [aggregationInfo, setAggregationInfo] = useState(null);

  // Status
  const [status, setStatus] = useState('Initializing...');
  const [memoryInfo, setMemoryInfo] = useState(null);

  // ─── Initialization ─────────────────────────────────────────────────────────

  useEffect(() => {
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
            setRecentDrawings(drawings.slice(0, 20)); // Last 20 for thumbnail grid
          }
        } catch (dbErr) {
          console.warn('[App] IndexedDB read failed:', dbErr.message);
        }

        // 3. Set up socket event listeners BEFORE connecting
        // This ensures we don't miss events that fire during connection
        socketService.onParticipantCount(({ count }) => {
          if (mounted) setParticipantCount(count);
        });

        socketService.onModelUpdate((data) => {
          if (!mounted || !modelRef.current) return;
          try {
            loadWeights(modelRef.current, data.weights);
            setModelVersion(data.version);
            setStatus(`Global model updated → v${data.version} (accuracy: ${(data.accuracy * 100).toFixed(1)}%)`);
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

        // 4. Connect to the aggregation server
        setStatus('Connecting to aggregation server...');
        try {
          await socketService.connect(SERVER_URL);
          if (mounted) setIsConnected(true);

          // 5. Request the latest global model weights
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

        if (mounted) {
          setMemoryInfo(getMemorySnapshot());
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
  }, []);

  // ─── Actions ────────────────────────────────────────────────────────────────

  /**
   * FLOW: DrawingCanvas → preprocessCanvasData → IndexedDB → update counts + thumbnails
   * 
   * Agent B's DrawingCanvas calls this with { label, strokeData, thumbnail }.
   * We need to convert the canvas drawing into a 784-element normalized pixel array
   * and store it in IndexedDB.
   */
  const handleSaveDrawing = useCallback(async (drawingData) => {
    try {
      const { label, thumbnail } = drawingData;

      // Convert the canvas thumbnail (a data URL) to 28x28 grayscale pixel array
      // We draw it onto an offscreen canvas, resize to 28x28, extract pixels
      const pixelData = await canvasDataURLToPixels(thumbnail);

      // Save the normalized 784-element array + label to IndexedDB
      const id = await saveDrawing(pixelData, label);

      // Update all data counts
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

  /**
   * FLOW: TrainingPanel → getTrainingData → trainLocalModel → update accuracy state
   * 
   * Trains the local model on all IndexedDB drawings.
   * Called by the Train button in Agent B's TrainingPanel.
   */
  const handleTrain = useCallback(async () => {
    if (!modelRef.current || isTraining) return;

    setIsTraining(true);
    setTrainingProgress(null);
    setStatus('Training locally...');

    try {
      const data = await getTrainingData();

      // BUG #7 FIX: Don't train on empty data — user must draw first
      if (data.length === 0) {
        setStatus('No drawings yet — draw some digits before training!');
        setIsTraining(false);
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

      setLastTrainingResult({
        finalAccuracy: result.finalAccuracy,
        finalLoss: result.finalLoss,
        epochHistory: result.epochHistory,
        samplesUsed: data.length,
        timestamp: Date.now()
      });
      setTrainingProgress(null);
      setMemoryInfo(getMemorySnapshot());
      setStatus(`Training complete — accuracy: ${(result.finalAccuracy * 100).toFixed(1)}% on ${data.length} samples`);

    } catch (err) {
      console.error('[App] Training failed:', err);
      setStatus(`Training error: ${err.message}`);
    } finally {
      setIsTraining(false);
    }
  }, [isTraining]);

  /**
   * FLOW: TrainingPanel → extractWeights → WebSocket → server → dashboard updates
   * 
   * Submits trained weights to the aggregation server.
   * Only sends weight arrays — never the raw drawings (privacy guarantee).
   */
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

  /**
   * FLOW: TestingArea → preprocessCanvasData → predictDigit → confidence bars update
   * 
   * Runs inference on a drawn digit and returns prediction + all 10 confidences.
   */
  const handlePredict = useCallback(async (imageData) => {
    if (!modelRef.current) {
      setStatus('Model not ready for prediction');
      return null;
    }

    try {
      // imageData can be either:
      // 1. A pre-processed 784-element Float32Array (from canvas preprocessing)
      // 2. A data URL string from DrawingCanvas that needs conversion
      let pixelData;
      if (typeof imageData === 'string') {
        // Data URL from canvas — convert to 28x28 grayscale
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

  /**
   * Clears all local data (GDPR compliance).
   */
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

  // ─── Canvas Data URL → 28×28 Grayscale Conversion ─────────────────────────

  /**
   * Converts a canvas data URL to a 784-element normalized Float32Array.
   * Draws the image onto an offscreen 28×28 canvas.
   */
  async function canvasDataURLToPixels(dataURL) {
    if (!dataURL) {
      throw new Error('No canvas data URL provided');
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          // Create offscreen 28x28 canvas
          const canvas = document.createElement('canvas');
          canvas.width = 28;
          canvas.height = 28;
          const ctx = canvas.getContext('2d');

          // White background (MNIST convention)
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, 28, 28);

          // Draw the image scaled to 28x28
          ctx.drawImage(img, 0, 0, 28, 28);

          // Extract pixel data
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

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800 pb-12">
      <GlobalBanners 
        isOffline={status.includes('offline') || status.includes('network')} 
        websocketError={!isConnected && !status.includes('offline')} 
      />

      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 px-6 py-4 shadow-sm mt-8">
         <div className="max-w-[90rem] mx-auto flex items-center justify-between">
           <div className="flex items-center gap-4">
               <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                 PrivacyNet FL
               </h1>
           </div>
           <button className="min-h-[44px] px-3 font-medium text-blue-500 hover:text-blue-700 transition-colors focus:ring-2 outline-none rounded-lg focus:ring-blue-200">
             How it Works
           </button>
         </div>
      </header>

      <main className="max-w-[90rem] mx-auto w-full px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
           
           <div className="flex flex-col gap-6 md:col-span-1 lg:col-span-1">
             <DrawingCanvas onSaveDrawing={handleSaveDrawing} />
             <TestingArea 
                onPredict={handlePredict} 
                predictions={prediction?.confidences || []} 
                isPredicting={false} // Would be tied to an isPredicting state ideally
             />
           </div>

           <div className="flex flex-col gap-6 md:col-span-1 lg:col-span-1">
             <TrainingPanel 
                drawingCount={drawingCount}
                thumbnails={recentDrawings.map(d => d.thumbnail).filter(Boolean)}
                onStartTraining={handleTrain}
                trainingProgress={trainingProgress ? (trainingProgress.epoch / trainingProgress.totalEpochs)*100 : 0}
                localAccuracy={lastTrainingResult ? lastTrainingResult.finalAccuracy : 0}
                isTraining={isTraining}
                hasTrained={!!lastTrainingResult}
                onSubmitToNetwork={handleSubmitWeights}
                isSubmitting={isSubmitting}
             />
             <div className="block lg:hidden">
               <PrivacyPanel 
                 localDataSize={drawingCount} 
                 onExportData={() => { /* implement export logic */ }} 
                 onDeleteData={handleClearData} 
               />
             </div>
           </div>

           <div className="flex flex-col gap-6 md:col-span-2 lg:col-span-1">
             <FederatedDashboard 
                isConnected={isConnected}
                participantCount={participantCount}
                globalModelVersion={modelVersion}
                trainingHistory={[]} // Would map aggregation history here if available
                onDownloadModel={() => { /* implement download */ }}
             />
             <div className="hidden lg:block w-full">
               <PrivacyPanel 
                 localDataSize={drawingCount} 
                 onExportData={() => { /* implement export logic */ }} 
                 onDeleteData={handleClearData} 
               />
             </div>
           </div>

        </div>
      </main>
    </div>
  );
}

export default App;
