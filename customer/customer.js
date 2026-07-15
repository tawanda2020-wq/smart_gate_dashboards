// =============================================================================
// customer/customer.js  - Smart Gate Delivery System
// Customer Dashboard: order placement, live tracking, history, notifications
// =============================================================================

import { db } from '../firebase-config.js';
import {
  ref, push, set, onValue, query, orderByChild, equalTo
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  generatePin, hashPin, statusClass, statusLabel, formatTimestamp, calcTotal, formatPrice, showToast
} from '../shared/utils.js';

// ---------------------------------------------------------------------------
// Product catalogue (static for prototype - extend or load from Firebase)
// ---------------------------------------------------------------------------
const PRODUCTS = [
  { id: 'p1', name: 'USB-C Cable 2m',      price: 4.99,  emoji: '🔌' },
  { id: 'p2', name: 'Wireless Mouse',       price: 14.99, emoji: '🖱️'  },
  { id: 'p3', name: 'Phone Stand',          price: 6.50,  emoji: '📱' },
  { id: 'p4', name: 'Screen Wipe Kit',      price: 2.99,  emoji: '🧹' },
  { id: 'p5', name: 'Notebook A5',          price: 3.50,  emoji: '📓' },
  { id: 'p6', name: 'HDMI Cable 1.5m',     price: 7.99,  emoji: '🔗' },
  { id: 'p7', name: 'Desk Lamp',            price: 19.99, emoji: '💡' },
  { id: 'p8', name: 'Bluetooth Earbuds',   price: 24.99, emoji: '🎧' },
];

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let cart             = {};    // { productId: qty }
let selectedLat      = null;
let selectedLon      = null;
let orderMap         = null;
let orderMapMarker   = null;
let trackMap         = null;
let trackMarker      = null;
let bikerMarker      = null;
let activeOrderId    = null;
let notifications    = [];
let currentCustomer  = null;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
window.handleLogin = function () {
  const phone = document.getElementById('login-phone').value.trim();
  const name  = document.getElementById('delivery-name')?.value.trim() || 'Customer';

  if (!phone) { showToast('Please enter your phone number', 'warning'); return; }

  currentCustomer = { phone, name: name || phone };
  document.getElementById('customer-name-display').textContent = phone;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  // Pre-fill phone in order form
  document.getElementById('delivery-phone').value = phone;

  initDashboard();
  feather.replace();
};

// ---------------------------------------------------------------------------
// Initialise dashboard after login
// ---------------------------------------------------------------------------
function initDashboard() {
  renderCatalogue();
  initOrderMap();
  listenToLockerStatus();
  listenToOrders();
  loadNotifications();
}

// ---------------------------------------------------------------------------
// Section navigation
// ---------------------------------------------------------------------------
window.showSection = function (name) {
  ['order','track','history','notifications'].forEach(s => {
    document.getElementById('section-' + s).classList.add('hidden');
  });
  document.getElementById('section-' + name).classList.remove('hidden');
  document.getElementById('section-title').textContent = {
    order: 'Place Order', track: 'Track Delivery',
    history: 'Order History', notifications: 'Notifications'
  }[name];

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  event.currentTarget.classList.add('active');

  // Lazy-init track map
  if (name === 'track' && !trackMap) initTrackMap();
  if (name === 'notifications') {
    document.getElementById('notif-badge').classList.add('hidden');
  }
};

// ---------------------------------------------------------------------------
// Product catalogue rendering
// ---------------------------------------------------------------------------
function renderCatalogue() {
  const el = document.getElementById('catalogue');
  el.innerHTML = PRODUCTS.map(p => `
    <div class="card" style="padding:16px;margin-bottom:0;cursor:pointer;transition:box-shadow .2s"
         onclick="toggleCart('${p.id}')">
      <div style="font-size:32px;margin-bottom:8px">${p.emoji}</div>
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">${p.name}</div>
      <div style="color:var(--teal);font-weight:700">${formatPrice(p.price)}</div>
      <div id="cart-ctrl-${p.id}" style="margin-top:10px"></div>
    </div>
  `).join('');
}

