//
// database.ts — the ledger over libSQL (@libsql/client). One async client per
// ledger; works identically against a local file (self-host / dev / tests:
// `file:...db`) and Turso hosted SQLite (`libsql://...` + auth token), which
// is what makes the app deployable on serverless (Vercel) with per-user
// databases. Only repositories touch this.
//
// Migration tracking uses a `_migrations` table instead of PRAGMA
// user_version (not all PRAGMAs are supported over Turso's HTTP protocol).
// Legacy better-sqlite3 ledgers are adopted by reading their user_version
// once and seeding _migrations from it.
//

import { createClient, type Client, type InValue } from '@libsql/client'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from './migrations'
import { log } from '../core/logger'

export interface LedgerOpts {
  /** `file:C:/.../ledger.db` or `libsql://name-org.turso.io` */
  url: string
  authToken?: string
}

export class Ledger {
  readonly client: Client
  readonly path: string
  private version = 0

  constructor(opts: LedgerOpts) {
    this.path = opts.url
    if (opts.url.startsWith('file:')) {
      const dir = dirname(opts.url.slice(5))
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    }
    this.client = createClient({ url: opts.url, authToken: opts.authToken })
  }

  /** Rows helper. */
  async all<T = any>(sql: string, args: InValue[] = []): Promise<T[]> {
    const rs = await this.client.execute({ sql, args })
    return rs.rows as unknown as T[]
  }

  /** First row or null. */
  async first<T = any>(sql: string, args: InValue[] = []): Promise<T | null> {
    const rs = await this.client.execute({ sql, args })
    return (rs.rows[0] as unknown as T) ?? null
  }

  /** Write statement. */
  async run(sql: string, args: InValue[] = []): Promise<void> {
    await this.client.execute({ sql, args })
  }

  /** Many writes atomically (implicit transaction). */
  async batch(stmts: { sql: string; args: InValue[] }[]): Promise<void> {
    if (!stmts.length) return
    await this.client.batch(stmts, 'write')
  }

  /** Multi-statement DDL (handles triggers with BEGIN…END correctly). */
  async exec(sql: string): Promise<void> {
    await this.client.executeMultiple(sql)
  }

  async currentVersion(): Promise<number> {
    await this.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY NOT NULL)')
    let v = Number((await this.first<{ v: number }>('SELECT MAX(version) v FROM _migrations'))?.v ?? 0)
    if (v === 0) {
      // Adopt a legacy better-sqlite3 ledger that tracked PRAGMA user_version.
      try {
        const r = await this.first<{ user_version: number }>('PRAGMA user_version')
        const legacy = Number(r?.user_version ?? 0)
        if (legacy > 0) {
          await this.batch(Array.from({ length: legacy }, (_, i) => ({
            sql: 'INSERT OR IGNORE INTO _migrations (version) VALUES (?)', args: [i + 1] as InValue[]
          })))
          v = legacy
        }
      } catch { /* PRAGMA unsupported (hosted) — fresh DB path is fine */ }
    }
    return v
  }

  /** Apply every migration newer than the recorded version. */
  async migrate(): Promise<void> {
    const current = await this.currentVersion()
    for (const [version, sql] of MIGRATIONS) {
      if (version <= current) continue
      try {
        await this.exec(sql)
        await this.run('INSERT INTO _migrations (version) VALUES (?)', [version])
        log.storage(`migrated schema → v${version}`)
      } catch (err) {
        throw new Error(`Migration v${version} failed: ${String(err)}`)
      }
    }
    this.version = Math.max(current, LATEST_SCHEMA_VERSION)
  }

  get schemaVersion(): number {
    return this.version
  }

  close(): void {
    this.client.close()
  }
}
