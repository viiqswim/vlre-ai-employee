import type { PropertyLock } from '../lock-types.ts';

interface VlreHubClientConfig {
  baseUrl: string;
}

export class VlreHubClient {
  private baseUrl: string;

  constructor(config: VlreHubClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async getLocksForProperty(hostfullyPropertyUid: string): Promise<PropertyLock[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/internal/properties/${encodeURIComponent(hostfullyPropertyUid)}/locks`
      );
      if (!response.ok) {
        console.warn(`[vlre-hub] getLocksForProperty failed: ${response.status} for property ${hostfullyPropertyUid}`);
        return [];
      }
      const data = await response.json() as { locks?: PropertyLock[] };
      return data.locks ?? [];
    } catch (error) {
      console.warn(`[vlre-hub] getLocksForProperty error for property ${hostfullyPropertyUid}:`, error);
      return [];
    }
  }
}

export function createVlreHubClient(config?: Partial<VlreHubClientConfig>): VlreHubClient {
  return new VlreHubClient({
    baseUrl: config?.baseUrl ?? process.env['VLRE_HUB_URL'] ?? 'http://localhost:7311',
  });
}
