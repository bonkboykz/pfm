import type { MiddlewareHandler } from 'hono';
import { AppError } from '../errors.js';

export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const apiKey = process.env.PFM_API_KEY;

    // If no API key configured, auth is disabled (local dev)
    if (!apiKey) {
      return next();
    }

    const provided = c.req.header('Authorization');

    if (!provided) {
      throw new AppError(
        'UNAUTHORIZED',
        'Missing Authorization header',
        401,
        'Include header: Authorization: Bearer <your-api-key>'
      );
    }

    // Expect: "Bearer <key>"
    const match = provided.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1] !== apiKey) {
      throw new AppError(
        'UNAUTHORIZED',
        'Invalid API key',
        401,
        'Check your PFM_API_KEY environment variable'
      );
    }

    await next();
  };
}
