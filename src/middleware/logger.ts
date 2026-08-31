/**
 * Simple request logger middleware.
 * Logs method, path, and request body (for JSON POSTs) to the console.
 * Helpful for debugging registration/login flows.
 */
import { Request, Response, NextFunction } from 'express';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const now = new Date().toISOString();
  const method = req.method;
  const path = req.path;
  const body = (method === 'POST' || method === 'PUT' || method === 'PATCH') ? req.body : undefined;
  console.log(`[${now}] ${method} ${path}`, body ? `Body: ${JSON.stringify(body)}` : '');
  next();
};
