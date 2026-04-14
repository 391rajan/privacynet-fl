/**
 * AccuracyPanel.jsx — PrivacyNet FL
 *
 * Visual proof that federated learning works. Shows three accuracy metrics
 * side by side (baseline, local, global) with animated counting, trend arrows,
 * an over-time line chart, and a per-digit breakdown table.
 *
 * Props:
 *   baselineAccuracy   — Static ~10% from random guessing (set once)
 *   localAccuracy      — Updated after each local training session
 *   globalAccuracy     — Updated after each federated round
 *   trainingHistory    — [{round, localAccuracy, globalAccuracy}]
 *   digitAccuracy      — {local: {"0": 0.92, ...}, global: {"0": 0.95, ...}}
 *   globalModelVersion — Current global model version number
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Target, User, Globe, TrendingUp, TrendingDown, Minus,
  Star, ChevronDown, BarChart3
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend
} from 'recharts';
import confetti from 'canvas-confetti';
import { useCountUp } from '../hooks/useCountUp';
import { useAccuracyColor } from '../hooks/useAccuracyColor';

// ─── Container Variants ─────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.1 }
  }
};

const cardVariants = {
  hidden: { opacity: 0, scale: 0.85 },
  show: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 25 } }
};

// ─── Metric Card ────────────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  iconColorClass,
  label,
  accuracy,
  prevAccuracy,
  subtitle,
  placeholder,
  isBest,
  shouldReduceMotion
}) {
  const displayValue = useCountUp(accuracy ?? 0, 1200);
  const color = useAccuracyColor(accuracy);
  const hasValue = accuracy != null && accuracy > 0;
  const delta = hasValue ? (accuracy - 0.1) : null; // vs baseline ~10%
  const trend = prevAccuracy != null && hasValue
    ? accuracy > prevAccuracy + 0.001 ? 'up'
      : accuracy < prevAccuracy - 0.001 ? 'down'
      : 'same'
    : null;

  return (
    <motion.div
      variants={cardVariants}
      className={`relative bg-white rounded-2xl border p-5 flex flex-col gap-3 transition-shadow ${
        isBest ? 'border-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.25)]' : 'border-slate-200 shadow-sm'
      }`}
    >
      {/* BEST badge */}
      <AnimatePresence>
        {isBest && (
          <motion.div
            initial={shouldReduceMotion ? {} : { scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
            className="absolute -top-2 -right-2 bg-amber-400 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md z-10"
          >
            <Star size={10} fill="currentColor" /> BEST
          </motion.div>
        )}
      </AnimatePresence>

      {/* Icon + Label */}
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
          iconColorClass === 'blue' ? 'bg-blue-100 text-blue-600' :
          iconColorClass === 'purple' ? 'bg-purple-100 text-purple-600' :
          'bg-slate-100 text-slate-500'
        }`}>
          <Icon size={18} />
        </div>
        <span className="text-sm font-semibold text-slate-700">{label}</span>
      </div>

      {/* Value */}
      {hasValue ? (
        <div className="flex items-end gap-2">
          <span className={`text-4xl font-bold tracking-tight ${color.text}`}>
            {(displayValue * 100).toFixed(1)}%
          </span>

          {/* Trend arrow */}
          {trend && (
            <motion.div
              animate={{ rotate: trend === 'down' ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 500 }}
              className={`mb-1.5 ${
                trend === 'up' ? 'text-emerald-500' :
                trend === 'down' ? 'text-red-500' :
                'text-slate-400'
              }`}
            >
              {trend === 'same' ? <Minus size={16} /> : <TrendingUp size={16} />}
            </motion.div>
          )}
        </div>
      ) : (
        <div className="border-2 border-dashed border-slate-200 rounded-xl py-3 px-4 text-center">
          <p className="text-sm text-slate-400 font-medium">{placeholder || 'No data'}</p>
        </div>
      )}

      {/* Subtitle + delta */}
      <div>
        <p className="text-xs text-slate-400">{subtitle}</p>
        {delta != null && hasValue && (
          <p className={`text-[11px] font-medium mt-0.5 ${delta > 0 ? 'text-emerald-500' : 'text-red-400'}`}>
            {delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)}% from baseline
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ─── Custom Chart Tooltip ───────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl text-sm border border-slate-700">
      <p className="font-semibold text-slate-300 mb-1.5">Round {label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-400">{entry.name}:</span>
          <span className="font-semibold">{entry.value?.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

// ─── Per-Digit Table ────────────────────────────────────────────────────────────

function DigitRow({ digit, baseline, local, global: glob, shouldReduceMotion }) {
  const cellStyle = (val) => {
    if (val == null) return {};
    return { backgroundColor: `rgba(16, 185, 129, ${Math.min(0.08 + val * 0.25, 0.35)})` };
  };

  const cellText = (val) => {
    if (val == null) return '—';
    return `${(val * 100).toFixed(1)}%`;
  };

  return (
    <motion.tr
      initial={shouldReduceMotion ? {} : { opacity: 0 }}
      animate={{ opacity: 1 }}
      className="border-b border-slate-100 last:border-b-0"
    >
      <td className="py-2.5 px-3 text-center">
        <span className="text-sm font-bold text-slate-700 bg-slate-100 w-7 h-7 rounded-lg inline-flex items-center justify-center font-mono">
          {digit}
        </span>
      </td>
      <td className="py-2.5 px-3 text-center text-sm text-slate-500 font-medium" style={cellStyle(baseline)}>
        {cellText(baseline)}
      </td>
      <td className="py-2.5 px-3 text-center text-sm font-medium text-blue-600" style={cellStyle(local)}>
        {cellText(local)}
      </td>
      <td className="py-2.5 px-3 text-center text-sm font-medium text-purple-600" style={cellStyle(glob)}>
        {cellText(glob)}
      </td>
    </motion.tr>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function AccuracyPanel({
  baselineAccuracy = 0.1,
  localAccuracy = null,
  globalAccuracy = null,
  prevLocalAccuracy = null,
  prevGlobalAccuracy = null,
  trainingHistory = [],
  digitAccuracy = null,
  globalModelVersion = 0
}) {
  const shouldReduceMotion = useReducedMotion();
  const [isExpanded, setIsExpanded] = useState(true);
  const hasTriggeredConfetti = useRef(false);

  // Determine if global model is currently the "BEST"
  const globalIsBest = globalAccuracy != null && localAccuracy != null && globalAccuracy > localAccuracy + 0.001;

  // Confetti when global first beats local
  useEffect(() => {
    if (globalIsBest && !hasTriggeredConfetti.current) {
      hasTriggeredConfetti.current = true;
      if (!shouldReduceMotion) {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#F59E0B', '#8B5CF6', '#10B981']
        });
      }
    }
  }, [globalIsBest, shouldReduceMotion]);

  // Build chart data from training history
  const chartData = useMemo(() => {
    if (!trainingHistory.length) return [];
    return trainingHistory.map((h) => ({
      round: h.round,
      Baseline: (baselineAccuracy * 100),
      'Your Model': h.localAccuracy != null ? (h.localAccuracy * 100) : null,
      'Global Model': h.globalAccuracy != null ? (h.globalAccuracy * 100) : null
    }));
  }, [trainingHistory, baselineAccuracy]);

  // Find index where global first exceeds local
  const federatedWinsRound = useMemo(() => {
    for (const h of trainingHistory) {
      if (h.globalAccuracy != null && h.localAccuracy != null && h.globalAccuracy > h.localAccuracy) {
        return h.round;
      }
    }
    return null;
  }, [trainingHistory]);

  // Digit accuracy rows (0–9)
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const avgDigit = (obj) => {
    if (!obj) return null;
    const vals = digits.map(d => obj[String(d)]).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-6 py-5 hover:bg-slate-50/50 transition-colors focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <BarChart3 size={22} className="text-purple-500" />
          <h2 className="text-xl font-semibold text-slate-800">Accuracy Comparison</h2>
          {globalModelVersion > 0 && (
            <span className="text-xs font-medium bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full border border-purple-100">
              v{globalModelVersion}
            </span>
          )}
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={20} className="text-slate-400" />
        </motion.div>
      </button>

      {/* ── Expandable body ────────────────────────────────────── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6">
              {/* ── Three Metric Cards ────────────────────────── */}
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="show"
                className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8"
              >
                <MetricCard
                  icon={Target}
                  iconColorClass="gray"
                  label="Untrained Baseline"
                  accuracy={baselineAccuracy}
                  prevAccuracy={null}
                  subtitle="Random chance performance"
                  shouldReduceMotion={shouldReduceMotion}
                />
                <MetricCard
                  icon={User}
                  iconColorClass="blue"
                  label="Your Local Model"
                  accuracy={localAccuracy}
                  prevAccuracy={prevLocalAccuracy}
                  subtitle="Trained on your drawings only"
                  placeholder="Not trained yet"
                  shouldReduceMotion={shouldReduceMotion}
                />
                <MetricCard
                  icon={Globe}
                  iconColorClass="purple"
                  label="Global Federated Model"
                  accuracy={globalAccuracy}
                  prevAccuracy={prevGlobalAccuracy}
                  subtitle="Trained by all participants"
                  placeholder="Waiting for first round..."
                  isBest={globalIsBest}
                  shouldReduceMotion={shouldReduceMotion}
                />
              </motion.div>

              {/* ── Accuracy Over Time Chart ──────────────────── */}
              <div className="bg-slate-900 rounded-xl p-5 mb-8 overflow-hidden">
                <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                  <TrendingUp size={16} className="text-purple-400" />
                  Accuracy Over Time
                </h3>
                {chartData.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                    Complete a training round to see accuracy trends...
                  </div>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        {/* Gradient fill for global line */}
                        <defs>
                          <linearGradient id="globalGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="round"
                          stroke="#64748B"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => `R${v}`}
                        />
                        <YAxis
                          stroke="#64748B"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 100]}
                          tickFormatter={(v) => `${v}%`}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend
                          iconType="circle"
                          wrapperStyle={{ fontSize: '12px', color: '#94A3B8' }}
                        />

                        {/* Baseline flat line */}
                        <Line
                          type="monotone"
                          dataKey="Baseline"
                          stroke="#94A3B8"
                          strokeWidth={2}
                          strokeDasharray="6 4"
                          dot={false}
                          isAnimationActive={!shouldReduceMotion}
                          animationDuration={1000}
                        />

                        {/* Local model line */}
                        <Line
                          type="monotone"
                          dataKey="Your Model"
                          stroke="#3B82F6"
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: '#1E293B', stroke: '#3B82F6' }}
                          activeDot={{ r: 6, fill: '#3B82F6', stroke: '#fff' }}
                          isAnimationActive={!shouldReduceMotion}
                          animationDuration={1000}
                          connectNulls
                        />

                        {/* Global model line with gradient fill */}
                        <Line
                          type="monotone"
                          dataKey="Global Model"
                          stroke="#8B5CF6"
                          strokeWidth={3}
                          dot={{ r: 4, fill: '#1E293B', stroke: '#8B5CF6' }}
                          activeDot={{ r: 6, fill: '#8B5CF6', stroke: '#fff' }}
                          isAnimationActive={!shouldReduceMotion}
                          animationDuration={1000}
                          fill="url(#globalGradient)"
                          connectNulls
                        />

                        {/* "Federated wins" reference line */}
                        {federatedWinsRound && (
                          <ReferenceLine
                            x={federatedWinsRound}
                            stroke="#10B981"
                            strokeDasharray="4 4"
                            strokeWidth={2}
                            label={{
                              value: 'Federated wins! 🎉',
                              position: 'top',
                              fill: '#10B981',
                              fontSize: 11,
                              fontWeight: 600
                            }}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* ── Per-Digit Accuracy Table ──────────────────── */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <Target size={16} className="text-slate-400" />
                  Per-Digit Accuracy Breakdown
                </h3>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="py-2.5 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Digit</th>
                        <th className="py-2.5 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Baseline</th>
                        <th className="py-2.5 px-3 text-center text-xs font-semibold text-blue-500 uppercase tracking-wider">Your Model</th>
                        <th className="py-2.5 px-3 text-center text-xs font-semibold text-purple-500 uppercase tracking-wider">Global</th>
                      </tr>
                    </thead>
                    <tbody>
                      {digits.map((d) => (
                        <DigitRow
                          key={d}
                          digit={d}
                          baseline={0.1}
                          local={digitAccuracy?.local?.[String(d)] ?? null}
                          global={digitAccuracy?.global?.[String(d)] ?? null}
                          shouldReduceMotion={shouldReduceMotion}
                        />
                      ))}

                      {/* Average footer row */}
                      <tr className="bg-slate-50 border-t-2 border-slate-200">
                        <td className="py-2.5 px-3 text-center text-xs font-bold text-slate-600 uppercase">Avg</td>
                        <td className="py-2.5 px-3 text-center text-sm font-semibold text-slate-500">10.0%</td>
                        <td className="py-2.5 px-3 text-center text-sm font-semibold text-blue-600">
                          {avgDigit(digitAccuracy?.local) != null
                            ? `${(avgDigit(digitAccuracy.local) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center text-sm font-semibold text-purple-600">
                          {avgDigit(digitAccuracy?.global) != null
                            ? `${(avgDigit(digitAccuracy.global) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
