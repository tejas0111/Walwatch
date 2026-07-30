/**
 * Error Handling (spec 20)
 *
 * Four-class failure taxonomy:
 *   1. Transient — likely to succeed on retry (network blip, rate limit)
 *   2. Persistent — will fail identically until config changes (invalid webhook URL, revoked auth)
 *   3. Partial — some items succeed, some fail (bulk operations)
 *   4. Systemic — platform-level health issue (DB unavailable, queue backlog)
 *
 * "Never Fail Silently" rule:
 *   - Transient + retry exhaustion → Persistent escalation
 *   - Persistent → always produces a human-visible signal
 *   - Systemic → always produces an operational alert
 */

// ── Failure Classes ────────────────────────────────────────────

export type FailureClass = 'transient' | 'persistent' | 'partial' | 'systemic';

export const FailureClasses = {
  TRANSIENT: 'transient' as const,
  PERSISTENT: 'persistent' as const,
  PARTIAL: 'partial' as const,
  SYSTEMIC: 'systemic' as const,
};

// ── Recovery Paths (Task 8.3) ────────────────────────────────────

export interface RecoveryPath {
  userAction?: string;
  adminAction?: string;
  documentationUrl?: string;
}

export const RecoveryPaths = {
  WEBHOOK_DELIVERY: {
    userAction: 'Check webhook URL and secret in Settings > Integrations',
    adminAction: 'Verify external service API key is valid',
    documentationUrl: 'https://walwatch.io/docs/webhooks/troubleshooting',
  } satisfies RecoveryPath,
  BUDGET_LIMIT_EXCEEDED: {
    userAction: 'Increase budget limit or wait for next billing cycle',
    adminAction: 'Review spending limits in Budget Settings',
    documentationUrl: 'https://walwatch.io/docs/budgets/limits',
  } satisfies RecoveryPath,
  API_KEY_EXPIRED: {
    userAction: 'Generate a new API key in Settings > API Keys',
    adminAction: 'Rotate API keys on a regular schedule',
    documentationUrl: 'https://walwatch.io/docs/api-keys/rotation',
  } satisfies RecoveryPath,
  INVALID_CONFIGURATION: {
    userAction: 'Review configuration settings and correct any errors',
    adminAction: 'Check deployment configuration for invalid values',
  } satisfies RecoveryPath,
  AUTH_FAILURE: {
    userAction: 'Check your credentials and try again',
    adminAction: 'Verify authentication provider is properly configured',
  } satisfies RecoveryPath,
} as const;

// ── Error Codes ────────────────────────────────────────────────

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  STATE_TRANSITION_ERROR: 'STATE_TRANSITION_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  PARTIAL_FAILURE: 'PARTIAL_FAILURE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ── Base AppError with Failure Class ───────────────────────────

export class AppError extends Error {
  public code: ErrorCode;
  public failureClass: FailureClass;
  /** For partial failures: per-item results */
  public partialResults?: Array<{ itemId: string; success: boolean; error?: string }>;
  /** Recovery guidance for persistent errors (Task 8.3) */
  public recoveryPath?: RecoveryPath;

  constructor(
    message: string,
    public statusCode: number = 500,
    code?: ErrorCode,
    failureClass?: FailureClass,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code || ErrorCodes.INTERNAL_ERROR;
    // Spec 20: unclassified failures default to Persistent (conservative assumption)
    this.failureClass = failureClass || FailureClasses.PERSISTENT;
  }
}

// ── Transient Errors (retryable, spec 20 class 1) ──────────────

export class TransientError extends AppError {
  constructor(message: string, code?: ErrorCode) {
    super(message, 503, code || ErrorCodes.SERVICE_UNAVAILABLE, FailureClasses.TRANSIENT);
    this.name = 'TransientError';
  }
}

export class RateLimitError extends TransientError {
  constructor(message = 'Rate limit exceeded') {
    super(message, ErrorCodes.RATE_LIMITED);
    this.name = 'RateLimitError';
    this.statusCode = 429;
  }
}

export class ExternalServiceError extends TransientError {
  constructor(message = 'External service unavailable', public retryAfterMs?: number) {
    super(message, ErrorCodes.EXTERNAL_SERVICE_ERROR);
    this.name = 'ExternalServiceError';
  }
}

// ── Persistent / Configuration Errors (spec 20 class 2) ────────

export class PersistentError extends AppError {
  constructor(
    message: string,
    statusCode: number = 400,
    code?: ErrorCode,
    recoveryPath?: RecoveryPath,
  ) {
    super(message, statusCode, code || ErrorCodes.CONFIGURATION_ERROR, FailureClasses.PERSISTENT);
    this.name = 'PersistentError';
    this.recoveryPath = recoveryPath;
  }
}

