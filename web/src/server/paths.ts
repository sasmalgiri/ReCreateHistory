//
// paths.ts — where the hosted server keeps per-user data. Each user gets an
// isolated directory containing their own SQLite ledger + uploads. This is the
// per-user data separation the multi-user SaaS requires.
//

import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { config } from './config'

export function dataDir(): string {
  return config.dataDir
}
export function systemDbPath(): string {
  ensure(config.dataDir)
  return join(config.dataDir, 'system.sqlite3')
}
export function userDir(userId: string): string {
  const d = join(config.dataDir, 'users', userId)
  ensure(d)
  return d
}
export function userLedgerPath(userId: string): string {
  return join(userDir(userId), 'ledger.sqlite3')
}
export function userUploadsDir(userId: string): string {
  const d = join(userDir(userId), 'uploads')
  ensure(d)
  return d
}
export function userMetaPath(userId: string): string {
  return join(userDir(userId), 'meta.json')
}

function ensure(dir: string): void {
  mkdirSync(dir, { recursive: true })
}
