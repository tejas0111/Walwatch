import { NotificationChannel, NotificationPayload, DeliveryResult } from './types.js';

export class TelegramChannel implements NotificationChannel {
  type = 'telegram';

  async send(payload: NotificationPayload, config: Record<string, unknown>): Promise<DeliveryResult> {
    const botToken = config.botToken as string;
    const chatId = config.chatId as string;
    if (!botToken || !chatId) return { success: false, error: 'Telegram bot token or chat ID not configured' };

    try {
      const text = `*${payload.eventType}* [${payload.severity.toUpperCase()}]\n${payload.message}\n\`${JSON.stringify(payload.details)}\``;
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });
      return { success: response.ok, statusCode: response.status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
