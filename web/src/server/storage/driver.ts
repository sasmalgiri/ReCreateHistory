//
// driver.ts — where each ledger lives. Two modes, same async client:
//   Local  (default): file:<DATA_DIR>/users/<id>/ledger.db — self-host/dev.
//   Turso  (TURSO_API_TOKEN set): one hosted SQLite database PER USER,
//          created on demand via the Turso platform API — this is what makes
//          the app run on serverless (Vercel) with zero data loss.
//
// Env (Turso mode): TURSO_API_TOKEN (platform API), TURSO_ORG,
// TURSO_GROUP (default "default"), TURSO_GROUP_TOKEN (db auth for the group).
//

import { join } from 'node:path'
import type { LedgerOpts } from './database'
import { userDir, dataDir } from '../paths'
import { log } from '../core/logger'

const env = process.env

export function tursoMode(): boolean {
  return !!(env.TURSO_API_TOKEN && env.TURSO_ORG && env.TURSO_GROUP_TOKEN)
}

function dbName(userId: string): string {
  return `rch-u-${userId.replace(/-/g, '').slice(0, 16).toLowerCase()}`
}

const ensured = new Set<string>()

/** Create the hosted DB if it doesn't exist (idempotent, cached per process). */
async function ensureTursoDb(name: string): Promise<void> {
  if (ensured.has(name)) return
  const org = env.TURSO_ORG!
  const res = await fetch(`https://api.turso.tech/v1/organizations/${org}/databases`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURSO_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, group: env.TURSO_GROUP || 'default' })
  })
  // 409 = already exists — fine. Anything else unexpected is fatal for this open.
  if (!res.ok && res.status !== 409) {
    throw new Error(`Turso create db failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`)
  }
  ensured.add(name)
  if (res.ok) log.storage(`turso: created database ${name}`)
}

/** Ledger location for a user's evidence database. */
export async function userLedgerOpts(userId: string): Promise<LedgerOpts> {
  if (tursoMode()) {
    const name = dbName(userId)
    await ensureTursoDb(name)
    return { url: `libsql://${name}-${env.TURSO_ORG}.turso.io`, authToken: env.TURSO_GROUP_TOKEN }
  }
  return { url: `file:${join(userDir(userId), 'ledger.db').replace(/\\/g, '/')}` }
}

/** Ledger location for the system database (accounts, quotas). */
export async function systemDbOpts(): Promise<LedgerOpts> {
  if (tursoMode()) {
    const name = 'rch-system'
    await ensureTursoDb(name)
    return { url: `libsql://${name}-${env.TURSO_ORG}.turso.io`, authToken: env.TURSO_GROUP_TOKEN }
  }
  return { url: `file:${join(dataDir(), 'system.db').replace(/\\/g, '/')}` }
}