window.toggleCart = function (pid) {
  const product = PRODUCTS.find(p => p.id === pid);
  if (!product) return;
  if (!cart[pid]) {
    cart[pid] = 1;
  } else {
    cart[pid]++;
  }
  renderCartSummary();
};

function renderCartSummary() {
  const el    = document.getElementById('cart-items');
  const items = Object.entries(cart).map(([pid, qty]) => {
    const p = PRODUCTS.find(x => x.id === pid);
    return { ...p, qty };
  });

  if (!items.length) {
    el.innerHTML = '<p class="text-muted text-sm">Your cart is empty.</p>';
    document.getElementById('cart-total').textContent = '$0.00';
    return;
  }

  el.innerHTML = items.map(i => `
    <div class="flex items-center gap-2" style="margin-bottom:10px;justify-content:space-between">
      <span>${i.emoji} ${i.name}</span>
      <div class="flex items-center gap-2">
        <button class="btn btn-sm btn-outline" onclick="changeQty('${i.id}',-1)">−</button>
        <span style="font-weight:700;min-width:20px;text-align:center">${i.qty}</span>
        <button class="btn btn-sm btn-outline" onclick="changeQty('${i.id}',1)">+</button>
        <span style="color:var(--teal);font-weight:600">${formatPrice(i.price * i.qty)}</span>
      </div>
    </div>
  `).join('');

  document.getElementById('cart-total').textContent = formatPrice(calcTotal(items));
}

window.changeQty = function (pid, delta) {
  if (!cart[pid]) return;
  cart[pid] += delta;
  if (cart[pid] <= 0) delete cart[pid];
  renderCartSummary();
};

