import { describe, it, expect } from 'vitest';
import {
  isTransient,
  escalateTransientToPersistent,
  userFacingMessage,
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
} from '../lib/errors.js';

describe('isTransient', () => {
  it('returns true for TransientError', () => {
    expect(isTransient(new TransientError('temp'))).toBe(true);
  });

  it('returns true for RateLimitError', () => {
    expect(isTransient(new RateLimitError())).toBe(true);
  });

  it('returns true for ExternalServiceError', () => {
    expect(isTransient(new ExternalServiceError())).toBe(true);
  });

  it('returns false for PersistentError', () => {
    expect(isTransient(new PersistentError('config'))).toBe(false);
  });

  it('returns false for AppError (default persistent)', () => {
    expect(isTransient(new AppError('generic'))).toBe(false);
  });

  it('returns false for plain Error', () => {
    expect(isTransient(new Error('plain'))).toBe(false);
  });

  it('returns false for string', () => {
    expect(isTransient('some error')).toBe(false);
  });

  it('returns true for TypeError with fetch', () => {
    expect(isTransient(new TypeError('fetch failed'))).toBe(true);
  });

  it('returns false for TypeError without fetch', () => {
    expect(isTransient(new TypeError('some other type error'))).toBe(false);
  });
});

describe('escalateTransientToPersistent', () => {
  it('converts TransientError to PersistentError', () => {
    const original = new TransientError('network timeout');
    const escalated = escalateTransientToPersistent(original, 'Renewal job 123');
    expect(escalated).toBeInstanceOf(PersistentError);
    expect(escalated.failureClass).toBe(FailureClasses.PERSISTENT);
    expect(escalated.message).toContain('Renewal job 123');
    expect(escalated.message).toContain('retries exhausted');
    expect(escalated.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('preserves original error as cause', () => {
    const original = new ExternalServiceError('API down');
    const escalated = escalateTransientToPersistent(original, 'context');
    expect(escalated.cause).toBe(original);
  });

  it('handles non-Error input', () => {
    const escalated = escalateTransientToPersistent('string error', 'ctx');
    expect(escalated).toBeInstanceOf(PersistentError);
    expect(escalated.message).toBe('ctx: transient failure exhausted retries');
  });
});

describe('userFacingMessage', () => {
  it('returns transient message for TransientError', () => {
    const msg = userFacingMessage(new TransientError('oops'));
    expect(msg).toContain('try again');
  });

  it('returns persistent message with original text for PersistentError', () => {
    const msg = userFacingMessage(new PersistentError('Invalid webhook URL'));
    expect(msg).toContain('Invalid webhook URL');
  });

  it('returns partial message for PartialFailureError', () => {
    const msg = userFacingMessage(new PartialFailureError('partial', []));
    expect(msg).toContain('Some items');
  });

  it('returns systemic message for SystemicError', () => {
    const msg = userFacingMessage(new SystemicError());
    expect(msg).toContain('system issue');
  });

  it('returns default for plain Error', () => {
    const msg = userFacingMessage(new Error('something'));
    expect(msg).toBe('An unexpected error occurred.');
  });

  it('returns default for non-Error input', () => {
    const msg = userFacingMessage(null);
    expect(msg).toBe('An unexpected error occurred.');
  });
});

describe('Error class hierarchy', () => {
  it('AppError has correct defaults', () => {
    const err = new AppError('test');
    expect(err.name).toBe('AppError');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(err.failureClass).toBe(FailureClasses.PERSISTENT);
  });

  it('TransientError sets transient failure class and 503', () => {
    const err = new TransientError('test');
    expect(err.name).toBe('TransientError');
    expect(err.failureClass).toBe(FailureClasses.TRANSIENT);
    expect(err.statusCode).toBe(503);
  });

  it('RateLimitError sets 429 status', () => {
    const err = new RateLimitError();
    expect(err.name).toBe('RateLimitError');
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe(ErrorCodes.RATE_LIMITED);
  });

  it('ExternalServiceError has retryAfterMs', () => {
    const err = new ExternalServiceError('down', 5000);
    expect(err.name).toBe('ExternalServiceError');
    expect(err.retryAfterMs).toBe(5000);
    expect(err.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('PersistentError defaults to 400', () => {
    const err = new PersistentError('bad config');
    expect(err.name).toBe('PersistentError');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(ErrorCodes.CONFIGURATION_ERROR);
  });

  it('ValidationError has 400 and VALIDATION_ERROR', () => {
    const err = new ValidationError();
    expect(err.name).toBe('ValidationError');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('NotFoundError has 404', () => {
    const err = new NotFoundError();
    expect(err.name).toBe('NotFoundError');
    expect(err.statusCode).toBe(404);
  });

  it('UnauthorizedError has 401', () => {
    const err = new UnauthorizedError();
    expect(err.name).toBe('UnauthorizedError');
    expect(err.statusCode).toBe(401);
  });

  it('ForbiddenError has 403', () => {
    const err = new ForbiddenError();
    expect(err.name).toBe('ForbiddenError');
    expect(err.statusCode).toBe(403);
  });

  it('ConflictError has 409', () => {
    const err = new ConflictError();
    expect(err.name).toBe('ConflictError');
    expect(err.statusCode).toBe(409);
  });

  it('ConfigurationError has CONFIGURATION_ERROR code', () => {
    const err = new ConfigurationError();
    expect(err.name).toBe('ConfigurationError');
    expect(err.code).toBe(ErrorCodes.CONFIGURATION_ERROR);
  });
});

describe('PartialFailureError', () => {
  it('stores results and errors arrays', () => {
    const results = [
      { itemId: '1', success: true },
      { itemId: '2', success: false, error: 'invalid' },
    ];
    const err = new PartialFailureError('Bulk operation partial failure', results);
    expect(err.name).toBe('PartialFailureError');
    expect(err.statusCode).toBe(207);
    expect(err.code).toBe(ErrorCodes.PARTIAL_FAILURE);
    expect(err.failureClass).toBe(FailureClasses.PARTIAL);
    expect(err.results).toHaveLength(2);
    expect(err.partialResults).toBe(results);
  });
});

describe('SystemicError', () => {
  it('includes service and criticality', () => {
    const err = new SystemicError('DB connection pool exhausted');
    expect(err.name).toBe('SystemicError');
    expect(err.failureClass).toBe(FailureClasses.SYSTEMIC);
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
