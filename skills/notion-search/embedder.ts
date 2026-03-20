import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Bypasses TS2590 — the AllTasks generic in @huggingface/transformers resolves to a union
// too complex for TypeScript to represent. Casting pipeline to a simple function type
// before calling it prevents the complex union from being computed.
type PipelineLoader = (task: string, model: string, options: object) => Promise<FeatureExtractionPipeline>;

export interface EmbeddingModel {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  isReady(): boolean;
}

export class TransformersEmbedder implements EmbeddingModel {
  private featurePipeline: FeatureExtractionPipeline | null = null;
  private ready = false;

  async initialize(): Promise<void> {
    try {
      // Load the model — downloads ~80MB to ~/.cache/huggingface/hub/ on first run
      const loader = pipeline as unknown as PipelineLoader;
      this.featurePipeline = await loader('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {});
      // Warm up with dummy text to eliminate cold-start latency
      await this.embed('warmup');
      this.ready = true;
      console.log('[NOTION] Embedding model loaded and warmed up (all-MiniLM-L6-v2, 384-dim)');
    } catch (error) {
      console.error('[NOTION] Failed to load embedding model:', (error as Error).message);
      this.ready = false;
      // Do NOT rethrow — allow graceful degradation
    }
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.featurePipeline) {
      throw new Error('[NOTION] Embedding model not initialized. Call initialize() first.');
    }
    // Output tensor dims: [1, 384] — data is a flat Float32Array with 384 elements.
    const output = await this.featurePipeline._call(text, { pooling: 'mean', normalize: true });
    return output.data as Float32Array;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Process sequentially to avoid memory spikes
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  isReady(): boolean {
    return this.ready;
  }
}

/**
 * Factory that creates and initializes an embedder.
 * Downloads model on first call (~80MB), cached afterward.
 */
export async function createEmbedder(): Promise<EmbeddingModel> {
  const embedder = new TransformersEmbedder();
  await embedder.initialize();
  return embedder;
}
