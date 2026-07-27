import pino from 'pino';

const logger = pino({ name: 'compensating-actions' });

const COMPENSATION_TIMEOUT_MS = 5000;

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Compensation timed out after ${ms}ms`)), ms),
  );
}

export interface CompensableAction<T> {
  execute(): Promise<T>;
  compensate(): Promise<void>;
  description: string;
}

export async function executeWithCompensation<T>(
  actions: CompensableAction<T>[],
): Promise<T[]> {
  const completed: CompensableAction<T>[] = [];
  const results: T[] = [];

  for (const action of actions) {
    try {
      const result = await action.execute();
      results.push(result);
      completed.push(action);
    } catch (err) {
      const reversed = [...completed].reverse();
      for (const done of reversed) {
        try {
          await Promise.race([
            done.compensate(),
            timeout(COMPENSATION_TIMEOUT_MS),
          ]);
        } catch (compErr) {
          logger.error({ err: compErr, description: done.description }, 'Compensation failed');
        }
      }
      throw err;
    }
  }

  return results;
}

export default {
  executeWithCompensation,
};
