/**
 * Pure math functions for vector similarity search.
 * No external dependencies — uses native Float32Array and Buffer.
 */

/**
 * Standard cosine similarity between two vectors.
 * Returns 1.0 for identical vectors, 0.0 for orthogonal, -1.0 for opposite.
 * Returns 0 if either vector has zero magnitude (avoids NaN).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i];
    const bVal = b[i];
    if (aVal !== undefined && bVal !== undefined) {
      dotProduct += aVal * bVal;
      magnitudeA += aVal * aVal;
      magnitudeB += bVal * bVal;
    }
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  // Handle zero-magnitude vectors
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Convert Float32Array to Buffer for SQLite BLOB storage.
 * Buffer wraps the same underlying ArrayBuffer — no copy needed.
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/**
 * Convert Buffer (from SQLite BLOB) back to Float32Array.
 * IMPORTANT: Bun's bun:sqlite returns Uint8Array for BLOBs, not Buffer.
 * This function accepts both Buffer and Uint8Array.
 */
export function bufferToEmbedding(buffer: Buffer | Uint8Array): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

/**
 * Find top-K candidates by cosine similarity to query.
 * Returns sorted descending by score (highest first).
 */
export function topKBySimilarity(
  query: Float32Array,
  candidates: Array<{ id: number; embedding: Float32Array }>,
  k: number
): Array<{ id: number; score: number }> {
  if (k < 0) {
    throw new Error(`k must be non-negative, got ${k}`);
  }

  if (candidates.length === 0) {
    return [];
  }

  // Compute similarity for each candidate
  const scored = candidates.map((candidate) => ({
    id: candidate.id,
    score: cosineSimilarity(query, candidate.embedding),
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Return top K
  return scored.slice(0, k);
}
