/**
 * LiveFeed.jsx — PrivacyNet FL
 *
 * Real-time scrolling activity feed — like a Twitter/X timeline for AI training events.
 * Shows the last 50 events (newest at top) with animated entries, colored icons per
 * event type, pulsing effects for active aggregation, and relative timestamps.
 *
 * Event types: USER_JOINED, USER_LEFT, TRAINING_STARTED, WEIGHTS_SUBMITTED,
 *              AGGREGATION_STARTED, MODEL_UPDATED, ROUND_COMPLETE
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Activity,
  UserPlus,
  UserMinus,
  Zap,
  Upload,
  Brain,
  CheckCircle,
  Trophy,
  ChevronUp
} from 'lucide-react';
import { timeAgo } from '../utils/timeUtils';

// ─── Event Type Configuration ───────────────────────────────────────────────────

const EVENT_CONFIG = {
  USER_JOINED: {
    icon: UserPlus,
    bgColor: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    format: (e) => ({ actor: e.nickname, text: 'joined the training session' }),
  },
  USER_LEFT: {
    icon: UserMinus,
    bgColor: 'bg-slate-200',
    iconColor: 'text-slate-500',
    format: (e) => ({ actor: e.nickname, text: 'left the session' }),
  },
  TRAINING_STARTED: {
    icon: Zap,
    bgColor: 'bg-amber-100',
    iconColor: 'text-amber-600',
    format: (e) => ({ actor: e.nickname, text: 'started local training' }),
  },
  WEIGHTS_SUBMITTED: {
    icon: Upload,
    bgColor: 'bg-blue-100',
    iconColor: 'text-blue-600',
    format: (e) => ({
      actor: e.nickname,
      text: `submitted weights (accuracy: ${((e.data?.accuracy || 0) * 100).toFixed(1)}%)`,
    }),
  },
  AGGREGATION_STARTED: {
    icon: Brain,
    bgColor: 'bg-purple-100',
    iconColor: 'text-purple-600',
    format: (e) => ({
      actor: 'Server',
      text: `is combining learnings from ${e.data?.contributorCount || '?'} participants...`,
    }),
    pulse: true,
  },
  MODEL_UPDATED: {
    icon: CheckCircle,
    bgColor: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    format: (e) => ({
      actor: 'Global model',
      text: `updated to v${e.data?.version || '?'} — accuracy improved to ${((e.data?.accuracy || 0) * 100).toFixed(1)}%`,
    }),
    flash: true,
  },
  ROUND_COMPLETE: {
    icon: Trophy,
    bgColor: 'bg-amber-100',
    iconColor: 'text-amber-600',
    format: (e) => ({
      actor: `Training round ${e.data?.round || '?'}`,
      text: `complete! ${e.data?.participantCount || '?'} participants contributed.`,
    }),
  },
};

// ─── Single Event Row ───────────────────────────────────────────────────────────

function FeedEventRow({ event, shouldReduceMotion }) {
  const config = EVENT_CONFIG[event.type];
  if (!config) return null;

  const Icon = config.icon;
  const { actor, text } = config.format(event);

  // Auto-update relative time every 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Base row wrapper — handles slide-in animation
  const rowContent = (
    <div className="flex items-start gap-3 py-3 px-3 rounded-xl group hover:bg-slate-50/80 transition-colors">
      {/* Icon circle */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${config.bgColor}`}>
        <Icon size={15} className={config.iconColor} />
      </div>

      {/* Event description */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-600 leading-snug">
          <span className="font-semibold text-slate-800">{actor}</span>{' '}
          {text}
        </p>
      </div>

      {/* Timestamp */}
      <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap shrink-0 pt-0.5">
        {timeAgo(event.timestamp)}
      </span>
    </div>
  );

  // Aggregation pulsing background
  if (config.pulse && !shouldReduceMotion) {
    return (
      <motion.div
        animate={{ backgroundColor: ['#EDE9FE', '#DDD6FE', '#EDE9FE'] }}
        transition={{ duration: 1.5, repeat: 5, ease: 'easeInOut' }}
        className="rounded-xl"
      >
        {rowContent}
      </motion.div>
    );
  }

  // Model updated green flash
  if (config.flash && !shouldReduceMotion) {
    return (
      <motion.div
        initial={{ backgroundColor: '#D1FAE5' }}
        animate={{ backgroundColor: '#FFFFFF' }}
        transition={{ duration: 2, ease: 'easeOut' }}
        className="rounded-xl"
      >
        {rowContent}
      </motion.div>
    );
  }

  return <div>{rowContent}</div>;
}

// ─── Main LiveFeed Component ────────────────────────────────────────────────────

export function LiveFeed({ events = [], isMobileDrawer = false }) {
  const shouldReduceMotion = useReducedMotion();
  const scrollRef = useRef(null);
  const [isAtTop, setIsAtTop] = useState(true);

  // Count events from today
  const todayCount = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return events.filter((e) => e.timestamp >= todayStart.getTime()).length;
  }, [events]);

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (scrollRef.current && isAtTop) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [events.length, isAtTop]);

  // Track scroll position for "scroll to top" button
  const handleScroll = () => {
    if (scrollRef.current) {
      setIsAtTop(scrollRef.current.scrollTop < 10);
    }
  };

  const scrollToTop = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden relative ${
        isMobileDrawer ? 'h-full' : ''
      }`}
    >
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-2.5">
          <Activity size={20} className="text-blue-500" />
          <h3 className="text-lg font-semibold text-slate-800">Live Activity</h3>
          {/* LIVE pulsing dot */}
          <motion.div
            className="w-2 h-2 rounded-full bg-emerald-500"
            animate={
              shouldReduceMotion
                ? {}
                : { scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }
            }
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
            Live
          </span>
        </div>

        {/* Events today counter */}
        <span className="text-xs font-medium text-slate-400 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100">
          {todayCount} event{todayCount !== 1 ? 's' : ''} today
        </span>
      </div>

      {/* ── Scrollable Event List ─────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto px-2 py-1"
        style={{ maxHeight: isMobileDrawer ? 'calc(100% - 60px)' : '400px' }}
      >
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Activity size={28} className="mb-2 opacity-40" />
            <p className="text-sm font-medium">No activity yet</p>
            <p className="text-xs mt-1">Events will appear here in real-time</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {events.map((event) => (
              <motion.div
                key={event.id}
                layout
                initial={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: -20, height: 0 }
                }
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0.15 }
                    : { type: 'spring', stiffness: 400, damping: 30 }
                }
              >
                <FeedEventRow
                  event={event}
                  shouldReduceMotion={shouldReduceMotion}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* ── Scroll-to-top button (visible when scrolled down) ────── */}
      <AnimatePresence>
        {!isAtTop && events.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10"
          >
            <button
              onClick={scrollToTop}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white text-xs font-medium rounded-full shadow-lg hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <ChevronUp size={14} />
              New events
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
