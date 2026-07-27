import { EmailChannel } from './channels/email.js';
import { DiscordChannel } from './channels/discord.js';
import { TelegramChannel } from './channels/telegram.js';
import { SlackChannel } from './channels/slack.js';
import { GenericWebhookChannel } from './channels/webhook.js';
import type { NotificationChannel, NotificationPayload } from './channels/types.js';
import type { DeliveryResult } from './channels/types.js';
import { logger as rootLogger } from './logger.js';
import { decrypt, isEncrypted } from './encryption.js';
import { validateTransition } from '../../api/src/lib/state-machine.js';
import { emit, createEvent } from '../../api/src/lib/event-bus.js';

const logger = rootLogger.child({ component: 'notification-engine' });

let _db: any;

async function getDb() {
  if (!_db) {
    const { getDb: getKeeperDb } = await import('./db.js');
    _db = getKeeperDb();
  }
  return _db;
}

const DEFAULT_DEDUP_WINDOW_SECONDS = 300; // 5 minutes
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

const FLAPPING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const FLAPPING_THRESHOLD = 3; // 3+ events = flapping

interface FlappingState {
  count: number;
  eventNames: Set<string>;
  firstSeen: number;
  lastSeen: number;
}

const flappingTracker = new Map<string, FlappingState>();

setInterval(() => {
  const now = Date.now();
  for (const [key, state] of flappingTracker) {
    if (now - state.lastSeen > FLAPPING_WINDOW_MS) flappingTracker.delete(key);
  }
}, 60000);

function checkFlapping(entityId: string, eventName: string): boolean {
  const now = Date.now();
  const entry = flappingTracker.get(entityId);

  if (!entry || (now - entry.lastSeen) > FLAPPING_WINDOW_MS) {
    flappingTracker.set(entityId, { count: 1, eventNames: new Set([eventName]), firstSeen: now, lastSeen: now });
    return false;
  }

  entry.count++;
  entry.eventNames.add(eventName);
  entry.lastSeen = now;

  return entry.count >= FLAPPING_THRESHOLD;
}

/**
 * Retry notification delivery with exponential backoff + jitter.
 * Unlike withRetry() which only retries network errors, this retries
 * ALL delivery failures (HTTP errors, timeouts, service rejections)
 * since notification delivery failures are inherently transient.
 */
async function retryDelivery(
  sendFn: () => Promise<DeliveryResult>,
  context: { alertEventId: string; channelId: string; channelType: string },
): Promise<DeliveryResult> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await sendFn();
      if (result.success) return result;
      lastError = result.error || `Delivery returned status ${result.statusCode ?? 'unknown'}`;
      logger.warn(
        { ...context, attempt, maxRetries: MAX_RETRIES, error: lastError },
        `Notification delivery attempt ${attempt}/${MAX_RETRIES} failed`,
      );
    } catch (error) {
      lastError = (error as Error).message;
      logger.warn(
        { ...context, attempt, maxRetries: MAX_RETRIES, error: lastError },
        `Notification delivery attempt ${attempt}/${MAX_RETRIES} threw`,
      );
    }
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      const jitter = Math.round(delay * (0.5 + Math.random() * 0.5));
      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }
  return { success: false, error: lastError ?? 'Max retries exceeded' };
}

export class NotificationEngine {
  private channels: Map<string, NotificationChannel> = new Map();

  constructor() {
    this.registerChannel(new EmailChannel());
    this.registerChannel(new DiscordChannel());
    this.registerChannel(new TelegramChannel());
    this.registerChannel(new SlackChannel());
    this.registerChannel(new GenericWebhookChannel());
  }

  registerChannel(channel: NotificationChannel): void {
    this.channels.set(channel.type, channel);
  }

