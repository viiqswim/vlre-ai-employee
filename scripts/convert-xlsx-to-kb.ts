#!/usr/bin/env bun
/**
 * convert-xlsx-to-kb.ts
 * Converts XLSX property information templates to markdown knowledge base entries.
 *
 * Single-file mode:
 *   bun run scripts/convert-xlsx-to-kb.ts --file <path.xlsx> [--dry-run]
 *
 * Batch mode (default when no --file):
 *   bun run scripts/convert-xlsx-to-kb.ts --source /path/to/xlsx-dir/ [--dry-run]
 */

import path from 'path';
import { readdirSync, existsSync, mkdirSync } from 'fs';

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

interface ConvertResult {
  markdown: string;
  warnings: string[];
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

// ─── Single-file converter ────────────────────────────────────────────────────

/**
 * Convert a single XLSX property template to markdown.
 * Returns the markdown string and any warnings encountered.
 */
function convertFile(filePath: string): ConvertResult {
  const warnings: string[] = [];

  const wb = XLSX.readFile(filePath);

  // Parse each sheet — gracefully handle missing sheets
  const settingsSheet = wb.Sheets['property-settings'] as object | undefined;
  const amenitiesSheet = wb.Sheets['amenities'] as object | undefined;
  const policiesSheet = wb.Sheets['policiesrules'] as object | undefined;
  const feesSheet = wb.Sheets['fees'] as object | undefined;
  const codesSheet = wb.Sheets['custom-codes'] as object | undefined;

  if (!settingsSheet) warnings.push('Missing sheet: property-settings');
  if (!amenitiesSheet) warnings.push('Missing sheet: amenities');
  if (!policiesSheet) warnings.push('Missing sheet: policiesrules');

  const settings = settingsSheet ? parsePropertySettings(settingsSheet) : {};
  const amenities = amenitiesSheet ? parseAmenities(amenitiesSheet) : {};
  const policies = policiesSheet ? parsePoliciesRules(policiesSheet) : { rules: [] };
  const fees = feesSheet ? parseFees(feesSheet) : [];
  const codes = codesSheet ? parseCustomCodes(codesSheet) : {};

  if (!settings.internalName) {
    warnings.push('No internal property name found in property-settings');
  }

  const markdown = assembleMarkdown(settings, amenities, policies, fees, codes);

  return { markdown, warnings };
}

// ─── Batch mode — property grouping ──────────────────────────────────────────

/**
 * Lookup table: normalized filename (no extension, no prefix, no suffix) → group code.
 * Built from the authoritative property grouping spec.
 */
const GROUP_MAP: Record<string, string> = {
  // 7213-NUT group
  '7213-nut-home': '7213-nut',
  '7213-nut-1': '7213-nut',
  '7213-nut-2': '7213-nut',
  '7213-nut-3': '7213-nut',
  '7213-nut-4': '7213-nut',
  '7213-nut-5': '7213-nut',
  // 3412-SAN group
  '3412-san-home': '3412-san',
  '3412-san-1': '3412-san',
  '3412-san-2': '3412-san',
  '3412-san-3': '3412-san',
  '3412-san-4': '3412-san',
  // 3420-HOV group
  '3420-hov-home': '3420-hov',
  '3420-hov-1': '3420-hov',
  '3420-hov-2': '3420-hov',
  '3420-hov-3': '3420-hov',
  // 3401-BRE group
  '3401-bre-home': '3401-bre',
  '3401-bre-1': '3401-bre',
  '3401-bre-2': '3401-bre',
  '3401-bre-3': '3401-bre',
  // 271-GIN group (no HOME file)
  '271-gin-1': '271-gin',
  '271-gin-2': '271-gin',
  '271-gin-3': '271-gin',
  '271-gin-4': '271-gin',
  // 3505-BAN group
  '3505-ban-home': '3505-ban',
  '3505-ban-1': '3505-ban',
  '3505-ban-2': '3505-ban',
  '3505-ban-3': '3505-ban',
  // 407-GEV group
  '407-gev-home': '407-gev',
  '407-gev-bundle': '407-gev',
  '407-gev-loft': '407-gev',
  // 219-PAU group
  '219-pau-home': '219-pau',
  // 4403-HAY group
  '4403a-hay-home': '4403-hay',
  '4403b-hay-home': '4403-hay',
  '4403c-hay-home': '4403-hay',
  // 4405-HAY group
  '4405a-hay-home': '4405-hay',
  // 4410-HAY group
  '4410a-hay-home': '4410-hay',
  '4410b-hay-home': '4410-hay',
  // Single properties
  '5306a-kin-home': '5306-kin',
  '6002-pal-home': '6002-pal',
  '6930-her-home': '6930-her',
  '8039-che-home': '8039-che',
  // 1602-BLU (from zip extract)
  '1602-blu-home': '1602-blu',
};

/**
 * Normalize a filename to a GROUP_MAP key.
 * Strips path, extension, leading underscore, "Copy of " prefix,
 * and "-property-information[-template]" suffixes.
 */
function getGroupCode(filename: string): string | null {
  let name = path.basename(filename, '.xlsx').toLowerCase();
  // Strip "copy of " prefix (possibly repeated)
  name = name.replace(/^(copy of )+/i, '');
  // Strip leading underscore
  name = name.replace(/^_/, '');
  // Strip common suffixes
  name = name.replace(/-property-information-template$/, '');
  name = name.replace(/-property-information$/, '');
  return GROUP_MAP[name] ?? null;
}

// ─── Discrepancy report ───────────────────────────────────────────────────────

function buildDiscrepancyReport(
  processed: string[],
  discrepancies: string[],
  unmapped: string[],
): string {
  const lines = [
    '# Knowledge Base Discrepancy Report',
    '',
    `> Generated: ${new Date().toISOString()}`,
    `> Properties processed: ${processed.length}`,
    `> Discrepancies found: ${discrepancies.length}`,
    '',
    '## Properties Processed',
    '',
    ...processed.map(p => `- ✅ ${p.toUpperCase()}`),
    '',
    '## Discrepancies',
    '',
  ];

  if (discrepancies.length === 0) {
    lines.push('No discrepancies found.');
  } else {
    lines.push(...discrepancies);
  }

  if (unmapped.length > 0) {
    lines.push('', '## Unmapped Files (skipped)', '');
    lines.push(...unmapped.map(f => `- ${path.basename(f)}`));
  }

  return lines.join('\n') + '\n';
}

// ─── Batch mode runner ────────────────────────────────────────────────────────

async function runBatch(sourceDir: string, isDryRun: boolean): Promise<void> {
  // Source directories to scan: the user-supplied dir + the extracted zip location
  const SOURCE_DIRS = [sourceDir, '/tmp/zip-extract'];

  // Collect all XLSX files from all source dirs
  const allFiles: string[] = [];
  for (const dir of SOURCE_DIRS) {
    if (!existsSync(dir)) {
      console.log(`[CONVERT] Skipping missing dir: ${dir}`);
      continue;
    }
    const dirFiles = readdirSync(dir)
      .filter(f => f.endsWith('.xlsx'))
      .map(f => path.join(dir, f));
    allFiles.push(...dirFiles);
    console.log(`[CONVERT] Found ${dirFiles.length} XLSX file(s) in ${dir}`);
  }

  console.log(`[CONVERT] Total XLSX files found: ${allFiles.length}`);

  // Group files by property code using the lookup table
  const groups = new Map<string, string[]>();
  const unmapped: string[] = [];

  for (const file of allFiles) {
    const code = getGroupCode(file);
    if (!code) {
      unmapped.push(file);
      continue;
    }
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)!.push(file);
  }

