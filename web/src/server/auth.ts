//
// auth.ts — JWT session cookies + the Express middleware that resolves a
// request to a user id. The token is httpOnly so the renderer can't read it;
// every /api call is authenticated and scoped to req.userId.
//

import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import { config } from './config'

export interface AuthedRequest extends Request {
  userId?: string
}

export function issueToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '30d' })
}

export function setSessionCookie(res: Response, userId: string): void {
  res.cookie(config.cookieName, issueToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/'
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.cookieName, { path: '/' })
}

export function userIdFromRequest(req: Request): string | null {
  const token = (req as any).cookies?.[config.cookieName]
  if (!token) return null
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string }
    return payload.sub ?? null
  } catch {
    return null
  }
}

/** Gate: require a valid session; attach userId or 401. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const userId = userIdFromRequest(req)
  if (!userId) {
    res.status(401).json({ error: 'unauthenticated' })
    return
  }
  req.userId = userId
  next()
}
