//
// quotas.ts — per-user resource caps, persisted in the system DB so they
// survive restarts. Two quotas guard a public deployment:
//   storage — total uploaded bytes per user (a hostile user can't fill the disk)
//   asks    — LLM-answer questions per day (a hostile user can't burn the
//             operator's cloud-API credits)
// Both are configurable via env and disabled when set to 0.
//

import { Ledger } from './storage/database'
import { systemDbOpts } from './storage/driver'
import { config } from './config'

let _db: Ledger | null = null
async function sys(): Promise<Ledger> {
  if (!_db) {
    _db = new Ledger(await systemDbOpts())
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        asks INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
      CREATE TABLE IF NOT EXISTS usage_storage (
        user_id TEXT PRIMARY KEY NOT NULL,
        bytes INTEGER NOT NULL DEFAULT 0
      );
    `)
  }
  return _db
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export const quotas = {
  /** True if the user may upload `incomingBytes` more; false = over quota. */
  async storageAllows(userId: string, incomingBytes: number): Promise<{ ok: boolean; usedBytes: number; limitBytes: number }> {
    const limitBytes = config.storageQuotaBytes
    const L = await sys()
    const row = (await L.first('SELECT bytes FROM usage_storage WHERE user_id=?', [userId])) as any
    const usedBytes = Number(row?.bytes ?? 0)
    if (limitBytes <= 0) return { ok: true, usedBytes, limitBytes }
    return { ok: usedBytes + incomingBytes <= limitBytes, usedBytes, limitBytes }
  },

  async recordStorage(userId: string, bytes: number): Promise<void> {
    const L = await sys()
    await L.run(
      `INSERT INTO usage_storage (user_id, bytes) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET bytes = bytes + excluded.bytes`,
      [userId, bytes]
    )
  },

  /** Atomically count one ask; false = daily cap reached (not counted). */
  async tryConsumeAsk(userId: string): Promise<{ ok: boolean; used: number; limit: number }> {
    const limit = config.askDailyLimit
    const day = today()
    const L = await sys()
    const row = (await L.first('SELECT asks FROM usage_daily WHERE user_id=? AND day=?', [userId, day])) as any
    const used = Number(row?.asks ?? 0)
    if (limit > 0 && used >= limit) return { ok: false, used, limit }
    await L.run(
      `INSERT INTO usage_daily (user_id, day, asks) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET asks = asks + 1`,
      [userId, day]
    )
    return { ok: true, used: used + 1, limit }
  }
}
