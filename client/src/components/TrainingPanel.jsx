import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Play, Upload, Zap, Brain, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 }
  }
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
};

export function TrainingPanel({ 
  drawingCount = 0, 
  thumbnails = [],
  onStartTraining, 
  trainingProgress = 0,
  localAccuracy = 0,
  isTraining = false,
  hasTrained = false,
  onSubmitToNetwork,
  isSubmitting = false
}) {
  const shouldReduceMotion = useReducedMotion();
  const isReadyToTrain = drawingCount >= 5;

  const handleTrainClick = async () => {
    if (!isReadyToTrain) return;
    
    // Using toast.promise to manage the training flow notification
    toast.promise(
      onStartTraining(),
      {
        loading: 'Initializing local model...',
        success: 'Model trained successfully!',
        error: 'Training failed to complete.'
      },
      {
        style: { background: '#1E293B', color: '#fff' },
        success: { icon: <CheckCircle className="text-emerald-500" /> },
        error: { icon: <AlertCircle className="text-red-500" /> }
      }
    );
  };

  const handleSubmitClick = async () => {
    toast.promise(
      onSubmitToNetwork(),
      {
        loading: 'Submitting weights to global network...',
        success: 'Weights submitted successfully!',
        error: 'Failed to submit weights.'
      },
      {
        style: { background: '#1E293B', color: '#fff' },
        success: { icon: <CheckCircle className="text-emerald-500" /> },
        error: { icon: <AlertCircle className="text-red-500" /> }
      }
    );
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
      <h2 className="text-2xl font-semibold mb-6 text-slate-800 flex items-center gap-2">
        <Zap className="text-purple-500" /> Local Training
      </h2>
      
      <AnimatePresence mode="wait">
        {drawingCount === 0 ? (
          <motion.div 
            key="empty-state"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ delay: 0.3, duration: shouldReduceMotion ? 0 : 0.4 }}
            className="flex flex-col items-center justify-center py-10 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center relative overflow-hidden"
          >
            {/* Animated bouncing arrow / brain */}
            <motion.div 
              animate={shouldReduceMotion ? {} : { y: [0, -10, 0] }}
              transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              className="mb-4 text-purple-500 bg-purple-100 p-4 rounded-full"
            >
              <Brain size={32} />
            </motion.div>
            <h3 className="text-lg font-medium text-slate-700">Draw your first digit to begin training</h3>
            <p className="text-sm text-slate-500 mt-2 max-w-xs">
              We need at least 5 drawings to start building your localized model.
            </p>
          </motion.div>
        ) : (
          <motion.div 
            key="content"
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-6"
          >
            {/* Drawing count badge */}
            <div className="flex items-center gap-3" aria-live="polite">
              <motion.div 
                key={drawingCount} // Re-animate on change
                initial={{ scale: 1.5, color: "#10B981" }}
                animate={{ scale: 1, color: "#8B5CF6" }}
                transition={{ type: "spring", stiffness: 500 }}
                className="px-4 py-2 bg-purple-50 rounded-lg border border-purple-100"
              >
                <span className="text-3xl font-bold">{drawingCount}</span>
              </motion.div>
              <span className="text-slate-500 font-medium">drawings ready for training</span>
            </div>
            
            {/* Thumbnail grid */}
            <motion.div className="grid grid-cols-4 gap-3">
              {thumbnails.slice(0, 12).map((thumb, i) => (
                <motion.img 
                  key={i}
                  variants={{ hidden: { opacity: 0, scale: 0.8 }, show: { opacity: 1, scale: 1 } }}
                  transition={{ type: "spring", stiffness: 300 }}
                  src={thumb}
                  alt={`Drawing thumbnail ${i + 1}`}
                  className="w-full aspect-square bg-slate-50 rounded-lg border border-slate-200"
                />
              ))}
            </motion.div>
            
            {/* Controls */}
            {!isTraining && !hasTrained && (
               <motion.button
                  whileHover={isReadyToTrain && !shouldReduceMotion ? { scale: 1.03, boxShadow: "0 8px 25px rgba(59,130,246,0.35)" } : {}}
                  whileTap={isReadyToTrain && !shouldReduceMotion ? { scale: 0.97 } : {}}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  onClick={handleTrainClick}
                  disabled={!isReadyToTrain}
                  aria-label="Start Local Training"
                  className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-white font-semibold outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    isReadyToTrain 
                      ? 'bg-blue-500' 
                      : 'bg-slate-300 opacity-40 cursor-not-allowed'
                  }`}
                  title={!isReadyToTrain ? 'Need at least 5 drawings' : ''}
               >
                 <Play size={20} />
                 {isReadyToTrain ? 'Start Local Training' : `Need ${5 - drawingCount} more`}
               </motion.button>
            )}

            {/* Loading / Training State with Shimmer */}
            <AnimatePresence mode="wait">
            {isTraining && (
               <motion.div 
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100 relative overflow-hidden"
                  role="status"
                  aria-live="polite"
               >
                 {/* Shimmer effect inside the loading card background */}
                 <motion.div 
                   animate={shouldReduceMotion ? {} : { x: ['-100%', '100%'] }}
                   transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                   className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent z-0"
                 />
                 <div className="flex items-center justify-between text-sm font-medium relative z-10">
                   <span className="text-purple-600 flex items-center gap-2">
                     <RefreshCw size={16} className={shouldReduceMotion ? "" : "animate-spin"} />
                     Model Initializing & Training...
                   </span>
                   <span className="text-slate-600">{Math.round(trainingProgress)}%</span>
                 </div>
                 <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden shadow-inner relative z-10">
                   <motion.div 
                     initial={{ width: 0 }}
                     animate={{ width: `${trainingProgress}%` }}
                     transition={{ duration: shouldReduceMotion ? 0 : 0.4, ease: "easeOut" }}
                     className="h-full bg-purple-500"
                   />
                 </div>
               </motion.div>
            )}
            </AnimatePresence>

            {/* Post-Training Display & Submission */}
            <AnimatePresence mode="wait">
            {hasTrained && !isTraining && (
              <motion.div 
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex flex-col items-center">
                  <span className="text-sm font-medium text-emerald-600 uppercase tracking-wider mb-1 flex items-center gap-2">
                    <CheckCircle size={16} /> Final Accuracy
                  </span>
                  <div className="flex items-baseline gap-1 overflow-hidden">
                    <motion.span 
                      key={localAccuracy}
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 300 }}
                      className="text-4xl font-bold text-emerald-500"
                    >
                      {(localAccuracy * 100).toFixed(1)}
                    </motion.span>
                    <span className="text-xl font-bold text-emerald-500">%</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <motion.button
                    whileHover={!isSubmitting && !shouldReduceMotion ? { scale: 1.03, boxShadow: "0 8px 25px rgba(59,130,246,0.35)" } : {}}
                    whileTap={!isSubmitting && !shouldReduceMotion ? { scale: 0.97 } : {}}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    onClick={handleSubmitClick}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-500 rounded-xl text-white font-semibold outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed group"
                  >
                    <Upload size={20} className={isSubmitting ? "animate-bounce" : ""} />
                    {isSubmitting ? 'Submitting...' : 'Submit to Network'}
                  </motion.button>
                  
                  {/* Waiting state after submission */}
                  <AnimatePresence>
                  {isSubmitting && (
                     <motion.p 
                       initial={{ opacity: 0, height: 0 }}
                       animate={{ opacity: 1, height: 'auto' }}
                       exit={{ opacity: 0, height: 0 }}
                       role="status" 
                       className="text-center text-sm font-medium text-amber-500 flex items-center justify-center gap-2 overflow-hidden"
                     >
                       <motion.div 
                         initial={{ scale: 0 }}
                         animate={shouldReduceMotion ? { scale: 1 } : { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                         transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                         className="w-2 h-2 rounded-full bg-amber-500"
                       />
                       Waiting for 2 more participants...
                     </motion.p>
                  )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
