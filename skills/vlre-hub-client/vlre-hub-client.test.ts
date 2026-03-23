import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { VlreHubClient } from './vlre-hub-client.ts';

const TEST_CONFIG = { baseUrl: 'http://localhost:7311' };

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let client: VlreHubClient;
let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  client = new VlreHubClient(TEST_CONFIG);
  fetchMock = mock(() => Promise.resolve(mockResponse({})));
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('getLocksForProperty', () => {
  test('returns PropertyLock[] on success', async () => {
    fetchMock = mock(() =>
      Promise.resolve(
        mockResponse({
          locks: [
            {
              lockId: 'cl1',
              sifelyLockId: '123',
              lockName: 'FRONT',
              lockRole: 'FRONT_DOOR',
            },
          ],
        })
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getLocksForProperty('prop-123');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      lockId: 'cl1',
      sifelyLockId: '123',
      lockName: 'FRONT',
      lockRole: 'FRONT_DOOR',
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/internal/properties/prop-123/locks');
  });

  test('returns [] when fetch throws a network error', async () => {
    fetchMock = mock(() => Promise.reject(new Error('Network error')));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getLocksForProperty('prop-123');
    expect(result).toEqual([]);
  });

  test('returns [] on non-200 response', async () => {
    fetchMock = mock(() => Promise.resolve(new Response(null, { status: 500 })));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getLocksForProperty('prop-123');
    expect(result).toEqual([]);
  });

  test('returns [] when locks key is absent from response', async () => {
    fetchMock = mock(() => Promise.resolve(mockResponse({})));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.getLocksForProperty('prop-123');
    expect(result).toEqual([]);
  });

  test('URL-encodes propertyUid in the request path', async () => {
    fetchMock = mock(() => Promise.resolve(mockResponse({ locks: [] })));
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.getLocksForProperty('uid with spaces');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('uid%20with%20spaces');
  });
});
