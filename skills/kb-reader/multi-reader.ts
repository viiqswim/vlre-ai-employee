/**
 * Multi-Property Knowledge Base Reader
 *
 * Loads a common KB (always) plus an optional property-specific KB.
 * Property-specific results are returned first, followed by common results.
 * Falls back to common-only when property is unknown or KB file is missing.
 * Reads from disk on every call (no caching) for freshness.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { KnowledgeBaseReader } from "./reader.ts";

export interface PropertyMapEntry {
  code: string;
  names: string[];
  address: string;
  kbFile: string;
}

export interface PropertyMap {
  properties: PropertyMapEntry[];
}

export class MultiPropertyKBReader {
  private commonReader: KnowledgeBaseReader;
  private propertyDir: string;
  private mapPath: string;

  constructor(commonPath: string, propertyDir: string, mapPath: string) {
    this.commonReader = new KnowledgeBaseReader(commonPath);
    this.propertyDir = resolve(propertyDir);
    this.mapPath = resolve(mapPath);
  }

  /**
   * Load property map from JSON file.
   * Returns empty array if file doesn't exist (graceful degradation).
   */
  private loadPropertyMap(): PropertyMap {
    try {
      if (!existsSync(this.mapPath)) return { properties: [] };
      const content = readFileSync(this.mapPath, "utf-8");
      return JSON.parse(content) as PropertyMap;
    } catch {
      return { properties: [] };
    }
  }

  /**
   * Find KB file path for a given property name.
   * Tries exact match first, then partial match.
   * Returns null if no match found.
   */
  private resolvePropertyKB(propertyName: string): string | null {
    if (!propertyName) return null;
    const map = this.loadPropertyMap();
    const nameLower = propertyName.toLowerCase();

    // Try exact match on any name in the names array
    for (const entry of map.properties) {
      if (entry.names.some((n) => n.toLowerCase() === nameLower)) {
        return join(this.propertyDir, "..", entry.kbFile);
      }
    }

    // Try partial match (e.g., "Nutria" matches "7213-NUT" or "7213 Nutria Run")
    for (const entry of map.properties) {
      if (
        entry.names.some(
          (n) =>
            n.toLowerCase().includes(nameLower) ||
            nameLower.includes(n.toLowerCase())
        ) ||
        entry.code.toLowerCase().includes(nameLower) ||
        entry.address.toLowerCase().includes(nameLower)
      ) {
        return join(this.propertyDir, "..", entry.kbFile);
      }
    }

    return null;
  }

  /**
   * Search common + property-specific KB.
   *
   * If propertyName is provided:
   *   - Searches property-specific KB (if found) — results first
   *   - Always searches common KB — results appended
   * If propertyName is not provided:
   *   - Searches common KB only
   *
   * Returns matching sections as markdown, or fallback message if nothing found.
   */
  search(query: string, propertyName?: string): string {
    const commonResult = this.commonReader.search(query);

    if (!propertyName) {
      return commonResult;
    }

    // Try to find property-specific KB
    const propertyKBPath = this.resolvePropertyKB(propertyName);

    if (!propertyKBPath || !existsSync(propertyKBPath)) {
      if (propertyName) {
        console.warn(
          `[KB] No property KB found for: "${propertyName}" — using common KB only`
        );
      }
      return commonResult;
    }

    // Search property-specific KB
    const propertyReader = new KnowledgeBaseReader(propertyKBPath);
    const propertyResult = propertyReader.search(query);

    const hasPropertyResults = !propertyResult.includes(
      "No matching sections found"
    );
    const hasCommonResults = !commonResult.includes(
      "No matching sections found"
    );

    if (!hasPropertyResults && !hasCommonResults) {
      return "No matching sections found in knowledge base.";
    }

    // Combine: property-specific first, then common
    const parts: string[] = [];
    if (hasPropertyResults) parts.push(propertyResult);
    if (hasCommonResults) parts.push(commonResult);

    return parts.join("\n\n---\n\n");
  }
}

/**
 * Factory function to create a MultiPropertyKBReader instance.
 */
export function createMultiPropertyKBReader(
  commonPath: string,
  propertyDir: string,
  mapPath: string
): MultiPropertyKBReader {
  return new MultiPropertyKBReader(commonPath, propertyDir, mapPath);
}
