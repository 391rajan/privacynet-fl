/**
 * FederatedDashboard.jsx — PrivacyNet FL
 * 
 * Federated learning network dashboard. Shows:
 *   - Connection status indicator (live pulsing dot)
 *   - Live participant list with avatars, nicknames, status badges, time-since-joined
 *   - Global model version with confetti on update
 *   - Accuracy history line chart
 *   - Download model button
 * 
 * Animations:
 *   - Participant rows slide in from right (AnimatePresence + staggerChildren)
 *   - Rows slide out to left when user disconnects
 *   - Status badge colors transition smoothly on status change
 *   - "and X more..." expander for 6+ participants
 */

import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Download, Globe, Users, Activity, Clock, CheckCircle, Hourglass, ChevronDown } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import confetti from 'canvas-confetti';
import toast from 'react-hot-toast';
import { getAvatarColor, getInitial } from '../utils/nicknameUtils';

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
};

// ─── Status Badge Config ────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  training: {
    label: 'Training',
    bgClass: 'bg-amber-100 text-amber-700 border-amber-200',
    dotClass: 'bg-amber-500',
    pulse: true,
  },
  submitted: {
    label: 'Submitted',
    bgClass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500',
    pulse: false,
  },
  waiting: {
    label: 'Waiting',
    bgClass: 'bg-slate-100 text-slate-500 border-slate-200',
    dotClass: 'bg-slate-400',
    pulse: false,
  },
};

// ─── Time-ago formatter ─────────────────────────────────────────────────────────

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ─── Participant Row ────────────────────────────────────────────────────────────

function ParticipantRow({ nickname, status, joinedAt, shouldReduceMotion }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.waiting;
  const color = getAvatarColor(nickname);
  const initial = getInitial(nickname);

  // Update time-ago every 15s
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={
        shouldReduceMotion
          ? { duration: 0.15 }
          : { type: 'spring', stiffness: 400, damping: 30 }
      }
      className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50/80 transition-colors group"
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm"
        style={{ backgroundColor: color }}
      >
        {initial}
      </div>

      {/* Nickname + time */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 truncate">{nickname}</p>
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <Clock size={10} />
          {timeAgo(joinedAt)}
        </p>
      </div>

      {/* Status badge */}
      <motion.div
        layout
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shrink-0 ${config.bgClass}`}
        animate={{ backgroundColor: undefined }} /* Let CSS handle the color via class */
      >
        {/* Pulsing dot for "training" status */}
        {config.pulse && !shouldReduceMotion ? (
          <motion.div
            className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`}
            animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : status === 'submitted' ? (
          <CheckCircle size={11} />
        ) : status === 'training' ? (
          <div className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
        ) : (
          <Hourglass size={11} />
        )}
        {config.label}
      </motion.div>
    </motion.div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function FederatedDashboard({ 
  isConnected = false,
  participantCount = 0,
  participants = [],    // [{nickname, status, joinedAt}]
  globalModelVersion = 0,
  trainingHistory = [],
  onDownloadModel
}) {
  const shouldReduceMotion = useReducedMotion();
  const [prevVersion, setPrevVersion] = useState(globalModelVersion);
  const [isExpanded, setIsExpanded] = useState(false);

  // ─── Confetti + toast on model version update ─────────────────────────────

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

  // ─── Participant list slicing (show 6, expand for more) ───────────────────

  const VISIBLE_LIMIT = 6;
  const visibleParticipants = isExpanded ? participants : participants.slice(0, VISIBLE_LIMIT);
  const hiddenCount = participants.length - VISIBLE_LIMIT;

  // ─── Status summary counts ────────────────────────────────────────────────

  const statusSummary = useMemo(() => {
    const counts = { training: 0, submitted: 0, waiting: 0 };
    participants.forEach(p => {
      if (counts[p.status] !== undefined) counts[p.status]++;
    });
    return counts;
  }, [participants]);

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
        {/* ── Header ───────────────────────────────────────────────── */}
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

        {/* ── Stats Row ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Active nodes */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-sm text-slate-500 mb-1 flex items-center gap-1.5 font-medium">
              <Users size={16} /> Active Nodes
            </p>
            <motion.p 
              key={participants.length}
              initial={shouldReduceMotion ? { opacity: 0 } : { scale: 1.5, color: "#10B981" }}
              animate={shouldReduceMotion ? { opacity: 1 } : { scale: 1, color: "#1E293B" }}
              transition={{ type: "spring", stiffness: 500 }}
              className="text-4xl font-bold tracking-tight text-slate-800"
            >
              {participants.length}
            </motion.p>
          </div>

          {/* Model version */}
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

        {/* ── Live Participant List ─────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Users size={14} /> Live Participants
            </h3>
            {/* Mini status summary pills */}
            <div className="flex items-center gap-1.5">
              {statusSummary.training > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100 font-medium">
                  {statusSummary.training} training
                </span>
              )}
              {statusSummary.submitted > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 font-medium">
                  {statusSummary.submitted} submitted
                </span>
              )}
            </div>
          </div>

          {participants.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-sm bg-slate-50 rounded-xl border border-dashed border-slate-200">
              No participants yet — waiting for connections...
            </div>
          ) : (
            <div className="space-y-0.5">
              <AnimatePresence mode="popLayout">
                {visibleParticipants.map((p) => (
                  <ParticipantRow
                    key={p.nickname}
                    nickname={p.nickname}
                    status={p.status}
                    joinedAt={p.joinedAt}
                    shouldReduceMotion={shouldReduceMotion}
                  />
                ))}
              </AnimatePresence>

              {/* Expand button if more than VISIBLE_LIMIT */}
              {hiddenCount > 0 && (
                <motion.button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-blue-500 hover:text-blue-700 hover:bg-blue-50/50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-200"
                  whileTap={!shouldReduceMotion ? { scale: 0.97 } : {}}
                >
                  <motion.div
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown size={14} />
                  </motion.div>
                  {isExpanded ? 'Show less' : `and ${hiddenCount} more...`}
                </motion.button>
              )}
            </div>
          )}
        </div>

        {/* ── Accuracy History Chart ────────────────────────────────── */}
        <div className="bg-slate-900 rounded-xl p-4 mb-6 h-48 w-full shadow-inner relative overflow-hidden">
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

        {/* ── Download Button ───────────────────────────────────────── */}
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
