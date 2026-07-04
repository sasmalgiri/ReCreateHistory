//
// userManager.ts — one UserApp per active user, cached in memory and lazily
// created on first request. Idle users are closed to bound memory + open DB
// handles. Each UserApp opens that user's isolated SQLite ledger.
//

import { UserApp } from './userApp'
import { log } from './core/logger'

const MAX_ACTIVE = 250
const IDLE_MS = 30 * 60 * 1000

class UserManager {
  private apps = new Map<string, UserApp>()

  constructor() {
    // Periodic sweep of idle users (skipped in one-shot smoke runs).
    setInterval(() => this.sweep(), 5 * 60 * 1000).unref?.()
  }

  get(userId: string): UserApp {
    let app = this.apps.get(userId)
    if (!app) {
      app = new UserApp(userId)
      this.apps.set(userId, app)
      if (this.apps.size > MAX_ACTIVE) this.evictOldest()
    }
    app.touch()
    return app
  }

  private sweep(): void {
    const now = Date.now()
    for (const [id, app] of this.apps) {
      if (now - app.lastUsed > IDLE_MS) {
        try { app.close() } catch { /* ignore */ }
        this.apps.delete(id)
        log.app(`evicted idle user ${id.slice(0, 8)}`)
      }
    }
  }

  private evictOldest(): void {
    let oldestId: string | null = null
    let oldest = Infinity
    for (const [id, app] of this.apps) {
      if (app.lastUsed < oldest) { oldest = app.lastUsed; oldestId = id }
    }
    if (oldestId) {
      try { this.apps.get(oldestId)?.close() } catch { /* ignore */ }
      this.apps.delete(oldestId)
    }
  }

  closeAll(): void {
    for (const app of this.apps.values()) { try { app.close() } catch { /* ignore */ } }
    this.apps.clear()
  }
}

export const userManager = new UserManager()
