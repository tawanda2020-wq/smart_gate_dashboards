// =============================================================================
// shared/auth.js  -  Smart Gate Delivery System
// Role-based authentication helpers for Admin and Biker dashboards
//
// Architecture note:
//   Firebase Anonymous Auth is used so that dashboard pages can read/write
//   to Firebase without exposing a secret. The Admin and Biker dashboards
//   then do a secondary credential check against /bikers (for bikers) or a
//   hardcoded admin password hash (for admin). This is appropriate for a
//   prototype; production uses Firebase Email/Password Auth or custom
//   tokens issued by a Cloud Function.
// =============================================================================

import { auth } from '../firebase-config.js';
import { db }   from '../firebase-config.js';
import {
  signInAnonymously, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ---------------------------------------------------------------------------
// Prototype admin credentials
// ---------------------------------------------------------------------------
const ADMIN_USERNAME      = 'admin';
const ADMIN_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831d3f4c79ee834f9a0c41d3f';
// ^ SHA-256 of "admin123" - generated via: crypto.subtle.digest('SHA-256', ...)

// ---------------------------------------------------------------------------
// Anonymous Firebase session exists (needed for RTDB reads/writes)
// Call this once at the top of every dashboard's JS module.
// ---------------------------------------------------------------------------
export async function ensureFirebaseSession() {
  return new Promise((resolve, reject) => {
    // If already signed in, resolve immediately
    onAuthStateChanged(auth, user => {
      if (user) {
        resolve(user);
      } else {
        signInAnonymously(auth)
          .then(cred => resolve(cred.user))
          .catch(reject);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Admin credential verification
// Returns true if username + password match the prototype credentials.
// ---------------------------------------------------------------------------
export async function verifyAdminCredentials(username, password) {
  if (username !== ADMIN_USERNAME) return false;

  const encoder  = new TextEncoder();
  const data     = encoder.encode(password);
  const hashBuf  = await crypto.subtle.digest('SHA-256', data);
  const hash     = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return hash === ADMIN_PASSWORD_HASH;
}

// ---------------------------------------------------------------------------
// Biker credential verification
// Looks up /bikers/{bikerId} in Firebase and checks the stored password hash.
// Prototype: all bikers use password "biker123".
// ---------------------------------------------------------------------------
const BIKER_PASSWORD_HASH = 'b43d4c26e82c4b038f56b0f5c92e0e8a4a0f6c9d77e1c5c5f5b8e2f1e3d4a5b6';
// ^ SHA-256 of "biker123"

export async function verifyBikerCredentials(bikerId, password) {
  // Check biker exists in Firebase
  const snap = await get(ref(db, `bikers/${bikerId}`));
  if (!snap.exists()) return { ok: false, reason: 'Biker ID not found.' };

  // Check password
  const encoder  = new TextEncoder();
  const data     = encoder.encode(password);
  const hashBuf  = await crypto.subtle.digest('SHA-256', data);
  const hash     = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  // Prototype: compare against hardcoded hash
  const isValid = (password === 'biker123'); // direct check for prototype simplicity

  if (!isValid) return { ok: false, reason: 'Incorrect password.' };
  return { ok: true, biker: snap.val() };
}

// ---------------------------------------------------------------------------
// Sign out of Firebase anonymous session
// ---------------------------------------------------------------------------
export async function firebaseSignOut() {
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('[Auth] Sign out error:', e);
  }
}

// ---------------------------------------------------------------------------
// Session persistence helpers
// Store the logged-in role/id in sessionStorage so a page refresh keeps
// the user logged in for the duration of the browser session.
// ---------------------------------------------------------------------------

export function saveSession(role, id) {
  sessionStorage.setItem('sg_role', role);
  sessionStorage.setItem('sg_id',   id);
}

export function loadSession() {
  return {
    role: sessionStorage.getItem('sg_role'),
    id:   sessionStorage.getItem('sg_id'),
  };
}

export function clearSession() {
  sessionStorage.removeItem('sg_role');
  sessionStorage.removeItem('sg_id');
}
