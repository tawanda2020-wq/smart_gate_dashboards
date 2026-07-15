// =============================================================================
// shared/utils.js  -  Smart Gate Delivery System
// Shared utility functions used across all three dashboards
// =============================================================================

// ---------------------------------------------------------------------------
// PIN Generation (Admin only - run client-side b4 writing to Firebase)
// ---------------------------------------------------------------------------

/** Generate a cryptographically random N-digit numeric PIN string. */
export function generatePin(length = 4) {
  const digits = new Uint8Array(length);
  crypto.getRandomValues(digits);
  return Array.from(digits).map(b => b % 10).join('');
}

/**
 * SHA-256 hash a plain-text PIN.
 * Firebase stores the hash; the ESP32 receives the plain PIN via a
 * separate protected field (bikerPinPlain / customerPinPlain) that is
 * deleted from Firebase once the ESP32 acknowledges receipt.
 */
export async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data     = encoder.encode(pin);
  const hashBuf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/** All valid delivery statuses in lifecycle order. */
export const STATUS_ORDER = [
  'PENDING', 'ASSIGNED', 'ENROUTE', 'ARRIVED', 'DELIVERED', 'COLLECTED'
];

/** Return a Tailwind-style colour class string for a given status. */
export function statusClass(status) {
  const map = {
    PENDING:   'badge-amber',
    ASSIGNED:  'badge-blue',
    ENROUTE:   'badge-purple',
    ARRIVED:   'badge-orange',
    DELIVERED: 'badge-teal',
    COLLECTED: 'badge-green',
    LOCKOUT:   'badge-red',
  };
  return map[status] || 'badge-gray';
}

/** Human-readable label for each status. */
export function statusLabel(status) {
  const map = {
    PENDING:   'Pending',
    ASSIGNED:  'Assigned',
    ENROUTE:   'En Route',
    ARRIVED:   'Arrived',
    DELIVERED: 'Delivered',
    COLLECTED: 'Collected',
    LOCKOUT:   'Locked Out',
  };
  return map[status] || status;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a Unix timestamp (seconds) to a readable date-time string. */
export function formatTimestamp(unixSec) {
  if (!unixSec) return '—';
  return new Date(unixSec * 1000).toLocaleString('en-ZW', {
    day:    '2-digit', month: 'short', year: 'numeric',
    hour:   '2-digit', minute: '2-digit'
  });
}

/** Format a price number to "$X.XX" */
export function formatPrice(amount) {
  return '$' + Number(amount || 0).toFixed(2);
}

/** Calculate order subtotal from items array [{qty, price}]. */
export function calcTotal(items = []) {
  return items.reduce((sum, i) => sum + (i.qty * i.price), 0);
}

// ---------------------------------------------------------------------------
// Toast notification system
// ---------------------------------------------------------------------------

/**
 * Show a slide-in toast in the top-right corner.
 * @param {string} message   - text to display
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} durationMs - auto-dismiss after this many ms (default 4000)
 */
export function showToast(message, type = 'info', durationMs = 4000) {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${toastIcon(type)}</span>
    <span class="toast-msg">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(toast);
  // Trigger slide-in
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}

function createToastContainer() {
  const el = document.createElement('div');
  el.id = 'toast-container';
  document.body.appendChild(el);
  return el;
}

function toastIcon(type) {
  return { info: 'ℹ️', success: '✅', warning: '⚠️', error: '🚨' }[type] || 'ℹ️';
}

// ---------------------------------------------------------------------------
// GPS / coordinate helpers
// ---------------------------------------------------------------------------

/** Return a Google Maps URL for a lat/lon pair. */
export function gmapsUrl(lat, lon) {
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

/** Haversine distance in km between two lat/lon pairs. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }
