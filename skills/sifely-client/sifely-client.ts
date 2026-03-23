import type { LockPasscode, AccessRecord } from '../lock-types.ts';

interface SifelyClientConfig {
  baseUrl: string;
  clientId: string;
  username: string;
  password: string;
}

interface SifelyLoginResponse {
  code: number;
  msg?: string;
  data?: {
    token: string;
  };
}

interface SifelyListResponse<T> {
  list?: T[];
  pageNo?: number;
  pageSize?: number;
  code?: number;
  msg?: string;
}

interface SifelyMutationResponse {
  errcode?: number;
  errmsg?: string;
  code?: number;
  msg?: string;
}

interface SifelyPasscodeRaw {
  keyboardPwdId: number;
  keyboardPwd: string;
  keyboardPwdName: string;
  keyboardPwdType: number;
  startDate: number;
  endDate: number;
  status: number;
}

interface SifelyAccessRecordRaw {
  recordId: number;
  lockId: number;
  recordType: number;
  success: number;
  keyboardPwd: string;
  lockDate: number;
  serverDate: number;
}

export class SifelyClient {
  private baseUrl: string;
  private clientId: string;
  private username: string;
  private password: string;
  private token: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: SifelyClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.clientId = config.clientId;
    this.username = config.username;
    this.password = config.password;
  }

  /**
   * Sifely returns HTTP 200 even on auth failure — must check response.code, not HTTP status.
   * Authorization header format: "Authorization: {token}" (no Bearer prefix).
   */
  private async login(): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      username: this.username,
      password: this.password,
      date: String(Date.now()),
    });

    const response = await fetch(`${this.baseUrl}/system/smart/login?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Origin: 'https://manager.sifely.com',
        Referer: 'https://manager.sifely.com/',
        isToken: 'false',
      },
    });

    if (!response.ok) {
      throw new Error(`Sifely login HTTP error: ${response.status} ${response.statusText}`);
    }

    const body = await response.json() as SifelyLoginResponse;

    if (body.code !== 200 || !body.data?.token) {
      throw new Error(`Sifely authentication failed: ${body.msg ?? `code ${body.code}`}`);
    }

    this.token = body.data.token;
    this.tokenExpiry = Date.now() + 2 * 60 * 60 * 1000;

    return this.token;
  }

  private async getToken(): Promise<string> {
    if (this.token !== null && Date.now() < this.tokenExpiry) {
      return this.token;
    }
    return this.login();
  }

  /**
   * Sifely auth failures arrive as HTTP 200 with body.code=-3 (not HTTP 401).
   * Clears the cached token and retries once on any auth-related error.
   */
  private async withAuthRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.getToken();
    try {
      return await fn(token);
    } catch (error) {
      const isAuthError =
        error instanceof Error &&
        (error.message.includes('auth') ||
          error.message.includes('token') ||
          error.message.includes('login') ||
          error.message.includes('-3') ||
          error.message.includes('401'));

      if (!isAuthError) {
        throw error;
      }

      this.token = null;
      this.tokenExpiry = 0;
      const freshToken = await this.login();
      return fn(freshToken);
    }
  }

  /**
   * Sifely list success omits `code` entirely — { list: [...] }.
   * Sifely list errors include `code` — { code: -X, msg: "..." }.
   * Must check for presence of code field, not just its value.
   */
  async listPasscodes(sifelyLockId: string): Promise<LockPasscode[]> {
    return this.withAuthRetry(async (token) => {
      const params = new URLSearchParams({
        lockId: sifelyLockId,
        pageNo: '1',
        pageSize: '100',
        date: String(Date.now()),
      });

      const response = await fetch(
        `${this.baseUrl}/v3/lock/listKeyboardPwd?${params.toString()}`,
        {
          method: 'GET',
          headers: { Authorization: token },
        }
      );

      if (!response.ok) {
        throw new Error(`Sifely listPasscodes HTTP error: ${response.status} ${response.statusText}`);
      }

      const body = await response.json() as SifelyListResponse<SifelyPasscodeRaw>;

      if (body.code !== undefined) {
        throw new Error(`Sifely listPasscodes error: ${body.msg ?? `code ${body.code}`}`);
      }

      return (body.list ?? []).map((item): LockPasscode => ({
        keyboardPwdId: item.keyboardPwdId,
        lockId: sifelyLockId,
        keyboardPwd: item.keyboardPwd,
        keyboardPwdName: item.keyboardPwdName,
        keyboardPwdType: item.keyboardPwdType,
        startDate: item.startDate,
        endDate: item.endDate,
        status: item.status,
      }));
    });
  }

  async listAccessRecords(
    sifelyLockId: string,
    startDate: number,
    endDate: number
  ): Promise<AccessRecord[]> {
    return this.withAuthRetry(async (token) => {
      const params = new URLSearchParams({
        lockId: sifelyLockId,
        startDate: String(startDate),
        endDate: String(endDate),
        pageNo: '1',
        pageSize: '20',
        date: String(Date.now()),
      });

      const response = await fetch(
        `${this.baseUrl}/v3/lockRecord/list?${params.toString()}`,
        {
          method: 'GET',
          headers: { Authorization: token },
        }
      );

      if (!response.ok) {
        throw new Error(`Sifely listAccessRecords HTTP error: ${response.status} ${response.statusText}`);
      }

      const body = await response.json() as SifelyListResponse<SifelyAccessRecordRaw>;

      if (body.code !== undefined) {
        throw new Error(`Sifely listAccessRecords error: ${body.msg ?? `code ${body.code}`}`);
      }

      return (body.list ?? []).map((item): AccessRecord => ({
        recordId: item.recordId,
        lockId: item.lockId,
        recordType: item.recordType,
        success: item.success,
        keyboardPwd: item.keyboardPwd,
        lockDate: item.lockDate,
        serverDate: item.serverDate,
      }));
    });
  }

  async updatePasscode(params: {
    keyboardPwdId: number;
    lockId: string;
    newKeyboardPwd: string;
  }): Promise<void> {
    await this.withAuthRetry(async (token) => {
      const qs = new URLSearchParams({
        lockId: params.lockId,
        keyboardPwdId: String(params.keyboardPwdId),
        newKeyboardPwd: params.newKeyboardPwd,
        changeType: '2',
        date: String(Date.now()),
      });

      const response = await fetch(
        `${this.baseUrl}/v3/keyboardPwd/update?${qs.toString()}`,
        {
          method: 'POST',
          headers: { Authorization: token },
        }
      );

      if (!response.ok) {
        throw new Error(`Sifely updatePasscode HTTP error: ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      if (!text || text.trim() === '') {
        return;
      }

      const body = JSON.parse(text) as SifelyMutationResponse;

      if (body.errcode !== undefined && body.errcode !== 0) {
        throw new Error(`Sifely updatePasscode failed: ${body.errmsg ?? `errcode ${body.errcode}`}`);
      }

      if (body.code !== undefined && body.code !== 200) {
        throw new Error(`Sifely updatePasscode error: ${body.msg ?? `code ${body.code}`}`);
      }
    });
  }
}

export function createSifelyClient(config?: Partial<SifelyClientConfig>): SifelyClient {
  return new SifelyClient({
    baseUrl: config?.baseUrl ?? process.env['SIFELY_BASE_URL'] ?? 'https://app-smart-server.sifely.com',
    clientId: config?.clientId ?? process.env['SIFELY_CLIENT_ID'] ?? '',
    username: config?.username ?? process.env['SIFELY_USERNAME'] ?? '',
    password: config?.password ?? process.env['SIFELY_PASSWORD'] ?? '',
  });
}
