import type {
  HostfullyMessage,
  HostfullyThread,
  HostfullyLead,
  HostfullyProperty,
  HostfullySendMessageRequest,
  HostfullySendMessageResponse,
  HostfullyMessagesListResponse,
  HostfullyWebhookRegistrationRequest,
  HostfullyWebhookRegistrationResponse,
  HostfullyApiError,
  HostfullyClientConfig,
  HostfullyCustomData,
} from './types.ts';
import { withRetry, type RetryConfig } from '../pipeline/retry.ts';

export class HostfullyClient {
  private apiKey: string;
  private baseUrl: string;
  private agencyUid: string;
  private retryConfig: Partial<RetryConfig>;

  constructor(config: HostfullyClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.agencyUid = config.agencyUid;
    this.retryConfig = config.retryConfig ?? {};
  }

  private get headers(): Record<string, string> {
    return {
      'X-HOSTFULLY-APIKEY': this.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private get v3BaseUrl(): string {
    return this.baseUrl.replace('/v3.2', '/v3');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return withRetry(async () => {
      const response = await fetch(url, {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Hostfully API rate limit exceeded (429) — too many requests, slow down or check quota');
        }

        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `Hostfully API authentication failed (${response.status}) — check that HOSTFULLY_API_KEY is valid and has not been rotated`
          );
        }

        let errorMessage = `Hostfully API error: ${response.status} ${response.statusText}`;
        try {
          const errorBody = await response.json() as HostfullyApiError;
          if (errorBody.message) errorMessage += ` — ${errorBody.message}`;
          if (errorBody.error) errorMessage += ` — ${errorBody.error}`;
        } catch {
          // non-JSON error body — keep base message
        }
        throw new Error(errorMessage);
      }

      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return undefined as unknown as T;
      }
      return response.json() as Promise<T>;
    }, this.retryConfig);
  }

  private async requestV3<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.v3BaseUrl}${path}`;
    return withRetry(async () => {
      const response = await fetch(url, {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Hostfully API rate limit exceeded (429) — too many requests, slow down or check quota');
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `Hostfully API authentication failed (${response.status}) — check that HOSTFULLY_API_KEY is valid and has not been rotated`
          );
        }
        let errorMessage = `Hostfully API error: ${response.status} ${response.statusText}`;
        try {
          const errorBody = await response.json() as HostfullyApiError;
          if (errorBody.message) errorMessage += ` — ${errorBody.message}`;
          if (errorBody.error) errorMessage += ` — ${errorBody.error}`;
        } catch {
          // non-JSON error body — keep base message
        }
        throw new Error(errorMessage);
      }

      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return undefined as unknown as T;
      }

      return response.json() as Promise<T>;
    }, this.retryConfig);
  }

  private async requestOnce<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Hostfully API rate limit exceeded (429) — too many requests, slow down or check quota');
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Hostfully API authentication failed (${response.status}) — check that HOSTFULLY_API_KEY is valid and has not been rotated`
        );
      }

      let errorMessage = `Hostfully API error: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json() as HostfullyApiError;
        if (errorBody.message) errorMessage += ` — ${errorBody.message}`;
        if (errorBody.error) errorMessage += ` — ${errorBody.error}`;
      } catch {
        // non-JSON error body — keep base message
      }
      throw new Error(errorMessage);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as unknown as T;
    }
    return response.json() as Promise<T>;
  }

  async getMessage(messageUid: string): Promise<HostfullyMessage> {
    const raw = await this.request<{ message: Record<string, unknown> }>('GET', `/messages/${messageUid}`);
    const inner = raw.message ?? (raw as unknown as Record<string, unknown>);
    const contentRaw = inner['content'] as { subject?: string | null; text?: string } | string | undefined;
    const contentText =
      typeof contentRaw === 'object' && contentRaw !== null
        ? (contentRaw.text ?? '')
        : (contentRaw ?? '');
    return { ...inner, content: contentText } as unknown as HostfullyMessage;
  }

  async getMessages(leadUid: string): Promise<HostfullyMessage[]> {
    const response = await this.request<HostfullyMessagesListResponse>(
      'GET',
      `/messages?leadUid=${encodeURIComponent(leadUid)}`
    );
    return (response.messages ?? []).map((m) => {
      const contentRaw = m.content as unknown as { subject?: string | null; text?: string } | string | undefined;
      const contentText =
        typeof contentRaw === 'object' && contentRaw !== null
          ? (contentRaw.text ?? '')
          : (contentRaw ?? '');
      return { ...m, content: contentText as string };
    });
  }

  async getThread(threadUid: string): Promise<HostfullyThread> {
    const raw = await this.request<{ thread?: Record<string, unknown> }>('GET', `/threads/${threadUid}`);
    const inner = (raw.thread ?? raw) as Record<string, unknown>;
    const participants = inner['participants'] as Array<{ participantType: string; participantUid: string; uid: string }> | undefined;
    const leadParticipant = participants?.find(p => p.participantType === 'LEAD');
    const leadUid = leadParticipant?.participantUid;
    return { ...inner, leadUid } as unknown as HostfullyThread;
  }

  async getLead(leadUid: string): Promise<HostfullyLead> {
    const raw = await this.request<{ lead?: Record<string, unknown> }>('GET', `/leads/${leadUid}`);
    const inner = (raw.lead ?? raw) as Record<string, unknown>;
    const guestInfo = inner['guestInformation'] as Record<string, unknown> | undefined;
    const checkInIso = inner['checkInZonedDateTime'] as string | undefined;
    const checkOutIso = inner['checkOutZonedDateTime'] as string | undefined;
    const checkInDate = checkInIso?.slice(0, 10);
    const checkOutDate = checkOutIso?.slice(0, 10);
    const numberOfNights =
      checkInDate && checkOutDate
        ? Math.round((new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / 86400000)
        : undefined;
    return {
      ...inner,
      guestFirstName: guestInfo?.['firstName'] as string | undefined,
      guestLastName: guestInfo?.['lastName'] as string | undefined,
      checkInDate,
      checkOutDate,
      numberOfNights,
    } as unknown as HostfullyLead;
  }

  async getProperty(propertyUid: string): Promise<HostfullyProperty> {
    const raw = await this.request<{ property?: Record<string, unknown> }>('GET', `/properties/${propertyUid}`);
    return (raw.property ?? raw) as unknown as HostfullyProperty;
  }

  async sendMessage(threadUid: string, text: string): Promise<HostfullySendMessageResponse> {
    const body: HostfullySendMessageRequest = {
      type: 'DIRECT_MESSAGE',
      threadUid,
      content: { subject: null, text },
    };
    // No retry — POST idempotency risk: retrying could send duplicate messages to guests
    return this.requestOnce<HostfullySendMessageResponse>('POST', '/messages', body);
  }

  async listWebhooks(agencyUid: string): Promise<HostfullyWebhookRegistrationResponse[]> {
    const response = await this.request<{ webhooks?: HostfullyWebhookRegistrationResponse[] }>(
      'GET',
      `/webhooks?agencyUid=${encodeURIComponent(agencyUid)}`
    );
    return response.webhooks ?? [];
  }

  async registerWebhook(
    agencyUid: string,
    eventType: string,
    callbackUrl: string,
    webhookType = 'POST_JSON'
  ): Promise<HostfullyWebhookRegistrationResponse> {
    const body: HostfullyWebhookRegistrationRequest = {
      agencyUid,
      eventType,
      callbackUrl,
      webhookType,
      objectUid: agencyUid,
    };
    const response = await this.request<{ webhook?: HostfullyWebhookRegistrationResponse }>(
      'POST',
      '/webhooks',
      body
    );
    return response.webhook ?? ({} as HostfullyWebhookRegistrationResponse);
  }

  async deregisterWebhook(webhookUid: string): Promise<void> {
    await this.request<void>('DELETE', `/webhooks/${webhookUid}`);
  }

  async getCustomData(propertyUid: string): Promise<HostfullyCustomData[]> {
    const response = await this.requestV3<{ customData?: HostfullyCustomData[] }>(
      'GET',
      `/custom-data?propertyUid=${encodeURIComponent(propertyUid)}`
    );
    return response.customData ?? [];
  }

  async getDoorCode(propertyUid: string): Promise<string | null> {
    const customData = await this.getCustomData(propertyUid);
    const doorCodeField = customData.find(
      (field) => field.customDataField.name === 'door_code'
    );
    return doorCodeField?.text ?? null;
  }

  async updateCustomData(
    propertyUid: string,
    fieldUid: string,
    text: string
  ): Promise<void> {
    await this.request<void>(
      'PUT',
      `/properties/${propertyUid}/customData/${fieldUid}`,
      { text }
    );
  }

  async updateDoorCode(propertyUid: string, newCode: string): Promise<void> {
    const customData = await this.getCustomData(propertyUid);
    const doorCodeField = customData.find(
      (field) => field.customDataField.name === 'door_code'
    );
    if (!doorCodeField) {
      throw new Error(
        `No door_code custom data field found for property ${propertyUid}`
      );
    }
    await this.updateCustomData(propertyUid, doorCodeField.customDataField.uid, newCode);
  }

  async validateApiKey(options?: { _retryDelayMs?: number }): Promise<void> {
    const agencyUid = this.agencyUid || process.env['HOSTFULLY_AGENCY_UID'] || '';
    const maxAttempts = 3;
    const retryDelayMs = options?._retryDelayMs ?? 2000;
    const timeoutMs = 5000;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(`${this.baseUrl}/webhooks?agencyUid=${encodeURIComponent(agencyUid)}`, {
            method: 'GET',
            headers: this.headers,
            signal: controller.signal,
          });
          if (response.status === 401 || response.status === 403) {
            throw new Error(
              `Hostfully API key is invalid or unauthorized (${response.status}) — check HOSTFULLY_API_KEY in .env`
            );
          }
          if (!response.ok) {
            throw new Error(`Hostfully API returned ${response.status} during validation — will retry`);
          }
          return;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error;
        const isAuthError = error instanceof Error && (
          error.message.includes('invalid or unauthorized') ||
          error.message.includes('401') ||
          error.message.includes('403')
        );
        if (isAuthError) throw error;
        if (attempt < maxAttempts) {
          await new Promise<void>((r) => setTimeout(r, retryDelayMs));
        }
      }
    }
    throw lastError;
  }
}

export function createHostfullyClient(config?: Partial<HostfullyClientConfig>): HostfullyClient {
  return new HostfullyClient({
    apiKey: config?.apiKey ?? process.env['HOSTFULLY_API_KEY']!,
    agencyUid: config?.agencyUid ?? process.env['HOSTFULLY_AGENCY_UID']!,
    baseUrl: config?.baseUrl ?? process.env['HOSTFULLY_API_URL'] ?? 'https://api.hostfully.com/api/v3.2',
  });
}
