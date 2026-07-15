# smart_gate_dashboards
# Smart Gate Delivery System - Web Dashboards
## Complete Setup, Firebase Configuration & GitHub Pages Deployment Guide

---
## What's In This Folder
```
smart_gate_dashboards/
├── index.html                < Role-selection landing page
├── firebase-config.js        < YOUR FIREBASE CREDENTIALS GO HERE
├── firebase-seed.js          < One-time DB seed (run once after Firebase setup)
├── firebase-rules.json       < Paste these into Firebase Console security rules
├── .nojekyll                 < Disables Jekyll on GitHub Pages (do not delete)
│
├── shared/
│   ├── style.css             < Full design system (colours, cards, badges, toasts)
│   ├── utils.js              < PIN generation, hashing, formatters, toast helper
│   └── auth.js               < Firebase anonymous auth + role credential verification
│
├── customer/
│   ├── customer.html         < Customer portal UI
│   └── customer.js           < Order placement, live tracking, history, notifications
│
├── admin/
│   ├── admin.html            < Admin dashboard UI
│   └── admin.js              < Orders queue, biker assignment, PIN generation, map
│
└── biker/
    ├── biker.html            < Biker portal UI
    └── biker.js              < Job alerts, navigation map, PIN display, GPS simulation
```

---
## Step 1 - Firebase Project Setup
(the firmware README covers it too):

1. Go to https://console.firebase.google.com > **Add project** > name it `smart-gate-delivery`
2. Disable Google Analytics > **Create project**
3. Go to **Build → Realtime Database** > **Create Database** > pick a region > **Start in test mode**

### Get Web App Credentials
1. **Project Settings** (gear icon) > **General** > scroll to **"Your apps"**
2. Click **Add app** > choose **Web (</>)**
3. Register the app (name it e.g. `SmartGate Web`)
4. Copy the `firebaseConfig` object 
---

## Step 2 - Configure `firebase-config.js`
Open `firebase-config.js` and replace every placeholder:
```js
const firebaseConfig = {
  apiKey: "AIzaSyCBSUVV6Yb-ZmfQgM7A29BuvhqI-TekIMY",
  authDomain: "smart-gate-delivery-system.firebaseapp.com",
  databaseURL: "https://smart-gate-delivery-system-default-rtdb.firebaseio.com",
  projectId: "smart-gate-delivery-system",
  storageBucket: "smart-gate-delivery-system.firebasestorage.app",
  messagingSenderId: "333705205778",
  appId: "1:333705205778:web:25af4f18a5e2e4b3d360cb"
};
```

**Where to find each value:**
- `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`
  > Firebase Console > Project Settings > General > Your apps > SDK setup > Config tab
- `databaseURL`
  > Firebase Console > Build > Realtime Database > Data tab > the URL at the top (ends in `.firebaseio.com`)
---

## Step 3 - Enable Anonymous Authentication
The dashboards sign into Firebase anonymously so they can read/write the RTDB.
1. Firebase Console > **Build > Authentication** > **Get started**
2. **Sign-in providers** tab > click **Anonymous** > **Enable** > **Save**
---

## Step 4 - Set Security Rules
1. Firebase Console > **Build > Realtime Database** > **Rules** tab
and paste,
```json
{
  "rules": {
    "orders": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bikers": {
      ".read": true,
      ".write": "auth != null"
    },
    "locker": {
      ".read": true,
      ".write": true
    },
    "deliveryLogs": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```
3. Click **Publish**

> **Prototype note:** The rules use `auth != null` which allows any anonymous session
> to read/write. This is intentional for the prototype. For production, add custom
> Firebase Auth tokens with role claims.

---
## Step 5 - Seed the Database
Run this **once** to populate the 5 bikers and initial locker state.
**Method A - Browser:**
1. Open `index.html` locally in your browser
2. Open DevTools (F12) > **Console**
3. Paste and run:
   ```js
   import('./firebase-seed.js')
   ```
4. Watch for `[SEED] 🎉 Database seed complete!` in the console

