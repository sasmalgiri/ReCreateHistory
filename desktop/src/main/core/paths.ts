//
// paths.ts — where Kalsmritikosh keeps its data on Windows.
// Mirrors macOS's ~/Library/Application Support/Kalsmritikosh with the
// Electron userData directory (%APPDATA%/kalsmritikosh-win on Windows).
//

import { app } from 'electron'
import { join } from 'node:path'

export function dataDir(): string {
  return app.getPath('userData')
}

export function defaultDatabasePath(): string {
  return join(dataDir(), 'ledger.sqlite3')
}

export function preferencesPath(): string {
  return join(dataDir(), 'preferences.json')
}

export function secretsPath(): string {
  return join(dataDir(), 'secrets.json')
}
