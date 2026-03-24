import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { HostfullyClient } from './client.ts';

const TEST_CONFIG = {
  apiKey: 'test-api-key',
  agencyUid: 'test-agency-uid',
  baseUrl: 'https://api.hostfully.com/api/v3.2',
};

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let client: HostfullyClient;
let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  client = new HostfullyClient(TEST_CONFIG);
  fetchMock = mock(() => Promise.resolve(mockResponse({})));
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('getMessage', () => {
  test('unwraps envelope and returns content.text as content string', async () => {
    const apiPayload = {
      message: {
        uid: 'msg-1',
        threadUid: 'thread-1',
        leadUid: 'lead-1',
        createdAt: '2024-01-01T00:00:00Z',
        content: { subject: null, text: 'Hello from the guest!' },
        senderType: 'GUEST',
      },
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const message = await client.getMessage('msg-1');

    expect(message.uid).toBe('msg-1');
    expect(message.content).toBe('Hello from the guest!');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/messages/msg-1');
    expect((opts.headers as Record<string, string>)['X-HOSTFULLY-APIKEY']).toBe('test-api-key');
  });

  test('handles content already as string (fallback)', async () => {
    const apiPayload = {
      message: {
        uid: 'msg-2',
        threadUid: 'thread-1',
        leadUid: 'lead-1',
        createdAt: '2024-01-01T00:00:00Z',
        content: 'Plain string content',
        senderType: 'PROPERTY_MANAGER',
      },
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const message = await client.getMessage('msg-2');
    expect(message.content).toBe('Plain string content');
  });
});

describe('getThread', () => {
  test('extracts leadUid from participants where participantType === LEAD', async () => {
    const apiPayload = {
      thread: {
        uid: 'thread-1',
        propertyUid: 'prop-1',
        agencyUid: 'agency-1',
        status: 'OPEN',
        participants: [
          { participantType: 'AGENCY', participantUid: 'agency-1', uid: 'part-1' },
          { participantType: 'LEAD', participantUid: 'lead-abc', uid: 'part-2' },
        ],
      },
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const thread = await client.getThread('thread-1');

    expect(thread.uid).toBe('thread-1');
    expect(thread.leadUid).toBe('lead-abc');
  });

  test('sets leadUid to undefined when no LEAD participant found', async () => {
    const apiPayload = {
      thread: {
        uid: 'thread-2',
        participants: [
          { participantType: 'AGENCY', participantUid: 'agency-1', uid: 'part-1' },
        ],
      },
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const thread = await client.getThread('thread-2');
    expect(thread.leadUid).toBeUndefined();
  });

  test('calls correct endpoint', async () => {
    fetchMock = mock(() => Promise.resolve(mockResponse({ thread: { uid: 'thread-3', participants: [] } })));
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.getThread('thread-3');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/threads/thread-3');
  });
});

describe('getLead', () => {
  test('remaps nested guestInformation fields and calculates numberOfNights', async () => {
    const apiPayload = {
      lead: {
        uid: 'lead-1',
        propertyUid: 'prop-1',
        guestInformation: {
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
        },
        checkInZonedDateTime: '2024-06-15T16:00:00-05:00',
        checkOutZonedDateTime: '2024-06-20T11:00:00-05:00',
        numberOfGuests: 2,
        status: 'ACCEPTED',
      },
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const lead = await client.getLead('lead-1');

    expect(lead.uid).toBe('lead-1');
    expect(lead.guestFirstName).toBe('Alice');
    expect(lead.guestLastName).toBe('Smith');
    expect(lead.checkInDate).toBe('2024-06-15');
    expect(lead.checkOutDate).toBe('2024-06-20');
    expect(lead.numberOfNights).toBe(5);
  });

  test('handles missing guestInformation gracefully', async () => {
    const apiPayload = {
      lead: {
        uid: 'lead-2',
        propertyUid: 'prop-1',
        checkInZonedDateTime: '2024-07-01T16:00:00Z',
        checkOutZonedDateTime: '2024-07-03T11:00:00Z',
      },
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const lead = await client.getLead('lead-2');

    expect(lead.guestFirstName).toBeUndefined();
    expect(lead.guestLastName).toBeUndefined();
    expect(lead.numberOfNights).toBe(2);
  });

  test('handles missing dates — numberOfNights is undefined', async () => {
    const apiPayload = {
      lead: { uid: 'lead-3', propertyUid: 'prop-1' },
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const lead = await client.getLead('lead-3');

    expect(lead.checkInDate).toBeUndefined();
    expect(lead.checkOutDate).toBeUndefined();
    expect(lead.numberOfNights).toBeUndefined();
  });
});

describe('getProperty', () => {
  test('unwraps property envelope', async () => {
    const apiPayload = {
      property: {
        uid: 'prop-1',
        name: 'Beach House',
        city: 'Austin',
        numberOfBedrooms: 3,
      },
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const property = await client.getProperty('prop-1');

    expect(property.uid).toBe('prop-1');
    expect(property.name).toBe('Beach House');
    expect(property.city).toBe('Austin');
    expect(property.numberOfBedrooms).toBe(3);
  });

  test('calls correct endpoint', async () => {
    fetchMock = mock(() =>
      Promise.resolve(mockResponse({ property: { uid: 'prop-2', name: 'Test' } }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.getProperty('prop-2');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/properties/prop-2');
  });
});

describe('sendMessage', () => {
  test('sends correct payload shape with type DIRECT_MESSAGE and content.subject null', async () => {
    const responsePayload = {
      uid: 'msg-new',
      threadUid: 'thread-1',
      content: 'Hey, welcome!',
      createdAt: '2024-01-01T12:00:00Z',
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(responsePayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.sendMessage('thread-1', 'Hey, welcome!');

    expect(result.uid).toBe('msg-new');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/messages');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string);
    expect(body.type).toBe('DIRECT_MESSAGE');
    expect(body.threadUid).toBe('thread-1');
    expect(body.content.subject).toBeNull();
    expect(body.content.text).toBe('Hey, welcome!');
  });
});

describe('listWebhooks', () => {
  test('returns webhooks array from response', async () => {
    const apiPayload = {
      webhooks: [
        { uid: 'wh-1', agencyUid: 'agency-1', eventType: 'NEW_INBOX_MESSAGE', callbackUrl: 'https://example.com/webhook' },
        { uid: 'wh-2', agencyUid: 'agency-1', eventType: 'BOOKING_CONFIRMED', callbackUrl: 'https://example.com/webhook2' },
      ],
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const webhooks = await client.listWebhooks('agency-1');

    expect(webhooks).toHaveLength(2);
    expect(webhooks[0]?.uid).toBe('wh-1');
    expect(webhooks[1]?.uid).toBe('wh-2');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/webhooks');
    expect(url).toContain('agencyUid=agency-1');
  });

  test('returns empty array when webhooks key is missing', async () => {
    fetchMock = mock(() => Promise.resolve(mockResponse({})));
    global.fetch = fetchMock as unknown as typeof fetch;

    const webhooks = await client.listWebhooks('agency-1');
    expect(webhooks).toEqual([]);
  });
});

describe('registerWebhook', () => {
  test('POSTs correct payload and returns registered webhook', async () => {
    const apiPayload = {
      webhook: {
        uid: 'wh-new',
        agencyUid: 'agency-1',
        eventType: 'NEW_INBOX_MESSAGE',
        callbackUrl: 'https://example.com/hook',
        webhookType: 'POST_JSON',
      },
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.registerWebhook('agency-1', 'NEW_INBOX_MESSAGE', 'https://example.com/hook');

    expect(result.uid).toBe('wh-new');
    expect(result.eventType).toBe('NEW_INBOX_MESSAGE');

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/webhooks');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string);
    expect(body.agencyUid).toBe('agency-1');
    expect(body.eventType).toBe('NEW_INBOX_MESSAGE');
    expect(body.callbackUrl).toBe('https://example.com/hook');
    expect(body.webhookType).toBe('POST_JSON');
  });
});

describe('deregisterWebhook', () => {
  test('sends DELETE to correct endpoint', async () => {
    fetchMock = mock(() => Promise.resolve(new Response(null, { status: 204 })));
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.deregisterWebhook('wh-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/webhooks/wh-1');
    expect(opts.method).toBe('DELETE');
  });
});

describe('error handling', () => {
  test('404 throws with descriptive message', async () => {
    fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Resource not found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.getMessage('nonexistent')).rejects.toThrow('404');
  });

  test('429 throws with rate limit message', async () => {
    fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 429, statusText: 'Too Many Requests' }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.getMessage('any-uid')).rejects.toThrow(/rate limit/i);
  });

  test('401 throws with authentication failed message', async () => {
    fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 401, statusText: 'Unauthorized' }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.getMessage('any-uid')).rejects.toThrow(/authentication failed.*401/i);
    await expect(client.getMessage('any-uid')).rejects.toThrow(/HOSTFULLY_API_KEY/i);
  });

  test('403 throws with authentication failed message', async () => {
    fetchMock = mock(() =>
      Promise.resolve(new Response(null, { status: 403, statusText: 'Forbidden' }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.getMessage('any-uid')).rejects.toThrow(/authentication failed.*403/i);
    await expect(client.getMessage('any-uid')).rejects.toThrow(/HOSTFULLY_API_KEY/i);
  });
});

describe('getMessages', () => {
  test('extracts content.text from object-shaped content', async () => {
    const apiPayload = {
      messages: [
        {
          uid: 'msg-1',
          threadUid: 'thread-1',
          leadUid: 'lead-1',
          createdAt: '2024-01-01T00:00:00Z',
          content: { subject: null, text: 'Hello from the guest!' },
          senderType: 'GUEST',
        },
      ],
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const messages = await client.getMessages('lead-1');

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('Hello from the guest!');
  });

  test('passes through content that is already a plain string', async () => {
    const apiPayload = {
      messages: [
        {
          uid: 'msg-2',
          threadUid: 'thread-1',
          leadUid: 'lead-1',
          createdAt: '2024-01-01T00:00:00Z',
          content: 'Already a string',
          senderType: 'PROPERTY_MANAGER',
        },
      ],
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const messages = await client.getMessages('lead-1');

    expect(messages[0]?.content).toBe('Already a string');
  });
});

describe('getDoorCode', () => {
  test('returns the door_code text when the field exists', async () => {
    const apiPayload = {
      customData: [
        { customDataField: { uid: 'field-1', name: 'wifi_password' }, text: 'secretwifi' },
        { customDataField: { uid: 'field-2', name: 'door_code' }, text: '1234' },
      ],
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const code = await client.getDoorCode('prop-1');

    expect(code).toBe('1234');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/properties/prop-1/customData');
  });

  test('returns null when no door_code field exists', async () => {
    const apiPayload = {
      customData: [
        { customDataField: { uid: 'field-1', name: 'wifi_password' }, text: 'secretwifi' },
      ],
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(apiPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const code = await client.getDoorCode('prop-1');

    expect(code).toBeNull();
  });

  test('returns null when customData array is empty', async () => {
    fetchMock = mock(() => Promise.resolve(mockResponse({ customData: [] })));
    global.fetch = fetchMock as unknown as typeof fetch;

    const code = await client.getDoorCode('prop-1');

    expect(code).toBeNull();
  });
});

describe('updateDoorCode', () => {
  test('finds door_code field and calls updateCustomData with correct args', async () => {
    const getPayload = {
      customData: [
        { customDataField: { uid: 'field-door', name: 'door_code' }, text: '1234' },
      ],
    };
    fetchMock = mock(() => Promise.resolve(mockResponse(getPayload)));
    global.fetch = fetchMock as unknown as typeof fetch;

    fetchMock.mockImplementationOnce(() => Promise.resolve(mockResponse(getPayload)));
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));

    await client.updateDoorCode('prop-1', '5678');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [putUrl, putOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(putUrl).toContain('/properties/prop-1/customData/field-door');
    expect(putOpts.method).toBe('PUT');
    const body = JSON.parse(putOpts.body as string) as { text: string };
    expect(body.text).toBe('5678');
  });

  test('throws when no door_code field is found', async () => {
    fetchMock = mock(() =>
      Promise.resolve(mockResponse({ customData: [{ customDataField: { uid: 'f1', name: 'wifi_password' }, text: 'wifi' }] }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.updateDoorCode('prop-1', '5678')).rejects.toThrow('door_code');
  });
});