  async processAlertEvent(alertEventId: string): Promise<void> {
    const db = await getDb();

    const [alertEvent] = await db`
      SELECT * FROM alert_events WHERE id = ${alertEventId} LIMIT 1
    `;
    if (!alertEvent) return;

    // Skip already-terminal events
    if (['acknowledged', 'escalated', 'delivered'].includes(alertEvent.status)) {
      logger.info({ alertEventId, status: alertEvent.status }, 'Alert event already in terminal state — skipping');
      return;
    }

    const alertEventTraceId = ((alertEvent.details as Record<string, unknown> | undefined)?.traceId as string | undefined) ?? undefined;

    // Find matching alert rule (scoped to org_id)
    let rule = null;
    if (alertEvent.alert_rule_id) {
      [rule] = await db`
        SELECT * FROM alert_rules
        WHERE id = ${alertEvent.alert_rule_id} AND org_id = ${alertEvent.org_id}
        LIMIT 1
      `;
    }

    // Use tunable dedup window from rule config, default to 5 minutes
    const dedupWindowSeconds = rule?.dedup_window_seconds ?? DEFAULT_DEDUP_WINDOW_SECONDS;

    const channelIds = rule?.channel_ids || [];
    const channelResults: Array<{ channelId: string; success: boolean }> = [];

    // Flapping detection: suppress all channels if same entity is generating rapid alternating events
    const flushingEntityId = alertEvent.blob_registration_id || alertEvent.renewal_job_id || alertEvent.id;
    if (checkFlapping(flushingEntityId, alertEvent.event_type)) {
      logger.info({ entityId: flushingEntityId, eventType: alertEvent.event_type }, 'Suppressing all notifications — entity is flapping');
      return;
    }

    for (const channelId of channelIds) {
      // Cross-tenant safety: verify channel belongs to same org as alert event
      const [channelRecord] = await db`
        SELECT * FROM notification_channels
        WHERE id = ${channelId} AND status = 'active' AND org_id = ${alertEvent.org_id}
        LIMIT 1
      `;
      if (!channelRecord) {
        logger.warn({ alertEventId: alertEvent.id, channelId }, 'Channel not found, inactive, or cross-tenant — skipping');
        continue;
      }

      const impl = this.channels.get(channelRecord.type);
      if (!impl) {
        logger.warn({ alertEventId: alertEvent.id, channelType: channelRecord.type }, 'No channel implementation registered for type');
        continue;
      }

      // Decrypt any encrypted fields in the channel config (Spec 17: secrets at rest)
      // Encrypted values use the format `iv:authTag:ciphertext` (hex-encoded).
      const rawConfig = (channelRecord.config ?? {}) as Record<string, unknown>;
      const decryptedConfig: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawConfig)) {
        if (typeof value === 'string' && isEncrypted(value)) {
          try {
            decryptedConfig[key] = decrypt(value);
          } catch (decryptError) {
            logger.warn(
              { alertEventId: alertEvent.id, channelId, configKey: key },
              'Failed to decrypt channel config field — using raw value',
            );
            decryptedConfig[key] = value;
          }
        } else {
          decryptedConfig[key] = value;
        }
      }

      // Tunable dedup/idempotency check: skip if notification already sent for same (alertEventId, channelId) within configured window
      const [existing] = await db`
        SELECT id FROM notifications
        WHERE alert_event_id = ${alertEvent.id}
          AND channel_id = ${channelId}
          AND created_at > NOW() - INTERVAL '1 second' * ${dedupWindowSeconds}
        LIMIT 1
      `;
      if (existing) {
        logger.info({ alertEventId: alertEvent.id, channelId, dedupWindowSeconds }, 'Skipping — duplicate notification within dedup window');
        continue;
      }

      const alertDetails = (alertEvent.details ?? {}) as Record<string, unknown>;
      const payload: NotificationPayload = {
        id: `${alertEvent.id}-${channelId}`,
        alertEventId: alertEvent.id,
        orgId: alertEvent.org_id,
        eventType: alertEvent.event_type,
        severity: alertEvent.severity,
        message: alertEvent.message,
        details: alertDetails,
        linkToEntity: alertEvent.link_to_entity || `https://walwatch.app/dashboard/alerts/${alertEvent.id}`,
        traceId: alertEventTraceId,
      };

