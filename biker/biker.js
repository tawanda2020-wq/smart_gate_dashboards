// =============================================================================
// biker/biker.js  -  Smart Gate Delivery System
// Biker Dashboard: job alerts, navigation, PIN display, status updates, GPS sim
// =============================================================================

import { db } from "../firebase-config.js";
import {
  ref,
  onValue,
  update,
  get,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  statusClass,
  statusLabel,
  formatTimestamp,
  calcTotal,
  formatPrice,
  showToast,
  distanceKm,
} from "../shared/utils.js";

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let currentBiker = null; // { bikerId, name, phone, ... }
let activeOrder = null; // current order object
let activeOrderId = null;
let bikerMap = null; // active delivery map
let allBikersMap = null; // "My Map" section map
let myMarker = null;
let destMarker = null;
let simulInterval = null; // GPS simulation interval
let pinVisible = false;
let allBikerMarkers = {};

// Harare area bounding box for simulated GPS movement
const SIM_BOUNDS = {
  latMin: -17.88,
  latMax: -17.77,
  lonMin: 30.99,
  lonMax: 31.08,
};

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
window.handleBikerLogin = async function () {
  const bikerId = document.getElementById("biker-id-input").value.trim();
  const pass = document.getElementById("biker-pass").value.trim();

  if (!bikerId) {
    showToast("Enter your Biker ID", "warning");
    return;
  }

  // Ensure anonymous Firebase session exists before any DB read
  try {
    const { signInAnonymously } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    const { auth } = await import("../firebase-config.js");
    await signInAnonymously(auth);
  } catch (authErr) {
    console.warn("[Auth] Anonymous sign-in failed:", authErr.message);
    // Continue anyway - rules are now public-read for /bikers
  }

  try {
    const snap = await get(ref(db, `bikers/${bikerId}`));

    if (!snap.exists()) {
      showToast("Biker ID not found in system.", "error");
      return;
    }

    if (pass !== "biker123") {
      showToast("Incorrect password.", "error");
      return;
    }

    currentBiker = { bikerId, ...snap.val() };
    document.getElementById("biker-name-sidebar").textContent =
      currentBiker.name;
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");

    feather.replace();
    initBikerDashboard();
  } catch (err) {
    console.error("[Login] Firebase read failed:", err.message);
    showToast("Login failed: " + err.message, "error");
  }
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function initBikerDashboard() {
  startGpsSimulation();
  listenForAssignment();
  listenAllBikers();
  loadTripHistory();
}

// ---------------------------------------------------------------------------
// Section navigation
// ---------------------------------------------------------------------------
window.showSection = function (name) {
  ["active", "map", "history"].forEach((s) => {
    document.getElementById("section-" + s).classList.add("hidden");
  });
  document.getElementById("section-" + name).classList.remove("hidden");
  document.getElementById("section-title").textContent = {
    active: "Active Delivery",
    map: "My Map",
    history: "Trip History",
  }[name];
  document
    .querySelectorAll(".nav-link")
    .forEach((l) => l.classList.remove("active"));
  event.currentTarget.classList.add("active");

  if (name === "map" && !allBikersMap) initAllBikersMap();
};

// ---------------------------------------------------------------------------
// GPS Simulation
// Moves the biker marker randomly within the bounding box every 10 seconds.
// In production, replace with navigator.geolocation.watchPosition().
// ---------------------------------------------------------------------------
function startGpsSimulation() {
  // Start at biker's stored position or random
  let lat =
    currentBiker.currentLat ||
    randomBetween(SIM_BOUNDS.latMin, SIM_BOUNDS.latMax);
  let lon =
    currentBiker.currentLon ||
    randomBetween(SIM_BOUNDS.lonMin, SIM_BOUNDS.lonMax);

  function nudge() {
    // Small random movement (≈100m per step)
    lat = clamp(
      lat + randomBetween(-0.001, 0.001),
      SIM_BOUNDS.latMin,
      SIM_BOUNDS.latMax,
    );
    lon = clamp(
      lon + randomBetween(-0.001, 0.001),
      SIM_BOUNDS.lonMin,
      SIM_BOUNDS.lonMax,
    );

    // If en-route, gradually drift toward destination
    if (activeOrder && ["ENROUTE", "ARRIVED"].includes(activeOrder.status)) {
      const dLat = (activeOrder.gpsLat - lat) * 0.08;
      const dLon = (activeOrder.gpsLon - lon) * 0.08;
      lat += dLat;
      lon += dLon;
    }

    // Push position to Firebase
    update(ref(db, `bikers/${currentBiker.bikerId}`), {
      currentLat: lat,
      currentLon: lon,
    });

    // Update map markers
    updateMyMarker(lat, lon);
  }

  nudge(); // immediate first update
  simulInterval = setInterval(nudge, 10000);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function updateMyMarker(lat, lon) {
  if (bikerMap && myMarker) {
    myMarker.setLatLng([lat, lon]);
  }
  if (allBikersMap && allBikerMarkers[currentBiker.bikerId]) {
    allBikerMarkers[currentBiker.bikerId].setLatLng([lat, lon]);
  }
}

// ---------------------------------------------------------------------------
// Listen for assignment from Firebase
// ---------------------------------------------------------------------------
function listenForAssignment() {
  onValue(ref(db, `bikers/${currentBiker.bikerId}`), async (snap) => {
    const bikerData = snap.val();
    if (!bikerData) return;

    // Sync local state
    currentBiker = { ...currentBiker, ...bikerData };

    const sidebarStatus = document.getElementById("biker-status-sidebar");
    sidebarStatus.textContent = bikerData.status;
    sidebarStatus.className =
      "badge " +
      (bikerData.status === "AVAILABLE" ? "badge-green" : "badge-purple");

    if (bikerData.assignedOrderId && bikerData.status !== "AVAILABLE") {
      // Load the order
      const orderSnap = await get(
        ref(db, `orders/${bikerData.assignedOrderId}`),
      );
      if (!orderSnap.exists()) return;
      const order = orderSnap.val();
      activeOrder = order;
      activeOrderId = bikerData.assignedOrderId;

      if (order.status === "PENDING_ACCEPTANCE") {
        // Show full-screen job alert - biker hasn't accepted yet
        showJobAlert(order, bikerData.assignedOrderId);
      } else {
        // Job already accepted - show active job UI
        showActiveJobUI(
          order,
          bikerData.assignedOrderId,
          bikerData.deliveryPin,
        );
      }
    }
  });

  // Also listen to the order itself for status changes (hardware locker updates)
  onValue(ref(db, "orders"), (snap) => {
    const orders = snap.val() || {};
    if (activeOrderId && orders[activeOrderId]) {
      const order = orders[activeOrderId];
      activeOrder = order;
      updateDeliveryStatusUI(order.status);
      if (order.status === "DELIVERED") {
        showToast("✅ Parcel confirmed delivered by locker!", "success", 8000);
        document.getElementById("btn-done").disabled = false;
      }
    }
    loadTripHistory();
  });
}

// ---------------------------------------------------------------------------
// Job Alert overlay
// ---------------------------------------------------------------------------
function showJobAlert(order, orderId) {
  // Biker sees: customer name, address, box ID only - NOT items, value or coordinates
  document.getElementById("job-alert-summary").textContent =
    `Deliver to: ${order.customerName} @ ${order.deliveryAddress}`;

  document.getElementById("job-alert-items").innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="flex items-center gap-2">
        <span style="font-size:18px">📦</span>
        <div>
          <p style="font-weight:600;font-size:13px">Box ID: ${order.boxId || "BOX-001"}</p>
          <p class="text-sm text-muted">Gate locker unit</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span style="font-size:18px">📞</span>
        <div>
          <p style="font-weight:600;font-size:13px">${order.customerPhone}</p>
          <p class="text-sm text-muted">Recipient contact</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span style="font-size:18px">📍</span>
        <div>
          <p style="font-weight:600;font-size:13px">${order.deliveryAddress}</p>
          <p class="text-sm text-muted">Delivery address</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span style="font-size:18px">🔖</span>
        <div>
          <p style="font-weight:600;font-size:13px;font-family:monospace">
            Ref: #${orderId?.slice(-6)}
          </p>
          <p class="text-sm text-muted">Order reference</p>
        </div>
      </div>
    </div>
  `;
  document.getElementById("job-alert").classList.remove("hidden");
}

window.acceptJob = async function () {
  document.getElementById('job-alert').classList.add('hidden');
  showToast('Job accepted! Navigate to delivery location.', 'success');

  // First set ASSIGNED so customer and admin see confirmation, then immediately ENROUTE
  await update(ref(db, `orders/${activeOrderId}`), { status: 'ASSIGNED' });
  await new Promise(r => setTimeout(r, 800));   // brief pause so dashboards register ASSIGNED
  await update(ref(db, `orders/${activeOrderId}`), { status: 'ENROUTE' });
  await update(ref(db, `bikers/${currentBiker.bikerId}`), { status: 'ENROUTE' });

  showActiveJobUI(activeOrder, activeOrderId, currentBiker.deliveryPin);
};

window.declineJob = async function () {
  document.getElementById('job-alert').classList.add('hidden');

  // Reset the order to DECLINED so admin can reassign to another biker
  await update(ref(db, `orders/${activeOrderId}`), {
    status:          'DECLINED',
    assignedBikerId: null,
    boxPassword:     null,
    customerPin:     null,
    bikerPinPlain:   null,
    customerPinPlain:null,
  });

  // Free up this biker
  await update(ref(db, `bikers/${currentBiker.bikerId}`), {
    status:          'AVAILABLE',
    assignedOrderId: null,
    deliveryPin:     null
  });

  activeOrder   = null;
  activeOrderId = null;
  showToast('Job declined. You are now available again.', 'info');
};

// ---------------------------------------------------------------------------
// Active Job UI
// ---------------------------------------------------------------------------
function showActiveJobUI(order, orderId, bikerPin) {
  document.getElementById("no-job-state").classList.add("hidden");
  document.getElementById("active-job-state").classList.remove("hidden");

  renderOrderDetails(order);
  updateDeliveryStatusUI(order.status);

  // Show PIN card once en-route
  if (["ENROUTE", "ARRIVED"].includes(order.status) && bikerPin) {
    const pinCard = document.getElementById("pin-card");
    pinCard.classList.remove("hidden");
    // Store PIN but don't show yet (toggle button reveals it)
    document.getElementById("biker-pin-display").dataset.pin = bikerPin;
    document.getElementById("biker-pin-display").textContent = "• • • •";
    pinVisible = false;
  }

  // Init delivery map
  if (!bikerMap) {
    bikerMap = L.map("biker-map").setView(
      [order.gpsLat || -17.8252, order.gpsLon || 31.0335],
      14,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(bikerMap);
  }

  // Destination marker
  if (order.gpsLat) {
    if (destMarker) bikerMap.removeLayer(destMarker);
    destMarker = L.marker([order.gpsLat, order.gpsLon], {
      icon: L.divIcon({ className: "", html: "📍", iconSize: [28, 28] }),
    })
      .addTo(bikerMap)
      .bindPopup(
        `📦 Deliver here<br>${order.customerName}<br>${order.deliveryAddress}`,
      )
      .openPopup();
    bikerMap.setView([order.gpsLat, order.gpsLon], 14);
  }

  // My position marker
  const lat = currentBiker.currentLat || -17.84;
  const lon = currentBiker.currentLon || 31.02;
  if (!myMarker) {
    myMarker = L.marker([lat, lon], {
      icon: L.divIcon({ className: "", html: "🛵", iconSize: [30, 30] }),
    })
      .addTo(bikerMap)
      .bindPopup("You are here");
  }

  document.getElementById("delivery-status-pill").textContent = statusLabel(
    order.status,
  );
  document.getElementById("delivery-status-pill").className =
    "badge " + statusClass(order.status);

  renderBikerTimeline(order.status);
}

function renderOrderDetails(order) {
  // Biker sees: customer name, phone, address only - NOT items, value or notes
  document.getElementById("active-order-details").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <p class="text-sm text-muted">Recipient</p>
        <p style="font-weight:600">${order.customerName}</p>
        <p class="text-sm">${order.customerPhone}</p>
      </div>
      <div>
        <p class="text-sm text-muted">Delivery Address</p>
        <p style="font-weight:600;font-size:13px">${order.deliveryAddress}</p>
      </div>
      <div>
        <p class="text-sm text-muted">Box ID</p>
        <p style="font-weight:600;font-family:monospace">${order.boxId || "BOX-001"}</p>
      </div>
      <div>
        <p class="text-sm text-muted">Order Reference</p>
        <p style="font-weight:600;font-family:monospace;font-size:12px">#${order.orderId?.slice(-6)}</p>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Status update buttons
// ---------------------------------------------------------------------------
function updateDeliveryStatusUI(status) {
  const enRouteBtn = document.getElementById("btn-enroute");
  const arrivedBtn = document.getElementById("btn-arrived");
  const doneBtn = document.getElementById("btn-done");
  const hint = document.getElementById("action-hint");

  // Reset all
  [enRouteBtn, arrivedBtn, doneBtn].forEach((b) => (b.disabled = true));

  if (status === "ASSIGNED") {
    enRouteBtn.disabled = false;
    hint.textContent = 'Tap "Confirm En Route" when you start riding.';
  } else if (status === "ENROUTE") {
    arrivedBtn.disabled = false;
    hint.textContent =
      'Navigate to the delivery address. Tap "Arrived" when you reach the gate.';
  } else if (status === "ARRIVED") {
    hint.textContent =
      "Enter the box PIN on the outer keypad. Place the parcel and close the door.";
  } else if (status === "DELIVERED") {
    doneBtn.disabled = false;
    hint.textContent =
      '✅ Parcel confirmed by locker sensor. Tap "Mark Delivered" to complete.';
  } else if (status === "COLLECTED") {
    hint.textContent =
      "🎉 Delivery complete! Customer has collected the parcel.";
  }

  renderBikerTimeline(status);
}

window.confirmEnRoute = async function () {
  document.getElementById("btn-enroute").disabled = true;
  await update(ref(db, `orders/${activeOrderId}`), { status: "ENROUTE" });
  // PIN card revealed on en-route confirmation
  document.getElementById("pin-card").classList.remove("hidden");
  showToast(
    "Status updated — En Route. Your box PIN is now visible.",
    "success",
  );
};

window.confirmArrived = async function () {
  document.getElementById("btn-arrived").disabled = true;
  await update(ref(db, `orders/${activeOrderId}`), { status: "ARRIVED" });
  showToast("Arrival confirmed! Enter the box PIN on the keypad.", "success");
};

window.confirmDeliveryDone = async function () {
  document.getElementById("btn-done").disabled = true;
  await update(ref(db, `orders/${activeOrderId}`), { status: "DELIVERED" });
  await update(ref(db, `bikers/${currentBiker.bikerId}`), {
    status: "AVAILABLE",
    assignedOrderId: null,
    deliveryPin: null,
  });
  showToast("🎉 Delivery marked complete!", "success", 6000);

  // Reset UI
  setTimeout(() => {
    document.getElementById("no-job-state").classList.remove("hidden");
    document.getElementById("active-job-state").classList.add("hidden");
    document.getElementById("pin-card").classList.add("hidden");
    document.getElementById("delivery-status-pill").textContent =
      "No active delivery";
    activeOrder = null;
    activeOrderId = null;
    if (myMarker) {
      bikerMap.removeLayer(myMarker);
      myMarker = null;
    }
    if (destMarker) {
      bikerMap.removeLayer(destMarker);
      destMarker = null;
    }
  }, 3000);
};

// ---------------------------------------------------------------------------
// PIN toggle
// ---------------------------------------------------------------------------
window.togglePinVisibility = function () {
  const display = document.getElementById("biker-pin-display");
  const btn = document.getElementById("pin-toggle-btn");
  pinVisible = !pinVisible;
  display.textContent = pinVisible
    ? display.dataset.pin.split("").join(" ")
    : "• • • •";
  btn.textContent = pinVisible ? "🙈 Hide PIN" : "👁 Show PIN";
};

// ---------------------------------------------------------------------------
// Biker Timeline
// ---------------------------------------------------------------------------
const BIKER_STEPS = [
  { status: "ASSIGNED", label: "Job Accepted", icon: "✅" },
  { status: "ENROUTE", label: "En Route", icon: "🛵" },
  { status: "ARRIVED", label: "Arrived at Gate", icon: "🏠" },
  { status: "DELIVERED", label: "Parcel Delivered", icon: "📦" },
];

function renderBikerTimeline(currentStatus) {
  const idx = BIKER_STEPS.findIndex((s) => s.status === currentStatus);
  document.getElementById("biker-timeline").innerHTML = BIKER_STEPS.map(
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
// All Bikers Map (My Map section)
// ---------------------------------------------------------------------------
function initAllBikersMap() {
  allBikersMap = L.map("all-bikers-map").setView([-17.8252, 31.0335], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(allBikersMap);
}

function listenAllBikers() {
  onValue(ref(db, "bikers"), (snap) => {
    const bikers = snap.val() || {};
    if (!allBikersMap) return;
    Object.entries(bikers).forEach(([id, b]) => {
      if (!b.currentLat) return;
      const isSelf = id === currentBiker.bikerId;
      const icon = L.divIcon({
        className: "",
        html: isSelf ? "🔵🛵" : "⚫🛵",
        iconSize: [40, 24],
      });
      if (allBikerMarkers[id]) {
        allBikerMarkers[id].setLatLng([b.currentLat, b.currentLon]);
      } else {
        allBikerMarkers[id] = L.marker([b.currentLat, b.currentLon], { icon })
          .addTo(allBikersMap)
          .bindPopup(
            `<b>${b.name}</b><br>${b.status}${isSelf ? " (You)" : ""}`,
          );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Trip History
// ---------------------------------------------------------------------------
function loadTripHistory() {
  onValue(ref(db, "orders"), (snap) => {
    const orders = snap.val() || {};
    const myTrips = Object.entries(orders)
      .filter(
        ([, o]) =>
          o.assignedBikerId === currentBiker.bikerId &&
          ["DELIVERED", "COLLECTED"].includes(o.status),
      )
      .sort(([, a], [, b]) => (b.deliveredAt || 0) - (a.deliveredAt || 0));

    const tbody = document.getElementById("trip-history-tbody");
    if (!myTrips.length) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted">No trips yet.</td></tr>';
      return;
    }
    tbody.innerHTML = myTrips
      .map(
        ([id, o]) => `
      <tr>
        <td style="font-family:monospace;font-size:12px">#${id.slice(-6)}</td>
        <td>${o.customerName}<br><span class="text-sm text-muted">${o.customerPhone}</span></td>
        <td style="font-size:12px">${o.deliveryAddress}</td>
        <td><span class="badge ${statusClass(o.status)}">${statusLabel(o.status)}</span></td>
        <td>${formatTimestamp(o.deliveredAt)}</td>
      </tr>
    `,
      )
      .join("");
  });
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
window.logout = function () {
  clearInterval(simulInterval);
  if (currentBiker) {
    update(ref(db, `bikers/${currentBiker.bikerId}`), { status: "AVAILABLE" });
  }
  document.getElementById("dashboard").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  currentBiker = null;
  activeOrder = null;
  activeOrderId = null;
};
