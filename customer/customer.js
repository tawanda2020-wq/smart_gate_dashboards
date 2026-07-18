// =============================================================================
// customer/customer.js  - Smart Gate Delivery System
// Customer Dashboard: order placement, live tracking, history, notifications
// =============================================================================

import { db } from "../firebase-config.js";
import {
  ref,
  push,
  set,
  update,
  onValue,
  query,
  orderByChild,
  equalTo,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  generatePin,
  hashPin,
  statusClass,
  statusLabel,
  formatTimestamp,
  calcTotal,
  formatPrice,
  showToast,
} from "../shared/utils.js";

// ── Restore session on page refresh ─────────────────────────────────────────
(async function restoreSession() {
  const saved = sessionStorage.getItem("sg_customer_phone");
  if (!saved) return; // no saved session - show login

  try {
    const { signInAnonymously } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    const { auth } = await import("../firebase-config.js");
    await signInAnonymously(auth);
  } catch (e) {
    /* continue anyway */
  }

  currentCustomer = { phone: saved, name: saved };
  document.getElementById("customer-name-display").textContent = saved;
  document.getElementById("delivery-phone").value = saved;
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  initDashboard();
  feather.replace();
})();

// ---------------------------------------------------------------------------
// Product catalogue (static for prototype - extend or load from Firebase)
// ---------------------------------------------------------------------------
const PRODUCTS = [
  { id: "p1", name: "USB-C Cable 2m", price: 4.99, emoji: "🔌" },
  { id: "p2", name: "Wireless Mouse", price: 14.99, emoji: "🖱️" },
  { id: "p3", name: "Phone Stand", price: 6.5, emoji: "📱" },
  { id: "p4", name: "Screen Wipe Kit", price: 2.99, emoji: "🧹" },
  { id: "p5", name: "Notebook A5", price: 3.5, emoji: "📓" },
  { id: "p6", name: "HDMI Cable 1.5m", price: 7.99, emoji: "🔗" },
  { id: "p7", name: "Desk Lamp", price: 19.99, emoji: "💡" },
  { id: "p8", name: "Bluetooth Earbuds", price: 24.99, emoji: "🎧" },
];

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let cart = {}; // { productId: qty }
let selectedLat = null;
let selectedLon = null;
let orderMap = null;
let orderMapMarker = null;
let trackMap = null;
let trackMarker = null;
let bikerMarker = null;
let activeOrderId = null;
let clearedCollectedIds = new Set();
let notifications = [];
let currentCustomer = null;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
window.handleLogin = async function () {
  const phone1 = document.getElementById("login-phone").value.trim();
  const phone2 = document.getElementById("login-phone-confirm").value.trim();
  const errBox = document.getElementById("login-error");

  // Strip everything except digits for validation
  const digitsOnly = phone1.replace(/\D/g, "");

  // Clear previous errors
  errBox.classList.add("hidden");
  errBox.textContent = "";

  // Validate: must be 10 digits (local) or 12 digits (with 263 country code)
  if (digitsOnly.length < 10 || digitsOnly.length > 12) {
    errBox.textContent = "Please enter a valid 10-digit phone number.";
    errBox.classList.remove("hidden");
    return;
  }

  // Validate: no letters
  if (/[a-zA-Z]/.test(phone1)) {
    errBox.textContent = "Phone number must contain digits only.";
    errBox.classList.remove("hidden");
    return;
  }

  // Validate: both entries match
  if (phone1.replace(/\D/g, "") !== phone2.replace(/\D/g, "")) {
    errBox.textContent = "Phone numbers do not match. Please re-enter.";
    errBox.classList.remove("hidden");
    return;
  }

  // Ensure Firebase anonymous session
  try {
    const { signInAnonymously } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    const { auth } = await import("../firebase-config.js");
    await signInAnonymously(auth);
  } catch (authErr) {
    console.warn("[Auth] Anonymous sign-in failed:", authErr.message);
  }

  // Normalise to +263XXXXXXXXX format
  let normalised = phone1.startsWith("+")
    ? phone1
    : "+263" + digitsOnly.slice(-9);
  currentCustomer = { phone: normalised, name: normalised };

  // Persist to sessionStorage so page refresh doesn't log them out
  sessionStorage.setItem("sg_customer_phone", normalised);

  document.getElementById("customer-name-display").textContent = normalised;
  document.getElementById("delivery-phone").value = normalised;
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");

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
  ["order", "track", "history", "notifications"].forEach((s) => {
    document.getElementById("section-" + s).classList.add("hidden");
  });
  document.getElementById("section-" + name).classList.remove("hidden");
  document.getElementById("section-title").textContent = {
    order: "Place Order",
    track: "Track Delivery",
    history: "Order History",
    notifications: "Notifications",
  }[name];

  document
    .querySelectorAll(".nav-link")
    .forEach((l) => l.classList.remove("active"));
  // Don't rely on the implicit `event` global - only valid inside a real
  // click handler. Called programmatically (after an `await`), it's stale
  // or undefined and throws, which was firing the error toast right after
  // the success toast even though the order saved fine.
  const navLink = document.querySelector(`.nav-link[onclick*="showSection('${name}')"]`);
  if (navLink) navLink.classList.add("active");

  // Lazy-init track map
  if (name === "track" && !trackMap) initTrackMap();
  if (name === "notifications") {
    document.getElementById("notif-badge").classList.add("hidden");
  }
};

