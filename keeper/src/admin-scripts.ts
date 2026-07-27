import { getDb } from './db.js';
import { emit, createEvent } from '../../api/src/lib/event-bus.js';

export async function triggerScanCycle(justification: string = 'manual admin trigger'): Promise<void> {
  await emit(createEvent(
    'system.scan_triggered',
    'system',
    'system',
    'scan-cycle',
    { type: 'admin', adminId: 'admin-cli', reason: justification },
    { justification },
  ));
}

export async function getQueueStats(): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db`
    SELECT status, count(*)::int AS count
    FROM renewal_jobs
    GROUP BY status
  `;
  const stats: Record<string, number> = {};
  for (const row of rows as unknown as Array<{ status: string; count: number }>) {
    stats[row.status] = row.count;
  }
  return stats;
}
