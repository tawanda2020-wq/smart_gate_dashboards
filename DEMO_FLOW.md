# SmartGate Delivery System — End-to-End Demo Flow

This document walks through a full delivery cycle on the **current firmware +
dashboard build**, from order creation to the box being ready for the next
delivery. It reflects:

- The redesigned biker drop-off flow (dashboard-driven "Mark Delivered", 30s
  retry window, two-strike admin flag)
- The redesigned customer pickup flow (dashboard-driven "Confirm Collection",
  keypad fallback, IR as a bonus signal)
- The fix so the box only prompts for the biker PIN on `ARRIVED`, not
  `ENROUTE`
- A non-blocking WiFi-offline indicator on the customer LCD

> **Known limitation:** the customer **can't yet open** the door on real
> hardware — the ESP8266 customer-keypad bridge has an unresolved bug and
> never returns a typed PIN to the ESP32
> (`[KP/CUST] Timeout waiting for ESP8266 PIN response.` loops indefinitely
> in the serial log). Everything up to that point (Steps 1–9) is fully
> working and demo-ready. Steps 10–12 (closing the box after collection) are
> implemented and ready to test the moment the ESP8266 bug is fixed.

---

## Actors

| Actor       | Interface                                                             |
|-------------|-----------------------------------------------------------------------|
| Customer    | Customer web dashboard (order tracking)                               |
| Biker       | Biker web dashboard + physical keypad/LCD on the box                  |
| Admin       | Admin web dashboard                                                   |
| Box (ESP32) | Physical locker — biker-side LCD/keypad/servo, customer-side LCD/keypad/servo, IR sensor, GSM |

---

## Pre-demo checklist

- [ ] Box powered on, WiFi credentials in `config.h` match the demo network
- [ ] Serial monitor open (115200 baud) to narrate what's happening live
- [ ] Firebase RTDB reachable, an order exists (or will be created) with `status: "ASSIGNED"` and a `boxId` matching `BOX_ID` in `config.h`
- [ ] Biker is logged into the biker dashboard and has the job assigned
- [ ] Admin dashboard open on a second screen (optional, good for demo narration)
- [ ] On small screens, use the hamburger icon (top-left of the topbar) to open the sidebar on any of the three dashboards

---

## Full Flow

### 1. Order created / assigned
Order exists in `/orders/{orderId}` with `status: "ASSIGNED"`, a `bikerPinPlain`, `customerPinPlain`, and `customerPhone`. The biker has accepted the job on their dashboard.

- **Biker dashboard:** shows the job card, "Confirm En Route" button active.
- **Box:** idle, LCDs show "Ready / Awaiting Order". If WiFi is down, the customer LCD periodically flashes "WiFi: OFFLINE / Retrying..." every ~8s without blocking anything else.

### 2. Biker taps "Confirm En Route"
- **Dashboard action:** `orders/{id}/status → "ENROUTE"`
- **Biker dashboard:** PIN card revealed, "Arrived" button active.
- **Box:** still idle. The box caches the order's PINs/phone in the background as soon as it sees `ASSIGNED` or `ENROUTE`, but **does not** prompt for a PIN yet — that only happens once status reaches `ARRIVED` (see Step 4).

### 3. Box picks up the assignment (background)
Every 3s the box polls `/orders` for anything matching its `BOX_ID` with status `ASSIGNED`, `ENROUTE`, or `ARRIVED`, so it can catch up even if it was offline earlier. Only `ARRIVED` triggers the PIN prompt — `ASSIGNED`/`ENROUTE` are silently cached.

- **Serial log (while still ASSIGNED/ENROUTE):** `[FB] Active order found -> {orderId} (status: ENROUTE) | Phone: ...` — no state change, no LCD change.