// ---------------------------------------------------------------------------
// Order Map (for coordinate pinning)
// ---------------------------------------------------------------------------
function initOrderMap() {
  // Default centre: Harare, Zimbabwe
  orderMap = L.map('order-map').setView([-17.8252, 31.0335], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(orderMap);

  orderMap.on('click', e => {
    selectedLat = parseFloat(e.latlng.lat.toFixed(6));
    selectedLon = parseFloat(e.latlng.lng.toFixed(6));
    document.getElementById('coords-display').textContent =
      `📍 Lat: ${selectedLat}, Lon: ${selectedLon}`;
    if (orderMapMarker) orderMap.removeLayer(orderMapMarker);
    orderMapMarker = L.marker([selectedLat, selectedLon]).addTo(orderMap)
      .bindPopup('Delivery location').openPopup();
  });
}

// ---------------------------------------------------------------------------
// Submit Order
// ---------------------------------------------------------------------------
window.submitOrder = async function () {
  const address = document.getElementById('delivery-address').value.trim();
  const name    = document.getElementById('delivery-name').value.trim();
  const phone   = document.getElementById('delivery-phone').value.trim();
  const notes   = document.getElementById('delivery-notes').value.trim();
  const items   = Object.entries(cart).map(([pid, qty]) => {
    const p = PRODUCTS.find(x => x.id === pid);
    return { name: p.name, qty, price: p.price };
  });

  if (!items.length)  { showToast('Add at least one item', 'warning');  return; }
  if (!address)       { showToast('Enter a delivery address', 'warning'); return; }
  if (!name)          { showToast('Enter your name', 'warning'); return; }
  if (!phone)         { showToast('Enter your phone number', 'warning'); return; }
  if (!selectedLat)   { showToast('Click the map to set delivery location', 'warning'); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Placing order...';

  try {
    const orderRef  = push(ref(db, 'orders'));
    const orderId   = orderRef.key;
    const timestamp = Math.floor(Date.now() / 1000);

    await set(orderRef, {
      orderId,
      customerId:      phone.replace(/\D/g, ''),
      customerName:    name,
      customerPhone:   phone,
      items,
      deliveryAddress: address,
      deliveryNotes:   notes,
      gpsLat:          selectedLat,
      gpsLon:          selectedLon,
      status:          'PENDING',
      assignedBikerId: null,
      boxPassword:     null,
      customerPin:     null,
      bikerPinPlain:   null,
      customerPinPlain:null,
      timestamp,
      deliveredAt:     null,
    });

    activeOrderId = orderId;
    showToast('Order placed! Waiting for admin assignment.', 'success');
    addNotification('🛒 Order placed successfully!', orderId);

    // Reset cart
    cart = {};
    renderCartSummary();
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="send"></i> Place Order';
    feather.replace();

    // Switch to tracking view
    showSection('track');

  } catch (err) {
    console.error('Order submit error:', err);
    showToast('Failed to place order. Check your connection.', 'error');
    btn.disabled = false;
    btn.textContent = 'Place Order';
  }
};

// ---------------------------------------------------------------------------
// Track Map
// ---------------------------------------------------------------------------
function initTrackMap() {
  trackMap = L.map('track-map').setView([-17.8252, 31.0335], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(trackMap);
}

// ---------------------------------------------------------------------------
// Listen to orders in real-time
// ---------------------------------------------------------------------------
function listenToOrders() {
  onValue(ref(db, 'orders'), snapshot => {
    const all = snapshot.val() || {};
    const myOrders = Object.entries(all).filter(([, o]) =>
      o.customerPhone === currentCustomer?.phone
    );

    // Render history
    renderHistory(myOrders);

    // Find the most recent active order
    const active = myOrders
      .filter(([, o]) => o.status !== 'COLLECTED')
      .sort(([, a], [, b]) => b.timestamp - a.timestamp)[0];

    if (active) {
      const [id, order] = active;
      activeOrderId = id;
      updateTrackingUI(order);
    }
  });
}

function updateTrackingUI(order) {
  document.getElementById('track-order-id').textContent = 'Order #' + order.orderId?.slice(-6);
  const badge = document.getElementById('track-status-badge');
  badge.textContent = statusLabel(order.status);
  badge.className = 'badge ' + statusClass(order.status);

  renderTimeline(order.status);

  // Show destination pin on track map
  if (trackMap && order.gpsLat && order.gpsLon) {
    if (trackMarker) trackMap.removeLayer(trackMarker);
    trackMarker = L.marker([order.gpsLat, order.gpsLon],
      { icon: L.divIcon({ className:'', html:'📍', iconSize:[24,24] }) })
      .addTo(trackMap)
      .bindPopup('Your gate 🏠');
    trackMap.setView([order.gpsLat, order.gpsLon], 14);
  }

  // Show customer retrieval PIN once DELIVERED
  if (order.status === 'DELIVERED' && order.customerPinPlain) {
    const pinSection = document.getElementById('customer-pin-section');
    pinSection.classList.remove('hidden');
    document.getElementById('customer-pin-display').textContent =
      order.customerPinPlain.split('').join(' ');
    if (!notifications.some(n => n.msg.includes('PIN'))) {
      addNotification('🔑 Your retrieval PIN is ready. Check the Track page!', activeOrderId);
      showToast('Your parcel has arrived! Your retrieval PIN is ready.', 'success', 8000);
    }
  }

  // Show biker position on map if ENROUTE/ARRIVED
  if (['ENROUTE','ARRIVED'].includes(order.status) && order.assignedBikerId) {
    listenBikerPosition(order.assignedBikerId, order.gpsLat, order.gpsLon);
  }
}

function listenBikerPosition(bikerId, destLat, destLon) {
  onValue(ref(db, `bikers/${bikerId}`), snap => {
    const biker = snap.val();
    if (!biker || !trackMap) return;
    if (bikerMarker) trackMap.removeLayer(bikerMarker);
    bikerMarker = L.marker([biker.currentLat, biker.currentLon],
      { icon: L.divIcon({ className:'', html:'🛵', iconSize:[28,28] }) })
      .addTo(trackMap)
      .bindPopup(`Biker: ${biker.name}`);
  });
}

// ---------------------------------------------------------------------------
// Status Timeline
// ---------------------------------------------------------------------------
const TIMELINE_STEPS = [
  { status: 'PENDING',   label: 'Order Placed',         icon: '🛒' },
  { status: 'ASSIGNED',  label: 'Biker Assigned',        icon: '👤' },
  { status: 'ENROUTE',   label: 'Biker En Route',        icon: '🛵' },
  { status: 'ARRIVED',   label: 'Arrived at Gate',       icon: '🏠' },
  { status: 'DELIVERED', label: 'Package Delivered',     icon: '📦' },
  { status: 'COLLECTED', label: 'Package Collected ✓',   icon: '✅' },
];

function renderTimeline(currentStatus) {
  const idx = TIMELINE_STEPS.findIndex(s => s.status === currentStatus);
  document.getElementById('status-timeline').innerHTML = TIMELINE_STEPS.map((s, i) => `
    <div class="timeline-step">
      <div class="timeline-dot ${i < idx ? 'done' : i === idx ? 'active' : ''}">
        ${i <= idx ? s.icon : '○'}
      </div>
      <div class="timeline-content">
        <div class="timeline-label" style="color:${i<=idx?'var(--dark)':'var(--gray-400)'}">
          ${s.label}
        </div>
      </div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Order History
// ---------------------------------------------------------------------------
function renderHistory(myOrders) {
  const tbody = document.getElementById('history-tbody');
  if (!myOrders.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No orders yet.</td></tr>';
    return;
  }
  tbody.innerHTML = myOrders
    .sort(([,a],[,b]) => b.timestamp - a.timestamp)
    .map(([id, o]) => `
      <tr>
        <td style="font-family:monospace;font-size:12px">#${id.slice(-6)}</td>
        <td>${(o.items||[]).map(i=>`${i.name} ×${i.qty}`).join(', ')}</td>
        <td>${formatPrice(calcTotal(o.items||[]))}</td>
        <td><span class="badge ${statusClass(o.status)}">${statusLabel(o.status)}</span></td>
        <td>${formatTimestamp(o.timestamp)}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="viewOrder('${id}')">Track</button>
        </td>
      </tr>
    `).join('');
}

window.viewOrder = function(id) {
  activeOrderId = id;
  showSection('track');
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
function loadNotifications() {
  // Listen to locker breach events
  onValue(ref(db, 'locker'), snap => {
    const locker = snap.val();
    if (!locker) return;
    document.getElementById('locker-status-pill').textContent = 'Locker: ' + (locker.status || '—');

    if (locker.breachAttempts > 0) {
      addNotification(`🚨 Security alert: ${locker.breachAttempts} failed PIN attempt(s) on locker.`, null, true);
    }
  });
}

function addNotification(msg, orderId, isBreachAlert = false) {
  const notif = { msg, orderId, time: new Date().toLocaleTimeString(), breach: isBreachAlert };
  notifications.unshift(notif);
  renderNotifications();

  // Show badge
  const badge = document.getElementById('notif-badge');
  badge.textContent = notifications.length;
  badge.classList.remove('hidden');
}

function renderNotifications() {
  const feed = document.getElementById('notif-feed');
  if (!notifications.length) {
    feed.innerHTML = '<p class="text-muted text-sm">No notifications yet.</p>';
    return;
  }
  feed.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.breach ? 'breach' : ''}">
      <span class="notif-icon">${n.breach ? '🚨' : '📬'}</span>
      <div>
        <div class="notif-text">${n.msg}</div>
        <div class="notif-time">${n.time}</div>
      </div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Locker status pill
// ---------------------------------------------------------------------------
function listenToLockerStatus() {
  onValue(ref(db, 'locker/status'), snap => {
    const s = snap.val() || 'IDLE';
    document.getElementById('locker-status-pill').textContent = 'Locker: ' + s;
  });
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
window.logout = function () {
  currentCustomer = null;
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
};
