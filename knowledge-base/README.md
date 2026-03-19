# Knowledge Base

This directory contains the VL Real Estate guest communication knowledge bases.

## Structure

- `common.md` — Shared policies, common guest Q&A, service directory. Loaded for every guest message.
- `properties/{code}.md` — Per-property details (WiFi, amenities, rules, fees). Loaded based on the guest's property.
- `property-map.json` — Maps Hostfully property names/addresses to KB file paths.
- `discrepancy-report.md` — Conversion anomalies, missing data, and gaps found during XLSX extraction.

## Usage

The `MultiPropertyKBReader` in `skills/kb-reader/` loads `common.md` for every message,
then loads the property-specific KB based on the incoming guest's property name.

## Regeneration

To regenerate all KB files from the source XLSX data:
```bash
bun run scripts/convert-xlsx-to-kb.ts --source /Users/victordozal/Downloads/properties-info/
```

To preview without writing files:
```bash
bun run scripts/convert-xlsx-to-kb.ts --dry-run
```