      // Insert notification, mark sent, attempt delivery, and finalize status in a single transaction
      let notif: any;
      let success = false;
      let lastError: string | null = null;
      await db.begin(async (tx: any) => {
        [notif] = await tx`
          INSERT INTO notifications (org_id, alert_event_id, channel_id, status)
          VALUES (${alertEvent.org_id}, ${alertEvent.id}, ${channelId}, 'queued')
          RETURNING *
        `;

        // Mark notification as sent (delivery attempt started)
        validateTransition('notification', 'queued', 'sent');
        await tx`
          UPDATE notifications SET status = 'sent', sent_at = NOW() WHERE id = ${notif.id}
        `;

        // Attempt delivery with retry (exponential backoff with jitter)
        try {
          const result = await retryDelivery(
            () => impl.send(payload, decryptedConfig),
            { alertEventId: alertEvent.id, channelId, channelType: channelRecord.type },
          );
          if (!result.success) {
            throw new Error(result.error || 'Delivery failed after retries');
          }
          logger.info({ alertEventId: alertEvent.id, channelId }, 'Notification sent successfully');
          validateTransition('notification', 'sent', 'delivered');
          await tx`
            UPDATE notifications
            SET status = 'delivered', delivered_at = NOW()
            WHERE id = ${notif.id}
          `;
          await tx`
            INSERT INTO activity_feed (org_id, actor_type, actor_id, action, resource_type, resource_id, summary, details, trace_id)
            VALUES (${alertEvent.org_id}, 'system', 'notification-engine', 'notification.delivered', 'notification', ${notif.id}, ${`Notification delivered via ${channelRecord.type} channel`}, ${JSON.stringify({ channelType: channelRecord.type })}, ${alertEvent.id})
          `;
          success = true;
        } catch (error) {
          lastError = (error as Error).message;
          logger.warn({ alertEventId: alertEvent.id, channelId, error: lastError }, 'All retry attempts exhausted');
          validateTransition('notification', 'sent', 'failed');
          await tx`
            UPDATE notifications
            SET status = 'failed', error = ${lastError}
            WHERE id = ${notif.id}
          `;
          // Record failure in audit trail with attribution (Spec 17: no anonymous entries)
          const failureDetails = {
            alertEventId: alertEvent.id,
            channelId,
            error: lastError,
            triggeredBy: {
              alertRuleId: alertEvent.alert_rule_id,
              cause: 'system:notification_engine',
              trace: `alert_event:${alertEvent.id} -> notification:${notif.id}`,
            },
          };
          await tx`
            INSERT INTO audit_logs (org_id, action, resource_type, resource_id, details)
            VALUES (${alertEvent.org_id}, 'notification.delivery_failed', 'notification', ${notif.id}, ${JSON.stringify(failureDetails)})
          `;
          await tx`
            INSERT INTO activity_feed (org_id, actor_type, actor_id, action, resource_type, resource_id, summary, details, trace_id)
            VALUES (${alertEvent.org_id}, 'system', 'notification-engine', 'notification.delivery_failed', 'notification', ${notif.id}, ${`Notification delivery failed for ${channelRecord.type} channel: ${lastError}`}, ${JSON.stringify({ channelType: channelRecord.type, error: lastError, attempts: MAX_RETRIES, alertEventId: alertEvent.id })}, ${alertEvent.id})
          `;
        }
      });