### 4. Biker taps "Confirm Arrived"
- **Dashboard action:** `orders/{id}/status → "ARRIVED"`
- **Box:** on its next poll cycle picks this up.
  - **Serial log:** `[SM] External transition → 1` then `[FB] Locker status -> BIKER_AUTH` then `[FB] Box catching up from ARRIVED -> STATE_BIKER_AUTH`
  - Box state → `STATE_BIKER_AUTH`
  - **Biker LCD:** "Enter PIN:"
- **Biker dashboard:** hint changes to "Enter the box PIN on the outer keypad to open the door."

### 5. Biker enters PIN on the physical keypad
- Biker types the 4-digit PIN shown on their dashboard.
- **Correct PIN:**
  - **Serial log:** `[SM/BIKER_AUTH] Entered: XXXX Expected: XXXX`
  - Servo opens the biker door.
  - `orders/{id}/status → "BIKER_AUTH_OK"`
  - Box state → `STATE_DOOR_OPEN_BIKER` (30s timer starts here)
  - **Biker dashboard:** "Mark Delivered" button becomes active — *"Door is open. Place the parcel, then tap Mark Delivered."*
- **Wrong PIN:** attempt counter increments, LCD shows tries remaining. After 3 wrong attempts → breach alert (SMS to customer + admin), box locks out for 10s, then returns to PIN entry.

### 6. Biker places the parcel and taps "Mark Delivered"
- **Dashboard action:** `orders/{id}/status → "MARK_DELIVERED_REQUESTED"`
- **Biker dashboard:** disables further taps, shows *"Closing the door and checking the parcel..."*
- Box polls this status every 2s while the door is open.

  **Physical fallback:** instead of the dashboard, the biker can press `#` or `*` on the keypad — this triggers the exact same close+check sequence, useful if the phone or network is unavailable.

### 7. Box closes the door and checks the parcel
- **Serial log:** `[SM] Closing biker door and checking for parcel...`
- Servo closes the biker door.
- Box samples the IR sensor for a flat **5-second window**.
- Box state → `STATE_PARCEL_DETECTED` → `STATE_PARCEL_CONFIRMED`

### 8. Box confirms delivery and notifies the customer
- **Firebase:** `orders/{id}/status → "DELIVERED"`, `locker/status → "PARCEL_IN"` then `"PARCEL_IN_CONFIRMED"` or `"PARCEL_IN_UNVERIFIED"` depending on the IR result.
- **SMS to customer** — one of two messages:
  - *Parcel confirmed:* "...it is confirmed inside. Use PIN XXXX to collect it, or check your dashboard."
  - *Parcel not confirmed:* "...our sensor could not fully confirm it is inside...please verify using PIN XXXX when you collect it."
- **Biker dashboard:** order listener sees `DELIVERED`, shows *"✅ Delivery confirmed by the locker!"*, frees the biker (`bikers/{id}/status → "AVAILABLE"`, clears `assignedOrderId`/`deliveryPin`), resets the active-job UI after a short delay.
- **Customer dashboard:** progress timeline advances to "Arrived at Gate" → "Package Delivered". PIN card appears, showing the 4-digit retrieval PIN — but the "Confirm Collection" button is greyed out ("Enter PIN on keypad first") until the box confirms the door is actually open (Step 9).
- **Box LCDs:** biker side shows "Delivery done! / Locker locked." for 4 seconds, then returns to a neutral **"System ready / Job complete"** screen so it's no longer stuck on the delivery message. Customer side shows "Package arrived! / Enter PIN to open".
- **This is the point where the biker's job is fully done and they're free for the next delivery.**

### 9. Customer enters PIN on the customer-side keypad *(currently blocked by the ESP8266 bug)*
- Correct PIN → customer door opens.
- `orders/{id}/status → "CUSTOMER_AUTH_OK"`, `locker/status → "CUSTOMER_AUTH"`
- **Customer LCD:** "Access Granted / Collect parcel" → "Collect your / package :)"
- **Customer dashboard:** "Confirm Collection" button now enables — this is the safety gate that stops the customer from closing an unopened door by mistake.

