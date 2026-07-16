### HOW THE BOX COMMUNICATES WITH THE REST OF THE  SYSTEM

Customer places order → Firebase /orders/{id} status: "PENDING"
        ↓
Admin assigns biker → Firebase /orders/{id} status: "ASSIGNED"
        ↓
ESP32 polls Firebase every 3s → sees status "ASSIGNED" → activates biker keypad
        ↓
Biker enters PIN at gate → ESP32 verifies → opens door
        ↓
IR sensor detects parcel for 5s → ESP32 writes to Firebase:
    /orders/{id}/status: "DELIVERED"
    /locker/status: "PARCEL_IN_CONFIRMED"
        ↓
Customer dashboard sees status change (real-time listener) → shows PIN
        ↓
Customer enters PIN on inner keypad → ESP32 opens customer door
        ↓
Customer removes parcel → IR goes HIGH → ESP32 writes:
    /orders/{id}/status: "COLLECTED"
    /locker/status: "IDLE"
        ↓
All dashboards update instantly


*The box DOES all of this in 'wifi_firebase.cpp':

Action                             | Handled in
*ESP32 polls for new assignments    - wifi_firebase.cpp → poll_for_assignment()
*ESP32 pushes DELIVERED status      - wifi_firebase.cpp → firebase_update_status()
*ESP32 pushes locker hardware state - wifi_firebase.cpp → firebase_update_locker_status()
*ESP32 logs breach attempts         - wifi_firebase.cpp → firebase_log_breach()
*ESP32 pushes COLLECTED on pickup   - state_machine.cpp → handle_pickup_confirmed()
*Dashboards react in real-time      - Firebase onValue() listeners in all 3 dashboard JS files



// STATE: DOOR_OPEN_BIKER
// Biker door is open:
//   - Biker taps "Mark Delivered" on the dashboard (polled via Firebase), OR
//   - Biker presses # or * on the physical keypad as an offline fallback.
// Either trigger closes the door and runs a 5s IR presence check.
// If neither happens within DOOR_CLOSE_TIMEOUT_MS (15s), the door
// auto-closes and the biker must re-enter their PIN to try again.
// After MAX_DOOR_TIMEOUT_RETRIES consecutive timeouts, the delivery is
// flagged for admin and cancelled instead of retrying indefinitely.
