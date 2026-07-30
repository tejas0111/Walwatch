/**
 * Standardized Error Response Utility
 *
 * Spec 14 requirement: Errors are standardized in shape across every endpoint:
 *   - machine-readable error code
 *   - human-readable message
 *   - (where applicable) reference to the specific field or sub-resource that caused it
 *   - requestId for correlation
 *
 * Error codes are stable and versioned alongside the API.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ErrorCodes, type ErrorCode, FailureClasses, userFacingMessage, AppError, type FailureClass, type RecoveryPath } from './errors.js';

// ── Error Response Shape ──────────────────────────────────────

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    /** Spec 20 failure class — lets clients distinguish Persistent/Transient/Partial/Systemic */
    failureClass?: string;
    /** Reference to the specific field that caused the error (validation errors only) */
    field?: string;
    /** Reference to the specific sub-resource that caused the error */
    resource?: string;
    /** Recovery guidance for persistent errors (Task 8.3) */
    recoveryPath?: {
      userAction?: string;
      adminAction?: string;
      documentationUrl?: string;
    };
    /** Request ID for correlation */
    requestId?: string;
  };
}

// ── Response Helpers (low-level) ──────────────────────────────

/**
 * Get the request ID from the context, if available.
 */
function getRequestId(c: Context): string | undefined {
  return c.get('requestId') as string | undefined;
}

/**
 * Return a standardized error JSON response.
 *
 * @param c - Hono context
 * @param status - HTTP status code
 * @param code - Machine-readable error code (from ErrorCodes)
 * @param message - Human-readable error message
 * @param options - Optional field/resource reference and failure class
 */
export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  options?: {
    field?: string;
    resource?: string;
    failureClass?: string;
    recoveryPath?: { userAction?: string; adminAction?: string; documentationUrl?: string };
  },
) {
  const body: ErrorResponseBody = {
    error: {
      code,
      message,
      ...(options?.failureClass ? { failureClass: options.failureClass } : {}),
      ...(options?.field ? { field: options.field } : {}),
      ...(options?.resource ? { resource: options.resource } : {}),
      ...(options?.recoveryPath ? { recoveryPath: options.recoveryPath } : {}),
      requestId: getRequestId(c),
    },
  };
  return c.json(body, status);
}

/**
 * Return a 400 Validation Error response with optional field reference.
 * Classification: Persistent/Configuration — user must fix their input.
 */
export function validationError(
  c: Context,
  message = 'Validation failed',
  field?: string,
) {
  return errorResponse(c, 400, ErrorCodes.VALIDATION_ERROR, message, { field, failureClass: FailureClasses.PERSISTENT });
}

/**
 * Return a 404 Not Found response.
 * Classification: Persistent/Configuration — resource doesn't exist, won't change on retry.
 */
export function notFound(
  c: Context,
  message = 'Resource not found',
  resource?: string,
) {
  return errorResponse(c, 404, ErrorCodes.NOT_FOUND, message, { resource, failureClass: FailureClasses.PERSISTENT });
}

/**
 * Return a 401 Unauthorized response.
 * Classification: Persistent/Configuration — auth credentials need fixing.
 */
export function unauthorized(
  c: Context,
  message = 'Unauthorized',
) {
  return errorResponse(c, 401, ErrorCodes.UNAUTHORIZED, message, { failureClass: FailureClasses.PERSISTENT });
}

/**
 * Return a 403 Forbidden response.
 * Classification: Persistent/Configuration — permission issue won't resolve on retry.
 */
export function forbidden(
  c: Context,
  message = 'Forbidden',
) {
  return errorResponse(c, 403, ErrorCodes.FORBIDDEN, message, { failureClass: FailureClasses.PERSISTENT });
}

/**
 * Return a 409 Conflict response.
 * Classification: Persistent/Configuration — conflict requires human resolution.
 */
export function conflict(
  c: Context,
  message = 'Resource already exists',
  resource?: string,
) {
  return errorResponse(c, 409, ErrorCodes.CONFLICT, message, { resource, failureClass: FailureClasses.PERSISTENT });
}

/**
 * Return a 429 Rate Limited response with retry-after header.
 * Classification: Transient — caller should retry after the specified time.
 */
export function rateLimited(
  c: Context,
  retryAfterSeconds: number,
  message = 'Too many requests',
) {
  c.res.headers.set('Retry-After', retryAfterSeconds.toString());
  return errorResponse(c, 429, ErrorCodes.RATE_LIMITED, message, { failureClass: FailureClasses.TRANSIENT });
}

/**
 * Return a 500 Internal Error response.
 * In production, the error detail is hidden to avoid information leakage.
 * Classification: Systemic — indicates a platform-level issue.
 */
export function internalError(
  c: Context,
  message = 'Internal server error',
) {
  return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, message, { failureClass: FailureClasses.SYSTEMIC });
}

/**
 * Return a 503 Service Unavailable response.
 * Classification: Transient — caller should retry after a short delay.
 */
export function serviceUnavailable(
  c: Context,
  message = 'Service temporarily unavailable',
) {
  return errorResponse(c, 503, ErrorCodes.SERVICE_UNAVAILABLE, message, { failureClass: FailureClasses.TRANSIENT });
}

/**
 * Return a multi-status (207) Partial Failure response with per-item results.
 * Spec 14: Partial failures are reported per-item, not collapsed into a single failure.
 * Classification: Partial — some items succeeded, some failed.
 */
export function partialFailure(
  c: Context,
  message: string,
  results: Array<{ itemId: string; success: boolean; error?: string }>,
) {
  return c.json({
    error: {
      code: ErrorCodes.PARTIAL_FAILURE,
      message,
      failureClass: FailureClasses.PARTIAL,
      results,
      requestId: getRequestId(c),
    },
  }, 207);
}

/**
 * Standardize an error response from an AppError instance.
 * Used in route catch blocks for consistent error shaping.
 *
 * Spec 20: Response includes failureClass so clients can distinguish
 * Persistent (fix something), Transient (retry), and Systemic (we're aware).
 * Uses userFacingMessage() to produce class-appropriate messages.
 */
export function fromAppError(c: Context, err: { statusCode?: number; code?: string; message: string; failureClass?: string; recoveryPath?: RecoveryPath }) {
  const status = (err.statusCode || 500) as ContentfulStatusCode;
  const code = err.code || ErrorCodes.INTERNAL_ERROR;
  const failureClass = (err as AppError).failureClass || FailureClasses.PERSISTENT;
  const recoveryPath = (err as AppError).recoveryPath;

  // Spec 20: Use class-appropriate user-facing message
  // userFacingMessage handles both AppError and plain Error inputs
  const message = userFacingMessage(err);

  return errorResponse(c, status, code, message, { failureClass, recoveryPath });
}

export default {
  errorResponse,
  validationError,
  notFound,
  unauthorized,
  forbidden,
  conflict,
  rateLimited,
  internalError,
  serviceUnavailable,
  partialFailure,
  fromAppError,
};
