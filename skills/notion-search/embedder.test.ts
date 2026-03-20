import { test, expect, describe, beforeAll } from 'bun:test';
import { TransformersEmbedder, createEmbedder, type EmbeddingModel } from './embedder.js';

// Set test timeout to 120s — model downloads ~80MB on first run, cached afterward.
describe('TransformersEmbedder', () => {
  let embedder: EmbeddingModel;

  beforeAll(async () => {
    embedder = await createEmbedder();
  }, 120000);

  test('isReady() returns true after initialization', () => {
    expect(embedder.isReady()).toBe(true);
  });

  test('embed() returns Float32Array of length 384', async () => {
    const result = await embedder.embed('hello world');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(384);
  }, 30000);

  test('embed() returns different vectors for different inputs', async () => {
    const v1 = await embedder.embed('wifi password access network');
    const v2 = await embedder.embed('check-in time early late arrival');
    expect(v1).not.toEqual(v2);
  }, 30000);

  test('embed() is deterministic (same input → same output)', async () => {
    const v1 = await embedder.embed('house rules quiet hours');
    const v2 = await embedder.embed('house rules quiet hours');
    expect(v1.length).toBe(v2.length);
    const allValuesMatch = Array.from(v1).every((val, i) => val === v2[i]);
    expect(allValuesMatch).toBe(true);
  }, 30000);

  test('embedBatch() returns correct number of embeddings', async () => {
    const texts = ['first text', 'second text', 'third text'];
    const results = await embedder.embedBatch(texts);
    expect(results.length).toBe(3);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[0]?.length).toBe(384);
  }, 60000);

  test('embedBatch() with empty array returns empty array', async () => {
    const results = await embedder.embedBatch([]);
    expect(results).toEqual([]);
  });

  test('embed() returns unit vector (normalized)', async () => {
    const vec = await embedder.embed('test normalization');
    const l2Norm = Math.sqrt(Array.from(vec).reduce((sum, v) => sum + v * v, 0));
    expect(l2Norm).toBeCloseTo(1.0, 2);
  }, 30000);
});

describe('TransformersEmbedder — uninitialized behavior', () => {
  test('embed() throws when model not initialized', async () => {
    const uninitializedEmbedder = new TransformersEmbedder();
    await expect(uninitializedEmbedder.embed('test')).rejects.toThrow('not initialized');
  });

  test('isReady() returns false before initialization', () => {
    const uninitializedEmbedder = new TransformersEmbedder();
    expect(uninitializedEmbedder.isReady()).toBe(false);
  });
});
