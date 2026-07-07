//
// rateLimit.ts — deterministic fixed-window rate limiting (in-memory, no
// dependency). Protects the public endpoints from brute force and abuse:
// auth by IP (strict), API + uploads by authenticated user. Single-process
// by design — this server scales vertically (one box, many users).
//

import type { Request, Response, NextFunction } from 'express'

interface Bucket { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

// Sweep expired buckets so memory stays bounded.
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}, 60_000).unref?.()

function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count++
  return { ok: b.count <= limit, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) }
}

function clientIp(req: Request): string {
  // Trust the first X-Forwarded-For hop only when behind a proxy (typical
  // Render/Railway/Fly setup); fall back to the socket address.
  const xff = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return xff || req.socket.remoteAddress || 'unknown'
}

/** Limit by client IP — for unauthenticated endpoints (auth). */
export function limitByIp(name: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { ok, retryAfterSec } = hit(`${name}:ip:${clientIp(req)}`, limit, windowMs)
    if (!ok) {
      res.setHeader('Retry-After', String(retryAfterSec))
      res.status(429).json({ error: `Too many requests. Try again in ${retryAfterSec}s.` })
      return
    }
    next()
  }
}

/** Limit by authenticated user id (set by requireAuth) — for API/uploads. */
export function limitByUser(name: string, limit: number, windowMs: number) {
  return (req: Request & { userId?: string }, res: Response, next: NextFunction): void => {
    const key = req.userId ? `${name}:u:${req.userId}` : `${name}:ip:${clientIp(req)}`
    const { ok, retryAfterSec } = hit(key, limit, windowMs)
    if (!ok) {
      res.setHeader('Retry-After', String(retryAfterSec))
      res.status(429).json({ error: `Rate limit reached. Try again in ${retryAfterSec}s.` })
      return
    }
    next()
  }
}
