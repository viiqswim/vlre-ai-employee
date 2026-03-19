#!/usr/bin/env bun
/**
 * convert-xlsx-to-kb.ts
 * Converts a single XLSX property information template to a markdown knowledge base entry.
 *
 * Usage:
 *   bun run scripts/convert-xlsx-to-kb.ts --file <path.xlsx> [--dry-run]
 */

// SheetJS — use require() (CommonJS) for compatibility with Bun's current XLSX version
const XLSX = require('xlsx');

// ─── Types ───────────────────────────────────────────────────────────────────

interface PropertySettings {
  internalName: string;
  propertyType: string;
  listingType: string;
  checkInTime: string;
  checkOutTime: string;
  wifiNetwork: string;
  wifiPassword: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  baseGuests: number;
  nightlyPrice: number;
  cleaningFee: number;
  securityDeposit: number;
  extraGuestFee: number;
  cancellationPolicy: string;
  primaryCheckinMethod: string;
  altCheckinMethod: string;
  minStay: number;
  maxStay: number;
  currency: string;
  percentageAtReservation: number;
  fullPaymentTiming: number;
  bookingWindow: string;
  bookingLeadTime: string | number;
}

interface AmenityItem {
  name: string;
  location?: string;
}

interface PoliciesRules {
  rules: string[];
  cancellationPolicy?: string;
}

interface FeeItem {
  name: string;
  amount: number;
}

