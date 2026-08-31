/**
 * Global Error Handler Middleware
 * 
 * This middleware catches and formats all unhandled errors in the application.
 * It provides consistent error responses and logs errors for debugging.
 * 
 * Why: Express doesn't handle errors automatically in async functions.
 * This middleware ensures all errors are properly formatted and logged.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Custom error class for application-specific errors
 * Allows passing additional error metadata like status codes
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, code: string = 'ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    // Maintains proper stack trace in V8 environments
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Zod validation error handler
 * Converts Zod validation errors to formatted API responses
 */
export class ValidationError extends AppError {
  public readonly validationErrors: Record<string, string[]>;

  constructor(message: string, validationErrors: Record<string, string[]>) {
    super(message, 400, 'VALIDATION_ERROR');
    this.validationErrors = validationErrors;
  }
}

/**
 * Not found error for missing resources
 */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

/**
 * Conflict error for duplicate resources
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * Unauthorized error for authentication failures
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/**
 * Forbidden error for authorization failures
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * Main error handler middleware
 * 
 * What it does:
 * 1. Handles different error types appropriately
 * 2. Logs errors for debugging
 * 3. Returns consistent JSON error responses
 * 4. Hides internal error details in production
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  // Log error for debugging (use proper logging in production)
  console.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  // Handle AppError and subclasses
  if (err instanceof AppError) {
    const response: Record<string, unknown> = {
      success: false,
      error: err.message,
      code: err.code,
    };

    // Include validation errors if present
    if (err instanceof ValidationError) {
      response.details = err.validationErrors;
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // Handle Zod validation errors directly
  if (err.name === 'ZodError') {
    const zodError = err as unknown as { errors: Array<{ path: string[]; message: string }> };
    const validationErrors: Record<string, string[]> = {};
    
    zodError.errors.forEach((e) => {
      const path = e.path.join('.');
      if (!validationErrors[path]) {
        validationErrors[path] = [];
      }
      validationErrors[path].push(e.message);
    });

    res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: validationErrors,
    });
    return;
  }

  // Handle PostgreSQL unique violation
  if (err.message?.includes('duplicate key')) {
    res.status(409).json({
      success: false,
      error: 'Resource already exists',
      code: 'DUPLICATE_RESOURCE',
    });
    return;
  }

  // Handle foreign key violation
  if (err.message?.includes('foreign key violation')) {
    res.status(400).json({
      success: false,
      error: 'Referenced resource does not exist',
      code: 'INVALID_REFERENCE',
    });
    return;
  }

  // Default to 500 Internal Server Error
  // Hide internal details in production for security
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;

  res.status(500).json({
    success: false,
    error: message,
    code: 'INTERNAL_ERROR',
  });
};

/**
 * Async handler wrapper
 * Wraps async route handlers to catch errors and pass to error handler
 * 
 * Why: Express doesn't automatically catch errors in async functions.
 * This wrapper ensures all async errors are properly handled.
 * 
 * Usage: router.get('/', asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler = <T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};