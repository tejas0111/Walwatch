import { createHmac } from 'crypto';
import { URL } from 'url';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { NotificationChannel, NotificationPayload, DeliveryResult } from './types.js';
import { emit, createEvent } from '../../../api/src/lib/event-bus.js';

const PRIVATE_IP_RANGES = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((r) => r.test(ip));
}

async function isInternalHostname(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return isPrivateIP(hostname);
  try {
    const addresses = await lookup(hostname);
    return isPrivateIP(addresses.address);
  } catch {
    return false;
  }
}

export class GenericWebhookChannel implements NotificationChannel {
  type = 'webhook';

  async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<DeliveryResult> {
    const rawUrl = config.url as string;
    if (!rawUrl) return { success: false, error: 'Webhook URL not configured' };

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { success: false, error: 'Invalid webhook URL' };
    }

    if (parsed.protocol !== 'https:') {
      return { success: false, error: 'Only HTTPS webhook URLs are allowed' };
    }

    if (await isInternalHostname(parsed.hostname)) {
      return { success: false, error: 'Webhook URL must point to an external service' };
    }

    const secret = config.secret as string || '';
    const body = JSON.stringify(payload);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) {
      const signature = createHmac('sha256', secret).update(body).digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
    } else {
      console.warn('[webhook] No secret configured — skipping payload signature');
    }

    try {
      const response = await fetch(rawUrl, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        emit(createEvent('webhook.failing', payload.orgId, 'webhook', payload.alertEventId, { type: 'system' }, { url: rawUrl, statusCode: response.status }));
      }
      return { success: response.ok, statusCode: response.status };
    } catch (err) {
      emit(createEvent('webhook.failing', payload.orgId, 'webhook', payload.alertEventId, { type: 'system' }, { url: rawUrl, error: (err as Error).message }));
      return { success: false, error: (err as Error).message };
    }
  }
}