interface CustomCodes {
  parking?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert Excel time to 12-hour human-readable format.
 * Handles both day fractions (0.625 → 3:00 PM) and whole hour values (15 → 3:00 PM).
 */
function excelTimeToHuman(val: number): string {
  let hours: number;
  let minutes: number;

  if (val < 1) {
    // Day fraction: e.g. 0.625 = 15h = 3:00 PM
    const totalMinutes = Math.round(val * 24 * 60);
    hours = Math.floor(totalMinutes / 60);
    minutes = totalMinutes % 60;
  } else {
    // Already a 24-hour clock value: e.g. 15 = 3:00 PM
    hours = Math.floor(val);
    minutes = Math.round((val - hours) * 60);
  }

  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${h}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

/** Remove template variables like %%foo%% and %word% from text. */
function stripTemplateVars(text: string): string {
  return text
    .replace(/%%[^%]+%%/g, '')
    .replace(/%[a-zA-Z_]+%/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function toStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function toNum(val: unknown): number {
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

/** Abbreviate US state names to 2-letter codes. */
function abbrevState(state: string): string {
  const map: Record<string, string> = {
    Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR',
    California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
    Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
    Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS',
    Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
    Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
    Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
    'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
    Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
    'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
    Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
    Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
    Wisconsin: 'WI', Wyoming: 'WY',
  };
  return map[state] ?? state;
}

/**
 * Extract the short property code from the internal name.
 * "219-PAU-HOME" → "219-PAU"
 */
function extractPropertyCode(internalName: string): string {
  const parts = internalName.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return internalName;
}

// Area display name mapping (XLSX area name → markdown heading)
const AREA_MAP: Record<string, string> = {
  'Room': 'Bedroom',
  'Overall property': 'Throughout the Property',
  'Living room': 'Living Room',
  'Kitchen': 'Kitchen',
  'Bathroom': 'Bathroom',
};

// Preferred order for amenity sections
const AREA_ORDER = ['Bedroom', 'Throughout the Property', 'Living Room', 'Kitchen', 'Bathroom'];

// ─── Sheet parsers ────────────────────────────────────────────────────────────

function parsePropertySettings(sheet: object): Partial<PropertySettings> {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  const data: Record<string, unknown> = {};

  // Auto-detect actual-value column: 6-col layout has "Platforms" at col[1] → actual at col[4]
  // 5-col layout omits "Platforms" → actual at col[3]
  const headerRow = rows[0] ?? [];
  const actualValueCol = toStr(headerRow[1]) === 'Platforms' ? 4 : 3;

  for (const row of rows) {
    const fieldName = toStr(row[0]);
    if (!fieldName || fieldName === 'Field Name') continue;
    data[fieldName] = row[actualValueCol];
  }

  const checkInRaw = toNum(data['Check-In Time Start']);
  const checkOutRaw = toNum(data['Check-Out Time']);

  return {
    internalName: toStr(data['Internal Property Name']),
    propertyType: toStr(data['Property Type']),
    listingType: toStr(data['Listing Type']),
    checkInTime: checkInRaw ? excelTimeToHuman(checkInRaw) : '',
    checkOutTime: checkOutRaw ? excelTimeToHuman(checkOutRaw) : '',
    wifiNetwork: toStr(data['Wifi Network']),
    wifiPassword: toStr(data['Wifi Password']),
    address1: toStr(data['Address 1']),
    city: toStr(data['City']),
    state: toStr(data['State']),
    postalCode: toStr(data['Postal Code']),
    bedrooms: toNum(data['Bedrooms']),
    bathrooms: toNum(data['Bathrooms']),
    maxGuests: toNum(data['Max Guests']),
    baseGuests: toNum(data['Base Guests']),
    nightlyPrice: toNum(data['Nightly Base Price']),
    cleaningFee: toNum(data['Cleaning Fee']),
    securityDeposit: toNum(data['Security Deposit']),
    extraGuestFee: toNum(data['Extra Guest Fee']),
    cancellationPolicy: toStr(data['Cancellation Policy']),
    primaryCheckinMethod: toStr(data['Primary Checkin Method']),
    altCheckinMethod: toStr(data['Alternative Checkin Method']),
    minStay: toNum(data['Minimum Stay']),
    maxStay: toNum(data['Maximum Stay']),
    currency: toStr(data['Currency']),
    percentageAtReservation: toNum(data['Percentage At Reservation']),
    fullPaymentTiming: toNum(data['Full Payment Timing']),
    bookingWindow: toStr(data['Booking Window']),
    bookingLeadTime: data['Booking Lead Time'] as string | number,
  };
}

function parseAmenities(sheet: object): Record<string, AmenityItem[]> {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  const grouped: Record<string, AmenityItem[]> = {};

  for (const row of rows.slice(1)) {
    const area = toStr(row[0]);
    const amenityName = toStr(row[1]);
    const hasIt = row[2];
    const needsLocation = row[3];
    const locationDesc = toStr(row[5]);

    if (!hasIt || !area || !amenityName) continue;

    const mappedArea = AREA_MAP[area] ?? area;
    if (!grouped[mappedArea]) {
      grouped[mappedArea] = [];
    }

    const item: AmenityItem = { name: amenityName };
    if (needsLocation && locationDesc) {
      item.location = locationDesc.trim();
    }

    grouped[mappedArea].push(item);
  }

  return grouped;
}

function parsePoliciesRules(sheet: object): PoliciesRules {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  const rules: string[] = [];
  let cancellationPolicy: string | undefined;

  for (const row of rows.slice(1)) {
    const item = toStr(row[0]).toLowerCase();
    const desc = toStr(row[1]);
    if (!desc) continue;

    if (item === 'rule') {
      // Normalize newlines in rules to spaces
      rules.push(desc.replace(/\n/g, ' ').trim());
    } else if (item === 'cancellation policy') {
      cancellationPolicy = desc.replace(/\n/g, ' ').trim();
    }
  }

  return { rules, cancellationPolicy };
}

function parseFees(sheet: object): FeeItem[] {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  const fees: FeeItem[] = [];

  for (const row of rows.slice(1)) {
    const feeName = toStr(row[0]);
    const hasFee = row[1];
    const amount = row[2];

    if (!hasFee || !feeName) continue;

    fees.push({
      name: feeName,
      amount: toNum(amount),
    });
  }

  return fees;
}

function parseCustomCodes(sheet: object): CustomCodes {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  const result: CustomCodes = {};

  // Codes to skip — dynamic or template-heavy
  const SKIP_CODES = new Set([
    'door-code',
    'last_minute_reservation',
    'not_last_minute_reservation',
    'door_instruccions_rooms',
  ]);

  for (const row of rows.slice(1)) {
    const codeName = toStr(row[0]);
    if (!codeName || SKIP_CODES.has(codeName)) continue;

    if (codeName === 'parking-instructions') {
      const codeValue = toStr(row[2]);
      if (codeValue) {
        const stripped = stripTemplateVars(codeValue);
        if (stripped) result.parking = stripped;
      }
    }
  }

  return result;
}

// ─── Parking fallback from amenities ─────────────────────────────────────────

/**
 * Extract parking-related amenities from the "Throughout the Property" section
 * as a fallback when no custom parking code is found.
 */
function extractParkingFromAmenities(amenities: Record<string, AmenityItem[]>): string | null {
  const overall = amenities['Throughout the Property'] ?? [];
  const parkingItems = overall.filter(
    item =>
      item.name.toLowerCase().includes('parking') ||
      item.name.toLowerCase().includes('garage'),
  );

  if (parkingItems.length === 0) return null;

  return parkingItems
    .map(item => {
      const base = `- **${item.name}**`;
      return item.location ? `${base} — ${item.location}` : base;
    })
    .join('\n');
}

// ─── Markdown assembly ────────────────────────────────────────────────────────

function assembleMarkdown(
  settings: Partial<PropertySettings>,
  amenities: Record<string, AmenityItem[]>,
  policies: PoliciesRules,
  fees: FeeItem[],
  codes: CustomCodes,
): string {
  const lines: string[] = [];

  const propCode = extractPropertyCode(settings.internalName ?? '');
  const stateAbbrev = abbrevState(settings.state ?? '');

  // ── Title ──────────────────────────────────────────────────────────────────
  lines.push(`# ${propCode} — ${settings.address1}, ${settings.city}, ${stateAbbrev}`);
  lines.push('');

  // ── Property Overview ──────────────────────────────────────────────────────
  lines.push('## Property Overview');
  lines.push(`- **Internal Code**: ${settings.internalName}`);
  lines.push(`- **Type**: ${settings.propertyType} | **Listing**: ${settings.listingType}`);
  lines.push(`- **Bedrooms**: ${settings.bedrooms} | **Bathrooms**: ${settings.bathrooms}`);

  if (settings.baseGuests && settings.baseGuests !== settings.maxGuests) {
    lines.push(
      `- **Max Guests**: ${settings.maxGuests} (base occupancy: ${settings.baseGuests}${settings.extraGuestFee ? `; extra guest fee: $${settings.extraGuestFee}/night over base` : ''})`,
    );
  } else {
    lines.push(`- **Max Guests**: ${settings.maxGuests}`);
  }

  lines.push(`- **Check-in**: ${settings.checkInTime} | **Check-out**: ${settings.checkOutTime}`);

  if (settings.minStay !== undefined || settings.maxStay !== undefined) {
    lines.push(
      `- **Minimum Stay**: ${settings.minStay} night(s) | **Maximum Stay**: ${settings.maxStay} nights`,
    );
  }

  if (settings.nightlyPrice) {
    lines.push(`- **Nightly Rate**: $${settings.nightlyPrice} (base)`);
  }

  lines.push(`- **Cancellation Policy**: ${settings.cancellationPolicy}`);
  lines.push(
    `- **Address**: ${settings.address1}, ${settings.city}, ${stateAbbrev} ${settings.postalCode}`,
  );
  lines.push('');

  // ── WiFi ───────────────────────────────────────────────────────────────────
  lines.push('## WiFi');
  if (settings.wifiNetwork) lines.push(`- **Network**: ${settings.wifiNetwork}`);
  if (settings.wifiPassword) lines.push(`- **Password**: ${settings.wifiPassword}`);
  lines.push('');

  // ── Access & Check-in ──────────────────────────────────────────────────────
  lines.push('## Access & Check-in');
  if (settings.primaryCheckinMethod) {
    lines.push(`- **Primary Method**: ${settings.primaryCheckinMethod}`);
  }
  if (settings.altCheckinMethod) {
    lines.push(`- **Alternative Method**: ${settings.altCheckinMethod}`);
  }
  lines.push('');

  // ── Parking ────────────────────────────────────────────────────────────────
  lines.push('## Parking');
  if (codes.parking) {
    lines.push(codes.parking);
  } else {
    const parkingFromAmenities = extractParkingFromAmenities(amenities);
    if (parkingFromAmenities) {
      lines.push(parkingFromAmenities);
    } else {
      lines.push('Parking details not specified.');
    }
  }
  lines.push('');

  // ── Amenities ──────────────────────────────────────────────────────────────
  lines.push('## Amenities');
  lines.push('');

  const allAreas = Object.keys(amenities);
  const orderedAreas = [
    ...AREA_ORDER.filter(a => allAreas.includes(a)),
    ...allAreas.filter(a => !AREA_ORDER.includes(a)),
  ];

  // Skip parking-related amenities in the Amenities section (already in Parking)
  const PARKING_AMENITY_KEYWORDS = ['parking', 'garage'];

  for (const area of orderedAreas) {
    const items = (amenities[area] ?? []).filter(item => {
      // Remove parking amenities — shown in the Parking section
      if (area === 'Throughout the Property') {
        return !PARKING_AMENITY_KEYWORDS.some(kw => item.name.toLowerCase().includes(kw));
      }
      return true;
    });

    if (items.length === 0) continue;

    lines.push(`### ${area}`);
    for (const item of items) {
      if (item.location) {
        lines.push(`- ${item.name} — ${item.location}`);
      } else {
        lines.push(`- ${item.name}`);
      }
    }
    lines.push('');
  }

  // ── House Rules ────────────────────────────────────────────────────────────
  lines.push('## House Rules');
  for (const rule of policies.rules) {
    lines.push(`- ${rule}`);
  }
  if (policies.rules.length === 0) {
    lines.push('No specific house rules provided.');
  }
  lines.push('');

  // ── Cancellation Policy ────────────────────────────────────────────────────
  if (policies.cancellationPolicy) {
    lines.push('## Cancellation Policy');
    // The policy text may start with the policy name followed by the details
    // e.g. "Strict Full refund for..." → "**Strict** — Full refund for..."
    const policyText = policies.cancellationPolicy;
    const policyName = settings.cancellationPolicy ?? '';
    if (policyName && policyText.startsWith(policyName)) {
      const rest = policyText.slice(policyName.length).trim();
      lines.push(`**${policyName}** — ${rest}`);
    } else {
      lines.push(policyText);
    }
    lines.push('');
  }

  // ── Fees ───────────────────────────────────────────────────────────────────
  lines.push('## Fees');

  if (settings.cleaningFee) {
    lines.push(`- **Cleaning Fee**: $${settings.cleaningFee}`);
  }
  if (settings.securityDeposit) {
    lines.push(`- **Security Deposit**: $${settings.securityDeposit}`);
  }
  if (settings.extraGuestFee) {
    const baseNote =
      settings.baseGuests ? ` (over base occupancy of ${settings.baseGuests})` : '';
    lines.push(`- **Extra Guest Fee**: $${settings.extraGuestFee}/night${baseNote}`);
  }

  // Include additional fees from the fees sheet (skip those already covered above + skip Tax)
  const SKIP_FEE_NAMES = new Set(['Cleaning Fee', 'Tax']);
  for (const fee of fees) {
    if (SKIP_FEE_NAMES.has(fee.name)) continue;
    if (fee.amount) {
      lines.push(`- **${fee.name}**: $${fee.amount}`);
    }
  }
  lines.push('');

  // ── Booking Details ────────────────────────────────────────────────────────
  lines.push('## Booking Details');
  if (settings.currency) {
    lines.push(`- **Currency**: ${settings.currency}`);
  }
  if (settings.percentageAtReservation) {
    lines.push(`- **Payment at Booking**: ${settings.percentageAtReservation}% of total`);
  }
  if (settings.fullPaymentTiming) {
    lines.push(`- **Final Payment**: ${settings.fullPaymentTiming} days before check-in`);
  }
  if (settings.bookingWindow) {
    lines.push(`- **Booking Window**: Up to ${settings.bookingWindow} in advance`);
  }

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const filePath = fileIndex !== -1 ? args[fileIndex + 1] ?? null : null;
  const isDryRun = args.includes('--dry-run');
  const isCommon = args.includes('--common');

  if (!filePath && !isCommon) {
    console.log('[CONVERT] No --file specified. Batch mode not yet implemented.');
    process.exit(0);
  }

  if (!filePath) {
    console.error('[CONVERT] --common mode not yet implemented.');
    process.exit(1);
  }

  process.stderr.write(`[CONVERT] Reading: ${filePath}\n`);

  const wb = XLSX.readFile(filePath);

  // Parse each sheet — gracefully handle missing sheets
  const settingsSheet = wb.Sheets['property-settings'] as object | undefined;
  const amenitiesSheet = wb.Sheets['amenities'] as object | undefined;
  const policiesSheet = wb.Sheets['policiesrules'] as object | undefined;
  const feesSheet = wb.Sheets['fees'] as object | undefined;
  const codesSheet = wb.Sheets['custom-codes'] as object | undefined;

  const settings = settingsSheet ? parsePropertySettings(settingsSheet) : {};
  const amenities = amenitiesSheet ? parseAmenities(amenitiesSheet) : {};
  const policies = policiesSheet ? parsePoliciesRules(policiesSheet) : { rules: [] };
  const fees = feesSheet ? parseFees(feesSheet) : [];
  const codes = codesSheet ? parseCustomCodes(codesSheet) : {};

  const markdown = assembleMarkdown(settings, amenities, policies, fees, codes);

  if (isDryRun) {
    process.stdout.write(markdown + '\n');
  } else {
    // Batch mode writes to file — for now, just print (Task 8 will handle file output)
    process.stdout.write(markdown + '\n');
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[CONVERT] Error: ${msg}\n`);
  process.exit(1);
});
