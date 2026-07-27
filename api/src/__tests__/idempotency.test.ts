import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockStore = new Map<string, { idempotencyKey: string; responseStatus: number; responseBody: string; createdAt: Date }>();
let currentTime = Date.now();

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        then: (fn: (r: any[]) => any) => {
          const cutoff = new Date(currentTime - 86400000);
          const results: typeof mockStore extends Map<string, infer V> ? V[] : never[] = [];
          for (const [, value] of mockStore) {
            if (value.createdAt > cutoff) {
              results.push(value);
            }
          }
          return Promise.resolve(fn(results));
        },
      }),
    }),
  }),
  insert: (_table: any) => ({
    values: (v: { idempotencyKey: string; responseStatus: number; responseBody: string }) => {
      mockStore.set(v.idempotencyKey, { ...v, createdAt: new Date(currentTime) });
      return { catch: (_fn: any) => {} };
    },
  }),
  delete: (_table: any) => ({
    where: () => Promise.resolve(),
  }),
};

vi.mock('../db/index.js', async () => ({
  getDb: () => mockDb,
}));

let mockHashCounter = 0;

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    createHash: () => {
      const inputParts: string[] = [];
      return {
        update: (data: string) => {
          inputParts.push(data);
          return {
            digest: () => {
              mockHashCounter++;
              const hashInput = inputParts.join(':');
              return `mocked_${hashInput.substring(0, 8)}_${mockHashCounter}`;
            },
          };
        },
      };
    },
  };
});

import { idempotencyMiddleware } from '../middleware/idempotency.js';

interface MockJsonFn {
  (body: any, status?: number): any;
  mockReturnedBody?: any;
  mockReturnedStatus?: number;
}

function createMockContext(opts: { method?: string; path?: string; idempotencyKey?: string; userId?: string; orgId?: string }): any {
  let jsonResponse: any;
  let jsonStatus: number | undefined;
  const json: MockJsonFn = ((body: any, status?: number) => {
    jsonResponse = body;
    jsonStatus = status;
    return body;
  }) as MockJsonFn;

  return {
    req: {
      method: opts.method || 'POST',
      path: opts.path || '/test',
      header: (name: string) => {
        if (name === 'Idempotency-Key') return opts.idempotencyKey || null;
        return null;
      },
    },
    get: (key: string) => {
      if (key === 'userId') return opts.userId || 'user-1';
      if (key === 'orgId') return opts.orgId || null;
      return null;
    },
    json,
    _getJsonResponse: () => jsonResponse,
    _getJsonStatus: () => jsonStatus,
  };
}

describe('Idempotency Middleware', () => {
  beforeEach(() => {
    mockStore.clear();
    currentTime = Date.now();
  });

  it('passes through for GET requests', async () => {
    const c = createMockContext({ method: 'GET', idempotencyKey: 'key-1' });
    let nextCalled = false;
    await idempotencyMiddleware(c, () => { nextCalled = true; return Promise.resolve(); });
    expect(nextCalled).toBe(true);
  });

  it('passes through when no idempotency key is provided', async () => {
    const c = createMockContext({ method: 'POST' });
    let nextCalled = false;
    await idempotencyMiddleware(c, () => { nextCalled = true; return Promise.resolve(); });
    expect(nextCalled).toBe(true);
  });

  it('returns cached response for same idempotency key', async () => {
    const cacheKey = 'mocked_user-1:_1:POST:/test:key-same';
    mockStore.set(cacheKey, {
      idempotencyKey: cacheKey,
      responseStatus: 200,
      responseBody: JSON.stringify({ id: '123', status: 'created' }),
      createdAt: new Date(currentTime),
    });

    const c = createMockContext({ method: 'POST', idempotencyKey: 'key-same' });
    let nextCalled = false;
    const result = await idempotencyMiddleware(c, () => { nextCalled = true; return Promise.resolve(); });
    expect(nextCalled).toBe(false);
    expect(result).toEqual({ id: '123', status: 'created' });
  });

  it('different keys get different executions', async () => {
    const c1 = createMockContext({ method: 'POST', idempotencyKey: 'key-a' });
    const c2 = createMockContext({ method: 'POST', idempotencyKey: 'key-b' });

    let c1Next = false;
    let c2Next = false;

    await idempotencyMiddleware(c1, () => { c1Next = true; return Promise.resolve(); });
    expect(c1Next).toBe(true);

    await idempotencyMiddleware(c2, () => { c2Next = true; return Promise.resolve(); });
    expect(c2Next).toBe(true);
  });

  it('different actors with same raw key do not collide', async () => {
    const c1 = createMockContext({ method: 'POST', idempotencyKey: 'shared-key', userId: 'user-a' });
    const c2 = createMockContext({ method: 'POST', idempotencyKey: 'shared-key', userId: 'user-b' });

    let c1Next = false;
    let c2Next = false;
    await idempotencyMiddleware(c1, () => { c1Next = true; return Promise.resolve(); });
    await idempotencyMiddleware(c2, () => { c2Next = true; return Promise.resolve(); });
    expect(c1Next).toBe(true);
    expect(c2Next).toBe(true);
  });

  it('caches response on first execution and returns cached on second', async () => {
    const c = createMockContext({ method: 'POST', idempotencyKey: 'cache-me' });

    let nextCalled = false;
    const nextFn = async () => {
      nextCalled = true;
      const originalJson = (c as any).json;
      originalJson({ id: 'saved', status: 'ok' }, 201);
    };

    await idempotencyMiddleware(c, nextFn);
    expect(nextCalled).toBe(true);

    const c2 = createMockContext({ method: 'POST', idempotencyKey: 'cache-me' });
    let next2Called = false;
    const result2 = await idempotencyMiddleware(c2, () => { next2Called = true; return Promise.resolve(); });
    expect(next2Called).toBe(false);
    expect(result2).toEqual({ id: 'saved', status: 'ok' });
  });
});

describe('Idempotency Key TTL', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('expired key does not return cached response', async () => {
    const cacheKey = 'mocked_user-1:_4:POST:/test:expired-key';
    mockStore.set(cacheKey, {
      idempotencyKey: cacheKey,
      responseStatus: 200,
      responseBody: JSON.stringify({ stale: true }),
      createdAt: new Date(currentTime - 86400001),
    });

    const c = createMockContext({ method: 'POST', idempotencyKey: 'expired-key' });
    let nextCalled = false;
    await idempotencyMiddleware(c, () => { nextCalled = true; return Promise.resolve(); });
    expect(nextCalled).toBe(true);
  });
});
