import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Download, Globe, Users, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import confetti from 'canvas-confetti';
import toast from 'react-hot-toast';

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
};

export function FederatedDashboard({ 
  isConnected = false,
  participantCount = 0,
  globalModelVersion = 0,
  trainingHistory = [],
  onDownloadModel
}) {
  const shouldReduceMotion = useReducedMotion();
  const [prevVersion, setPrevVersion] = useState(globalModelVersion);

  useEffect(() => {
    if (globalModelVersion > prevVersion) {
      if (!shouldReduceMotion) {
         confetti({
           particleCount: 100,
           spread: 70,
           origin: { y: 0.6 },
           colors: ['#3B82F6', '#8B5CF6', '#10B981']
         });
      }
      toast.success(`Global model updated to v${globalModelVersion}! 🧠`, {
        style: { background: '#1E293B', color: '#fff' }
      });
      setPrevVersion(globalModelVersion);
    }
  }, [globalModelVersion, prevVersion, shouldReduceMotion]);

  return (
    <motion.div 
      layout
      variants={cardVariants}
      initial="hidden"
      animate="show"
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 relative overflow-hidden group focus-within:ring-2 focus-within:ring-purple-500 outline-none"
      whileHover={{ scale: shouldReduceMotion ? 1 : 1.005, boxShadow: "0 8px 25px rgba(139,92,246,0.15)" }}
    >
      {/* Success glow border triggered conditionally on version update */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={globalModelVersion > (prevVersion === 0 ? 0 : prevVersion - 1) ? { opacity: [0, 1, 0], boxShadow: ["inset 0 0 0px #10B981", "inset 0 0 10px #10B981", "inset 0 0 0px #10B981"] } : {}}
        transition={{ duration: 1.5 }}
        className="absolute inset-0 pointer-events-none rounded-2xl z-20"
      />

      <div className="relative z-10">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-2xl font-semibold flex items-center gap-2 text-slate-800">
            <Globe className="text-blue-500" /> Global Network
          </h2>
          
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
            <motion.div 
              animate={isConnected && !shouldReduceMotion ? { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] } : {}}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} 
            />
            <span role="status" className="text-sm font-medium text-slate-600">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Participant count */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-sm text-slate-500 mb-1 flex items-center gap-1.5 font-medium">
              <Users size={16} /> Active Nodes
            </p>
            <motion.p 
              key={participantCount}
              initial={shouldReduceMotion ? { opacity: 0 } : { scale: 1.5, color: "#10B981" }}
              animate={shouldReduceMotion ? { opacity: 1 } : { scale: 1, color: "#1E293B" }}
              transition={{ type: "spring", stiffness: 500 }}
              className="text-4xl font-bold tracking-tight text-slate-800"
            >
              {participantCount}
            </motion.p>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-sm text-slate-500 mb-1 flex items-center gap-1.5 font-medium">
               <Activity size={16} /> Version
            </p>
            <motion.div 
              key={globalModelVersion} 
              initial={{ color: "#10B981" }} 
              animate={{ color: "#1E293B" }}
              transition={{ duration: 1 }}
            >
              <p className="text-4xl font-bold">
                {globalModelVersion}
              </p>
            </motion.div>
          </div>
        </div>

        {/* Recharts - LineChart */}
        <div className="bg-slate-900 rounded-xl p-4 mb-6 h-48 w-full shadow-inner relative overflow-hidden">
           {/* Definition for Gradient Fill */}
           <svg style={{ height: 0 }}>
             <defs>
               <linearGradient id="neuralGradient" x1="0" y1="0" x2="0" y2="1">
                 <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.4}/>
                 <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
               </linearGradient>
             </defs>
           </svg>

           {trainingHistory.length === 0 ? (
             <div className="absolute inset-0 flex items-center justify-center flex-col text-slate-400 gap-2">
               Waiting for first round...
             </div>
           ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trainingHistory}>
                <XAxis dataKey="version" stroke="#64748B" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `v${v}`} />
                <YAxis stroke="#64748B" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1E293B', border: 'none', borderRadius: '8px', color: '#fff' }}
                  itemStyle={{ color: '#8B5CF6' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="accuracy" 
                  stroke="#8B5CF6" 
                  strokeWidth={3} 
                  dot={{ r: 4, fill: '#1E293B', stroke: '#8B5CF6' }} 
                  activeDot={{ r: 6, fill: '#8B5CF6', stroke: '#fff' }} 
                  isAnimationActive={!shouldReduceMotion}
                  animationDuration={800} 
                  fill="url(#neuralGradient)"
                />
              </LineChart>
            </ResponsiveContainer>
           )}
        </div>

        <motion.button 
          whileHover={isConnected && globalModelVersion > 0 && !shouldReduceMotion ? { scale: 1.03, boxShadow: "0 8px 25px rgba(59,130,246,0.35)" } : {}}
          whileTap={isConnected && globalModelVersion > 0 && !shouldReduceMotion ? { scale: 0.97 } : {}}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          onClick={onDownloadModel}
          disabled={!isConnected || globalModelVersion === 0}
          className="w-full border-2 border-blue-500 text-blue-500 hover:bg-blue-50 py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed group focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <Download size={18} />
          Download Latest Model
        </motion.button>
      </div>
    </motion.div>
  );
}
