import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
};

export function TestingArea({ onPredict, predictions = [], isPredicting = false }) {
  const [useGlobal, setUseGlobal] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const getTopPrediction = () => {
    if (!predictions || predictions.length === 0) return null;
    let max = -1;
    let maxIndex = null;
    predictions.forEach((conf, i) => {
      if (conf > max) {
        max = conf;
        maxIndex = i;
      }
    });
    return maxIndex;
  };
  const topInd = getTopPrediction();

  return (
    <motion.div 
      layout 
      variants={cardVariants} 
      initial="hidden" 
      animate="show" 
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 focus-within:ring-2 focus-within:ring-purple-500 outline-none"
      whileHover={{ scale: shouldReduceMotion ? 1 : 1.005, boxShadow: "0 8px 25px rgba(139,92,246,0.15)" }}
    >
      <h2 className="text-2xl font-semibold mb-6 text-slate-800">Test Accuracy</h2>
      
      {/* Sliding Pill Control */}
      <div className="flex p-1 bg-slate-100 rounded-xl mb-6 relative">
        <button outline="none" onClick={() => setUseGlobal(false)} className={`flex-1 py-1.5 text-sm font-medium z-10 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg ${!useGlobal ? 'text-slate-800' : 'text-slate-500'}`}>
          Local Model
        </button>
        <button outline="none" onClick={() => setUseGlobal(true)} className={`flex-1 py-1.5 text-sm font-medium z-10 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg ${useGlobal ? 'text-slate-800' : 'text-slate-500'}`}>
          Global Model
        </button>
        <motion.div 
          layout 
          className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-lg shadow-sm origin-left" 
          initial={false} 
          animate={{ x: useGlobal ? "100%" : 0 }} 
          transition={{ type: "spring", stiffness: 400, damping: 30 }} 
        />
      </div>

      <div className="mb-6 flex justify-center">
         {/* Internal test canvas area is structurally planned here */}
         <div className="w-full max-w-[200px] aspect-square bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-sm font-medium text-slate-400">
             Test Subject Canvas
         </div>
      </div>

      <motion.button 
        whileHover={!shouldReduceMotion && !isPredicting ? { scale: 1.03, boxShadow: "0 8px 25px rgba(139,92,246,0.35)" } : {}} 
        whileTap={!shouldReduceMotion && !isPredicting ? { scale: 0.97 } : {}} 
        onClick={() => onPredict(useGlobal)} 
        disabled={isPredicting} 
        className="w-full flex items-center justify-center gap-2 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-semibold disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors"
      >
        <RefreshCw size={18} className={isPredicting ? "animate-spin" : ""} />
        {isPredicting ? 'Inferring...' : 'Generate Prediction'}
      </motion.button>
      
      {predictions.length > 0 && (
        <div className="mt-8 space-y-3" role="status" aria-live="polite">
          {predictions.map((conf, digit) => {
            const isHighest = digit === topInd;
            return (
              <div key={digit} className="flex items-center gap-3 group">
                <span className="font-mono text-sm w-4 font-bold text-slate-500">{digit}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-8 overflow-hidden relative border border-slate-200 group-hover:border-slate-300 transition-colors">
                  <motion.div 
                     initial={{ width: 0 }} 
                     animate={{ width: `${conf * 100}%` }} 
                     transition={shouldReduceMotion ? {} : { duration: 0.5, delay: digit * 0.05, ease: "easeOut" }}
                     className={`h-full relative overflow-hidden flex flex-col justify-center items-end pr-3 ${isHighest ? 'bg-purple-500' : 'bg-slate-300'}`}
                  >
                     {conf > 0.1 && (
                         <span className="text-xs font-semibold text-white relative z-20">{(conf * 100).toFixed(1)}%</span>
                     )}
                     {/* Glow constraint applied conditionally inside the bar */}
                     {isHighest && !shouldReduceMotion && (
                        <motion.div 
                            animate={{ boxShadow: ["inset 0 0 0px #fff", "inset 0 0 10px #fff", "inset 0 0 0px #fff"] }} 
                            transition={{ duration: 1.5, repeat: Infinity }} 
                            className="absolute inset-0 z-10" 
                        />
                     )}
                  </motion.div>
                </div>
              </div>
          )})}
        </div>
      )}
    </motion.div>
  );
}
