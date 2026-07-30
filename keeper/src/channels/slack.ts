import { NotificationChannel, NotificationPayload, DeliveryResult } from './types.js';

export class SlackChannel implements NotificationChannel {
  type = 'slack';

  async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<DeliveryResult> {
    const webhookUrl = config.webhookUrl as string;
    if (!webhookUrl) return { success: false, error: 'Slack webhook URL not configured' };

    const color = payload.severity === 'error' ? 'danger'
      : payload.severity === 'warning' ? 'warning'
      : 'good';

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [{
            color,
            title: payload.eventType,
            text: payload.message,
            fields: Object.entries(payload.details).map(([k, v]) => ({
              title: k,
              value: String(v).slice(0, 1024),
              short: true,
            })),
            ts: Math.floor(Date.now() / 1000),
          }],
        }),
      });
      return { success: response.ok, statusCode: response.status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
