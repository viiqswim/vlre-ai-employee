import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { SifelyClient } from './sifely-client.ts';

const TEST_CONFIG = {
  baseUrl: 'https://app-smart-server.sifely.com',
  clientId: 'test-client-id',
  username: 'test-user',
  password: 'test-pass',
};

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setToken(c: SifelyClient): void {
  (c as unknown as Record<string, unknown>)['token'] = 'cached-token';
  (c as unknown as Record<string, unknown>)['tokenExpiry'] = Date.now() + 3_600_000;
}

let client: SifelyClient;
let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  client = new SifelyClient(TEST_CONFIG);
  fetchMock = mock(() => Promise.resolve(mockResponse({})));
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('login', () => {
  test('fetches token on first call and passes it as Authorization header', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ code: 200, data: { token: 'test-token' } }))
    );
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ list: [] }))
    );

    await client.listPasscodes('lock-123');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const loginUrl = (fetchMock.mock.calls[0] as [string])[0];
    expect(loginUrl).toContain('/system/smart/login');
    const [apiUrl, opts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(apiUrl).toContain('/v3/lock/listKeyboardPwd');
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('test-token');
  });

  test('throws when server returns non-200 code', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ code: 401, msg: 'Invalid credentials' }))
    );

    await expect(client.listPasscodes('lock-123')).rejects.toThrow('Invalid credentials');
  });

  test('caches token — second API call skips re-login', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() => Promise.resolve(mockResponse({ list: [] })));
    fetchMock.mockImplementationOnce(() => Promise.resolve(mockResponse({ list: [] })));

    await client.listPasscodes('lock-1');
    await client.listPasscodes('lock-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const url = (call as [string])[0];
      expect(url).not.toContain('/system/smart/login');
    }
  });
});

describe('listPasscodes', () => {
  test('returns array with correct LockPasscode shape', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        mockResponse({
          list: [
            {
              keyboardPwdId: 1,
              keyboardPwd: '1234',
              keyboardPwdName: 'Guest Code',
              keyboardPwdType: 2,
              startDate: 1_000_000,
              endDate: 2_000_000,
              status: 1,
            },
          ],
        })
      )
    );

    const result = await client.listPasscodes('lock-123');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      keyboardPwdId: 1,
      keyboardPwd: '1234',
      keyboardPwdType: 2,
      lockId: 'lock-123',
    });
  });

  test('throws when response body contains an error code field', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ code: -3, msg: 'Error' }))
    );
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ code: 200, data: { token: 'new-token' } }))
    );
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ code: -3, msg: 'Error' }))
    );

    await expect(client.listPasscodes('lock-123')).rejects.toThrow('Sifely listPasscodes error');
  });

  test('returns empty array when list field is absent', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() => Promise.resolve(mockResponse({})));

    const result = await client.listPasscodes('lock-123');
    expect(result).toEqual([]);
  });
});

describe('listAccessRecords', () => {
  test('returns AccessRecord[] with correct shape', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        mockResponse({
          list: [
            {
              recordId: 1,
              lockId: 123,
              recordType: 4,
              success: 1,
              keyboardPwd: '1234',
              lockDate: 1000,
              serverDate: 1001,
            },
          ],
        })
      )
    );

    const result = await client.listAccessRecords('lock-123', 0, Date.now());

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      recordId: 1,
      lockId: 123,
      recordType: 4,
      success: 1,
      keyboardPwd: '1234',
      lockDate: 1000,
      serverDate: 1001,
    });
  });

  test('returns empty array when list field is absent', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() => Promise.resolve(mockResponse({})));

    const result = await client.listAccessRecords('lock-123', 0, Date.now());
    expect(result).toEqual([]);
  });
});

describe('updatePasscode', () => {
  test('resolves without error when errcode is 0', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ errcode: 0 }))
    );

    await expect(
      client.updatePasscode({ keyboardPwdId: 1, lockId: 'lock-123', newKeyboardPwd: '5678' })
    ).resolves.toBeUndefined();

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v3/keyboardPwd/update');
    expect(opts.method).toBe('POST');
  });

  test('throws when errcode is non-zero', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ errcode: 1, errmsg: 'Failed to update' }))
    );

    await expect(
      client.updatePasscode({ keyboardPwdId: 1, lockId: 'lock-123', newKeyboardPwd: '5678' })
    ).rejects.toThrow('Failed to update');
  });

  test('resolves when response body is empty', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(new Response('', { status: 200 }))
    );

    await expect(
      client.updatePasscode({ keyboardPwdId: 2, lockId: 'lock-456', newKeyboardPwd: '0000' })
    ).resolves.toBeUndefined();
  });
});

describe('withAuthRetry', () => {
  test('retries after auth error and returns result from second attempt', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ code: -3, msg: 'token expired' }))
    );
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(mockResponse({ code: 200, data: { token: 'fresh-token' } }))
    );
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        mockResponse({
          list: [
            {
              keyboardPwdId: 42,
              keyboardPwd: '9999',
              keyboardPwdName: 'Retry Code',
              keyboardPwdType: 2,
              startDate: 0,
              endDate: 0,
              status: 1,
            },
          ],
        })
      )
    );

    const result = await client.listPasscodes('lock-retry');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(1);
    expect(result[0]?.keyboardPwdId).toBe(42);
    expect(result[0]?.keyboardPwd).toBe('9999');
    const [, retryOpts] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((retryOpts.headers as Record<string, string>)['Authorization']).toBe('fresh-token');
  });

  test('does not retry on non-auth errors', async () => {
    setToken(client);
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(new Response(null, { status: 500, statusText: 'Internal Server Error' }))
    );

    await expect(client.listPasscodes('lock-err')).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
