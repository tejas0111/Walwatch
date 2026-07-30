import { NotificationChannel, NotificationPayload, DeliveryResult } from './types.js';

export class EmailChannel implements NotificationChannel {
  type = 'email';

  async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<DeliveryResult> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return { success: false, error: 'RESEND_API_KEY not configured' };

    const to = config.to as string;
    if (!to || typeof to !== 'string' || to.trim().length === 0) {
      return { success: false, error: 'Email recipient (to) is not configured or empty' };
    }
    const from = config.from as string || process.env.NOTIFICATION_FROM_EMAIL || 'alerts@walwatch.dev';

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to,
          subject: `[${payload.severity.toUpperCase()}] ${payload.eventType} — ${payload.message.slice(0, 80)}`,
          html: this.buildEmailBody(payload),
        }),
      });

      return { success: response.ok, statusCode: response.status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private buildEmailBody(payload: NotificationPayload): string {
    return `<h2>${payload.eventType}</h2>
<p>${payload.message}</p>
<pre>${JSON.stringify(payload.details, null, 2)}</pre>
${payload.linkToEntity ? `<p><a href="${payload.linkToEntity}">View in dashboard</a></p>` : ''}`;
  }
}