**Method B - Firebase Console (manual):**
1. Firebase Console > Realtime Database > **⋮ menu** > **Import JSON**
2. Create a file `seed.json` with this content and import it:
```json
{
  "bikers": {
    "biker001": { "bikerId":"biker001","name":"Tendai Moyo","phone":"+263771111111","status":"AVAILABLE","currentLat":-17.8292,"currentLon":31.0522,"assignedOrderId":null,"deliveryPin":null },
    "biker002": { "bikerId":"biker002","name":"Chipo Ndlovu","phone":"+263772222222","status":"AVAILABLE","currentLat":-17.8150,"currentLon":31.0410,"assignedOrderId":null,"deliveryPin":null },
    "biker003": { "bikerId":"biker003","name":"Farai Sibanda","phone":"+263773333333","status":"AVAILABLE","currentLat":-17.8380,"currentLon":31.0280,"assignedOrderId":null,"deliveryPin":null },
    "biker004": { "bikerId":"biker004","name":"Rudo Mhlanga","phone":"+263774444444","status":"AVAILABLE","currentLat":-17.8100,"currentLon":31.0600,"assignedOrderId":null,"deliveryPin":null },
    "biker005": { "bikerId":"biker005","name":"Humphrey T Masheleni","phone":"+263717990359","status":"AVAILABLE","currentLat":-17.8450,"currentLon":31.0350,"assignedOrderId":null,"deliveryPin":null }
  },
  "locker": { "status":"IDLE","lastUpdated":0,"breachAttempts":0,"weightGrams":0,"gpsLat":-17.8252,"gpsLon":31.0335 }
}
```

---

## Step 6 - Run Locally (Before Deploying)
Because the dashboards use ES Module `import` statements, we **cannot** just
open the HTML files by double-clicking them - browsers block local module imports.
We need a simple local server.

**Option A - VS Code Live Server:**
1. Install the **Live Server** extension in VS Code
2. Right-click `index.html` > **Open with Live Server**
3. Browser opens at `http://127.0.0.1:5500`

**Option B - Node.js:**
```bash
npx serve smart_gate_dashboards
# Opens at http://localhost:3000
```

---
## Step 7 - Deploy to GitHub Pages
### 7.1 Create the Repository
```bash
# In the smart_gate_dashboards folder:
git init
git add .
git commit -m "Initial SmartGate dashboard deployment"
```

### 7.2 Push to GitHub
1. Create a new repository on https://github.com (e.g. `smart-gate-dashboards`)
2. **Do NOT** tick "Add a README" - keep it empty
3. Then:
```bash
git remote add origin https://github.com/YOUR_USERNAME/smart-gate-dashboards.git
git branch -M main
git push -u origin main
```

### 7.3 Enable GitHub Pages
1. Your repo on GitHub > **Settings** > **Pages** (left sidebar)
2. Under **Source** > select branch **main** > folder **/ (root)** > **Save**
3. Wait ~2 minutes > GitHub gives you a URL:
   ```
   https://YOUR_USERNAME.github.io/smart-gate-dashboards/
   ```

### 7.4 Add Your GitHub Pages URL to Firebase Auth
Firebase rejects requests from unknown domains. Add your GitHub Pages domain:

1. Firebase Console > **Authentication** > **Settings** tab
2. **Authorized domains** > **Add domain**
3. Add: `YOUR_USERNAME.github.io` eg(tawanda2020-wq.github.io)

### 7.5 Three Live Dashboard URLs
| Dashboard    | URL                                                                            |
|--------------|--------------------------------------------------------------------------------|
| Landing page | `https://YOUR_USERNAME.github.io/smart-gate-dashboards/`                       |
| Customer     | `https://YOUR_USERNAME.github.io/smart-gate-dashboards/customer/customer.html` |
| Admin        | `https://YOUR_USERNAME.github.io/smart-gate-dashboards/admin/admin.html`       |
| Biker        | `https://YOUR_USERNAME.github.io/smart-gate-dashboards/biker/biker.html`       |

