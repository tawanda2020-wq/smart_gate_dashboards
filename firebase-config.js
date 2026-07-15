// =============================================================================
// firebase-config.js  -  Smart Gate Delivery System
// Firebase SDK v9+ initialisation - shared by all three dashboards
// =============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCBSUVV6Yb-ZmfQgM7A29BuvhqI-TekIMY",
  authDomain: "smart-gate-delivery-system.firebaseapp.com",
  databaseURL: "https://smart-gate-delivery-system-default-rtdb.firebaseio.com",
  projectId: "smart-gate-delivery-system",
  storageBucket: "smart-gate-delivery-system.firebasestorage.app",
  messagingSenderId: "333705205778",
  appId: "1:333705205778:web:25af4f18a5e2e4b3d360cb"
};

const app = initializeApp(firebaseConfig);

export const db   = getDatabase(app);
export const auth = getAuth(app);