// ---------------------------------------------------------------------------
// Product catalogue rendering
// ---------------------------------------------------------------------------
function renderCatalogue() {
  const el = document.getElementById("catalogue");
  el.innerHTML = PRODUCTS.map(
    (p) => `
    <div class="card" style="padding:16px;margin-bottom:0;cursor:pointer;transition:box-shadow .2s"
         onclick="toggleCart('${p.id}')">
      <div style="font-size:32px;margin-bottom:8px">${p.emoji}</div>
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">${p.name}</div>
      <div style="color:var(--teal);font-weight:700">${formatPrice(p.price)}</div>
      <div id="cart-ctrl-${p.id}" style="margin-top:10px"></div>
    </div>
  `,
  ).join("");
}

window.toggleCart = function (pid) {
  const product = PRODUCTS.find((p) => p.id === pid);
  if (!product) return;
  if (!cart[pid]) {
    cart[pid] = 1;
  } else {
    cart[pid]++;
  }
  renderCartSummary();
};

function renderCartSummary() {
  const el = document.getElementById("cart-items");
  const items = Object.entries(cart).map(([pid, qty]) => {
    const p = PRODUCTS.find((x) => x.id === pid);
    return { ...p, qty };
  });

  if (!items.length) {
    el.innerHTML = '<p class="text-muted text-sm">Your cart is empty.</p>';
    document.getElementById("cart-total").textContent = "$0.00";
    return;
  }

  el.innerHTML = items
    .map(
      (i) => `
    <div class="flex items-center gap-2" style="margin-bottom:10px;justify-content:space-between">
      <span>${i.emoji} ${i.name}</span>
      <div class="flex items-center gap-2">
        <button class="btn btn-sm btn-outline" onclick="changeQty('${i.id}',-1)">−</button>
        <span style="font-weight:700;min-width:20px;text-align:center">${i.qty}</span>
        <button class="btn btn-sm btn-outline" onclick="changeQty('${i.id}',1)">+</button>
        <span style="color:var(--teal);font-weight:600">${formatPrice(i.price * i.qty)}</span>
      </div>
    </div>
  `,
    )
    .join("");

  document.getElementById("cart-total").textContent = formatPrice(
    calcTotal(items),
  );
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
  orderMap = L.map("order-map").setView([-17.8252, 31.0335], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(orderMap);

  orderMap.on("click", (e) => {
    selectedLat = parseFloat(e.latlng.lat.toFixed(6));
    selectedLon = parseFloat(e.latlng.lng.toFixed(6));
    document.getElementById("coords-display").textContent =
      `📍 Lat: ${selectedLat}, Lon: ${selectedLon}`;
    if (orderMapMarker) orderMap.removeLayer(orderMapMarker);
    orderMapMarker = L.marker([selectedLat, selectedLon])
      .addTo(orderMap)
      .bindPopup("Delivery location")
      .openPopup();
  });
}

// ---------------------------------------------------------------------------
// Submit Order
// ---------------------------------------------------------------------------
window.submitOrder = async function () {
  const address = document.getElementById("delivery-address").value.trim();
  const name = document.getElementById("delivery-name").value.trim();
  let phone = document.getElementById("delivery-phone").value.trim();
  // This field is pre-filled from the normalised login phone, but the
  // customer can still hand-edit it - re-normalise to +263XXXXXXXXX so the
  // GSM module always has a valid international number to SMS.
  if (phone && !phone.startsWith("+")) {
    const digitsOnly = phone.replace(/\D/g, "");
    phone = "+263" + digitsOnly.slice(-9);
  }
  const notes = document.getElementById("delivery-notes").value.trim();
  const items = Object.entries(cart).map(([pid, qty]) => {
    const p = PRODUCTS.find((x) => x.id === pid);
    return { name: p.name, qty, price: p.price };
  });

  if (!items.length) {
    showToast("Add at least one item", "warning");
    return;
  }
  if (!address) {
    showToast("Enter a delivery address", "warning");
    return;
  }
  if (!name) {
    showToast("Enter your name", "warning");
    return;
  }
  if (!phone) {
    showToast("Enter your phone number", "warning");
    return;
  }
  if (!selectedLat) {
    showToast("Click the map to set delivery location", "warning");
    return;
  }

  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  btn.textContent = "Placing order...";

  try {
    const orderRef = push(ref(db, "orders"));
    const orderId = orderRef.key;
    const timestamp = Math.floor(Date.now() / 1000);

    await set(orderRef, {
      orderId,
      boxId: "BOX-001",
      customerId: phone.replace(/\D/g, ""),
      customerName: name,
      customerPhone: phone,
      items,
      deliveryAddress: address,
      deliveryNotes: notes,
      gpsLat: selectedLat,
      gpsLon: selectedLon,
      status: "PENDING",
      assignedBikerId: null,
      boxPassword: null,
      customerPin: null,
      bikerPinPlain: null,
      customerPinPlain: null,
      timestamp,
      deliveredAt: null,
    });

    activeOrderId = orderId;
    showToast("Order placed! Waiting for admin assignment.", "success");
    addNotification("🛒 Order placed successfully!", orderId);

    // Reset cart
    cart = {};
    renderCartSummary();
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="send"></i> Place Order';
    feather.replace();

    // Switch to tracking view
    showSection("track");
  } catch (err) {
    console.error("Order submit error:", err);
    showToast("Failed to place order. Check your connection.", "error");
    btn.disabled = false;
    btn.textContent = "Place Order";
  }
};

// ---------------------------------------------------------------------------
// Track Map
// ---------------------------------------------------------------------------
function initTrackMap() {
  trackMap = L.map("track-map").setView([-17.8252, 31.0335], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(trackMap);
}

// ---------------------------------------------------------------------------
// Listen to orders in real-time
// ---------------------------------------------------------------------------
function listenToOrders() {
  onValue(ref(db, "orders"), (snapshot) => {
    const all = snapshot.val() || {};

    // Normalise phone for comparison (strip non-digits, compare last 9)
    const myLast9 = currentCustomer?.phone.replace(/\D/g, "").slice(-9);

    const myOrders = Object.entries(all).filter(([, o]) => {
      const orderLast9 = (o.customerPhone || "").replace(/\D/g, "").slice(-9);
      return orderLast9 === myLast9;
    });

    renderHistory(myOrders);
    
    // Find most recent order to show as "active". A COLLECTED order is
    // still allowed through ONCE so updateTrackingUI() can render its final
    // state and clean up after itself - excluding it immediately here was
    // freezing the page on whatever status was shown right before COLLECTED.
    const active = myOrders
      .filter(([id, o]) => !(o.status === "COLLECTED" && clearedCollectedIds.has(id)))
      .sort(([, a], [, b]) => b.timestamp - a.timestamp)[0];

    if (active) {
      const [id, order] = active;
      activeOrderId = id;
      updateTrackingUI(order);

      // Auto-show tracking section if there's an active delivery in progress
      if (
        ["ASSIGNED", "ENROUTE", "ARRIVED", "DELIVERED"].includes(order.status)
      ) {
        // Only auto-switch if user hasn't manually navigated elsewhere
        const trackSection = document.getElementById("section-track");
        if (trackSection && !trackSection.classList.contains("hidden")) return;
        // Quietly update the tracking data in background without forcing tab switch
      }
    }
  });
}

function updateTrackingUI(order) {
  document.getElementById("track-order-id").textContent =
    "Order #" + order.orderId?.slice(-6);
  const badge = document.getElementById("track-status-badge");
  badge.textContent = statusLabel(order.status);
  badge.className = "badge " + statusClass(order.status);

  renderTimeline(order.status);
  updateParcelReminderBanner(order);
  checkBreachAlert(order);

  // Show destination pin on track map
  if (trackMap && order.gpsLat && order.gpsLon) {
    if (trackMarker) trackMap.removeLayer(trackMarker);
    trackMarker = L.marker([order.gpsLat, order.gpsLon], {
      icon: L.divIcon({ className: "", html: "📍", iconSize: [24, 24] }),
    })
      .addTo(trackMap)
      .bindPopup("Your gate 🏠");
    trackMap.setView([order.gpsLat, order.gpsLon], 14);
  }

// Show customer retrieval PIN once DELIVERED
  if (order.status === "DELIVERED" && order.customerPinPlain) {
    const pinSection = document.getElementById("customer-pin-section");
    pinSection.classList.remove("hidden");
    document.getElementById("customer-pin-display").textContent =
      order.customerPinPlain.split("").join(" ");
    const btn = document.getElementById("btn-confirm-collection");
    btn.disabled = true;
    btn.textContent = "Enter PIN on keypad first";
    if (!notifications.some((n) => n.msg.includes("PIN"))) {
      addNotification(
        "🔑 Your retrieval PIN is ready. Check the Track page!",
        activeOrderId,
      );
      showToast(
        "Your parcel has arrived! Your retrieval PIN is ready.",
        "success",
        8000,
      );
    }
  } else if (order.status === "CUSTOMER_AUTH_OK") {
    // Box confirms the door is actually open - now it's safe to let the
    // customer trigger the close.
    document.getElementById("customer-pin-section").classList.remove("hidden");
    const btn = document.getElementById("btn-confirm-collection");
    btn.disabled = false;
    btn.textContent = "✅ Confirm Collection";
  } else if (order.status === "COLLECTION_REQUESTED") {
    const btn = document.getElementById("btn-confirm-collection");
    btn.disabled = true;
    btn.textContent = "Closing locker...";
  } else if (order.status === "COLLECTED") {
    // Delivery fully complete - clear the PIN and hide the section so the
    // page is ready for the next order.
    document.getElementById("customer-pin-section").classList.add("hidden");
    document.getElementById("customer-pin-display").textContent = "-";

    if (!clearedCollectedIds.has(order.orderId)) {
      showToast("🎉 Delivery complete! Enjoy your parcel.", "success", 5000);
      clearedCollectedIds.add(order.orderId);

      // Give the customer a moment to see "Package Collected", then reset
      // the whole Track Delivery card back to its placeholder state - ready
      // for the next order instead of freezing on this one.
      setTimeout(() => {
        if (activeOrderId !== order.orderId) return; // a newer order took over meanwhile
        document.getElementById("track-order-id").textContent = "Order #-";
        const badge = document.getElementById("track-status-badge");
        badge.textContent = "-";
        badge.className = "badge badge-gray";
        document.getElementById("status-timeline").innerHTML = "";
        activeOrderId = null;
      }, 4000);
    }
  }

  // Show biker position on map if ENROUTE/ARRIVED
  if (["ENROUTE", "ARRIVED"].includes(order.status) && order.assignedBikerId) {
    listenBikerPosition(order.assignedBikerId, order.gpsLat, order.gpsLon);
  }
}

// ---------------------------------------------------------------------------
// Confirm Collection - tells the box the customer has taken the parcel
// ---------------------------------------------------------------------------
window.confirmCollection = async function () {
  document.getElementById("btn-confirm-collection").disabled = true;
  // This does NOT finish the pickup itself - it tells the box to close the
  // door. The box pushes the real "COLLECTED" status once it has done so
  // (handled in the orders listener, same pattern as the biker's Mark
  // Delivered flow).
  await update(ref(db, `orders/${activeOrderId}`), {
    status: "COLLECTION_REQUESTED",
  });
  showToast("Confirming with locker...", "info", 4000);
};

// ---------------------------------------------------------------------------
// Parcel-in-locker reminder banner - replaces the GSM "your parcel is
// inside" SMS. Stays visible for as long as the box reports it present.
// ---------------------------------------------------------------------------
let orderReminderActive = false;

function updateParcelReminderBanner(order) {
  const banner = document.getElementById("parcel-reminder-banner");
  const text = document.getElementById("parcel-reminder-text");

  const awaitingCollection =
    ["DELIVERED", "CUSTOMER_AUTH_OK", "COLLECTION_REQUESTED"].includes(order.status) &&
    order.parcelPresent !== false;

  orderReminderActive = awaitingCollection;

  if (!awaitingCollection) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  if (order.parcelConfirmed === false) {
    text.textContent =
      "Your biker dropped off your parcel, but our sensor couldn't fully confirm it's inside - please verify when you collect.";
  } else {
    text.textContent =
      "📦 Your parcel is in the locker. Use your PIN to collect it whenever you're ready.";
  }
}

// Fallback reminder when there's no active order to attach it to (e.g. a
// previous delivery that was never collected). Only shows when the
// order-specific reminder above isn't already covering it.
function updateGlobalParcelReminder(present) {
  if (orderReminderActive) return; // order-specific reminder takes priority
  const banner = document.getElementById("parcel-reminder-banner");
  const text = document.getElementById("parcel-reminder-text");
  if (present) {
    banner.classList.remove("hidden");
    text.textContent =
      "📦 There may be a parcel in the locker from a previous delivery. Use the keypad (# open / * close) or check with support.";
  } else {
    banner.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Security alert - replaces the GSM breach-attempt SMS
// ---------------------------------------------------------------------------
function checkBreachAlert(order) {
  if (
    (order.breachAttempts || 0) > 0 &&
    !notifications.some((n) => n.msg.includes("Security alert"))
  ) {
    addNotification(
      "🚨 Security alert: 3 failed PIN attempts were detected on your locker. The system locked itself as a precaution.",
      activeOrderId,
      true,
    );
    showToast(
      "🚨 Security alert on your locker - check Notifications.",
      "error",
      8000,
    );
  }
}

// ---------------------------------------------------------------------------
// Virtual keypad - type the PIN here instead of using the physical keypad
// (useful while the ESP8266 customer-keypad bridge is unreliable).
// ---------------------------------------------------------------------------
window.submitWebPin = async function () {
  const input = document.getElementById("web-pin-input");
  const pin = input.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    showToast("Enter the 4-digit PIN", "warning");
    return;
  }
  await update(ref(db, `orders/${activeOrderId}`), { webPinEntry: pin });
  showToast("Sent to locker - opening...", "info", 4000);
  input.value = "";
};

function listenBikerPosition(bikerId, destLat, destLon) {
  onValue(ref(db, `bikers/${bikerId}`), (snap) => {
    const biker = snap.val();
    if (!biker || !trackMap) return;
    if (bikerMarker) trackMap.removeLayer(bikerMarker);
    bikerMarker = L.marker([biker.currentLat, biker.currentLon], {
      icon: L.divIcon({ className: "", html: "🛵", iconSize: [28, 28] }),
    })
      .addTo(trackMap)
      .bindPopup(`Biker: ${biker.name}`);
  });
}

// ---------------------------------------------------------------------------
// Status Timeline
// ---------------------------------------------------------------------------
const TIMELINE_STEPS = [
  { status: 'PENDING',            label: 'Order Placed',       icon: '🛒' },
  { status: 'PENDING_ACCEPTANCE', label: 'Finding Biker',      icon: '🔍' },
  { status: 'ASSIGNED',           label: 'Biker Confirmed',    icon: '👤' },
  { status: 'ENROUTE',            label: 'Biker En Route',     icon: '🛵' },
  { status: 'ARRIVED',            label: 'Arrived at Gate',    icon: '🏠' },
  { status: 'DELIVERED',          label: 'Package Delivered',  icon: '📦' },
  { status: 'COLLECTED',          label: 'Package Collected ✓',icon: '✅' },
];

function renderTimeline(currentStatus) {
  // If biker declined, show customer as still at PENDING (finding new biker)
  // CUSTOMER_AUTH_OK / COLLECTION_REQUESTED sit between DELIVERED and
  // COLLECTED - map them onto DELIVERED so the timeline doesn't blank out.
  const displayStatus =
    currentStatus === 'DECLINED' ? 'PENDING' :
    (currentStatus === 'CUSTOMER_AUTH_OK' || currentStatus === 'COLLECTION_REQUESTED') ? 'DELIVERED' :
    currentStatus;
  const idx = TIMELINE_STEPS.findIndex(s => s.status === displayStatus);
  document.getElementById("status-timeline").innerHTML = TIMELINE_STEPS.map(
    (s, i) => `
    <div class="timeline-step">
      <div class="timeline-dot ${i < idx ? "done" : i === idx ? "active" : ""}">
        ${i <= idx ? s.icon : "○"}
      </div>
      <div class="timeline-content">
        <div class="timeline-label" style="color:${i <= idx ? "var(--dark)" : "var(--gray-400)"}">
          ${s.label}
        </div>
      </div>
    </div>
  `,
  ).join("");
}

// ---------------------------------------------------------------------------
// Order History
// ---------------------------------------------------------------------------
function renderHistory(myOrders) {
  const tbody = document.getElementById("history-tbody");
  if (!myOrders.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="text-center text-muted">No orders yet.</td></tr>';
    return;
  }
  tbody.innerHTML = myOrders
    .sort(([, a], [, b]) => b.timestamp - a.timestamp)
    .map(
      ([id, o]) => `
      <tr>
        <td style="font-family:monospace;font-size:12px">#${id.slice(-6)}</td>
        <td>${(o.items || []).map((i) => `${i.name} ×${i.qty}`).join(", ")}</td>
        <td>${formatPrice(calcTotal(o.items || []))}</td>
        <td><span class="badge ${statusClass(o.status)}">${statusLabel(o.status)}</span></td>
        <td>${formatTimestamp(o.timestamp)}</td>
        <td>
          ${o.status !== "COLLECTED" ? `<button class="btn btn-sm btn-outline" onclick="viewOrder('${id}')">Track</button>` : '<span class="text-muted text-sm">-</span>'}
        </td>
      </tr>
    `,
    )
    .join("");
}

window.viewOrder = function (id) {
  activeOrderId = id;
  showSection("track");
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
function loadNotifications() {
  // Listen to locker breach events
  onValue(ref(db, "locker"), (snap) => {
    const locker = snap.val();
    if (!locker) return;
    document.getElementById("locker-status-pill").textContent =
      "Locker: " + (locker.status || "—");

    if (locker.breachAttempts > 0) {
      addNotification(
        `🚨 Security alert: ${locker.breachAttempts} failed PIN attempt(s) on locker.`,
        null,
        true,
      );
    }
  });
}

function addNotification(msg, orderId, isBreachAlert = false) {
  const notif = {
    msg,
    orderId,
    time: new Date().toLocaleTimeString(),
    breach: isBreachAlert,
  };
  notifications.unshift(notif);
  renderNotifications();

  // Show badge
  const badge = document.getElementById("notif-badge");
  badge.textContent = notifications.length;
  badge.classList.remove("hidden");
}

function renderNotifications() {
  const feed = document.getElementById("notif-feed");
  if (!notifications.length) {
    feed.innerHTML = '<p class="text-muted text-sm">No notifications yet.</p>';
    return;
  }
  feed.innerHTML = notifications
    .map(
      (n) => `
    <div class="notif-item ${n.breach ? "breach" : ""}">
      <span class="notif-icon">${n.breach ? "🚨" : "📬"}</span>
      <div>
        <div class="notif-text">${n.msg}</div>
        <div class="notif-time">${n.time}</div>
      </div>
    </div>
  `,
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Locker status pill
// ---------------------------------------------------------------------------
function listenToLockerStatus() {
  onValue(ref(db, "locker"), (snap) => {
    const locker = snap.val() || {};
    document.getElementById("locker-status-pill").textContent =
      "Locker: " + (locker.status || "IDLE");
    updateGlobalParcelReminder(locker.parcelPresent);
  });
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
window.logout = function () {
  sessionStorage.removeItem("sg_customer_phone");
  // Full reload, not just hiding the dashboard. Logging in a second time in
  // the same tab without reloading left old Firebase listeners and the
  // Leaflet map instance alive - the map re-init would throw, silently
  // aborting initDashboard() partway through and leaving the PREVIOUS
  // customer's listenToOrders() as the only one ever running. That's why a
  // second account in the same tab kept showing the first customer's data.
  location.reload();
};

