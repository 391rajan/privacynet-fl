import React, { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronDown, Shield, Lock, Share2, Trash2, Download } from 'lucide-react';

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
};

export function PrivacyPanel({ localDataSize = "0", onExportData, onDeleteData }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const handleDeleteConfirm = () => {
    onDeleteData?.();
    setShowModal(false);
  };

  return (
    <motion.div 
      layout 
      variants={cardVariants} 
      initial="hidden" 
      animate="show" 
      className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4 focus-within:ring-2 focus-within:ring-slate-300 outline-none"
    >
      <button 
        onClick={() => setIsExpanded(!isExpanded)} 
        className="w-full flex items-center justify-between outline-none rounded-lg group" 
        aria-expanded={isExpanded}
      >
        <h3 className="text-xl font-semibold flex items-center gap-2 text-slate-800 transition-colors group-hover:text-slate-900">
          <Shield className="text-emerald-500" /> Privacy Guarantee
        </h3>
        <motion.div 
          animate={{ rotate: isExpanded ? 180 : 0 }} 
          transition={{ duration: 0.3 }}
          className="bg-slate-50 p-1.5 rounded-md group-hover:bg-slate-100 transition-colors"
        >
          <ChevronDown size={20} className="text-slate-500" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }} 
            animate={{ height: "auto", opacity: 1 }} 
            exit={{ height: 0, opacity: 0 }} 
            transition={{ duration: 0.35, ease: "easeInOut" }} 
            style={{ overflow: "hidden" }}
          >
             <div className="pt-6 space-y-4 pb-2">
                <div className="flex items-start gap-3 p-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
                   <Lock size={18} className="text-emerald-500 mt-0.5" /> 
                   <div>
                     <span className="block text-sm font-semibold text-emerald-800 mb-1">What Stays Private</span>
                     <span className="text-sm text-emerald-600 leading-snug">Your raw drawing pixels, timestamps, and behavioral interactions never leave your browser instance.</span>
                   </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-blue-50/50 rounded-xl border border-blue-100">
                   <Share2 size={18} className="text-blue-500 mt-0.5" /> 
                   <div>
                     <span className="block text-sm font-semibold text-blue-800 mb-1">What Gets Shared</span>
                     <span className="text-sm text-blue-600 leading-snug">Only mathematical weight updates (anonymous matrices) periodically merge with the global network.</span>
                   </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-100 flex gap-3">
                   <motion.button 
                     whileHover={!shouldReduceMotion ? { scale: 1.02 } : {}} 
                     whileTap={!shouldReduceMotion ? { scale: 0.98 } : {}} 
                     onClick={onExportData}
                     className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-50 border border-slate-200 text-slate-700 font-medium rounded-xl hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300"
                   >
                     <Download size={16} /> Export JSON
                   </motion.button>
                   
                   <motion.button 
                     whileHover={!shouldReduceMotion ? { scale: 1.02 } : {}} 
                     whileTap={!shouldReduceMotion ? { scale: 0.98 } : {}} 
                     onClick={() => setShowModal(true)}
                     className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-50 text-red-600 font-medium rounded-xl border border-red-100 hover:bg-red-100 transition-colors focus:outline-none focus:ring-2 focus:ring-red-200"
                   >
                     <Trash2 size={16} /> Delete Data
                   </motion.button>
                </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto">
            {/* Backdrop */}
            <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               exit={{ opacity: 0 }} 
               className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm cursor-pointer"
               onClick={() => setShowModal(false)}
            />
            {/* Modal Content */}
            <motion.div 
               initial={{ opacity: 0, scale: 0.85 }} 
               animate={{ opacity: 1, scale: 1 }} 
               exit={{ opacity: 0, scale: 0.85 }} 
               transition={{ type: "spring", stiffness: 300, damping: 30 }}
               className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 relative z-10 border border-slate-100"
               role="dialog"
               aria-modal="true"
            >
               <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-500 mx-auto mb-4">
                 <Trash2 size={24} />
               </div>
               <h4 className="text-xl font-semibold text-center text-slate-800 mb-2">Delete Local Data?</h4>
               <p className="text-center text-slate-500 text-sm mb-6">
                 This permanently wipes all your drawn dataset ({localDataSize} items) from browser storage. The global model remains unaffected.
               </p>
               <div className="flex gap-3">
                 <button 
                   onClick={() => setShowModal(false)}
                   className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300"
                 >
                   Cancel
                 </button>
                 <motion.button 
                   whileTap={!shouldReduceMotion ? { scale: 0.95 } : {}}
                   onClick={handleDeleteConfirm}
                   className="flex-1 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
                 >
                   Delete Now
                 </motion.button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
