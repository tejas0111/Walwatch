import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage<string>();

export function getTraceId(): string | undefined {
  return als.getStore();
}

export function runWithTraceId<R>(traceId: string, fn: () => R): R {
  return als.run(traceId, fn);
}


