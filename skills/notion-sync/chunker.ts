export interface Chunk {
  heading: string | null; // H2/H3 heading text (without #), null for pre-header content
  content: string; // Full section text (heading line + body), trimmed
}

export interface ChunkOptions {
  minChunkLength?: number; // default: 50
}

/**
 * Split markdown into chunks based on H2 and H3 headers.
 * Only H2 (##) and H3 (###) are split points.
 * H4+ headers remain part of their parent section.
 *
 * @param markdown - The markdown string to chunk
 * @param options - Configuration options
 * @returns Array of chunks with heading and content
 */
export function chunkMarkdown(
  markdown: string,
  options: ChunkOptions = {}
): Chunk[] {
  const minChunkLength = options.minChunkLength ?? 50;

  if (!markdown || markdown.trim().length === 0) {
    return [];
  }

  const chunks: Chunk[] = [];
  const lines = markdown.split("\n");

  // Regex to match H2 and H3 headers
  const headerRegex = /^(#{2,3})\s+(.+)$/;

  let currentHeading: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = line.match(headerRegex);

    if (match) {
      // Found a new header (H2 or H3)
      const level = match[1]; // "##" or "###"
      const headingText = (match[2] ?? "").trim();

      // Save the previous section if it has content
      if (currentContent.length > 0) {
        const contentStr = currentContent.join("\n").trim();
        if (contentStr.length >= minChunkLength) {
          chunks.push({
            heading: currentHeading,
            content: contentStr,
          });
        }
      }

      // Start a new section
      currentHeading = headingText;
      currentContent = [line];
    } else {
      // Regular content line (including H4+ headers)
      currentContent.push(line);
    }
  }

  // Don't forget the last section
  if (currentContent.length > 0) {
    const contentStr = currentContent.join("\n").trim();
    if (contentStr.length >= minChunkLength) {
      chunks.push({
        heading: currentHeading,
        content: contentStr,
      });
    }
  }

  // If no chunks were created and we have content, return it as a single chunk
  if (chunks.length === 0 && markdown.trim().length > 0) {
    const contentStr = markdown.trim();
    if (contentStr.length >= minChunkLength) {
      chunks.push({
        heading: null,
        content: contentStr,
      });
    }
  }

  return chunks;
}
