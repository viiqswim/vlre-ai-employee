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
Hi [Guest Name]! Great question. For [Property Name], the WiFi network is "[WIFI_NETWORK]" and the password is "[WIFI_PASSWORD]". You should be able to connect right away once you check in. Let us know if you have any trouble! 😊

**Template 2 — Smart Lock / Door Code:**
Hi [Guest Name]! Your door access code for [Property Name] is "[DOOR_CODE]". This code will be active starting at your check-in time (3 PM). Simply enter the code on the keypad and the door will unlock. If you have any issues, please don't hesitate to reach out!

**Template 3 — General Access Question:**
Hi [Guest Name]! You'll find complete access instructions in your booking confirmation and in the digital welcome guide inside the property. Your access code is sent automatically 24 hours before check-in. If you haven't received it, please let us know and we'll resend it immediately.

### Early Check-in / Late Check-out

**Template 1 — Early Check-in Request (uncertain availability):**
Hi [Guest Name]! We'd love to accommodate your early check-in request. Our standard check-in is 3:00 PM, but we'll check with our cleaning team to see if the property is ready earlier. I'll update you by noon on your arrival day. Please note that early check-in (before 3 PM) is subject to a $50 fee and availability. Thank you for your flexibility!

**Template 2 — Early Check-in (confirmed available):**
Hi [Guest Name]! Great news — the property will be ready for you at [TIME]! You're all set to check in early. Enjoy your stay!

**Template 3 — Late Check-out Request:**
Hi [Guest Name]! We can check on late check-out availability for you. Our standard check-out is 11:00 AM. A late check-out until [TIME] can be arranged for $50, subject to availability (we have back-to-back bookings to coordinate). I'll confirm within a few hours!

**Template 4 — Late Check-out Denial (back-to-back):**
Hi [Guest Name]! Unfortunately we're unable to accommodate a late check-out as we have guests arriving later today and our cleaning team needs time to prepare. We hope you understand! The standard check-out is 11:00 AM. Safe travels!

### Amenity Questions

**Template 1 — Parking Question:**
Hi [Guest Name]! [Property Name] has [PARKING_DETAILS]. Parking is [free/included/available for a fee]. [Any additional parking notes]. Let me know if you need any additional information!

**Template 2 — Pool/Hot Tub:**
Hi [Guest Name]! [Property Name] [does/does not] have a pool/hot tub. [If yes: The pool/hot tub is available 24 hours and the temperature is set to [TEMP]°F. Please follow the posted pool rules.] Let us know if you have questions!

**Template 3 — Appliance/Kitchen Question:**
Hi [Guest Name]! The kitchen at [Property Name] is fully equipped with [LIST_APPLIANCES]. There's [STORAGE_DETAILS] for your groceries. Feel free to use everything — just give us a heads up if anything isn't working properly!

### Maintenance Requests

**Template 1 — Routine Maintenance Acknowledgment:**
Hi [Guest Name]! Thank you for letting us know about the [ISSUE]. We've logged this and will have our maintenance team address it as soon as possible. We want to make sure your stay is comfortable. Can you tell us a bit more about where exactly this is happening so we can assist faster?

**Template 2 — AC/Heat Issue:**
Hi [Guest Name]! Sorry to hear you're having trouble with the [AC/heater]. Please try the following: [TROUBLESHOOTING_STEPS]. If the issue persists, please let us know immediately and we'll dispatch someone right away. Your comfort is our priority!

**Template 3 — Plumbing Issue:**
Hi [Guest Name]! We're sorry about the [plumbing issue]. This is being escalated to our maintenance team right away. Someone will be in touch with you within [TIME_FRAME] to resolve this. Thank you for your patience!

### Noise / Neighbor Complaints

**Template 1 — Noise Reminder (preemptive or after complaint):**
Hi [Guest Name]! Just a friendly reminder that our properties observe quiet hours from 10:00 PM to 8:00 AM out of respect for neighbors and other guests nearby. We want to make sure everyone has a great experience. Thanks so much for your understanding!

**Template 2 — After Receiving Noise Complaint:**
Hi [Guest Name]! We've received a noise concern from a neighbor. We want to ensure you have a great stay while being respectful of the neighborhood. Please keep noise levels down, especially after 10 PM. We appreciate your cooperation — please reach out if you need anything!

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
