/**
 * NicknameModal.jsx — PrivacyNet FL
 * 
 * Full-screen welcome gate shown before the main training interface.
 * Collects a validated nickname, then transitions out with a slide-up exit.
 * 
 * Animations:
 *   - Modal fades + scales in with spring physics on mount
 *   - Input shakes left-right (x keyframes) on validation error
 *   - Button lifts with blue glow on hover
 *   - Modal slides up (y: -40) + fades on successful join
 * 
 * All animations respect useReducedMotion() for accessibility.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useAnimation, useReducedMotion } from 'framer-motion';
import { Lock, Loader2, Sparkles } from 'lucide-react';
import { validateNickname, getAvatarColor, getInitial } from '../utils/nicknameUtils';

export function NicknameModal({ onJoin, isVisible }) {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState(null);
  const [isJoining, setIsJoining] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);

  const inputControls = useAnimation();
  const shouldReduceMotion = useReducedMotion();

  // ─── Validation (live as user types) ──────────────────────────────────────

  const validation = validateNickname(nickname);
  const charCount = nickname.trim().length;

  // Only show error AFTER user has attempted to submit or typed enough
  const showError = hasAttempted && error;

  // ─── Input shake on error ─────────────────────────────────────────────────

  const triggerShake = useCallback(async () => {
    if (shouldReduceMotion) return;
    await inputControls.start({
      x: [0, -10, 10, -10, 10, 0],
      transition: { duration: 0.4, ease: 'easeInOut' }
    });
  }, [inputControls, shouldReduceMotion]);

  // ─── Handle input change ──────────────────────────────────────────────────

  const handleChange = (e) => {
    const value = e.target.value;
    // Hard limit at 20 chars — don't allow typing past it
    if (value.length > 20) return;
    setNickname(value);

    // Clear error as user fixes it
    if (error) {
      const check = validateNickname(value);
      if (check.valid) setError(null);
    }
  };

  // ─── Handle join ──────────────────────────────────────────────────────────

  const handleJoin = async () => {
    setHasAttempted(true);

    const check = validateNickname(nickname);
    if (!check.valid) {
      setError(check.error || 'Please enter a valid nickname');
      triggerShake();
      return;
    }

    // Show loading state for 1 second
    setIsJoining(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Notify parent with the trimmed nickname
    onJoin(nickname.trim());
  };

  // ─── Keyboard submit ─────────────────────────────────────────────────────

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && validation.valid && !isJoining) {
      handleJoin();
    }
  };

  // ─── Avatar preview color ─────────────────────────────────────────────────

  const previewColor = nickname.trim().length >= 2 ? getAvatarColor(nickname.trim()) : '#94A3B8';
  const previewInitial = nickname.trim().length >= 1 ? getInitial(nickname.trim()) : '?';

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="nickname-modal-backdrop"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* ─── Modal Card ──────────────────────────────────────────── */}
          <motion.div
            key="nickname-modal-card"
            className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 p-8 sm:p-10 relative overflow-hidden"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -40 }}
            transition={
              shouldReduceMotion
                ? { duration: 0.15 }
                : { type: 'spring', stiffness: 300, damping: 25 }
            }
          >
            {/* ── Decorative gradient blobs in background ───────────── */}
            <div className="absolute -top-20 -right-20 w-48 h-48 bg-blue-400/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-purple-400/20 rounded-full blur-3xl pointer-events-none" />

            {/* ── Logo / Brand ─────────────────────────────────────── */}
            <div className="text-center mb-8 relative z-10">
              <motion.div
                className="inline-flex items-center justify-center gap-2 mb-4"
                initial={shouldReduceMotion ? {} : { y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.5 }}
              >
                <Sparkles className="text-blue-500" size={28} />
                <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-500 via-purple-500 to-blue-600 bg-clip-text text-transparent">
                  PrivacyNet FL
                </h1>
              </motion.div>

              <motion.h2
                className="text-xl sm:text-2xl font-semibold text-slate-800 mb-2"
                initial={shouldReduceMotion ? {} : { y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.25, duration: 0.5 }}
              >
                Join the Training Session
              </motion.h2>

              <motion.p
                className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto"
                initial={shouldReduceMotion ? {} : { y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.35, duration: 0.5 }}
              >
                Your drawings never leave your browser.
                Only model improvements are shared.
              </motion.p>
            </div>

            {/* ── Avatar Preview ───────────────────────────────────── */}
            <motion.div
              className="flex justify-center mb-6 relative z-10"
              initial={shouldReduceMotion ? {} : { scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
            >
              <motion.div
                className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg"
                style={{ backgroundColor: previewColor }}
                animate={{ backgroundColor: previewColor }}
                transition={{ duration: 0.3 }}
              >
                {previewInitial}
              </motion.div>
            </motion.div>

            {/* ── Nickname Input ───────────────────────────────────── */}
            <motion.div
              className="relative z-10 mb-2"
              animate={inputControls}
              initial={shouldReduceMotion ? {} : { y: 10, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.5 }}
            >
              <input
                id="nickname-input"
                type="text"
                value={nickname}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Enter your nickname..."
                autoFocus
                autoComplete="off"
                spellCheck="false"
                aria-label="Enter your nickname"
                aria-invalid={!!showError}
                aria-describedby={showError ? 'nickname-error' : undefined}
                className={`
                  w-full px-5 py-3.5 rounded-xl text-base font-medium
                  bg-slate-50 border-2 outline-none transition-all duration-200
                  placeholder:text-slate-400
                  focus:bg-white focus:ring-4
                  ${showError
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-100 text-red-700'
                    : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100 text-slate-800'
                  }
                `}
              />

              {/* Character count */}
              <div className="flex items-center justify-between mt-2 px-1">
                <AnimatePresence mode="wait">
                  {showError ? (
                    <motion.p
                      id="nickname-error"
                      key="error"
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -5 }}
                      className="text-xs font-medium text-red-500"
                      role="alert"
                    >
                      {error}
                    </motion.p>
                  ) : (
                    <motion.p
                      key="spacer"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs text-transparent select-none"
                    >
                      &nbsp;
                    </motion.p>
                  )}
                </AnimatePresence>

                <p className={`text-xs font-mono ${charCount > 20 ? 'text-red-500' : 'text-slate-400'}`}>
                  {charCount}/20
                </p>
              </div>
            </motion.div>

            {/* ── Join Button ──────────────────────────────────────── */}
            <motion.button
              onClick={handleJoin}
              disabled={!validation.valid || isJoining}
              className={`
                w-full py-3.5 rounded-xl font-semibold text-base flex items-center justify-center gap-2
                transition-colors duration-200 outline-none
                focus:ring-4 focus:ring-blue-200
                ${validation.valid && !isJoining
                  ? 'bg-blue-500 hover:bg-blue-600 text-white cursor-pointer'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }
              `}
              whileHover={
                validation.valid && !isJoining && !shouldReduceMotion
                  ? { y: -2, boxShadow: '0 8px 30px rgba(59, 130, 246, 0.4)' }
                  : {}
              }
              whileTap={
                validation.valid && !isJoining && !shouldReduceMotion
                  ? { scale: 0.97 }
                  : {}
              }
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            >
              {isJoining ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Joining...
                </>
              ) : (
                'Join Training'
              )}
            </motion.button>

            {/* ── Privacy Note ─────────────────────────────────────── */}
            <motion.div
              className="flex items-center justify-center gap-2 mt-6 text-xs text-slate-400 relative z-10"
              initial={shouldReduceMotion ? {} : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              <Lock size={12} className="text-slate-400" />
              <span>Your nickname is only used for this session and is never stored permanently.</span>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
