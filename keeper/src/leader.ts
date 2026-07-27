import os from 'node:os';
import postgres from 'postgres';

import { getDb, closeDb } from './db.js';
import { logger as rootLogger } from './logger.js';

const logger = rootLogger.child({ component: 'leader-elector' });

export interface LeaderElectionConfig {
  instanceId: string;
  databaseUrl: string;
  lockId?: number;
  ttlMs?: number;
  renewIntervalMs?: number;
  onLeadershipGained?: () => void;
  onLeadershipLost?: () => void;
}

export class LeaderElector {
  private sql: postgres.Sql | null = null;
  private renewalTimer: ReturnType<typeof setInterval> | null = null;
  private _isLeader: boolean = false;
  private config: LeaderElectionConfig;
  private stopped: boolean = false;
  private lastLeadershipConfirmedAt: number = 0;

  constructor(config: LeaderElectionConfig) {
    this.config = {
      lockId: 20240722,
      ttlMs: 60000,
      renewIntervalMs: 30000,
      ...config,
    };
  }

  get isLeader(): boolean {
    return this._isLeader;
  }

  get instanceId(): string {
    return this.config.instanceId;
  }

  /**
   * Time in ms since the last successful leadership confirmation.
   * Useful for detecting stale leadership.
   */
  get msSinceLastConfirmation(): number {
    return this.lastLeadershipConfirmedAt === 0
      ? Infinity
      : Date.now() - this.lastLeadershipConfirmedAt;
  }

  /**
   * Check whether this instance still holds the advisory lock.
   * This is a lightweight verification that can be called mid-cycle.
   */
  async confirmLeadership(): Promise<boolean> {
    if (!this._isLeader) return false;
    if (this.stopped) return false;

    // If the lock was verified recently (within half the renewal interval), skip
    if (Date.now() - this.lastLeadershipConfirmedAt < this.config.renewIntervalMs! / 2) {
      return true;
    }

    try {
      const confirmed = await this.tryAcquire();
      if (confirmed) {
        // tryAcquire already calls recordLeadership() and setLeader()
        return true;
      }
      // Another instance took the lock
      this.setLeader(false);
      return false;
    } catch (error) {
      logger.warn({ error }, 'Failed to confirm leadership');
      // Don't revoke on transient errors — let the renewal timer handle it
      // But don't report as confirmed either
      return this._isLeader;
    }
  }

  async tryAcquire(): Promise<boolean> {
    try {
      if (!this.sql) {
        this.sql = getDb(this.config.databaseUrl);
      }

      const lockId = this.config.lockId!;

      const result = await this.sql`
        SELECT pg_try_advisory_lock(${lockId}) AS acquired
      `;

      const acquired = result[0]?.acquired === true;

      if (acquired) {
        await this.recordLeadership();
        this.setLeader(true);
        this.lastLeadershipConfirmedAt = Date.now();
      }

      return acquired;
    } catch (error) {
      logger.error({ error }, 'Failed to acquire advisory lock');
      return false;
    }
  }

  async start(): Promise<void> {
    const acquired = await this.tryAcquire();

    if (acquired) {
      logger.info({ instanceId: this.config.instanceId }, 'Leadership acquired');
    } else {
      logger.info({ instanceId: this.config.instanceId }, 'Not the leader, standing by');
    }

    this.renewalTimer = setInterval(async () => {
      if (this.stopped) return;

      try {
        const acquired = await this.tryAcquire();
        if (!acquired && this._isLeader) {
          this.setLeader(false);
        }
      } catch (error) {
        logger.error({ error }, 'Leadership renewal failed');
        if (this._isLeader) {
          this.setLeader(false);
        }
      }
    }, this.config.renewIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }

    if (this.sql && this._isLeader) {
      try {
        const lockId = this.config.lockId!;
        await this.sql`SELECT pg_advisory_unlock(${lockId})`;
        logger.info({ instanceId: this.config.instanceId }, 'Advisory lock released');
      } catch (error) {
        logger.error({ error }, 'Failed to release advisory lock');
      }
    }

    this._isLeader = false;
    await closeDb();
  }

  private setLeader(isLeader: boolean): void {
    const changed = this._isLeader !== isLeader;
    this._isLeader = isLeader;

    if (changed) {
      if (isLeader) {
        logger.info({ instanceId: this.config.instanceId }, 'Leadership gained');
        this.config.onLeadershipGained?.();
      } else {
        logger.warn({ instanceId: this.config.instanceId }, 'Leadership lost');
        this.config.onLeadershipLost?.();
      }
    }
  }

  private async recordLeadership(): Promise<void> {
    try {
      await this.sql!`
        CREATE TABLE IF NOT EXISTS leader_locks (
          id SERIAL PRIMARY KEY,
          instance_id TEXT NOT NULL,
          lock_id BIGINT NOT NULL,
          acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        )
      `;

      await this.sql!`
        CREATE INDEX IF NOT EXISTS idx_leader_locks_lookup
        ON leader_locks(lock_id, acquired_at)
      `;

      const expiresAt = new Date(Date.now() + this.config.ttlMs!);

      await this.sql!`
        INSERT INTO leader_locks (instance_id, lock_id, acquired_at, expires_at)
        VALUES (${this.config.instanceId}, ${this.config.lockId!}, NOW(), ${expiresAt})
      `;

      // Clean up stale rows older than 1 hour to keep the table lean
      await this.sql!`
        DELETE FROM leader_locks WHERE acquired_at < NOW() - INTERVAL '1 hour'
      `;

      // Also clean up stale locks from crashed instances
      await this.sql!`
        DELETE FROM leader_locks
        WHERE lock_id = ${this.config.lockId!}
          AND instance_id != ${this.config.instanceId}
          AND expires_at < NOW()
      `;
    } catch (error) {
      logger.warn({ error }, 'Failed to record leadership in leader_locks table');
    }
  }
}

export function createInstanceId(): string {
  const hostname = process.env.KEEPER_INSTANCE_ID || os.hostname();
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${hostname}-${suffix}`;
}
