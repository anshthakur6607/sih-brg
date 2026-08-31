/**
 * Rate Limiting Middleware
 * 
 * This middleware implements rate limiting using Upstash Redis.
 * It prevents abuse by limiting requests per IP address.
 * 
 * Why: Protect the API from brute-force attacks, DDoS, and excessive usage.
 * Different limits apply to different endpoint categories.
 */

import { Ratelimit as UpstashRateLimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { Request, Response, NextFunction } from 'express';

// Initialize Upstash Redis client - optional for local dev
const hasRedis = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = hasRedis ? new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
}) : null as any;

// Define rate limiters for different use cases

/**
 * General API rate limit
 * - 100 requests per minute for authenticated users
 * - 20 requests per minute for unauthenticated requests
 */
const generalLimiter = new UpstashRateLimit({
  redis,
  prefix: 'skillup:rate:general',
  limiter: UpstashRateLimit.slidingWindow(100, '60 s'),
  analytics: true,
});

/**
 * Authentication rate limit (stricter)
 * - 5 login attempts per minute to prevent brute force
 */
const authLimiter = new UpstashRateLimit({
  redis,
  prefix: 'skillup:rate:auth',
  limiter: UpstashRateLimit.slidingWindow(5, '60 s'),
  analytics: true,
});

/**
 * Assessment/submission rate limit
 * - 10 submissions per hour to prevent spam
 */
const submissionLimiter = new UpstashRateLimit({
  redis,
  prefix: 'skillup:rate:submission',
  limiter: UpstashRateLimit.slidingWindow(10, '60 m'),
  analytics: true,
});

/**
 * AI service rate limit
 * - 20 AI requests per minute ( Gemini API costs money )
 */
const aiLimiter = new UpstashRateLimit({
  redis,
  prefix: 'skillup:rate:ai',
  limiter: UpstashRateLimit.slidingWindow(20, '60 s'),
  analytics: true,
});

/**
 * Rate limiter middleware factory
 * 
 * Creates a rate limiting middleware based on the provided limiter
 * 
 * @param limiter - Upstash rate limiter instance
 * @param skipSuccessfulRequests - Whether to count successful requests
 */
const createRateLimiter = (
  limiter: any,
  skipSuccessfulRequests: boolean = false
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!hasRedis) { next(); return; }
    // Get IP address (consider X-Forwarded-For in production)
    const ip = req.ip || 
               req.headers['x-forwarded-for'] as string || 
               'unknown';

    try {
      const result = await limiter.limit(ip);

      // Set rate limit headers
      res.set('X-RateLimit-Limit', result.limit.toString());
      res.set('X-RateLimit-Remaining', result.remaining.toString());
      res.set('X-RateLimit-Reset', result.reset.toString());

      if (!result.success) {
        res.status(429).json({
          success: false,
          error: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          retry_after: result.reset,
        });
        return;
      }

      next();
    } catch (error) {
      // If Redis is down, allow request but log error
      console.error('Rate limiter error:', error);
      next();
    }
  };
};

// Export pre-configured middlewares
export const rateLimiter = createRateLimiter(generalLimiter);
export const authRateLimiter = createRateLimiter(authLimiter);
export const submissionRateLimiter = createRateLimiter(submissionLimiter);
export const aiRateLimiter = createRateLimiter(aiLimiter);

/**
 * IP-based rate limiter for public endpoints
 * Uses simple in-memory store for development (not for production)
 */
export const simpleRateLimiter = (maxRequests: number = 100, windowMs: number = 60000) => {
  const requests = new Map<string, { count: number; resetTime: number }>();

  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of requests.entries()) {
      if (data.resetTime < now) {
        requests.delete(ip);
      }
    }
  }, 60000);

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    
    let record = requests.get(ip);
    
    if (!record || record.resetTime < now) {
      record = { count: 0, resetTime: now + windowMs };
      requests.set(ip, record);
    }
    
    record.count++;
    
    if (record.count > maxRequests) {
      res.status(429).json({
        success: false,
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retry_after: Math.ceil((record.resetTime - now) / 1000),
      });
      return;
    }

    next();
  };
};