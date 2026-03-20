import { test, expect, describe } from "bun:test";
import {
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
  topKBySimilarity,
} from "./vector-math.js";

describe("cosineSimilarity", () => {
  test("identical vectors return ~1.0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    const result = cosineSimilarity(a, b);
    expect(result).toBeCloseTo(1.0, 4);
  });

  test("orthogonal vectors return ~0.0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    const result = cosineSimilarity(a, b);
    expect(result).toBeCloseTo(0.0, 4);
  });

  test("opposite vectors return ~-1.0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    const result = cosineSimilarity(a, b);
    expect(result).toBeCloseTo(-1.0, 4);
  });

  test("zero magnitude vector returns 0 (no NaN)", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    const result = cosineSimilarity(a, b);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });

  test("both zero magnitude vectors return 0", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([0, 0, 0]);
    const result = cosineSimilarity(a, b);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe("embeddingToBuffer", () => {
  test("returns Buffer with correct byte length", () => {
    const embedding = new Float32Array([1.5, 2.5, 3.5]);
    const buffer = embeddingToBuffer(embedding);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.byteLength).toBe(12); // 3 floats * 4 bytes
  });

  test("buffer wraps same underlying data (no copy)", () => {
    const embedding = new Float32Array([1.5, 2.5, 3.5]);
    const buffer = embeddingToBuffer(embedding);
    embedding[0] = 99;
    const view = new Float32Array(buffer.buffer, buffer.byteOffset, 3);
    expect(view[0]).toBe(99);
  });
});

describe("bufferToEmbedding", () => {
  test("round-trip Float32Array → Buffer → Float32Array preserves values", () => {
    const original = new Float32Array([1.5, 2.5, 3.5]);
    const buffer = embeddingToBuffer(original);
    const restored = bufferToEmbedding(buffer);
    expect(restored.length).toBe(3);
    expect(restored[0]).toBe(1.5);
    expect(restored[1]).toBe(2.5);
    expect(restored[2]).toBe(3.5);
  });

  test("accepts Buffer input", () => {
    const embedding = new Float32Array([1.5, 2.5, 3.5]);
    const buffer = embeddingToBuffer(embedding);
    const restored = bufferToEmbedding(buffer);
    expect(restored.length).toBe(3);
    expect(restored[0]).toBe(1.5);
  });

  test("accepts Uint8Array input", () => {
    const embedding = new Float32Array([1.5, 2.5, 3.5]);
    const buffer = embeddingToBuffer(embedding);
    const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const restored = bufferToEmbedding(uint8);
    expect(restored.length).toBe(3);
    expect(restored[0]).toBe(1.5);
  });
});

describe("topKBySimilarity", () => {
  test("returns top-K sorted by score (highest first)", () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 1, embedding: new Float32Array([1, 0, 0]) }, // similarity = 1.0
      { id: 2, embedding: new Float32Array([0, 1, 0]) }, // similarity = 0.0
      { id: 3, embedding: new Float32Array([-1, 0, 0]) }, // similarity = -1.0
    ];
    const result = topKBySimilarity(query, candidates, 3);
    expect(result.length).toBe(3);
    const r0 = result[0];
    const r1 = result[1];
    const r2 = result[2];
    if (r0 !== undefined) expect(r0.id).toBe(1);
    if (r0 !== undefined) expect(r0.score).toBeCloseTo(1.0, 4);
    if (r1 !== undefined) expect(r1.id).toBe(2);
    if (r1 !== undefined) expect(r1.score).toBeCloseTo(0.0, 4);
    if (r2 !== undefined) expect(r2.id).toBe(3);
    if (r2 !== undefined) expect(r2.score).toBeCloseTo(-1.0, 4);
  });

  test("k=2 with 3 candidates returns only 2", () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 1, embedding: new Float32Array([1, 0, 0]) },
      { id: 2, embedding: new Float32Array([0, 1, 0]) },
      { id: 3, embedding: new Float32Array([-1, 0, 0]) },
    ];
    const result = topKBySimilarity(query, candidates, 2);
    expect(result.length).toBe(2);
    const r0 = result[0];
    const r1 = result[1];
    if (r0 !== undefined) expect(r0.id).toBe(1);
    if (r1 !== undefined) expect(r1.id).toBe(2);
  });

  test("empty candidates returns empty array", () => {
    const query = new Float32Array([1, 0, 0]);
    const result = topKBySimilarity(query, [], 5);
    expect(result.length).toBe(0);
  });

  test("k larger than candidates.length returns all candidates", () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 1, embedding: new Float32Array([1, 0, 0]) },
      { id: 2, embedding: new Float32Array([0, 1, 0]) },
    ];
    const result = topKBySimilarity(query, candidates, 10);
    expect(result.length).toBe(2);
  });

  test("k=0 returns empty array", () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 1, embedding: new Float32Array([1, 0, 0]) },
      { id: 2, embedding: new Float32Array([0, 1, 0]) },
    ];
    const result = topKBySimilarity(query, candidates, 0);
    expect(result.length).toBe(0);
  });

  test("full round-trip: buffer → embedding → similarity → correct score", () => {
    const queryEmbedding = new Float32Array([1, 0, 0]);
    const queryBuffer = embeddingToBuffer(queryEmbedding);
    const queryRestored = bufferToEmbedding(queryBuffer);

    const candidateEmbedding = new Float32Array([1, 0, 0]);
    const candidateBuffer = embeddingToBuffer(candidateEmbedding);
    const candidateRestored = bufferToEmbedding(candidateBuffer);

    const candidates = [{ id: 42, embedding: candidateRestored }];
    const result = topKBySimilarity(queryRestored, candidates, 1);

    expect(result.length).toBe(1);
    const r0 = result[0];
    if (r0 !== undefined) expect(r0.id).toBe(42);
    if (r0 !== undefined) expect(r0.score).toBeCloseTo(1.0, 4);
  });
});
