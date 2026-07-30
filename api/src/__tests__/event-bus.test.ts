import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  subscribe,
  emit,
  clearSubscribers,
  getSubscriptions,
  createEvent,
  EventNames,
} from '../lib/event-bus.js';

describe('Event Bus - subscribe and emit', () => {
  beforeEach(() => {
    clearSubscribers();
  });

  afterEach(() => {
    clearSubscribers();
  });

  it('subscribe and emit: handler is called with event', async () => {
    const calls: string[] = [];
    subscribe(EventNames.BLOB_DISCOVERED, (event) => {
      calls.push(event.eventName);
    });

    const event = createEvent(
      EventNames.BLOB_DISCOVERED,
      'org-1',
      'blob_registration',
      'blob-1',
      { type: 'system' },
    );

    await emit(event);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(EventNames.BLOB_DISCOVERED);
  });

  it('multiple subscribers for the same event', async () => {
    const calls1: string[] = [];
    const calls2: string[] = [];
    subscribe(EventNames.BLOB_RENEWED, (e) => { calls1.push(e.entityId); });
    subscribe(EventNames.BLOB_RENEWED, (e) => { calls2.push(e.entityId); });

    const event = createEvent(
      EventNames.BLOB_RENEWED,
      'org-1',
      'blob_registration',
      'blob-42',
      { type: 'system' },
    );

    await emit(event);
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
  });

  it('subscriber is not called for non-matching event', async () => {
    const calls: string[] = [];
    subscribe(EventNames.BLOB_DISCOVERED, (e) => { calls.push(e.eventName); });

    const event = createEvent(
      EventNames.BLOB_RENEWED,
      'org-1',
      'blob_registration',
      'blob-1',
      { type: 'system' },
    );

    await emit(event);
    expect(calls).toHaveLength(0);
  });

  it('multiple events can be subscribed at once', async () => {
    const calls: string[] = [];
    subscribe([EventNames.BLOB_EXPIRED, EventNames.BLOB_DELETED], (e) => {
      calls.push(e.eventName);
    });

    await emit(createEvent(EventNames.BLOB_EXPIRED, 'o1', 'blob', 'b1', { type: 'system' }));
    await emit(createEvent(EventNames.BLOB_DELETED, 'o1', 'blob', 'b1', { type: 'system' }));
    expect(calls).toHaveLength(2);
  });

  it('handler error does not crash emitter', async () => {
    let errorCaught = false;
    subscribe(EventNames.BLOB_DISCOVERED, () => {
      throw new Error('handler crash');
    });

    const event = createEvent(
      EventNames.BLOB_DISCOVERED,
      'org-1',
      'blob_registration',
      'blob-1',
      { type: 'system' },
    );

    await expect(emit(event)).resolves.toBeUndefined();
  });

  it('async handler error does not crash emitter', async () => {
    subscribe(EventNames.BLOB_DISCOVERED, async () => {
      throw new Error('async handler crash');
    });

    const event = createEvent(
      EventNames.BLOB_DISCOVERED,
      'org-1',
      'blob_registration',
      'blob-1',
      { type: 'system' },
    );

    await expect(emit(event)).resolves.toBeUndefined();
  });
});

describe('Event Bus - unsubscribe', () => {
  beforeEach(() => {
    clearSubscribers();
  });

  afterEach(() => {
    clearSubscribers();
  });

  it('unsubscribe removes the subscriber', async () => {
    const calls: string[] = [];
    const unsubscribe = subscribe(EventNames.POLICY_CREATED, (e) => {
      calls.push(e.eventName);
    });

    const event = createEvent(
      EventNames.POLICY_CREATED,
      'org-1',
      'policy',
      'p-1',
      { type: 'system' },
    );

    await emit(event);
    expect(calls).toHaveLength(1);

    unsubscribe();
    await emit(event);
    expect(calls).toHaveLength(1);
  });
});

describe('Event Bus - clearSubscribers', () => {
  beforeEach(() => {
    clearSubscribers();
  });

  afterEach(() => {
    clearSubscribers();
  });

  it('clears all subscriptions', async () => {
    subscribe(EventNames.BLOB_DISCOVERED, () => {});
    subscribe(EventNames.BLOB_RENEWED, () => {});
    expect(getSubscriptions()).toHaveLength(2);

    clearSubscribers();
    expect(getSubscriptions()).toHaveLength(0);
  });
});

describe('Event Bus - getSubscriptions', () => {
  beforeEach(() => {
    clearSubscribers();
  });

  afterEach(() => {
    clearSubscribers();
  });

  it('returns active subscriptions', () => {
    subscribe(EventNames.BLOB_DISCOVERED, () => {}, 'Test handler');
    const subs = getSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].description).toBe('Test handler');
    expect(subs[0].eventNames).toContain(EventNames.BLOB_DISCOVERED);
  });
});

describe('Event Bus - createEvent', () => {
  it('creates event with correct shape', () => {
    const event = createEvent(
      EventNames.RENEWAL_STARTED,
      'org-abc',
      'renewal_job',
      'job-42',
      { type: 'human', userId: 'user-1' },
      { estimatedCost: 100 },
    );

    expect(event.eventName).toBe(EventNames.RENEWAL_STARTED);
    expect(event.orgId).toBe('org-abc');
    expect(event.entityType).toBe('renewal_job');
    expect(event.entityId).toBe('job-42');
    expect(event.actor).toEqual({ type: 'human', userId: 'user-1' });
    expect(event.details).toEqual({ estimatedCost: 100 });
    expect(typeof event.timestamp).toBe('string');
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it('creates event with system actor', () => {
    const event = createEvent(
      EventNames.SYSTEM_DEGRADED,
      'org-1',
      'system',
      'db-primary',
      { type: 'system' },
    );
    expect(event.actor.type).toBe('system');
  });

  it('creates event with api_key actor', () => {
    const event = createEvent(
      EventNames.API_KEY_ROTATED,
      'org-1',
      'api_key',
      'key-1',
      { type: 'api_key', keyId: 'k-1', keyPrefix: 'ark_' },
    );
    expect(event.actor.type).toBe('api_key');
    expect((event.actor as any).keyPrefix).toBe('ark_');
  });
});
