// =============================================================================
// firebase-seed.js  - Smart Gate Delivery System
// One-time database seed: populates /bikers and /locker with initial data.
//
// HOW TO RUN:
//   Option A - Browser console:
//     1. Open any dashboard HTML file in your browser
//     2. Open DevTools > Console
//     3. Paste the contents of this file and press Enter

//   Option C - Firebase Console:
//     Go to Realtime Database > Import JSON > paste firebase-seed-data.json
//
// Run this ONCE b4 first use. Re-running is safe (it overwrites existing data).
// =============================================================================

// ── Seed Data ─────────────────────────────────────────────────────────────
const SEED_DATA = {
  // ── /bikers — 5 pre-registered delivery agents ──────────────────────────
  bikers: {
    biker001: {
      bikerId:         'biker001',
      name:            'Tendai Moyo',
      phone:           '+263771111111',
      status:          'AVAILABLE',
      currentLat:      -17.8292,
      currentLon:       31.0522,
      assignedOrderId: null,
      deliveryPin:     null,
      // passwordHash: SHA-256 of "biker123" - stored here in production
    },
    biker002: {
      bikerId:         'biker002',
      name:            'Chipo Ndlovu',
      phone:           '+263772222222',
      status:          'AVAILABLE',
      currentLat:      -17.8150,
      currentLon:       31.0410,
      assignedOrderId: null,
      deliveryPin:     null,
    },
    biker003: {
      bikerId:         'biker003',
      name:            'Farai Sibanda',
      phone:           '+263773333333',
      status:          'AVAILABLE',
      currentLat:      -17.8380,
      currentLon:       31.0280,
      assignedOrderId: null,
      deliveryPin:     null,
    },
    biker004: {
      bikerId:         'biker004',
      name:            'Rudo Mhlanga',
      phone:           '+263774444444',
      status:          'AVAILABLE',
      currentLat:      -17.8100,
      currentLon:       31.0600,
      assignedOrderId: null,
      deliveryPin:     null,
    },
    biker005: {
      bikerId:         'biker005',
      name:            'Humphrey T Masheleni',
      phone:           '+263717990359',
      status:          'AVAILABLE',
      currentLat:      -17.8450,
      currentLon:       31.0350,
      assignedOrderId: null,
      deliveryPin:     null,
    },
  },

  // ── /locker — initial hardware state ─────────────────────────────────────
  locker: {
    status:         'IDLE',
    lastUpdated:    0,
    breachAttempts: 0,
    weightGrams:    0,
    gpsLat:         -17.8252,   // Gate installation coordinates (can be updated to any gate location)
    gpsLon:          31.0335,
  },

  // ── /orders — empty on first boot (orders created by customers) ──────────
  // orders: {}   // NO seeding orders; Firebase creates this node on first push

  // ── /deliveryLogs — empty on first boot ──────────────────────────────────
  // deliveryLogs: {}
};

// ── Browser execution: call this function from the console ────────────────
async function seedDatabase() {
  // Dynamically import Firebase (works in browser modules context)
  const { db }  = await import('./firebase-config.js');
  const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');

  console.log('[SEED] Starting database seed...');

  try {
    // Write bikers
    await set(ref(db, 'bikers'), SEED_DATA.bikers);
    console.log('[SEED] ✅ /bikers written -', Object.keys(SEED_DATA.bikers).length, 'bikers');

    // Write locker initial state
    await set(ref(db, 'locker'), SEED_DATA.locker);
    console.log('[SEED] ✅ /locker written');

    console.log('[SEED] 🎉 Database seed complete!');
    console.log('[SEED] Biker login password for all bikers: biker123');
    console.log('[SEED] Admin login: admin / admin123');

  } catch (err) {
    console.error('[SEED] ❌ Seed failed:', err);
  }
}

// Auto-run if loaded as a <script type="module"> in the browser
//seedDatabase();

// NOT auto-run - call manually from browser console: seedDatabase()
// Or open seed.html 
window.seedDatabase = seedDatabase;
console.log('[SEED] Ready. Run seedDatabase() in console to seed the database.');