### 10. Customer collects the parcel and taps "Confirm Collection"
- **Dashboard action:** `orders/{id}/status → "COLLECTION_REQUESTED"`
- **Customer dashboard:** button disables, shows *"Closing locker..."*
- Box polls this status every 2s while the door is open.

  **Physical fallback:** the customer can instead press `#` or `*` on the customer keypad. The IR sensor sensing the parcel removed is also accepted as a bonus signal, but neither the dashboard button nor the keypad requires it to work.

### 11. Box closes the customer door
- **Serial log:** `[SM] Closing biker door and checking for parcel...` *(customer-side equivalent)* → `[SM] -> STATE_PICKUP_CONFIRMED`
- Servo closes the customer door after a brief pause.
- **Customer LCD:** "Door closing... / Thank you!"

### 12. Box marks the order fully complete and resets
- **Firebase:** `orders/{id}/status → "COLLECTED"`, `locker/status → "IDLE"`
- **Customer dashboard:** pin-section hides itself, the retrieval PIN clears back to `-` — the page is now ready for the customer's next order.
- Box fully resets (`reset_delivery()`), state → `STATE_IDLE`, both LCDs show "System ready / Awaiting order".

---

## Alternate path A — biker doesn't confirm drop-off in time

If neither "Mark Delivered" nor the `#`/`*` keypad fallback fires within **30 seconds** of the biker door opening:

1. Door auto-closes.
2. `doorTimeoutCount` increments.
3. **First timeout:** LCD shows "Timed out / Re-enter PIN", box returns to `STATE_BIKER_AUTH` — biker re-enters their PIN, door reopens, 30s window restarts.
4. **Second consecutive timeout:** box gives up on this attempt:
   - `orders/{id}/status → "FLAGGED_NEEDS_ADMIN"`
   - SMS sent to both customer and admin asking them to coordinate directly.
   - LCDs show "Contact admin / Delivery flagged" for a few seconds.
   - Box resets to `STATE_IDLE`, biker dashboard frees the biker up automatically, showing a warning toast.

## Alternate path B — customer pickup blocked on hardware today

Because the ESP8266 customer-keypad bridge doesn't return typed PINs to the ESP32, the demo currently can't progress past Step 8 on real hardware. Once that's fixed, Steps 9–12 above are ready to run as-is — no further redesign needed on the collection side.

---

## Recent fixes in this build (changelog)

- **PIN prompt no longer fires on `ENROUTE`.** Previously the box jumped straight to "Enter PIN" the moment a biker tapped "Confirm En Route," well before they'd actually arrived. It now waits for `ARRIVED`.
- **Biker LCD no longer stuck.** "Delivery done! / Locker locked." now clears itself back to "System ready" after 4 seconds instead of staying frozen through the entire customer-pickup phase.
- **WiFi status visible on the box**, not just the serial monitor — customer LCD flashes "WiFi: OFFLINE / Retrying..." periodically while idle and disconnected.
- **Customer phone numbers normalise to `+263...`** even if the delivery form's phone field is hand-edited after login (previously only the login field was normalised).
- **Sidebar is usable on mobile again** across all three dashboards — a hamburger icon in the topbar toggles it in/out instead of it just disappearing below 768px width.

---

## "Ready for another delivery" checklist

The system is back to a clean idle state, ready for a new order, when **all** of the following are true:

- [ ] Box serial log shows `[SM] Initialised → STATE_IDLE` or the box has cycled back there naturally
- [ ] Both LCDs show "System ready / Awaiting order" (or "Ready / Awaiting Order")
- [ ] Biker dashboard shows "No active delivery" and the biker's status in `/bikers/{id}` is `AVAILABLE`
- [ ] Customer dashboard's PIN section is hidden and the PIN display has cleared back to `-`
- [ ] `/locker/status` is `IDLE`
- [ ] The completed order's final status is `DELIVERED` → `COLLECTED` (happy path) or `FLAGGED_NEEDS_ADMIN` (escalated path)