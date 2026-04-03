import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { timingSafeEqual } from 'crypto';

export function correlationId(req: Request, _res: Response, next: NextFunction): void {
  req.headers['x-correlation-id'] = req.headers['x-correlation-id'] || uuidv4();
  next();
}

// Constant-time string comparison to prevent timing attacks
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// API key authentication middleware.
// Checks X-API-Key header or ?api_key query param against API_KEYS env var.
// API_KEYS is a comma-separated list of valid keys. If unset, auth is disabled (dev mode).
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const validKeys = process.env.API_KEYS?.split(',').map(k => k.trim()).filter(Boolean);

  // If no keys configured, skip auth (development mode)
  if (!validKeys || validKeys.length === 0) {
    next();
    return;
  }

  const providedKey = (req.headers['x-api-key'] as string)
    || (req.query.api_key as string);

  if (!providedKey || !validKeys.some(k => safeCompare(k, providedKey))) {
    res.status(401).json({ error: 'Unauthorized — valid X-API-Key header required' });
    return;
  }

  next();
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error(`[ERROR] ${err.message}`, err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
