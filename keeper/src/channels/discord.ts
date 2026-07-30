import { NotificationChannel, NotificationPayload, DeliveryResult } from './types.js';

export class DiscordChannel implements NotificationChannel {
  type = 'discord';

  async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<DeliveryResult> {
    const webhookUrl = config.webhookUrl as string;
    if (!webhookUrl) return { success: false, error: 'Discord webhook URL not configured' };

    const embedColor = payload.severity === 'error' ? 0xff0000
      : payload.severity === 'warning' ? 0xffaa00
      : 0x3498db;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: payload.eventType,
            description: payload.message,
            color: embedColor,
            fields: Object.entries(payload.details).map(([k, v]) => ({
              name: k,
              value: String(v).slice(0, 1024),
              inline: true,
            })),
            timestamp: new Date().toISOString(),
          }],
        }),
      });
      return { success: response.ok, statusCode: response.status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
