//
// capabilityRegistry.ts — the ONLY entry point for obtaining a model. Ported
// from CapabilityRegistry.swift. Callers hand it a CapabilitySpec; it returns
// the best privacy-eligible, available provider whose capabilities cover the
// spec's `requires`. Model names live only here and in the providers.
//

import type { ModelProvider } from './provider'
import { ProviderError } from './provider'
import { PrivacyGate } from './privacyGate'
import type {
  CapabilitySpec, GenerationOptions, ModelCapability, PrivacyLevel, ProviderStatus
} from '../../shared/ai'
import { defaultGenerationOptions } from '../../shared/ai'
import { log } from '../core/logger'

const PRIVACY_RANK: Record<PrivacyLevel, number> = { onDevice: 0, localNetwork: 1, cloud: 2 }

export class CapabilityRegistry {
  private providers: ModelProvider[] = []
  private availabilityCache = new Map<string, { at: number; value: boolean }>()

  constructor(public gate: PrivacyGate) {}

  register(p: ModelProvider): void {
    this.providers.push(p)
    log.routing(`registered provider ${p.id} [${[...p.capabilities].join(',')}]`)
  }

  clear(): void {
    this.providers = []
    this.availabilityCache.clear()
  }

  private async available(p: ModelProvider): Promise<boolean> {
    const cached = this.availabilityCache.get(p.id)
    const now = Date.now()
    if (cached && now - cached.at < 10_000) return cached.value
    let value = false
    try {
      value = await p.isAvailable()
    } catch {
      value = false
    }
    this.availabilityCache.set(p.id, { at: now, value })
    return value
  }

  private covers(p: ModelProvider, requires: ModelCapability[]): boolean {
    return requires.every((c) => p.capabilities.has(c))
  }

  /** Resolve a spec to a concrete provider, or null if nothing eligible. */
  async resolve(spec: CapabilitySpec): Promise<ModelProvider | null> {
    const eligible: ModelProvider[] = []
    for (const p of this.providers) {
      if (!this.covers(p, spec.requires)) continue
      if (!this.gate.isEligible(p.manifest.privacyLevel, spec.privacy)) continue
      if (!(await this.available(p))) continue
      eligible.push(p)
    }
    if (!eligible.length) return null
    eligible.sort((a, b) => {
      // Prefer more private (lower rank), then more prefers matches, then larger tier.
      const pr = PRIVACY_RANK[a.manifest.privacyLevel] - PRIVACY_RANK[b.manifest.privacyLevel]
      if (pr !== 0) return pr
      const am = spec.prefers.filter((c) => a.capabilities.has(c)).length
      const bm = spec.prefers.filter((c) => b.capabilities.has(c)).length
      return bm - am
    })
    return eligible[0]
  }

  /** Convenience: resolve + generate. Throws noProvider if nothing resolves. */
  async generate(spec: CapabilitySpec, prompt: string, options?: Partial<GenerationOptions>): Promise<string> {
    const p = await this.resolve(spec)
    if (!p) throw new ProviderError('noProvider', `No provider for spec: ${spec.purpose}`)
    return p.generate(prompt, { ...defaultGenerationOptions, ...options })
  }

  /** Resolve + generate, returning null instead of throwing (heuristic fallback). */
  async tryGenerate(spec: CapabilitySpec, prompt: string, options?: Partial<GenerationOptions>): Promise<string | null> {
    try {
      const p = await this.resolve(spec)
      if (!p) return null
      return await p.generate(prompt, { ...defaultGenerationOptions, ...options })
    } catch (err) {
      log.routing.warn(`tryGenerate failed for "${spec.purpose}": ${String(err)}`)
      return null
    }
  }

  async embed(text: string): Promise<number[] | null> {
    const p = await this.resolve({
      requires: ['embedding'], prefers: [], maxLatency: 'interactive',
      privacy: 'localNetwork', estimatedContextTokens: 512, purpose: 'embed'
    })
    if (!p) return null
    try {
      return await p.embed(text)
    } catch {
      return null
    }
  }

  async embedBatch(texts: string[]): Promise<number[][] | null> {
    const p = await this.resolve({
      requires: ['embedding'], prefers: [], maxLatency: 'background',
      privacy: 'localNetwork', estimatedContextTokens: 512, purpose: 'embedBatch'
    })
    if (!p) return null
    try {
      return await p.embedBatch(texts)
    } catch {
      return null
    }
  }

  hasEmbedding(): Promise<boolean> {
    return this.resolve({
      requires: ['embedding'], prefers: [], maxLatency: 'background',
      privacy: 'localNetwork', estimatedContextTokens: 1, purpose: 'probe'
    }).then((p) => !!p)
  }

  async statuses(): Promise<ProviderStatus[]> {
    const out: ProviderStatus[] = []
    for (const p of this.providers) {
      const available = await this.available(p)
      out.push({
        id: p.id, displayName: p.manifest.displayName, privacyLevel: p.manifest.privacyLevel,
        capabilities: p.manifest.capabilities, available,
        detail: available ? 'ready' : (p.manifest.privacyLevel === 'cloud' && !this.gate.allowCloud ? 'blocked by privacy gate' : 'unreachable')
      })
    }
    return out
  }
}
