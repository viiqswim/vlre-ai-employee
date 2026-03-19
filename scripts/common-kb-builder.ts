import { readFileSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx') as typeof import('xlsx');

type CellValue = string | number | boolean | null | undefined;
type Row = CellValue[];

function str(val: CellValue): string {
  if (val == null) return '';
  return String(val).trim();
}

function excelTimeToString(fraction: CellValue, defaultTime: string): string {
  if (typeof fraction !== 'number' || fraction <= 0) return defaultTime;
  // Excel stores time as fraction of a 24-hour day: 0.625 = 15:00 = 3 PM
  const totalMinutes = Math.round(fraction * 24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

function isOperationalSituation(situation: string): boolean {
  const lower = situation.toLowerCase().trim();
  return (
    lower.startsWith('regular shift') ||
    lower.startsWith('wellchair') ||
    lower.startsWith('reviews') ||
    lower.startsWith('reglas generales') ||
    lower.startsWith('como crear') ||
    lower.length === 0
  );
}

function poolText(val: CellValue): string {
  const s = str(val).toLowerCase();
  if (s.includes('community pool')) return 'Community';
  if (s.startsWith('yes')) return 'Yes';
  return 'No';
}

function petsText(val: CellValue): string {
  const s = str(val).toLowerCase();
  if (s.startsWith('yes') || s.includes('service animal')) return 'Service animals only';
  return 'No';
}

function cell(val: CellValue): string {
  return str(val).replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCommonSituations(rows: Row[]): string {
  const parts: string[] = [];

  for (let i = 1; i <= 8; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    const situation = str(row[0]);
    if (isOperationalSituation(situation)) continue;

    const howToConfirm = str(row[1]).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
    const answer = str(row[2]).replace(/\r\n/g, '\n').trim();

    parts.push(`### ${situation}`);
    if (howToConfirm) {
      parts.push(`**How to verify**: ${howToConfirm}`);
    }
    if (answer) {
      parts.push(`**Response**:\n${answer}`);
    }
    parts.push('');
  }

  const row10 = rows[10];
  if (row10 && row10[1]) {
    const detail = str(row10[1]).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
    parts.push('### Service Animals');
    parts.push(
      '**How to verify**: Guest claims to have a service animal (not emotional support).',
    );
    parts.push(`**Response**: ${detail}`);
    parts.push('');
  }

  const row33 = rows[33];
  if (row33 && row33[0]) {
    const title = str(row33[0]);
    const detail = str(row33[1]).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
    parts.push(`### ${title}`);
    parts.push('**How to verify**: Check if the property has mailbox access.');
    parts.push(`**Response**: ${detail || 'See property-specific instructions for mailbox access.'}`);
    parts.push('');
  }

  const thermostatLinks: string[] = [];
  for (let i = 36; i <= 50; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    const label = str(row[0]).trim();
    const link = str(row[1]).trim();
    if (label && link.startsWith('http')) {
      thermostatLinks.push(`- **${label} Thermostat**: ${link}`);
    }
  }
  if (thermostatLinks.length > 0) {
    parts.push('### Thermostat Instructions');
    parts.push(
      '**How to verify**: Check which thermostat brand the property has (see Property Quick Reference).',
    );
    parts.push('**Response**: Send the appropriate tutorial video:');
    parts.push(...thermostatLinks);
    parts.push('');
  }

  return parts.join('\n');
}

function parsePropertiesInfo(rows: Row[]): string {
  const dataRows = rows.slice(3).filter((r) => r.length > 0 && r[0] != null && str(r[0]).length > 0);

  const header = [
    '| Property | Code | Rooms | Baths | Max Guests | Check-in | Check-out | Neighborhood | Pool | Pets |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];

  const tableRows: string[] = [];

  for (const row of dataRows) {
    const name = str(row[0]);
    if (name.toLowerCase().includes('property') && name.toLowerCase().includes('name')) continue;

    const code = cell(row[1]);
    const rooms = cell(row[2]);
    const baths = cell(row[3]);
    const guests = cell(row[4]);
    const checkIn = excelTimeToString(row[5], '3:00 PM');
    const checkOut = excelTimeToString(row[6], '11:00 AM');
    const neighborhood = cell(row[10]);
    const pool = poolText(row[23]);
    const pets = petsText(row[26]);

    const addressParts = name.split(',');
    const shortName = addressParts.length >= 2
      ? `${addressParts[0].trim()}, ${addressParts[1].trim()}`
      : name.trim();

    tableRows.push(
      `| ${shortName} | ${code} | ${rooms} | ${baths} | ${guests} | ${checkIn} | ${checkOut} | ${neighborhood || '—'} | ${pool} | ${pets} |`,
    );
  }

  return [...header, ...tableRows].join('\n');
}

function parseDirectorio(rows: Row[]): string {
  const byCity: Record<string, Array<{ name: string; service: string; phone: string; notes: string }>> = {};
  let currentCity = '';

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const ciudad = str(row[0]);
    if (ciudad) currentCity = ciudad;

    const name = str(row[1]);
    const service = str(row[2]);
    const phone = str(row[3]);
    const notes = str(row[4]);

    if (!phone || !name) continue;

    if (!byCity[currentCity]) byCity[currentCity] = [];
    byCity[currentCity].push({ name, service, phone, notes });
  }

  const parts: string[] = [];

  for (const [city, entries] of Object.entries(byCity)) {
    if (entries.length === 0) continue;
    parts.push(`### ${city}`);
    parts.push('| Name | Service | Phone | Notes |');
    parts.push('|---|---|---|---|');
    for (const e of entries) {
      parts.push(
        `| ${cell(e.name)} | ${cell(e.service) || '—'} | ${cell(e.phone)} | ${cell(e.notes) || '—'} |`,
      );
    }
    parts.push('');
  }

  return parts.join('\n');
}

function extractSection(kbContent: string, sectionTitle: string): string {
  const lines = kbContent.split('\n');
  const startIdx = lines.findIndex(
    (l) => l.startsWith('## ') && l.includes(sectionTitle),
  );
  if (startIdx === -1) return `<!-- Section "${sectionTitle}" not found in knowledge-base.md -->`;

  const contentLines: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ') && !line.includes(sectionTitle)) break;
    contentLines.push(line);
  }

  while (contentLines.length > 0 && contentLines[contentLines.length - 1]?.trim() === '') {
    contentLines.pop();
  }
  return contentLines.join('\n');
}

export function buildCommonKB(xlsxPath: string, kbPath: string): string {
  const wb = XLSX.readFile(xlsxPath);

  const csRows: Row[] = XLSX.utils.sheet_to_json(wb.Sheets['Common Situations'] ?? {}, {
    header: 1,
    defval: null,
  }) as Row[];

  const piRows: Row[] = XLSX.utils.sheet_to_json(wb.Sheets['Properties Info'] ?? {}, {
    header: 1,
    defval: null,
  }) as Row[];

  const dirRows: Row[] = XLSX.utils.sheet_to_json(wb.Sheets['Directorio'] ?? {}, {
    header: 1,
    defval: null,
  }) as Row[];

  const kbContent = readFileSync(kbPath, 'utf-8');

  const generalPolicies = extractSection(kbContent, 'General Policies');
  const classificationRules = extractSection(kbContent, 'Classification Rules');
  const escalationTriggers = extractSection(kbContent, 'Escalation Triggers');

  const commonSituations = parseCommonSituations(csRows);
  const propertyTable = parsePropertiesInfo(piRows);
  const serviceDirectory = parseDirectorio(dirRows);

  const output = [
    '# VL Real Estate — Common Knowledge Base',
    '',
    '> This file is automatically generated from common-situations.xlsx and shared policies.',
    '> It is loaded for every guest message, regardless of property.',
    '',
    '## General Policies',
    '',
    generalPolicies,
    '',
    '## Common Guest Situations',
    '',
    commonSituations,
    '## Property Quick Reference',
    '',
    propertyTable,
    '',
    '## Service Directory',
    '',
    serviceDirectory,
    '## Classification Rules',
    '',
    classificationRules,
    '',
    '## Escalation Triggers',
    '',
    escalationTriggers,
    '',
  ].join('\n');

  return output;
}

if (import.meta.main) {
  const isDryRun = process.argv.includes('--dry-run');
  const content = buildCommonKB(
    '/Users/victordozal/Downloads/properties-info/common-situations.xlsx',
    './knowledge-base.md',
  );
  if (isDryRun) {
    console.log(content);
  } else {
    await Bun.write('./knowledge-base/common.md', content);
    console.log('[CONVERT] Written: knowledge-base/common.md');
  }
}