export class ValidationError extends PersistentError {
  constructor(message = 'Validation failed') {
    super(message, 400, ErrorCodes.VALIDATION_ERROR);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends PersistentError {
  constructor(message = 'Resource not found') {
    super(message, 404, ErrorCodes.NOT_FOUND);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends PersistentError {
  constructor(message = 'Unauthorized') {
    super(message, 401, ErrorCodes.UNAUTHORIZED);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends PersistentError {
  constructor(message = 'Forbidden') {
    super(message, 403, ErrorCodes.FORBIDDEN);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends PersistentError {
  constructor(message = 'Resource already exists') {
    super(message, 409, ErrorCodes.CONFLICT);
    this.name = 'ConflictError';
  }
}

export class ConfigurationError extends PersistentError {
  constructor(message = 'Configuration error') {
    super(message, 400, ErrorCodes.CONFIGURATION_ERROR);
    this.name = 'ConfigurationError';
  }
}

// ── Partial Failure Errors (spec 20 class 3) ───────────────────

export class PartialFailureError extends AppError {
  constructor(
    message: string,
    public results: Array<{ itemId: string; success: boolean; error?: string }>,
  ) {
    super(message, 207, ErrorCodes.PARTIAL_FAILURE, FailureClasses.PARTIAL);
    this.name = 'PartialFailureError';
    this.partialResults = results;
  }
}

// ── Systemic Errors (spec 20 class 4) ──────────────────────────

export class SystemicError extends AppError {
  constructor(message = 'Internal system error', code?: ErrorCode) {
    super(message, 500, code || ErrorCodes.INTERNAL_ERROR, FailureClasses.SYSTEMIC);
    this.name = 'SystemicError';
    // Systemic errors are always logged as operational alerts
  }
}

// ── Error Classification Helpers ───────────────────────────────

/**
 * Determine if an error is transient and therefore safe to retry.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.failureClass === FailureClasses.TRANSIENT;
  }
  // Network/connection errors are transient by default
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  return false;
}

/**
 * Escalate a transient error that has exhausted retries to a persistent one.
 * Spec 20: "Transient failures that exhaust retries become Persistent-class escalations."
 */
export function escalateTransientToPersistent(
  originalError: unknown,
  context: string,
  recoveryPath?: RecoveryPath,
): PersistentError {
  const message = originalError instanceof Error
    ? `${context}: ${originalError.message} (retries exhausted)`
    : `${context}: transient failure exhausted retries`;

  // Preserve the original error details
  const err = new PersistentError(message, 503, ErrorCodes.EXTERNAL_SERVICE_ERROR, recoveryPath);
  err.cause = originalError instanceof Error ? originalError : undefined;
  return err;
}

/**
 * Create a user-facing error message based on the failure class.
 * Spec 20: "Error messages shown to users distinguish clearly between..."
 *
 * - Persistent/Configuration → returns the specific error message (user needs to fix something)
 * - Transient → "try again shortly"
 * - Systemic → "we're aware and working on it"
 * - Partial → per-item details reported separately
 * - Unclassified → "unexpected error" (conservative, logged for investigation)
 */
export function userFacingMessage(error: unknown): string {
  if (error instanceof AppError) {
    switch (error.failureClass) {
      case FailureClasses.TRANSIENT:
        return 'A temporary error occurred. Please try again shortly.';
      case FailureClasses.PERSISTENT:
        return error.message || 'A configuration issue needs to be fixed.';
      case FailureClasses.PARTIAL:
        return 'Some items completed successfully, but others failed. Check the results for details.';
      case FailureClasses.SYSTEMIC:
        return 'We are experiencing a system issue and are working to resolve it.';
    }
  }

  // Handle plain objects that have failureClass and message (e.g., from fromAppError)
  if (error && typeof error === 'object') {
    const obj = error as { failureClass?: string; message?: string };
    if (obj.failureClass) {
      switch (obj.failureClass) {
        case FailureClasses.TRANSIENT:
          return 'A temporary error occurred. Please try again shortly.';
        case FailureClasses.PERSISTENT:
          return obj.message || 'A configuration issue needs to be fixed.';
        case FailureClasses.SYSTEMIC:
          return 'We are experiencing a system issue and are working to resolve it.';
      }
    }
  }

  return 'An unexpected error occurred.';
}

export default {
  AppError,
  TransientError,
  RateLimitError,
  ExternalServiceError,
  PersistentError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  ConfigurationError,
  PartialFailureError,
  SystemicError,
  FailureClasses,
  ErrorCodes,
  RecoveryPaths,
  isTransient,
  escalateTransientToPersistent,
  userFacingMessage,
};
