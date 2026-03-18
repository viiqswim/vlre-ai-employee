/**
 * Knowledge Base Reader
 *
 * Reads and searches the local markdown knowledge base file.
 * Uses keyword-based section search (no embeddings, no vector DB).
 * Reads from disk on every call for freshness (no caching).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

export interface KBSection {
  heading: string;
  level: number; // 1-6
  content: string;
}

export class KnowledgeBaseReader {
  private filePath: string;

  constructor(filePath: string = "./knowledge-base.md") {
    this.filePath = resolve(filePath);
  }

  /**
   * Read the entire knowledge base as a string.
   * Returns empty string if file doesn't exist.
   */
  private getFullContent(): string {
    try {
      return readFileSync(this.filePath, "utf-8");
    } catch {
      return "";
    }
  }

  /**
   * Parse the markdown file into sections based on ## headers.
   * Returns array of sections with heading, level, and content.
   */
  private parseSections(): KBSection[] {
    const content = this.getFullContent();
    if (!content) return [];

    const lines = content.split("\n");
    const sections: KBSection[] = [];
    let currentSection: KBSection | null = null;

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        // Save the current section before starting a new one
        if (currentSection) {
          currentSection.content = currentSection.content.trim();
          sections.push(currentSection);
        }
        currentSection = {
          heading: headingMatch[2]?.trim() ?? "",
          level: headingMatch[1]?.length ?? 1,
          content: "",
        };
      } else if (currentSection) {
        currentSection.content += line + "\n";
      }
    }

    // Don't forget the last section
    if (currentSection) {
      currentSection.content = currentSection.content.trim();
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * Search sections by keyword (case-insensitive string matching).
   * Splits query into keywords and returns sections matching any keyword.
   * Returns matching sections as plain text, or fallback message if nothing matches.
   */
  search(query: string): string {
    const sections = this.parseSections();
    if (sections.length === 0) {
      return "No matching sections found in knowledge base.";
    }

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length > 0);

    if (keywords.length === 0) {
      return "No matching sections found in knowledge base.";
    }

    const matchedSections = sections.filter((section) => {
      const headingLower = section.heading.toLowerCase();
      const contentLower = section.content.toLowerCase();
      return keywords.some(
        (kw) => headingLower.includes(kw) || contentLower.includes(kw)
      );
    });

    if (matchedSections.length === 0) {
      return "No matching sections found in knowledge base.";
    }

    // Format matched sections as plain text
    return matchedSections
      .map((section) => `## ${section.heading}\n\n${section.content}`)
      .join("\n\n---\n\n");
  }
}

/**
 * Factory function to create a KnowledgeBaseReader instance.
 * @param filePath - Path to the knowledge base markdown file (default: ./knowledge-base.md)
 * @returns KnowledgeBaseReader instance
 */
export function createKBReader(filePath?: string): KnowledgeBaseReader {
  return new KnowledgeBaseReader(filePath);
}
