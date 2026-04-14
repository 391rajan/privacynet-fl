import React, { useRef, useState, Component } from 'react';
import { Trash2, Save, ChevronDown, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
};

// ─── Error Boundary ─────────────────────────────────────────────────────────────
// react-canvas-draw requires React 16/17 peer deps. Under React 18 StrictMode
// it can throw during mount. This boundary catches the error gracefully.
class CanvasErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.warn('[DrawingCanvas] react-canvas-draw error caught:', error.message);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center w-full aspect-square bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 text-center p-6">
          <p className="text-sm font-medium text-slate-500 mb-2">Canvas unavailable</p>
          <p className="text-xs text-slate-400">Drawing component failed to load. Try refreshing.</p>
          <button 
            onClick={() => this.setState({ hasError: false })}
            className="mt-3 text-xs text-blue-500 hover:underline font-medium"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Lazy-load react-canvas-draw ────────────────────────────────────────────────
// Dynamically import to prevent build errors if the package has issues
let CanvasDraw = null;
try {
  CanvasDraw = require('react-canvas-draw').default || require('react-canvas-draw');
} catch (err) {
  console.warn('[DrawingCanvas] react-canvas-draw not available:', err.message);
}

export function DrawingCanvas({ onSaveDrawing }) {
  const canvasRef = useRef(null);
  const [label, setLabel] = useState(0);
  const [hasStrokes, setHasStrokes] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const handleClear = () => {
    if (canvasRef.current) {
      canvasRef.current.clear();
      setHasStrokes(false);
    }
  };

  const handleSave = () => {
    if (!hasStrokes || !canvasRef.current) return;

    const strokeData = canvasRef.current.getSaveData();
    let imageThumbnail = null;
    
    try {
      imageThumbnail = canvasRef.current.getDataURL('image/png', false, '#ffffff');
    } catch(e) {
      console.warn("getDataURL not available", e);
    }

    if (onSaveDrawing) {
      onSaveDrawing({ 
        label: parseInt(label, 10), 
        strokeData,
        thumbnail: imageThumbnail
      });
    }

    toast.success(`Drawing saved!`, {
      icon: <CheckCircle className="text-emerald-500" />,
      style: { background: '#1E293B', color: '#fff' }
    });

    handleClear();
  };

  return (
    <motion.div 
      layout
      variants={cardVariants}
      initial="hidden"
      animate="show"
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 group focus-within:ring-2 focus-within:ring-blue-500 outline-none"
      whileHover={{ scale: shouldReduceMotion ? 1 : 1.005, boxShadow: "0 8px 25px rgba(59,130,246,0.15)" }}
    >
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">
          Draw a Digit
        </h2>
        
        <AnimatePresence>
          {hasStrokes && (
            <motion.button 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: "spring", stiffness: 300 }}
              onClick={handleClear}
              className="group flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-500 bg-white border border-red-500 rounded-lg outline-none focus:ring-2 focus:ring-red-200"
              aria-label="Clear canvas"
            >
              <Trash2 size={16} />
              <span>Clear</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col items-center">
        <div className="relative rounded-lg border border-slate-200 overflow-hidden cursor-crosshair bg-white shadow-inner" style={{ width: 280, height: 280 }}>
          <CanvasErrorBoundary>
            {CanvasDraw ? (
              <CanvasDraw
                ref={canvasRef}
                brushColor="#1E293B"
                brushRadius={3}
                lazyRadius={0}
                canvasWidth={280}
                canvasHeight={280}
                hideGrid={true}
                backgroundColor="#FFFFFF"
                onChange={() => {
                  if(!hasStrokes) setHasStrokes(true);
                }}
                className="touch-none"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-slate-400">
                Canvas not available
              </div>
            )}
          </CanvasErrorBoundary>
        </div>

        <div className="w-full flex items-center justify-between gap-4 mt-6">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="digit-select" className="text-sm font-medium text-slate-500">
              Digit Label
            </label>
            <div className="relative">
              <select 
                id="digit-select"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="appearance-none bg-slate-50 border border-slate-200 text-lg text-slate-800 rounded-lg pl-4 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono font-semibold cursor-pointer"
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <option key={num} value={num}>
                    {num}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                <ChevronDown size={18} />
              </div>
            </div>
          </div>
          
          <div className="flex items-end h-full pt-6">
             <motion.button
              whileHover={hasStrokes && !shouldReduceMotion ? { scale: 1.03, boxShadow: "0 8px 25px rgba(59,130,246,0.35)" } : {}}
              whileTap={hasStrokes && !shouldReduceMotion ? { scale: 0.97 } : {}}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              onClick={handleSave}
              disabled={!hasStrokes}
              className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                hasStrokes 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-slate-300 text-white opacity-40 cursor-not-allowed'
              }`}
              aria-label="Save current drawing"
            >
              <Save size={18} />
              <span>Save</span>
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
