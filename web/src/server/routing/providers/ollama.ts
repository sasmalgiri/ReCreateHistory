//
// ollama.ts — real HTTP client for a local Ollama server (default
// http://localhost:11434). Ported from OllamaProvider.swift. This is the
// local, private, offline AI engine — the Windows equivalent of the Mac
// app's on-device MLX/FoundationModels path.
//

import type { ModelProvider } from '../provider'
import { ProviderError } from '../provider'
import type { ModelCapability, ModelManifest, GenerationOptions } from '../../../shared/ai'
import { log } from '../../core/logger'

export interface OllamaConfig {
  baseURL: string
  modelTag: string
  embeddingModelTag: string | null
}

export class OllamaProvider implements ModelProvider {
  readonly id = 'provider.local.ollama'
  readonly capabilities: Set<ModelCapability>
  readonly manifest: ModelManifest
  private baseURL: string
  private modelTag: string
  private embeddingModelTag: string | null

  constructor(cfg: OllamaConfig) {
    this.baseURL = cfg.baseURL.replace(/\/$/, '')
    this.modelTag = cfg.modelTag
    this.embeddingModelTag = cfg.embeddingModelTag
    const caps: ModelCapability[] = [
      'textGeneration', 'reasoning', 'summarization', 'extraction',
      'classification', 'longContext', 'structuredOutput', 'reranking', 'routing'
    ]
    if (this.embeddingModelTag) caps.push('embedding')
    this.capabilities = new Set(caps)
    this.manifest = {
      id: this.id, displayName: `Ollama (${this.modelTag})`, capabilities: caps,
      minRAMBytes: 0, diskBytes: 0, contextWindow: 32768,
      privacyLevel: 'localNetwork', requiresDownload: false, tier: 'medium'
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1500)
      const res = await fetch(`${this.baseURL}/api/tags`, { signal: ctrl.signal })
      clearTimeout(t)
      return res.ok
    } catch {
      return false
    }
  }

  async listModels(): Promise<{ name: string; sizeBytes: number; family?: string }[]> {
    try {
      const res = await fetch(`${this.baseURL}/api/tags`)
      if (!res.ok) return []
      const data = (await res.json()) as any
      return (data.models ?? []).map((m: any) => ({
        name: m.name, sizeBytes: Number(m.size ?? 0), family: m.details?.family
      }))
    } catch {
      return []
    }
  }

  async generate(prompt: string, options: GenerationOptions): Promise<string> {
    if (!this.modelTag) throw new ProviderError('generationFailed', 'No Ollama model tag configured.')
    const body: any = {
      model: this.modelTag, prompt, stream: false,
      options: { temperature: options.temperature, top_p: options.topP, num_predict: options.maxTokens }
    }
    if (options.stopSequences.length) body.options.stop = options.stopSequences
    if (options.systemPrompt) body.system = options.systemPrompt
    const res = await fetch(`${this.baseURL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    if (!res.ok) {
      throw new ProviderError('generationFailed', `Ollama HTTP ${res.status}: ${await res.text()}`)
    }
    const data = (await res.json()) as any
    const text = (data.response as string) ?? ''
    if (!text) throw new ProviderError('generationFailed', 'Ollama returned empty response.')
    return text
  }

  async *generateStream(prompt: string, options: GenerationOptions): AsyncGenerator<string> {
    const body: any = {
      model: this.modelTag, prompt, stream: true,
      options: { temperature: options.temperature, top_p: options.topP, num_predict: options.maxTokens }
    }
    if (options.stopSequences.length) body.options.stop = options.stopSequences
    if (options.systemPrompt) body.system = options.systemPrompt
    const res = await fetch(`${this.baseURL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    if (!res.ok || !res.body) {
      throw new ProviderError('generationFailed', `Ollama HTTP ${res.status}`)
    }
    // Ollama streams NDJSON: one JSON object per line with a "response" delta.
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try {
          const obj = JSON.parse(line)
          if (obj.response) yield obj.response as string
          if (obj.done) return
        } catch {
          /* skip malformed line */
        }
      }
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.embeddingModelTag) throw new ProviderError('capabilityMissing', 'No embedding model configured.')
    const res = await fetch(`${this.baseURL}/api/embeddings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModelTag, prompt: text })
    })
    if (!res.ok) throw new ProviderError('generationFailed', `Ollama embeddings HTTP ${res.status}`)
    const data = (await res.json()) as any
    if (Array.isArray(data.embedding)) return data.embedding as number[]
    throw new ProviderError('generationFailed', "Ollama embeddings: missing 'embedding' field.")
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.embeddingModelTag) throw new ProviderError('capabilityMissing', 'No embedding model configured.')
    if (!texts.length) return []
    log.ingestion(`OllamaProvider.embedBatch: ${texts.length} texts`)
    try {
      const res = await fetch(`${this.baseURL}/api/embed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.embeddingModelTag, input: texts })
      })
      if (res.ok) {
        const data = (await res.json()) as any
        if (Array.isArray(data.embeddings)) return data.embeddings as number[][]
      }
    } catch {
      /* fall through to per-item */
    }
    const out: number[][] = []
    for (const t of texts) out.push(await this.embed(t))
    return out
  }
}
