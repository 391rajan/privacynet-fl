/**
 * useAccuracyColor.js — PrivacyNet FL
 *
 * Returns Tailwind CSS color classes based on an accuracy value.
 * Used by AccuracyPanel metric cards and the per-digit breakdown table.
 *
 * Thresholds:
 *   < 50%  → red (danger)
 *   50–75% → amber (warning)
 *   > 75%  → green (success)
 *
 * @param {number} accuracy - Value between 0 and 1
 * @returns {{ text: string, bg: string, border: string, hex: string }}
 */

export function useAccuracyColor(accuracy) {
  if (accuracy == null || isNaN(accuracy)) {
    return {
      text: 'text-slate-400',
      bg: 'bg-slate-100',
      border: 'border-slate-200',
      hex: '#94A3B8'
    };
  }

  if (accuracy < 0.5) {
    return {
      text: 'text-red-500',
      bg: 'bg-red-50',
      border: 'border-red-200',
      hex: '#EF4444'
    };
  }

  if (accuracy < 0.75) {
    return {
      text: 'text-amber-500',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      hex: '#F59E0B'
    };
  }

  return {
    text: 'text-emerald-500',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    hex: '#10B981'
  };
}
