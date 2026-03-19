# VL Real Estate — Guest Communication Knowledge Base

## General Policies

- **Check-in Time**: 3:00 PM (15:00)
- **Check-out Time**: 11:00 AM (11:00)
- **Quiet Hours**: 10:00 PM – 8:00 AM
- **Smoking**: Strictly prohibited inside all properties
- **Pets**: Property-specific (see Property-Specific Info below)
- **Maximum Occupancy**: As listed in booking confirmation
- **Parties/Events**: Not permitted without prior written approval
- **Additional Guests**: Must be approved in advance; additional charges may apply

## Response Templates by Category

### WiFi / Access

**Template 1 — WiFi Password Request:**
Hey [Guest Name]! For [Property Name], the WiFi network is "[WIFI_NETWORK]" and the password is "[WIFI_PASSWORD]". You should be good to connect right away. Let us know if you have any trouble! 😊

**Template 2 — Smart Lock / Door Code:**
Hey [Guest Name]! Your door access code for [Property Name] is "[DOOR_CODE]". It'll be active starting at check-in time (3 PM) — just enter it on the keypad. If you have any issues, let us know!

**Template 3 — General Access Question:**
Hey [Guest Name]! Complete access instructions are in your booking confirmation and the digital welcome guide at the property. Your access code gets sent automatically 24 hours before check-in. If you haven't gotten it yet, just let us know and we'll resend it!

### Early Check-in / Late Check-out

**Template 1 — Early Check-in Request (uncertain availability):**
Hey [Guest Name]! Check-in is usually 3 PM, but we'll check if it's ready earlier and let you know by noon. If we can swing it, early check-in is $50. We'll keep you posted!

**Template 2 — Early Check-in (confirmed available):**
Hey [Guest Name]! Great news — it'll be ready for you at [TIME]! You're all set for early check-in. Enjoy your stay!

**Template 3 — Late Check-out Request:**
Hey [Guest Name]! Standard check-out is 11 AM. We can check if late check-out until [TIME] is possible — it's $50 and depends on availability (back-to-back bookings). I'll confirm within a few hours!

**Template 4 — Late Check-out Denial (back-to-back):**
Hey [Guest Name]! Unfortunately we can't do late check-out today — we've got guests arriving and the cleaning team needs time to turn the place around. Standard check-out is 11 AM. Have a great trip!

### Amenity Questions

**Template 1 — Parking Question:**
Hey [Guest Name]! [Property Name] has [PARKING_DETAILS]. Parking is [free/included/available for a fee]. [Any additional parking notes]. Let me know if you need anything else!

**Template 2 — Pool/Hot Tub:**
Hey [Guest Name]! [Property Name] [does/does not] have a pool/hot tub. [If yes: It's available 24 hours and set to [TEMP]°F. Please follow the posted pool rules.] Let us know if you have questions!

**Template 3 — Appliance/Kitchen Question:**
Hey [Guest Name]! The kitchen at [Property Name] is fully equipped with [LIST_APPLIANCES]. There's [STORAGE_DETAILS] for your groceries. Help yourself to everything — just let us know if anything isn't working!

### Maintenance Requests

**Template 1 — Routine Maintenance Acknowledgment:**
Hey [Guest Name]! Sorry about the [ISSUE] — we're on it. Can you tell us exactly where it's happening so we can get someone there faster?

**Template 2 — AC/Heat Issue:**
Hey [Guest Name]! Sorry about the [AC/heater] issue. Try this first: [TROUBLESHOOTING_STEPS]. If it's still not working, let us know right away and we'll get someone out there!

**Template 3 — Plumbing Issue:**
Hey [Guest Name]! Sorry about the [plumbing issue] — we're escalating to maintenance right now. Someone will reach out within [TIME_FRAME] to get it sorted. Thanks for the heads-up!

### Noise / Neighbor Complaints

**Template 1 — Noise Reminder (preemptive or after complaint):**
Hey [Guest Name]! Quick reminder — quiet hours are 10 PM to 8 AM. Thanks for being mindful of the neighbors!

**Template 2 — After Receiving Noise Complaint:**
Hey [Guest Name]! We got a noise complaint from a neighbor. Please keep it down, especially after 10 PM. Reach out if you need anything!

## Property-Specific Info

### Lakewood Retreat — 1234 Lakewood Blvd, Austin TX 78704
- **WiFi Network**: LakewoodGuest
- **WiFi Password**: Welcome2024!
- **Parking**: 2 driveway spots available; no street parking after 10 PM
- **Pets**: NOT allowed
- **Bedrooms**: 3 | **Bathrooms**: 2 | **Max Occupancy**: 6
- **Smart Lock Code**: Sent via email 24h before check-in
- **Pool**: No
- **Notes**: Property has Ring doorbell camera facing front entrance

### South Congress Bungalow — 456 S Congress Ave, Austin TX 78704
- **WiFi Network**: SCBungalow_Guest
- **WiFi Password**: SoCo2024$
- **Parking**: 1 dedicated spot in rear alley; additional street parking available
- **Pets**: Small dogs (under 25 lbs) allowed with $75 pet fee — confirm in booking
- **Bedrooms**: 2 | **Bathrooms**: 1 | **Max Occupancy**: 4
- **Smart Lock Code**: Sent via email 24h before check-in
- **Pool**: No
- **Notes**: Located on busy street — noise-canceling earplugs provided in nightstand

### Mueller District Loft — 789 Mueller Ave, Austin TX 78723
- **WiFi Network**: MuellerLoft_5G
- **WiFi Password**: Mueller#2024
- **Parking**: Garage spot #14 (remote in kitchen drawer)
- **Pets**: NOT allowed
- **Bedrooms**: 1 | **Bathrooms**: 1 | **Max Occupancy**: 2
- **Smart Lock Code**: Sent via email 24h before check-in
- **Pool**: Building rooftop pool (6 AM – 10 PM)
- **Notes**: Elevator building, unit on 4th floor. Package room in lobby.

## Classification Rules

### AUTO_RESPOND candidates (high confidence required ≥ 0.9):
- WiFi password requests (exact property match in KB)
- Check-in/out time questions
- Parking questions (exact property match in KB)
- General policy questions (smoking, pets for known properties)

### NEEDS_APPROVAL (route to CS team):
- Early check-in / late check-out requests (requires checking availability)
- Maintenance issues (need to dispatch team)
- Pet approval questions
- Pricing / refund questions
- Special requests (extra bedding, cribs, etc.)
- Anything where the answer requires judgment

### ESCALATE immediately (tag manager):
- Lock/key access issues (guest can't enter property)
- Damage reports (by guest or neighbor)
- Safety concerns (gas smell, carbon monoxide, flooding)
- Refund/chargeback threats
- Aggressive or threatening communication
- Legal threats

## Escalation Triggers

The following ALWAYS require immediate escalation regardless of context:
1. "can't get in" / "lock doesn't work" / "locked out" → ACCESS ISSUE
2. "broken" + (window/door/lock) → SECURITY ISSUE
3. "smell gas" / "carbon monoxide" / "CO detector" → EMERGENCY
4. "refund" / "chargeback" / "dispute" → FINANCIAL
5. "flood" / "water leak" / "burst pipe" → EMERGENCY
6. "mold" / "cockroach" / "pest" → HEALTH
7. "police" / "call the cops" / "neighbors called police" → INCIDENT

Note: When in doubt, classify as NEEDS_APPROVAL rather than AUTO_RESPOND.