---

## Step 8 - Connect the ESP32 to the Same Firebase Project
In the firmware's `config.h`, the values must match your Firebase project:

```cpp
#define FIREBASE_HOST   "smart-gate-delivery-system-default-rtdb.firebaseio.com"
#define FIREBASE_AUTH  "3214hMhlmhm6cFxtjFcOWjasms3fxwZ1Ay2pXNSl"   // legacy secret (NOT the API key)
```

**Where to find the legacy database secret:**
- Firebase Console > Project Settings > **Service accounts** tab
- **Database secrets** section > **Show** > copy the string

> This is a separate credential from the web API key. The ESP32 uses it to
> bypass auth rules and write directly to the RTDB (simulating a trusted server).

---
## Step 9 - Demo Login Credentials
| Dashboard | Username / ID | Password   |
| --------- | ------------- | ---------- |
| Admin     | `admin`       | `admin123` |
| Biker 1   | `biker001`    | `biker123` |
| Biker 2   | `biker002`    | `biker123` |
| Biker 3   | `biker003`    | `biker123` |
| Biker 4   | `biker004`    | `biker123` |
| Biker 5   | `biker005`    | `biker123` |
| Customer  | Any phone number | Any password |

---

## Step 10 - Full End-to-End Test Walkthrough
Open three browser tabs (or three different browsers/devices):

### Tab 1 - Customer Portal

1. Customer enters phone number twice (validation, no password)
   Phone # saved to sessionStorage - survives refresh
   Box ID is hardcoded (since we have 1 box) and shown to customer
   Tracking page auto-loads their latest order by phone # from Firebase

2. Add items to cart, fill address, click the map to drop a location pin
3. Click **Place Order**
4. Switch to **Track Delivery** - status shows `PENDING`

### Tab 2 - Admin Dashboard
1. Sign in with `admin` / `admin123`
2. The new order appears in **Pending Orders** panel (and Overview)
3. Click **Assign Biker** on the order card
4. Select a biker from the dropdown - PINs are auto-generated and shown
5. Click **Generate PINs & Assign**
6. Both Biker and Customer dashboards update instantly (no refresh)

### Tab 3 - Biker Portal
1. Sign in as `biker001` / `biker123`
2. Full-screen job alert appears - click **✅ Accept Job**
3. Navigation map shows route to destination
4. Click **Confirm En Route** > Box PIN is revealed (tap "Show PIN" to see it)
5. Click **Confirm Arrived** > Admin and Customer dashboards update to `ARRIVED`
6. *(Now the ESP32 hardware takes over: biker enters PIN on outer keypad)*
7. Once locker sensor confirms delivery > click **Mark Delivered**

### Customer Tab
- Status timeline advances through each step in real time
- Once `DELIVERED`: retrieval PIN appears on the Track page
- Customer goes to gate, enters PIN on inner keypad
- Locker opens, parcel collected > status > `COLLECTED`

---
## Troubleshooting
| Issue| Cause | Fix |
|- --|---|---|
| `Cannot use import statement` in console | Opening HTML as a local file | Use Live Server / Python server (Step 6) |
| Firebase write permission denied | Auth rules too strict | Paste `firebase-rules.json` rules into Firebase Console and publish |
| Anonymous auth fails | Not enabled in Firebase | Enable Anonymous provider (Step 3) |
| Dashboards don't update in real-time | Wrong `databaseURL` in `firebase-config.js` | Check it ends in `.firebaseio.com`, not `.firebasedatabase.app` |
| Bikers not showing in admin dropdown | DB not seeded | Run the seed script (Step 5) |
| GitHub Pages shows 404 on sub-pages | Jekyll processing HTML | Confirm `.nojekyll` file is in the repo root |
| Map doesn't load | Ad-blocker blocking OpenStreetMap | Disable ad-blocker or use a different tile provider |
| PIN not showing on biker dashboard | Order status not yet `ENROUTE` | Click "Confirm En Route" first — PIN reveals after that action |

---
