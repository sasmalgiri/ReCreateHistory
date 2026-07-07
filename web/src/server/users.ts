//
// users.ts — the system database of accounts (separate from each user's
// knowledge ledger). Passwords are bcrypt-hashed. This is the identity side of
// the multi-user SaaS; per-user knowledge data lives in isolated ledgers.
//

import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { systemDbPath } from './paths'
import { log } from './core/logger'

export interface User {
  id: string
  email: string
  displayName: string | null
  createdAt: number
  emailVerified: boolean
}

const db = new Database(systemDbPath())
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
`)
// Additive columns for verification + reset (idempotent for existing DBs).
for (const ddl of [
  "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN verify_token_hash TEXT",
  "ALTER TABLE users ADD COLUMN reset_token_hash TEXT",
  "ALTER TABLE users ADD COLUMN reset_expires REAL"
]) {
  try { db.exec(ddl) } catch { /* column already exists */ }
}

function tokenHash(t: string): string {
  return createHash('sha256').update(t).digest('hex')
}
log.app(`system DB open at ${systemDbPath()}`)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const users = {
  create(email: string, password: string, displayName?: string): User {
    const e = email.trim().toLowerCase()
    if (!EMAIL_RE.test(e)) throw new Error('Invalid email address.')
    if (password.length < 8) throw new Error('Password must be at least 8 characters.')
    if (this.findByEmail(e)) throw new Error('An account with that email already exists.')
    const id = randomUUID()
    const now = Date.now()
    const hash = bcrypt.hashSync(password, 10)
    db.prepare('INSERT INTO users (id,email,password_hash,display_name,created_at,email_verified) VALUES (?,?,?,?,?,0)')
      .run(id, e, hash, displayName?.trim() || null, now)
    return { id, email: e, displayName: displayName?.trim() || null, createdAt: now, emailVerified: false }
  },

  /** Issue a one-time email-verification token (returns the raw token). */
  issueVerifyToken(userId: string): string {
    const token = randomBytes(24).toString('hex')
    db.prepare('UPDATE users SET verify_token_hash=? WHERE id=?').run(tokenHash(token), userId)
    return token
  },

  verifyEmailByToken(token: string): boolean {
    const r = db.prepare('SELECT id FROM users WHERE verify_token_hash=?').get(tokenHash(token)) as any
    if (!r) return false
    db.prepare('UPDATE users SET email_verified=1, verify_token_hash=NULL WHERE id=?').run(r.id)
    return true
  },

  /** Issue a password-reset token valid for 1 hour (returns raw token, or
   *  null when no such account — callers must not leak which it was). */
  issueResetToken(email: string): string | null {
    const u = this.findByEmail(email)
    if (!u) return null
    const token = randomBytes(24).toString('hex')
    db.prepare('UPDATE users SET reset_token_hash=?, reset_expires=? WHERE id=?')
      .run(tokenHash(token), Date.now() + 60 * 60 * 1000, u.id)
    return token
  },

  resetPassword(token: string, newPassword: string): boolean {
    if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.')
    const r = db.prepare('SELECT id, reset_expires FROM users WHERE reset_token_hash=?').get(tokenHash(token)) as any
    if (!r || Number(r.reset_expires ?? 0) < Date.now()) return false
    db.prepare('UPDATE users SET password_hash=?, reset_token_hash=NULL, reset_expires=NULL WHERE id=?')
      .run(bcrypt.hashSync(newPassword, 10), r.id)
    return true
  },

  findByEmail(email: string): (User & { passwordHash: string }) | null {
    const r = db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase()) as any
    return r ? map(r) : null
  },

  getById(id: string): User | null {
    const r = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any
    if (!r) return null
    const { passwordHash, ...pub } = map(r)
    return pub
  },

  verify(email: string, password: string): User | null {
    const r = this.findByEmail(email)
    if (!r) return null
    if (!bcrypt.compareSync(password, r.passwordHash)) return null
    const { passwordHash, ...pub } = r
    return pub
  },

  count(): number {
    return Number((db.prepare('SELECT COUNT(*) c FROM users').get() as any).c)
  }
}

function map(r: any): User & { passwordHash: string } {
  return {
    id: r.id, email: r.email, displayName: r.display_name ?? null,
    createdAt: Number(r.created_at), passwordHash: r.password_hash,
    emailVerified: Number(r.email_verified ?? 0) === 1
  }
}
