/**
 * nicknameUtils.js — PrivacyNet FL
 * 
 * Utility functions for nickname validation, avatar color generation,
 * and session persistence. Used by NicknameModal and FederatedDashboard.
 */

// ─── Design System Colors ────────────────────────────────────────────────────────
// 8 carefully chosen colors that all look great as avatar backgrounds.
// The hash function maps any nickname deterministically to one of these.
const AVATAR_COLORS = [
  '#3B82F6', // blue-500
  '#8B5CF6', // violet-500
  '#10B981', // emerald-500
  '#F59E0B', // amber-500
  '#EF4444', // red-500
  '#06B6D4', // cyan-500
  '#EC4899', // pink-500
  '#84CC16', // lime-500
];

/**
 * Generates a consistent avatar color from a nickname string.
 * Uses a simple DJB2 hash of the character codes, modulo the palette length.
 * The same nickname ALWAYS returns the same color — no randomness.
 * 
 * @param {string} nickname 
 * @returns {string} Hex color string (e.g. '#3B82F6')
 */
export function getAvatarColor(nickname) {
  if (!nickname) return AVATAR_COLORS[0];

  // DJB2 hash — fast, well-distributed for short strings
  let hash = 5381;
  for (let i = 0; i < nickname.length; i++) {
    hash = ((hash << 5) + hash) + nickname.charCodeAt(i); // hash * 33 + char
    hash = hash & hash; // Convert to 32-bit integer
  }

  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

/**
 * Returns the first character of a nickname, uppercased, for avatar display.
 * 
 * @param {string} nickname 
 * @returns {string} Single uppercase character
 */
export function getInitial(nickname) {
  if (!nickname || nickname.length === 0) return '?';
  return nickname.charAt(0).toUpperCase();
}

/**
 * Validates a nickname against the platform rules:
 *   - Length: 2–20 characters
 *   - Characters: letters, numbers, underscore, hyphen only
 * 
 * @param {string} nickname 
 * @returns {{ valid: boolean, error: string | null }}
 */
export function validateNickname(nickname) {
  if (!nickname || nickname.trim().length === 0) {
    return { valid: false, error: null }; // Empty is not an error, just not valid yet
  }

  const trimmed = nickname.trim();

  if (trimmed.length < 2) {
    return { valid: false, error: 'Nickname must be at least 2 characters' };
  }

  if (trimmed.length > 20) {
    return { valid: false, error: 'Nickname must be 20 characters or fewer' };
  }

  // Only allow: A-Z, a-z, 0-9, underscore, hyphen
  const validPattern = /^[A-Za-z0-9_-]+$/;
  if (!validPattern.test(trimmed)) {
    return { valid: false, error: 'Only letters, numbers, _ and - are allowed' };
  }

  return { valid: true, error: null };
}

// ─── Session Persistence ─────────────────────────────────────────────────────────
// sessionStorage: survives page refresh, clears when the tab/browser closes.

const NICKNAME_KEY = 'privacynet_nickname';

/**
 * Saves the nickname to sessionStorage.
 * @param {string} nickname
 */
export function saveNicknameToSession(nickname) {
  try {
    sessionStorage.setItem(NICKNAME_KEY, nickname);
  } catch (err) {
    console.warn('[Nickname] sessionStorage unavailable:', err.message);
  }
}

/**
 * Retrieves the nickname from sessionStorage, or null if not set.
 * @returns {string | null}
 */
export function getNicknameFromSession() {
  try {
    return sessionStorage.getItem(NICKNAME_KEY);
  } catch (err) {
    console.warn('[Nickname] sessionStorage unavailable:', err.message);
    return null;
  }
}

/**
 * Clears the nickname from sessionStorage.
 */
export function clearNicknameFromSession() {
  try {
    sessionStorage.removeItem(NICKNAME_KEY);
  } catch (err) {
    // Silently ignore
  }
}
