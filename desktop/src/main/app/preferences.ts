//
// preferences.ts — persisted user preferences + BYO cloud key. Preferences
// live in preferences.json; the API key lives separately in secrets.json (the
// Windows equivalent of the Mac app's Keychain slot). PrivacyGate still gates
// whether a cloud key is ever usable.
//

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { Preferences } from '../../shared/ipc'
import { preferencesPath, secretsPath } from '../core/paths'
import { log } from '../core/logger'

const DEFAULTS: Preferences = {
  privacyAllowCloud: false,
  ollamaBaseURL: 'http://localhost:11434',
  ollamaModelTag: 'qwen2.5:7b',
  ollamaEmbeddingTag: 'nomic-embed-text',
  cloudProvider: 'none',
  cloudModel: 'claude-sonnet-5',
  cloudApiKeySet: false,
  theme: 'dark',
  enableLLMExtraction: true
}

export class PreferencesStore {
  private prefs: Preferences
  private apiKey = ''

  constructor() {
    this.prefs = { ...DEFAULTS }
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(preferencesPath())) {
        const raw = JSON.parse(readFileSync(preferencesPath(), 'utf8'))
        this.prefs = { ...DEFAULTS, ...raw }
      }
      if (existsSync(secretsPath())) {
        const s = JSON.parse(readFileSync(secretsPath(), 'utf8'))
        this.apiKey = s.cloudApiKey ?? ''
      }
      this.prefs.cloudApiKeySet = !!this.apiKey
    } catch (err) {
      log.app.warn(`preferences load failed: ${String(err)}`)
    }
  }

  get(): Preferences {
    return { ...this.prefs, cloudApiKeySet: !!this.apiKey }
  }

  getApiKey(): string {
    return this.apiKey
  }

  set(patch: Partial<Preferences>): Preferences {
    this.prefs = { ...this.prefs, ...patch }
    try {
      writeFileSync(preferencesPath(), JSON.stringify(this.prefs, null, 2), 'utf8')
    } catch (err) {
      log.app.error('preferences save failed', err)
    }
    return this.get()
  }

  setApiKey(key: string): void {
    this.apiKey = key
    try {
      writeFileSync(secretsPath(), JSON.stringify({ cloudApiKey: key }, null, 2), 'utf8')
    } catch (err) {
      log.app.error('secret save failed', err)
    }
    this.prefs.cloudApiKeySet = !!key
  }
}
