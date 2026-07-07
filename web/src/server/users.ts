//
// users.ts — the system database of accounts (separate from each user's
// knowledge ledger). Passwords are bcrypt-hashed. This is the identity side of
// the multi-user SaaS; per-user knowledge data lives in isolated ledgers.
//

import bcrypt from 'bcryptjs'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { Ledger } from './storage/database'
import { systemDbOpts } from './storage/driver'
import { log } from './core/logger'

export interface User {
  id: string
  email: string
  displayName: string | null
  createdAt: number
  emailVerified: boolean
}

let _db: Ledger | null = null
async function sys(): Promise<Ledger> {
  if (!_db) {
    _db = new Ledger(await systemDbOpts())
    await _db.exec(`
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
      try { await _db.exec(ddl) } catch { /* column already exists */ }
    }
    log.app(`system DB open at ${_db.path}`)
  }
  return _db
}

function tokenHash(t: string): string {
  return createHash('sha256').update(t).digest('hex')
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const users = {
  async create(email: string, password: string, displayName?: string): Promise<User> {
    const e = email.trim().toLowerCase()
    if (!EMAIL_RE.test(e)) throw new Error('Invalid email address.')
    if (password.length < 8) throw new Error('Password must be at least 8 characters.')
    if (await this.findByEmail(e)) throw new Error('An account with that email already exists.')
    const id = randomUUID()
    const now = Date.now()
    const hash = bcrypt.hashSync(password, 10)
    const L = await sys()
    await L.run('INSERT INTO users (id,email,password_hash,display_name,created_at,email_verified) VALUES (?,?,?,?,?,0)',
      [id, e, hash, displayName?.trim() || null, now])
    return { id, email: e, displayName: displayName?.trim() || null, createdAt: now, emailVerified: false }
  },

  /** Issue a one-time email-verification token (returns the raw token). */
  async issueVerifyToken(userId: string): Promise<string> {
    const token = randomBytes(24).toString('hex')
    const L = await sys()
    await L.run('UPDATE users SET verify_token_hash=? WHERE id=?', [tokenHash(token), userId])
    return token
  },

  async verifyEmailByToken(token: string): Promise<boolean> {
    const L = await sys()
    const r = (await L.first('SELECT id FROM users WHERE verify_token_hash=?', [tokenHash(token)])) as any
    if (!r) return false
    await L.run('UPDATE users SET email_verified=1, verify_token_hash=NULL WHERE id=?', [r.id])
    return true
  },

  /** Issue a password-reset token valid for 1 hour (returns raw token, or
   *  null when no such account — callers must not leak which it was). */
  async issueResetToken(email: string): Promise<string | null> {
    const u = await this.findByEmail(email)
    if (!u) return null
    const token = randomBytes(24).toString('hex')
    const L = await sys()
    await L.run('UPDATE users SET reset_token_hash=?, reset_expires=? WHERE id=?',
      [tokenHash(token), Date.now() + 60 * 60 * 1000, u.id])
    return token
  },

  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.')
    const L = await sys()
    const r = (await L.first('SELECT id, reset_expires FROM users WHERE reset_token_hash=?', [tokenHash(token)])) as any
    if (!r || Number(r.reset_expires ?? 0) < Date.now()) return false
    await L.run('UPDATE users SET password_hash=?, reset_token_hash=NULL, reset_expires=NULL WHERE id=?',
      [bcrypt.hashSync(newPassword, 10), r.id])
    return true
  },

  async findByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
    const L = await sys()
    const r = (await L.first('SELECT * FROM users WHERE email=?', [email.trim().toLowerCase()])) as any
    return r ? map(r) : null
  },

  async getById(id: string): Promise<User | null> {
    const L = await sys()
    const r = (await L.first('SELECT * FROM users WHERE id=?', [id])) as any
    if (!r) return null
    const { passwordHash, ...pub } = map(r)
    return pub
  },

  async verify(email: string, password: string): Promise<User | null> {
    const r = await this.findByEmail(email)
    if (!r) return null
    if (!bcrypt.compareSync(password, r.passwordHash)) return null
    const { passwordHash, ...pub } = r
    return pub
  },

  async count(): Promise<number> {
    const L = await sys()
    return Number(((await L.first('SELECT COUNT(*) c FROM users')) as any)?.c ?? 0)
  }
}

function map(r: any): User & { passwordHash: string } {
  return {
    id: r.id, email: r.email, displayName: r.display_name ?? null,
    createdAt: Number(r.created_at), passwordHash: r.password_hash,
    emailVerified: Number(r.email_verified ?? 0) === 1
  }
}
