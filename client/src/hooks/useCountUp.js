/**
 * useCountUp.js — PrivacyNet FL
 *
 * Custom hook that animates a number from its previous value to a new target.
 * Uses requestAnimationFrame for smooth 60fps counting. Perfect for accuracy
 * percentages that update after each training round.
 *
 * @param {number} targetValue - The value to animate towards (0–1 for accuracy)
 * @param {number} duration - Animation duration in milliseconds (default: 1200)
 * @returns {number} The current interpolated display value
 */

import { useState, useEffect, useRef } from 'react';

export function useCountUp(targetValue, duration = 1200) {
  // Sanitize: NaN or non-finite → 0
  const safeTarget = (targetValue != null && isFinite(targetValue)) ? targetValue : 0;
  const [displayValue, setDisplayValue] = useState(safeTarget);
  const prevTarget = useRef(safeTarget);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = prevTarget.current;
    const to = safeTarget;
    prevTarget.current = safeTarget;

    // Don't animate if the change is negligible
    if (Math.abs(to - from) < 0.0001) {
      setDisplayValue(to);
      return;
    }

    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic: fast start, gentle finish
      const eased = 1 - Math.pow(1 - progress, 3);

      const current = from + (to - from) * eased;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayValue(to); // Snap to exact final value
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [targetValue, duration]);

  return displayValue;
}