  console.log(`[CONVERT] Mapped to ${groups.size} property group(s). Unmapped: ${unmapped.length}`);
  if (unmapped.length > 0) {
    for (const f of unmapped) {
      console.log(`[CONVERT]   (skip) ${path.basename(f)}`);
    }
  }

  const discrepancies: string[] = [];
  const processed: string[] = [];

  // Ensure output directory exists
  const outDir = 'knowledge-base/properties';
  if (!isDryRun && !existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // Process each property group
  for (const [code, groupFiles] of groups.entries()) {
    console.log(`\n[CONVERT] Processing ${code.toUpperCase()} (${groupFiles.length} file(s))...`);

    // Sort: HOME first, then numbered/named units alphabetically
    const sorted = [...groupFiles].sort((a, b) => {
      const nameA = path.basename(a).toLowerCase().replace(/^_/, '').replace(/^copy of /i, '');
      const nameB = path.basename(b).toLowerCase().replace(/^_/, '').replace(/^copy of /i, '');
      const aIsHome = nameA.includes('-home');
      const bIsHome = nameB.includes('-home');
      if (aIsHome && !bIsHome) return -1;
      if (!aIsHome && bIsHome) return 1;
      return nameA.localeCompare(nameB);
    });

    // Check for HOME file — note if missing
    const hasHome = sorted.some(f => {
      const n = path.basename(f).toLowerCase().replace(/^_/, '').replace(/^copy of /i, '');
      return n.includes('-home');
    });

    if (!hasHome) {
      discrepancies.push(
        `⚠️ **${code.toUpperCase()}**: No HOME file found — room files used as overview (no property-level settings).`,
      );
      console.log(`[CONVERT]   ⚠ No HOME file for ${code.toUpperCase()}`);
    }

    // Build merged markdown parts
    const markdownParts: string[] = [];
    const fileWarnings: string[] = [];

    for (const file of sorted) {
      const basename = path.basename(file);
      const normalName = basename.toLowerCase().replace(/^_/, '').replace(/^copy of /i, '');
      const isHome = normalName.includes('-home');

      console.log(`[CONVERT]   → ${basename}${isHome ? ' (HOME)' : ''}`);

      let result: ConvertResult;
      try {
        result = convertFile(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        discrepancies.push(`❌ **${basename}**: Failed to parse — ${msg}`);
        console.log(`[CONVERT]   ✗ Parse error: ${msg}`);
        continue;
      }

      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          fileWarnings.push(`⚠️ **${basename}**: ${w}`);
        }
      }

      if (isHome || sorted.length === 1) {
        // HOME file or only file: use as the main content
        markdownParts.push(result.markdown);
      } else {
        // Room/unit file: add as a subsection under the HOME content
        // Extract a unit label from the filename (last segment before suffix)
        const nameForLabel = normalName
          .replace(/-property-information-template$/, '')
          .replace(/-property-information$/, '');
        const segments = nameForLabel.split('-');
        const unitLabel = segments[segments.length - 1]?.toUpperCase() ?? basename;

        // Strip the H1 title line from the room markdown and add as subsection
        const roomBody = result.markdown.replace(/^#[^\n]*\n/, '').trimStart();
        const unitHeader = `\n---\n\n## Unit ${unitLabel}\n`;
        markdownParts.push(unitHeader + roomBody);
      }
    }

    // Accumulate per-file warnings into discrepancy list
    discrepancies.push(...fileWarnings);

    if (markdownParts.length === 0) {
      discrepancies.push(`❌ **${code.toUpperCase()}**: No content generated — all files failed.`);
      console.log(`[CONVERT]   ✗ No output generated for ${code.toUpperCase()}`);
      continue;
    }

    const finalMarkdown = markdownParts.join('\n');
    const outPath = `${outDir}/${code}.md`;

    if (isDryRun) {
      console.log(
        `[DRY RUN] Would write: ${outPath} (${finalMarkdown.length} chars, ${markdownParts.length} section(s))`,
      );
    } else {
      await Bun.write(outPath, finalMarkdown);
      console.log(`[CONVERT] ✅ Written: ${outPath}`);
    }

    processed.push(code);
  }

  // Generate common.md via common-kb-builder
  console.log('\n[CONVERT] Building common.md from common-situations.xlsx...');
  const commonXlsxPath = path.join(sourceDir, 'common-situations.xlsx');

  if (existsSync(commonXlsxPath)) {
    try {
      const { buildCommonKB } = await import('./common-kb-builder.ts');
      const commonContent = buildCommonKB(commonXlsxPath, './knowledge-base.md');

      if (isDryRun) {
        console.log(
          `[DRY RUN] Would write: knowledge-base/common.md (${commonContent.length} chars)`,
        );
      } else {
        if (!existsSync('knowledge-base')) mkdirSync('knowledge-base', { recursive: true });
        await Bun.write('knowledge-base/common.md', commonContent);
        console.log('[CONVERT] ✅ Written: knowledge-base/common.md');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      discrepancies.push(`❌ **common.md**: Failed to build — ${msg}`);
      console.log(`[CONVERT] ✗ common.md build failed: ${msg}`);
    }
  } else {
    discrepancies.push(
      `⚠️ **common.md**: common-situations.xlsx not found at ${commonXlsxPath} — skipped.`,
    );
    console.log(`[CONVERT] ⚠ common-situations.xlsx not found, skipping common.md`);
  }

  // Generate discrepancy report
  const report = buildDiscrepancyReport(processed, discrepancies, unmapped);
  const reportPath = 'knowledge-base/discrepancy-report.md';

  if (isDryRun) {
    console.log('\n[DRY RUN] Would write: knowledge-base/discrepancy-report.md');
    console.log('─'.repeat(60));
    console.log(report);
  } else {
    await Bun.write(reportPath, report);
    console.log(`[CONVERT] ✅ Written: ${reportPath}`);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`[CONVERT] Done!`);
  console.log(`[CONVERT]   Properties processed: ${processed.length}`);
  console.log(`[CONVERT]   Discrepancies:        ${discrepancies.length}`);
  console.log(`[CONVERT]   Unmapped files:       ${unmapped.length}`);

  if (discrepancies.length > 0) {
    console.log(`[CONVERT] See ${reportPath} for details.`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const filePath = fileIndex !== -1 ? (args[fileIndex + 1] ?? null) : null;
  const isDryRun = args.includes('--dry-run');
  const isCommon = args.includes('--common');

  const sourceIndex = args.indexOf('--source');
  const sourceDir =
    sourceIndex !== -1
      ? (args[sourceIndex + 1] ?? '/Users/victordozal/Downloads/properties-info/')
      : '/Users/victordozal/Downloads/properties-info/';

  // --common: build just common.md
  if (isCommon && !filePath) {
    const { buildCommonKB } = await import('./common-kb-builder.ts');
    const commonContent = buildCommonKB(
      path.join(sourceDir, 'common-situations.xlsx'),
      './knowledge-base.md',
    );
    if (isDryRun) {
      process.stdout.write(commonContent + '\n');
    } else {
      await Bun.write('knowledge-base/common.md', commonContent);
      console.log('[CONVERT] Written: knowledge-base/common.md');
    }
    return;
  }

  // --file: single-file conversion mode (prints to stdout)
  if (filePath) {
    process.stderr.write(`[CONVERT] Reading: ${filePath}\n`);
    const result = convertFile(filePath);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        process.stderr.write(`[CONVERT] Warning: ${w}\n`);
      }
    }
    process.stdout.write(result.markdown + '\n');
    return;
  }

  // Default: batch mode
  console.log(`[CONVERT] Batch mode — source: ${sourceDir}`);
  if (isDryRun) console.log('[CONVERT] DRY RUN — no files will be written');

  await runBatch(sourceDir, isDryRun);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[CONVERT] Error: ${msg}\n`);
  process.exit(1);
});
