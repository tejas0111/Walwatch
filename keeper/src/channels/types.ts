export interface NotificationPayload {
  id: string;
  alertEventId: string;
  orgId: string;
  eventType: string;
  severity: string;
  message: string;
  details: Record<string, unknown>;
  linkToEntity?: string;
  traceId?: string;
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export interface NotificationChannel {
  type: string;
  send(payload: NotificationPayload, config: Record<string, unknown>): Promise<DeliveryResult>;
}
