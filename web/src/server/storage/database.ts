//
// database.ts — the single ledger behind better-sqlite3. In Swift this is
// an `actor Database` guarding a raw sqlite3 pointer; here better-sqlite3 is
// synchronous, so the "one connection, all access through repositories"
// invariant is enforced by convention: only repositories import this.
//

import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from './migrations'
import { log } from '../core/logger'

export type SqliteDatabase = Database.Database

export class Ledger {
  readonly db: SqliteDatabase
  readonly path: string

  constructor(path: string) {
    this.path = path
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
  }

  userVersion(): number {
    const row = this.db.pragma('user_version', { simple: true })
    return Number(row)
  }

  setUserVersion(v: number): void {
    this.db.pragma(`user_version = ${v}`)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  /**
   * Apply every migration newer than the current user_version. Each migration
   * runs inside a SAVEPOINT so a partial DDL failure leaves the schema at the
   * previous version instead of half-applied — mirrors SchemaMigrations.swift.
   */
  migrate(): void {
    const current = this.userVersion()
    for (const [version, sql] of MIGRATIONS) {
      if (version <= current) continue
      const savepoint = `km_mig_v${version}`
      try {
        this.db.exec(`SAVEPOINT ${savepoint};`)
        this.db.exec(sql)
        this.setUserVersion(version)
        this.db.exec(`RELEASE SAVEPOINT ${savepoint};`)
        log.storage(`migrated schema → v${version}`)
      } catch (err) {
        try {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`)
          this.db.exec(`RELEASE SAVEPOINT ${savepoint};`)
        } catch {
          /* ignore rollback failure */
        }
        throw new Error(`Migration v${version} failed: ${String(err)}`)
      }
    }
  }

  get schemaVersion(): number {
    return this.userVersion()
  }

  static get latestVersion(): number {
    return LATEST_SCHEMA_VERSION
  }

  close(): void {
    this.db.close()
  }
}
