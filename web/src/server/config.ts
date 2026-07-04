//
// config.ts — server configuration from environment. The hosted SaaS uses a
// shared server-side cloud key (users don't bring their own) and optionally a
// reachable Ollama; the CapabilityRegistry routes local-first, cloud fallback.
//

import { randomBytes } from 'node:crypto'

const env = process.env

function pickCloud(): { provider: 'anthropic' | 'openai' | 'none'; model: string; key: string } {
  const explicit = env.CLOUD_PROVIDER as 'anthropic' | 'openai' | undefined
  if (explicit === 'anthropic' || (!explicit && env.ANTHROPIC_API_KEY)) {
    return { provider: 'anthropic', model: env.CLOUD_MODEL || 'claude-sonnet-5', key: env.ANTHROPIC_API_KEY || '' }
  }
  if (explicit === 'openai' || (!explicit && env.OPENAI_API_KEY)) {
    return { provider: 'openai', model: env.CLOUD_MODEL || 'gpt-4o-mini', key: env.OPENAI_API_KEY || '' }
  }
  return { provider: 'none', model: '', key: '' }
}

const cloud = pickCloud()

export const config = {
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT || 8787),
  dataDir: env.DATA_DIR || 'data',
  jwtSecret: env.JWT_SECRET || (env.NODE_ENV === 'production' ? '' : randomBytes(32).toString('hex')),
  cookieName: 'km_session',
  // AI engine — "both": Ollama if reachable, else cloud.
  ollama: {
    baseURL: env.OLLAMA_URL || 'http://localhost:11434',
    model: env.OLLAMA_MODEL || 'qwen2.5:7b',
    embed: env.OLLAMA_EMBED || 'nomic-embed-text'
  },
  cloud,
  // Hosted SaaS is cloud-by-nature; the privacy gate is open so the cloud
  // fallback can resolve. (Individual answers still prefer local Ollama.)
  allowCloud: true,
  maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024)
}

if (config.isProd && !config.jwtSecret) {
  // eslint-disable-next-line no-console
  console.error('FATAL: JWT_SECRET must be set in production.')
  process.exit(1)
}
