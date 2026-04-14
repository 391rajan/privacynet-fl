/**
 * timeUtils.js — PrivacyNet FL
 *
 * Human-readable relative time formatting for the live activity feed.
 * Auto-updates via setInterval in consuming components.
 */

/**
 * Converts a UNIX timestamp to a human-readable relative time string.
 *
 * @param {number} timestamp - Date.now() value
 * @returns {string} "just now", "15 sec ago", "3 min ago", "2 hr ago"
 */
export function timeAgo(timestamp) {
  if (!timestamp) return 'just now';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ago`;
}

// ─── Session Persistence ────────────────────────────────────────────────────────

const FEED_KEY = 'privacynet_feed_events';
const MAX_PERSISTED = 20;

/**
 * Saves the most recent feed events to sessionStorage.
 * @param {Array} events
 */
export function saveFeedToSession(events) {
  try {
    const trimmed = events.slice(0, MAX_PERSISTED);
    sessionStorage.setItem(FEED_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // sessionStorage may be unavailable in private mode
  }
}

/**
 * Loads persisted feed events from sessionStorage.
 * @returns {Array}
 */
export function loadFeedFromSession() {
  try {
    const raw = sessionStorage.getItem(FEED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    return [];
  }
}
