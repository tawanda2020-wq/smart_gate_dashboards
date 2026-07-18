# SmartGate Delivery System — Final Demo Flow

A straight-line walkthrough of one full delivery, start to finish, with what
happens on each screen/LCD at every step. Follow the arrows top to bottom.

---

## Actors

- **Customer** — customer web dashboard
- **Biker** — biker web dashboard + physical keypad/LCD on the box
- **Admin** — admin web dashboard
- **Box (ESP32)** — biker-side LCD/keypad/servo, customer-side LCD/keypad/servo, IR sensor

---

## The Flow

```
STEP 1 — Customer places an order
  Customer dashboard → Place Order → fill in items + address → Submit
  ↳ orders/{id}.status = "PENDING"
  ↳ Customer sees: "Order placed! Waiting for admin assignment."
        │
        ▼
STEP 2 — Admin assigns a biker
  Admin dashboard → Pending Orders → Assign Biker
  ↳ PINs auto-generated (biker PIN + customer PIN)
  ↳ orders/{id}.status = "ASSIGNED"
  ↳ Admin sees: "Assigned to [Biker]. PINs generated and pushed."
        │
        ▼
STEP 3 — Biker accepts and heads out
  Biker dashboard → Confirm En Route
  ↳ orders/{id}.status = "ENROUTE"
  ↳ Customer sees: "🛵 Biker En Route"
  ↳ Box: still idle — does NOT prompt for PIN yet
        │
        ▼
STEP 4 — Biker arrives at the gate
  Biker dashboard → Confirm Arrived
  ↳ orders/{id}.status = "ARRIVED"
  ↳ Box picks this up on its next poll → prompts "Enter PIN"
  ↳ Biker LCD: "Enter PIN:"
  ↳ Customer sees: "🏠 Arrived at Gate"
        │
        ▼
STEP 5 — Biker enters PIN, door opens
  Biker types the 4-digit PIN on the physical keypad
  ↳ Correct → servo opens biker door
  ↳ orders/{id}.status = "BIKER_AUTH_OK"
  ↳ Biker dashboard: "Mark Delivered" button becomes active
  ↳ Wrong (×3) → security alert logged, box locks out 10s, LCD: "Check dashboard"
        │
        ▼
STEP 6 — Biker places the parcel, confirms drop-off
  Biker taps "Mark Delivered" on dashboard
      OR presses # / * on the keypad
      OR does nothing for 30s → box auto-closes and assumes delivered
        (one-shot — no retry; contact admin if this was a mistake)
  ↳ orders/{id}.status = "MARK_DELIVERED_REQUESTED"
  ↳ Box closes the door and samples the IR sensor for a flat 5 seconds
        │
        ▼
STEP 7 — Box confirms delivery
  ↳ orders/{id}.status = "DELIVERED"
  ↳ orders/{id}.parcelConfirmed = true/false (from the 5s IR check)
  ↳ Biker dashboard: "✅ Delivery confirmed by the locker!" → biker freed for next job
  ↳ Biker LCD: "Delivery done! / Locker locked." → clears to "System ready" after 4s
  ↳ Customer dashboard: retrieval PIN appears + 📦 reminder banner:
       "Your parcel is in the locker. Use your PIN to collect it."
       (or, if IR was inconclusive: "...sensor couldn't fully confirm — please verify")
        │
        ▼
STEP 8 — Customer opens the box
  Customer enters PIN on the physical keypad
      OR types it into the "Type PIN" box on their dashboard → Open
  ↳ Correct → servo opens customer door
  ↳ orders/{id}.status = "CUSTOMER_AUTH_OK"
  ↳ Customer LCD: "Collect your / package :)"
  ↳ Customer dashboard: "Confirm Collection" button becomes active
       (stays disabled until this point — prevents closing a door that
        was never actually opened)
        │
        ▼
STEP 9 — Customer collects the parcel, confirms
  Customer taps "Confirm Collection" on dashboard
      OR presses # / * on the customer keypad
      OR IR sensor genuinely sees the parcel removed (bonus signal)
  ↳ orders/{id}.status = "COLLECTION_REQUESTED"
  ↳ Customer dashboard: "Closing locker..."
        │
        ▼
STEP 10 — Box closes and marks the order complete
  ↳ Servo closes the customer door
  ↳ orders/{id}.status = "COLLECTED"
  ↳ locker/status = "IDLE"
  ↳ Both LCDs: "System ready / Awaiting order"
  ↳ Customer dashboard: shows "🎉 Delivery complete!" for a few seconds,
       then the Track Delivery card clears itself back to "Order #-",
       ready for the next order
        │
        ▼
STEP 11 — System is ready for the next delivery
  ↳ Box state = STATE_IDLE
  ↳ Biker available for a new assignment
  ↳ Customer dashboard reset, PIN cleared
  ↳ Loop back to STEP 1
```

---

## Side branch — security lockout (any PIN entry point)

```
3 wrong PIN attempts (biker OR customer side)
        │
        ▼
Box locks that side for 10s
  ↳ LCD: "SECURITY ALERT / Check dashboard"
  ↳ Admin dashboard: Security Alerts badge increments
  ↳ Customer dashboard: 🚨 notification + toast
        │
        ▼
Lockout expires → back to normal PIN entry
```

## Side branch — parcel left uncollected

```
Order is DELIVERED but customer hasn't opened the box yet
        │
        ▼
Box stays idle in between other activity, IR keeps sampling
  ↳ locker/parcelPresent pushed to Firebase every ~5s
  ↳ Customer LCD rotates in "Parcel in box / # to open, * close" every ~8s
  ↳ Customer dashboard: 📦 reminder banner stays visible
        (shows even if the customer has no order "active" in their session -
         e.g. they signed out and back in - as long as the box still has it)
        │
        ▼
Customer eventually collects → STEP 9 onward as normal
```

---

## Quick reference — where each status shows up

| Status | Meaning | Who sees what |
|---|---|---|
| `PENDING` | Order placed, no biker yet | Customer: "Finding Biker" |
| `ASSIGNED` | Biker assigned, PINs generated | Biker: job card appears |
| `ENROUTE` | Biker travelling | Customer: "Biker En Route" |
| `ARRIVED` | Biker at the gate | Box prompts for biker PIN |
| `BIKER_AUTH_OK` | Biker door open | Biker dashboard: Mark Delivered enabled |
| `MARK_DELIVERED_REQUESTED` | Biker confirmed drop-off | Box closing + checking parcel |
| `DELIVERED` | Parcel confirmed in box | Customer sees PIN + reminder banner |
| `CUSTOMER_AUTH_OK` | Customer door open | Customer dashboard: Confirm Collection enabled |
| `COLLECTION_REQUESTED` | Customer confirmed pickup | Box closing |
| `COLLECTED` | Fully complete | Everything resets for next order |

---

## Known limitation

The **physical customer keypad** (via the ESP8266 bridge) is unreliable on
current hardware. The dashboard's "Type PIN" box (Step 8) is a full working
alternative — the demo does not depend on the physical customer keypad at all.
