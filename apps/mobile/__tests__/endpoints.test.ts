import { createMeAccountApi } from '../src/api/endpoints';
import type { AxiosInstance } from 'axios';

/**
 * These tests verify that our endpoint wrapper calls the correct HTTP method
 * and path for each API — the same paths the backend's pytest suite already
 * proves exist and behave correctly. We mock axios itself so this test has
 * zero network dependency and runs anywhere.
 */
function makeMockClient() {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const mockClient = {
    get: jest.fn((url: string, config?: unknown) => {
      calls.push({ method: 'GET', url, body: config });
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn((url: string, body?: unknown, config?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return Promise.resolve({ data: {} });
    }),
  } as unknown as AxiosInstance;

  return { mockClient, calls };
}

describe('createMeAccountApi — auth', () => {
  it('calls POST /api/v1/auth/login with the credentials', async () => {
    const { mockClient, calls } = makeMockClient();
    const meApi = createMeAccountApi(mockClient);

    await meApi.auth.login({ email: 'a@b.com', password: 'secret' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { email: 'a@b.com', password: 'secret' },
    });
  });

  it('calls GET /api/v1/auth/me with no body', async () => {
    const { mockClient, calls } = makeMockClient();
    const meApi = createMeAccountApi(mockClient);

    await meApi.auth.me();

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('/api/v1/auth/me');
  });
});

describe('createMeAccountApi — dashboard', () => {
  it('calls GET /api/v1/dashboard/kpi', async () => {
    const { mockClient, calls } = makeMockClient();
    const meApi = createMeAccountApi(mockClient);

    await meApi.dashboard.kpi();

    expect(calls[0]).toEqual({ method: 'GET', url: '/api/v1/dashboard/kpi', body: undefined });
  });
});

describe('createMeAccountApi — chat', () => {
  it('sends the conversation_id and message to /api/v1/chat-v2/message', async () => {
    const { mockClient, calls } = makeMockClient();
    const meApi = createMeAccountApi(mockClient);

    await meApi.chat.sendMessage({ conversation_id: 'conv-1', message: 'สวัสดี' });

    expect(calls[0].url).toBe('/api/v1/chat-v2/message');
    expect(calls[0].body).toEqual({ conversation_id: 'conv-1', message: 'สวัสดี' });
  });

  it('allows conversation_id to be omitted for a new conversation', async () => {
    const { mockClient, calls } = makeMockClient();
    const meApi = createMeAccountApi(mockClient);

    await meApi.chat.sendMessage({ message: 'first message' });

    expect((calls[0].body as any).conversation_id).toBeUndefined();
  });
});

describe('createMeAccountApi — ap (approvals)', () => {
  it('calls POST to the correct bill approval path with action and comment', async () => {
    const { mockClient, calls } = makeMockClient();
    const meApi = createMeAccountApi(mockClient);

    await meApi.ap.approveBill('bill-123', 'approved', 'looks good');

    expect(calls[0].url).toBe('/api/v1/ap/bills/bill-123/approve');
    expect(calls[0].body).toEqual({ action: 'approved', comment: 'looks good' });
  });

  it('filters bills by status when requesting the pending-approval queue', async () => {
    const { mockClient, calls } = makeMockClient();
    const meApi = createMeAccountApi(mockClient);

    await meApi.ap.bills({ status: 'pending_approval' });

    expect(calls[0].url).toBe('/api/v1/ap/bills');
    expect(calls[0].body).toEqual({ params: { status: 'pending_approval' } });
  });
});

describe('createMeAccountApi — inventory', () => {
  it('requests the AI forecast for a specific product id', async () => {
    const { mockClient, calls } = makeMockClient();
    const meApi = createMeAccountApi(mockClient);

    await meApi.inventory.forecast('prod-42');

    expect(calls[0].url).toBe('/api/v1/inventory/ai/forecast/prod-42');
  });
});
