/**
 * indexedDBService.js — PrivacyNet FL
 * 
 * Local data persistence using Dexie.js (IndexedDB wrapper).
 * All drawing data stays on the client — this is the core privacy guarantee.
 * 
 * Schema:
 *   drawings: ++id, label, timestamp
 *     - imageData: Float32Array of 784 pixels (28×28, normalized 0–1)
 *     - label: digit 0–9
 *     - timestamp: ISO date string
 */

import Dexie from 'dexie';

// ─── Database Setup ─────────────────────────────────────────────────────────────

const db = new Dexie('PrivacyNetDB');

db.version(1).stores({
  // ++id = auto-incrementing primary key
  // label, timestamp = indexed fields for querying
  drawings: '++id, label, timestamp'
});

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Saves a single drawing to the local database.
 * 
 * @param {Float32Array|number[]} imageData - 784-element pixel array (0–1 normalized)
 * @param {number} label - Digit label 0–9
 * @returns {Promise<number>} Auto-generated drawing ID
 */
export async function saveDrawing(imageData, label) {
  if (label < 0 || label > 9 || !Number.isInteger(label)) {
    throw new Error(`[IndexedDB] Invalid label: ${label}. Must be integer 0–9.`);
  }

  if (!imageData || imageData.length !== 784) {
    throw new Error(`[IndexedDB] Expected 784 pixels, got ${imageData ? imageData.length : 0}`);
  }

  // Convert to plain array for IndexedDB storage (Float32Array serialization can be lossy)
  const pixelArray = Array.from(imageData);

  const id = await db.drawings.add({
    imageData: pixelArray,
    label,
    timestamp: new Date().toISOString()
  });

  console.log(`[IndexedDB] Saved drawing #${id} — label: ${label}`);
  return id;
}

/**
 * Retrieves all stored drawings, sorted by newest first.
 * 
 * @returns {Promise<Array<{id: number, imageData: number[], label: number, timestamp: string}>>}
 */
export async function getAllDrawings() {
  const drawings = await db.drawings
    .orderBy('timestamp')
    .reverse()
    .toArray();

  console.log(`[IndexedDB] Retrieved ${drawings.length} drawings`);
  return drawings;
}

/**
 * Retrieves drawings filtered by label.
 * 
 * @param {number} label - Digit 0–9
 * @returns {Promise<Array>} Drawings matching the label
 */
export async function getDrawingsByLabel(label) {
  return db.drawings
    .where('label')
    .equals(label)
    .toArray();
}

/**
 * Returns the total number of stored drawings.
 * 
 * @returns {Promise<number>}
 */
export async function getDrawingCount() {
  const count = await db.drawings.count();
  return count;
}

/**
 * Returns a breakdown of drawing counts per label.
 * Useful for showing the user how balanced their local dataset is.
 * 
 * @returns {Promise<Object<string, number>>} Map of label → count
 */
export async function getDrawingCountsByLabel() {
  // BUG #9 FIX: Run all 10 digit-count queries in parallel instead of sequentially.
  // Sequential awaits caused up to 500ms blocking delay with large datasets.
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, digit) =>
      db.drawings.where('label').equals(digit).count().then(count => ({ digit, count }))
    )
  );
  return Object.fromEntries(results.map(({ digit, count }) => [digit, count]));
}

/**
 * Retrieves all drawings formatted for training (pixel arrays + labels).
 * This is the direct input for tensorflowService.trainLocalModel().
 * 
 * @returns {Promise<Array<{pixels: Float32Array, label: number}>>}
 */
export async function getTrainingData() {
  const drawings = await db.drawings.toArray();

  return drawings.map(d => ({
    pixels: new Float32Array(d.imageData),
    label: d.label
  }));
}

/**
 * Deletes a single drawing by ID.
 * 
 * @param {number} id - Drawing ID to delete
 * @returns {Promise<void>}
 */
export async function deleteDrawing(id) {
  await db.drawings.delete(id);
  console.log(`[IndexedDB] Deleted drawing #${id}`);
}

/**
 * Deletes ALL local drawings — full data wipe.
 * Supports GDPR "right to erasure" / user privacy controls.
 * 
 * @returns {Promise<void>}
 */
export async function clearAllDrawings() {
  const count = await db.drawings.count();
  await db.drawings.clear();
  console.log(`[IndexedDB] Cleared all ${count} drawings from local storage`);
}

/**
 * Returns the Dexie database instance for advanced queries.
 * Use sparingly — prefer the exported helper functions.
 */
export { db };
