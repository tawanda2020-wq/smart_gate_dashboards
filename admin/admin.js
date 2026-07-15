// =============================================================================
// admin/admin.js - Smart Gate Delivery System
// Admin Dashboard: order queue, biker assignment, PIN generation, live map
// =============================================================================

import { db } from '../firebase-config.js';
import { ref, onValue, update, push, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  generatePin, hashPin, statusClass, statusLabel,
  formatTimestamp, calcTotal, formatPrice, showToast
} from '../shared/utils.js';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let allOrders  = {};
let allBikers  = {};
let adminMap   = null;
let bikerMarkers = {};
let pendingAssignOrderId = null;
let generatedBikerPin    = null;
let generatedCustomerPin = null;
let allAlerts  = [];

// ---------------------------------------------------------------------------
// Login (prototype: hardcoded credentials)
// ---------------------------------------------------------------------------
window.handleAdminLogin = function () {
  const user = document.getElementById('admin-user').value.trim();
  const pass = document.getElementById('admin-pass').value.trim();

  if (user === 'admin' && pass === 'admin123') {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    initAdmin();
    feather.replace();
  } else {
    showToast('Invalid credentials. Use admin / admin123', 'error');
  }
};

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------
function initAdmin() {
  listenOrders();
  listenBikers();
  listenLocker();
}

// ---------------------------------------------------------------------------
// Section navigation
// ---------------------------------------------------------------------------
window.showSection = function (name) {
  ['overview','orders','bikers','map','history','alerts'].forEach(s => {
    document.getElementById('section-' + s).classList.add('hidden');
  });
  document.getElementById('section-' + name).classList.remove('hidden');
  document.getElementById('section-title').textContent = {
    overview: 'Overview', orders: 'Pending Orders', bikers: 'Biker Roster',
    map: 'Live Map', history: 'Delivery History', alerts: 'Security Alerts'
  }[name];

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  event.currentTarget.classList.add('active');

  if (name === 'map' && !adminMap) initAdminMap();
};

// ---------------------------------------------------------------------------
// Firebase listeners
// ---------------------------------------------------------------------------
function listenOrders() {
  onValue(ref(db, 'orders'), snap => {
    allOrders = snap.val() || {};
    renderOverview();
    renderPendingOrders();
    renderHistory();
  });
}

function listenBikers() {
  onValue(ref(db, 'bikers'), snap => {
    allBikers = snap.val() || {};
    renderBikersTable();
    updateBikerMapMarkers();

    // Update available biker count stat
    const available = Object.values(allBikers).filter(b => b.status === 'AVAILABLE').length;
    document.getElementById('stat-bikers').textContent = available;
  });
}