      channelResults.push({ channelId, success });
    }

    // Aggregate logic: determine alert_events status after all channels processed
    let alertEventFinalStatus: string | null = null;
    let alertEventError: string | null = null;

    await db.begin(async (tx: any) => {
      if (channelResults.length === 0) {
        // No channels configured or all were invalid — escalate as no delivery possible
        alertEventFinalStatus = 'delivery_failed_final';
        alertEventError = 'No valid channels available for delivery';
        await tx`
          UPDATE alert_events
          SET status = 'delivery_failed_final', escalated_at = NOW()
          WHERE id = ${alertEvent.id}
        `;
        await tx`
          INSERT INTO audit_logs (org_id, action, resource_type, resource_id, details)
          VALUES (${alertEvent.org_id}, 'alert_event.no_channels', 'alert_event', ${alertEvent.id}, ${JSON.stringify({ reason: 'No valid channels available for delivery', triggeredBy: { alertRuleId: alertEvent.alert_rule_id, cause: 'system:notification_engine', trace: `alert_event:${alertEvent.id}` } })})
        `;
        return;
      }

      const anySucceeded = channelResults.some(r => r.success);
      const allFailed = channelResults.every(r => !r.success);

      if (allFailed) {
        // Multi-level escalation: try escalation channels in order
        const escalationChannelIds: string[] = Array.isArray(rule?.escalation_channels)
          ? (rule.escalation_channels as unknown[]).filter((c): c is string => typeof c === 'string')
          : [];
        let anyEscalationSucceeded = false;

        for (const escChannelId of escalationChannelIds) {
          if (channelIds.includes(escChannelId)) continue;

          const [escChannel] = await tx`
            SELECT * FROM notification_channels WHERE id = ${escChannelId} AND status = 'active' AND org_id = ${alertEvent.org_id} LIMIT 1
          `;
          if (!escChannel) continue;

          const escImpl = this.channels.get(escChannel.type);
          if (!escImpl) continue;

          const escRawConfig = (escChannel.config ?? {}) as Record<string, unknown>;
          const escDecryptedConfig: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(escRawConfig)) {
            if (typeof value === 'string' && isEncrypted(value)) {
              try { escDecryptedConfig[key] = decrypt(value); } catch { escDecryptedConfig[key] = value; }
            } else {
              escDecryptedConfig[key] = value;
            }
          }

          const escalationPayload: NotificationPayload = {
            id: `${alertEvent.id}-${escChannelId}`,
            alertEventId: alertEvent.id,
            orgId: alertEvent.org_id,
            eventType: alertEvent.event_type,
            severity: alertEvent.severity,
            message: `[ESCALATED] ${alertEvent.message}`,
            details: (alertEvent.details ?? {}) as Record<string, unknown>,
            linkToEntity: alertEvent.link_to_entity || `https://walwatch.app/dashboard/alerts/${alertEvent.id}`,
            traceId: alertEventTraceId,
          };

          const [escNotif] = await tx`
            INSERT INTO notifications (org_id, alert_event_id, channel_id, status)
            VALUES (${alertEvent.org_id}, ${alertEvent.id}, ${escChannelId}, 'queued')
            RETURNING *
          `;

          validateTransition('notification', 'queued', 'sent');
          await tx`
            UPDATE notifications SET status = 'sent', sent_at = NOW() WHERE id = ${escNotif.id}
          `;

          try {
            const result = await retryDelivery(
              () => escImpl.send(escalationPayload, escDecryptedConfig),
              { alertEventId: alertEvent.id, channelId: escChannelId, channelType: escChannel.type },
            );
            if (!result.success) throw new Error(result.error || 'Escalation delivery failed');

            validateTransition('notification', 'sent', 'delivered');
            await tx`
              UPDATE notifications SET status = 'delivered', delivered_at = NOW() WHERE id = ${escNotif.id}
            `;
            await tx`
              INSERT INTO activity_feed (org_id, actor_type, actor_id, action, resource_type, resource_id, summary, details, trace_id)
              VALUES (${alertEvent.org_id}, 'system', 'notification-engine', 'notification.delivered', 'notification', ${escNotif.id}, ${`Escalation notification delivered via ${escChannel.type} channel`}, ${JSON.stringify({ channelType: escChannel.type, escalated: true })}, ${alertEvent.id})
            `;

            anyEscalationSucceeded = true;
            logger.info({ alertEventId: alertEvent.id, escChannelId }, 'Escalation notification sent successfully');
            break;
          } catch (error) {
            const errMsg = (error as Error).message;
            validateTransition('notification', 'sent', 'failed');
            await tx`
              UPDATE notifications SET status = 'failed', error = ${errMsg} WHERE id = ${escNotif.id}
            `;
            logger.warn({ alertEventId: alertEvent.id, escChannelId, error: errMsg }, 'Escalation channel delivery failed');
          }
        }

        if (anyEscalationSucceeded) {
          alertEventFinalStatus = 'delivered';
          await tx`
            UPDATE alert_events SET status = 'delivered', delivered_at = NOW() WHERE id = ${alertEvent.id}
          `;
        } else {
          // All primary and escalation channels failed — final escalation with email fallback
          alertEventFinalStatus = 'delivery_failed_final';
          alertEventError = 'All delivery channels and escalation channels failed';
          await tx`
            UPDATE alert_events
            SET status = 'delivery_failed_final', escalated_at = NOW()
            WHERE id = ${alertEvent.id}
          `;
          await tx`
            INSERT INTO audit_logs (org_id, action, resource_type, resource_id, details)
            VALUES (${alertEvent.org_id}, 'alert_event.escalated', 'alert_event', ${alertEvent.id}, ${JSON.stringify({ reason: 'All delivery and escalation channels failed', channelResults, triggeredBy: { alertRuleId: alertEvent.alert_rule_id, cause: 'system:notification_engine', trace: `alertEvent:${alertEvent.id}` } })})
          `;

          // Last resort: attempt fallback email if available
          const [emailChannel] = await tx`
            SELECT * FROM notification_channels
            WHERE org_id = ${alertEvent.org_id} AND type = 'email' AND status = 'active'
            LIMIT 1
          `;
          if (emailChannel) {
            const emailImpl = this.channels.get('email');
            if (emailImpl) {
              const fallbackPayload: NotificationPayload = {
                id: `${alertEvent.id}-escalation`,
                alertEventId: alertEvent.id,
                orgId: alertEvent.org_id,
                eventType: alertEvent.event_type,
                severity: alertEvent.severity,
                message: `[ESCALATED] ${alertEvent.message}`,
                details: (alertEvent.details ?? {}) as Record<string, unknown>,
                linkToEntity: alertEvent.link_to_entity || `https://walwatch.app/dashboard/alerts/${alertEvent.id}`,
                traceId: alertEventTraceId,
              };
              const [escalationNotif] = await tx`
                INSERT INTO notifications (org_id, alert_event_id, channel_id, status)
                VALUES (${alertEvent.org_id}, ${alertEvent.id}, ${emailChannel.id}, 'queued')
                RETURNING *
              `;
              // Decrypt email channel config if encrypted
              const emailRawConfig = (emailChannel.config ?? {}) as Record<string, unknown>;
              const emailDecryptedConfig: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(emailRawConfig)) {
                if (typeof v === 'string' && isEncrypted(v)) {
                  try { emailDecryptedConfig[k] = decrypt(v); } catch { emailDecryptedConfig[k] = v; }
                } else {
                  emailDecryptedConfig[k] = v;
                }
              }
              // Mark escalation notification as sent (delivery attempt started)
              validateTransition('notification', 'queued', 'sent');
              await tx`
                UPDATE notifications SET status = 'sent', sent_at = NOW() WHERE id = ${escalationNotif.id}
              `;
              try {
                const result = await emailImpl.send(fallbackPayload, emailDecryptedConfig);
                if (result.success) {
                  validateTransition('notification', 'sent', 'delivered');
                  await tx`
                    UPDATE notifications SET status = 'delivered', delivered_at = NOW() WHERE id = ${escalationNotif.id}
                  `;
                  logger.info({ alertEventId: alertEvent.id }, 'Escalation email sent successfully');
                } else {
                  validateTransition('notification', 'sent', 'failed');
                  await tx`
                    UPDATE notifications SET status = 'failed', error = ${result.error || 'Escalation email failed'} WHERE id = ${escalationNotif.id}
                  `;
                  logger.warn({ alertEventId: alertEvent.id, error: result.error }, 'Escalation email failed');
                }
              } catch (error) {
                validateTransition('notification', 'sent', 'failed');
                await tx`
                  UPDATE notifications SET status = 'failed', error = ${(error as Error).message} WHERE id = ${escalationNotif.id}
                `;
                logger.warn({ alertEventId: alertEvent.id, error: (error as Error).message }, 'Escalation email threw');
              }
            }
          }
        }

        logger.info({ alertEventId: alertEvent.id }, 'Alert event escalated after complete delivery failure');
      } else if (anySucceeded) {
        // At least one channel succeeded
        if (channelResults.length === 1 || channelResults.every(r => r.success)) {
          // Single channel or all succeeded
          alertEventFinalStatus = 'delivered';
          await tx`
            UPDATE alert_events
            SET status = 'delivered', delivered_at = NOW()
            WHERE id = ${alertEvent.id}
          `;
        } else {
          // Mixed results: some succeeded, some failed
          alertEventFinalStatus = 'partial_delivery';
          await tx`
            UPDATE alert_events
            SET status = 'partial_delivery', delivered_at = NOW()
            WHERE id = ${alertEvent.id}
          `;
          await tx`
            INSERT INTO audit_logs (org_id, action, resource_type, resource_id, details)
            VALUES (${alertEvent.org_id}, 'alert_event.partial_delivery', 'alert_event', ${alertEvent.id}, ${JSON.stringify({ reason: 'Some channels failed delivery', channelResults, triggeredBy: { alertRuleId: alertEvent.alert_rule_id, cause: 'system:notification_engine', trace: `alert_event:${alertEvent.id}` } })})
          `;
        }
      }

      // Emit event bus events for alert_event lifecycle transitions inside the transaction
      if (alertEventFinalStatus === 'delivered' || alertEventFinalStatus === 'partial_delivery') {
        await emit(createEvent(
          'alert_event.delivered',
          alertEvent.org_id,
          'alert_event',
          alertEventId,
          { type: 'system' },
          { channelResults },
          alertEventTraceId,
        ));
      } else if (alertEventFinalStatus === 'delivery_failed_final') {
        await emit(createEvent(
          'alert_event.delivery_failed',
          alertEvent.org_id,
          'alert_event',
          alertEventId,
          { type: 'system' },
          { channelResults, error: alertEventError },
          alertEventTraceId,
        ));
      }
    });
  }
}