function listenLocker() {
  onValue(ref(db, 'locker'), snap => {
    const locker = snap.val() || {};
    document.getElementById('locker-pill').textContent        = 'Locker: ' + (locker.status || 'IDLE');
    document.getElementById('locker-weight-pill').textContent = 'Weight: ' + Math.round(locker.weightGrams || 0) + 'g';

    if (locker.breachAttempts > 0) {
      document.getElementById('breach-badge').classList.remove('hidden');
      addAlert(`🚨 ${locker.breachAttempts} failed PIN attempt(s) on the locker.`);
    }
  });

  // Listen to per-order breach logs
  onValue(ref(db, 'deliveryLogs'), snap => {
    const logs = snap.val() || {};
    Object.entries(logs).forEach(([orderId, events]) => {
      Object.entries(events).forEach(([key, event]) => {
        if (key.startsWith('breach_')) {
          addAlert(`🚨 Breach on ${event.side} side — Order #${orderId?.slice(-6)} at ${formatTimestamp(event.timestamp)}`);
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function renderOverview() {
  const orders = Object.values(allOrders);
  const pending   = orders.filter(o => o.status === 'PENDING').length;
  const active    = orders.filter(o => ['ASSIGNED','ENROUTE','ARRIVED','DELIVERED'].includes(o.status)).length;
  const today     = orders.filter(o => o.status === 'DELIVERED' || o.status === 'COLLECTED').length;

  document.getElementById('stat-pending').textContent   = pending;
  document.getElementById('stat-active').textContent    = active;
  document.getElementById('stat-delivered').textContent = today;

  const badge = document.getElementById('pending-count-badge');
  if (pending > 0) { badge.textContent = pending; badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); }

  // Overview pending list
  const pendingList = document.getElementById('overview-pending-list');
  const pendingOrders = Object.entries(allOrders).filter(([,o]) => o.status === 'PENDING');
  pendingList.innerHTML = pendingOrders.length
    ? pendingOrders.slice(0,4).map(([id,o]) => `
        <div class="flex items-center gap-2" style="padding:10px 0;border-bottom:1px solid var(--gray-100)">
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${o.customerName}</div>
            <div class="text-sm text-muted">${(o.items||[]).map(i=>i.name).join(', ')}</div>
          </div>
          <button class="btn btn-sm btn-teal" onclick="openAssignModal('${id}')">Assign</button>
        </div>
      `).join('')
    : '<p class="text-muted text-sm">No pending orders.</p>';

  // Recent activity
  const activity = document.getElementById('overview-activity');
  const recent = Object.entries(allOrders)
    .filter(([,o]) => o.status !== 'PENDING')
    .sort(([,a],[,b]) => (b.deliveredAt||b.timestamp) - (a.deliveredAt||a.timestamp))
    .slice(0,5);
  activity.innerHTML = recent.length
    ? recent.map(([id,o]) => `
        <div class="flex items-center gap-2" style="padding:10px 0;border-bottom:1px solid var(--gray-100)">
          <span class="badge ${statusClass(o.status)}">${statusLabel(o.status)}</span>
          <div style="flex:1;font-size:13px">${o.customerName} — #${id.slice(-6)}</div>
        </div>
      `).join('')
    : '<p class="text-muted text-sm">No activity yet.</p>';
}

// ---------------------------------------------------------------------------
// Pending Orders Panel
// ---------------------------------------------------------------------------
function renderPendingOrders() {
  const pending = Object.entries(allOrders).filter(([,o]) => o.status === 'PENDING');
  const container = document.getElementById('orders-list');

  if (!pending.length) {
    container.innerHTML = '<p class="text-muted">No pending orders.</p>';
    return;
  }

  container.innerHTML = pending.map(([id, o]) => `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <div>
          <span style="font-weight:700;font-size:15px">${o.customerName}</span>
          <span class="badge badge-amber" style="margin-left:10px">PENDING</span>
          <div class="text-sm text-muted mt-1">Order #${id.slice(-6)} · ${formatTimestamp(o.timestamp)}</div>
        </div>
        <button class="btn btn-teal" onclick="openAssignModal('${id}')">
          <i data-feather="user-check"></i> Assign Biker
        </button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:4px">
        <div>
          <p class="text-sm text-muted">Items</p>
          <p style="font-size:13px">${(o.items||[]).map(i=>`${i.name} ×${i.qty}`).join('<br>')}</p>
          <p style="color:var(--teal);font-weight:700;margin-top:4px">${formatPrice(calcTotal(o.items||[]))}</p>
        </div>
        <div>
          <p class="text-sm text-muted">Delivery Address</p>
          <p style="font-size:13px">${o.deliveryAddress}</p>
          <p class="text-sm text-muted mt-1">📞 ${o.customerPhone}</p>
        </div>
        <div>
          <p class="text-sm text-muted">GPS Coordinates</p>
          <p style="font-size:13px;font-family:monospace">${o.gpsLat}, ${o.gpsLon}</p>
          ${o.deliveryNotes ? `<p class="text-sm text-muted mt-1">📝 ${o.deliveryNotes}</p>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  feather.replace();
}

// ---------------------------------------------------------------------------
// Assign Modal
// ---------------------------------------------------------------------------
window.openAssignModal = function (orderId) {
  pendingAssignOrderId = orderId;
  const order = allOrders[orderId];
  document.getElementById('assign-order-summary').textContent =
    `Assigning: ${order.customerName} — ${(order.items||[]).map(i=>i.name).join(', ')}`;

  // Populate available bikers
  const select = document.getElementById('biker-select');
  const available = Object.entries(allBikers).filter(([,b]) => b.status === 'AVAILABLE');
  select.innerHTML = '<option value="">— Choose available biker —</option>' +
    available.map(([id,b]) => `<option value="${id}">${b.name} (${b.phone})</option>`).join('');

  select.onchange = () => {
    if (select.value) {
      // Pre-generate PINs so admin can see them before confirming
      generatedBikerPin    = generatePin(4);
      generatedCustomerPin = generatePin(4);
      document.getElementById('preview-biker-pin').textContent    = generatedBikerPin;
      document.getElementById('preview-customer-pin').textContent = generatedCustomerPin;
      document.getElementById('assign-pin-preview').classList.remove('hidden');
      document.getElementById('confirm-assign-btn').disabled = false;
    } else {
      document.getElementById('assign-pin-preview').classList.add('hidden');
      document.getElementById('confirm-assign-btn').disabled = true;
    }
  };

  document.getElementById('assign-modal').classList.remove('hidden');
};

window.closeAssignModal = function () {
  document.getElementById('assign-modal').classList.add('hidden');
  pendingAssignOrderId = null;
  generatedBikerPin    = null;
  generatedCustomerPin = null;
};

window.confirmAssign = async function () {
  const bikerId = document.getElementById('biker-select').value;
  if (!bikerId || !pendingAssignOrderId) return;

  const btn = document.getElementById('confirm-assign-btn');
  btn.disabled = true;
  btn.textContent = 'Assigning...';

  try {
    const bikerPin    = generatedBikerPin;
    const customerPin = generatedCustomerPin;

    // Hash both PINs for secure storage in Firebase
    const hashedBiker    = await hashPin(bikerPin);
    const hashedCustomer = await hashPin(customerPin);
    const biker          = allBikers[bikerId];

    // Update order
    await update(ref(db, `orders/${pendingAssignOrderId}`), {
      status:           'ASSIGNED',
      assignedBikerId:  bikerId,
      boxPassword:      hashedBiker,        // hashed - ESP32 hashes keypad input to compare
      customerPin:      hashedCustomer,     // hashed
      bikerPinPlain:    bikerPin,           // plain - ESP32 reads this to display on biker LCD
      customerPinPlain: customerPin,        // plain - shown on customer dashboard
    });

    // Update biker status
    await update(ref(db, `bikers/${bikerId}`), {
      status:          'ENROUTE',
      assignedOrderId: pendingAssignOrderId,
      deliveryPin:     bikerPin,            // shown on biker dashboard
    });

    // Write to delivery log
    await set(ref(db, `deliveryLogs/${pendingAssignOrderId}`), {
      orderId:    pendingAssignOrderId,
      bikerId,
      bikerName:  biker.name,
      assignedAt: Math.floor(Date.now() / 1000),
    });

    showToast(`✅ Assigned to ${biker.name}. PINs generated and pushed.`, 'success');
    addAlert(`📋 Order #${pendingAssignOrderId.slice(-6)} assigned to ${biker.name}.`);
    closeAssignModal();

  } catch (err) {
    console.error('Assign error:', err);
    showToast('Assignment failed. Check your connection.', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Generate PINs & Assign';
};

// ---------------------------------------------------------------------------
// Bikers Table
// ---------------------------------------------------------------------------
function renderBikersTable() {
  const tbody = document.getElementById('bikers-tbody');
  const bikers = Object.values(allBikers);
  if (!bikers.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No bikers registered.</td></tr>';
    return;
  }
  tbody.innerHTML = bikers.map(b => `
    <tr>
      <td style="font-weight:600">${b.name}</td>
      <td>${b.phone}</td>
      <td><span class="badge ${b.status==='AVAILABLE'?'badge-green':b.status==='ENROUTE'?'badge-purple':'badge-amber'}">${b.status}</span></td>
      <td style="font-family:monospace;font-size:12px">${b.currentLat?.toFixed(4)}, ${b.currentLon?.toFixed(4)}</td>
      <td>${b.assignedOrderId ? '#'+b.assignedOrderId.slice(-6) : '—'}</td>
    </tr>
  `).join('');
}

// ---------------------------------------------------------------------------
// Admin Map
// ---------------------------------------------------------------------------
function initAdminMap() {
  adminMap = L.map('admin-map').setView([-17.8252, 31.0335], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(adminMap);
  updateBikerMapMarkers();
}

function updateBikerMapMarkers() {
  if (!adminMap) return;
  Object.entries(allBikers).forEach(([id, b]) => {
    if (!b.currentLat) return;
    if (bikerMarkers[id]) adminMap.removeLayer(bikerMarkers[id]);
    bikerMarkers[id] = L.marker([b.currentLat, b.currentLon], {
      icon: L.divIcon({ className:'', html: b.status==='AVAILABLE' ? '🟢🛵' : '🔴🛵', iconSize:[40,24] })
    }).addTo(adminMap).bindPopup(`<b>${b.name}</b><br>${b.status}<br>${b.phone}`);
  });

  // Show active delivery destination pins
  Object.entries(allOrders)
    .filter(([,o]) => ['ENROUTE','ARRIVED'].includes(o.status))
    .forEach(([id,o]) => {
      if (!o.gpsLat) return;
      L.marker([o.gpsLat, o.gpsLon], {
        icon: L.divIcon({ className:'', html:'📍', iconSize:[24,24] })
      }).addTo(adminMap)
        .bindPopup(`<b>${o.customerName}</b><br>#${id.slice(-6)}<br>${o.deliveryAddress}`);
    });
}

// ---------------------------------------------------------------------------
// History Table
// ---------------------------------------------------------------------------
let historyData = [];

function renderHistory() {
  historyData = Object.entries(allOrders)
    .filter(([,o]) => ['DELIVERED','COLLECTED'].includes(o.status))
    .sort(([,a],[,b]) => (b.deliveredAt||0) - (a.deliveredAt||0));
  renderHistoryRows(historyData);
}

function renderHistoryRows(rows) {
  const tbody = document.getElementById('history-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No completed deliveries yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(([id,o]) => `
    <tr>
      <td style="font-family:monospace;font-size:12px">#${id.slice(-6)}</td>
      <td>${o.customerName}<br><span class="text-sm text-muted">${o.customerPhone}</span></td>
      <td>${o.assignedBikerId ? (allBikers[o.assignedBikerId]?.name || o.assignedBikerId) : '—'}</td>
      <td><span class="badge ${statusClass(o.status)}">${statusLabel(o.status)}</span></td>
      <td>${formatTimestamp(o.timestamp)}</td>
      <td>${formatTimestamp(o.deliveredAt)}</td>
    </tr>
  `).join('');
}

window.filterHistory = function () {
  const q = document.getElementById('history-search').value.toLowerCase();
  const filtered = historyData.filter(([id,o]) =>
    o.customerName?.toLowerCase().includes(q) ||
    o.status?.toLowerCase().includes(q) ||
    id.toLowerCase().includes(q)
  );
  renderHistoryRows(filtered);
};

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
function addAlert(msg) {
  const time = new Date().toLocaleTimeString();
  const isNew = !allAlerts.some(a => a.msg === msg);
  if (!isNew) return;
  allAlerts.unshift({ msg, time });
  renderAlerts();
}

function renderAlerts() {
  const feed = document.getElementById('alerts-feed');
  if (!allAlerts.length) {
    feed.innerHTML = '<p class="text-muted text-sm">No alerts logged.</p>';
    return;
  }
  feed.innerHTML = allAlerts.map(a => `
    <div class="notif-item breach">
      <span class="notif-icon">🚨</span>
      <div>
        <div class="notif-text">${a.msg}</div>
        <div class="notif-time">${a.time}</div>
      </div>
    </div>
  `).join('');

  document.getElementById('breach-badge').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
window.logout = function () {
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
};
