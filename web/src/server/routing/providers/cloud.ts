//
// cloud.ts — optional BYO-key cloud provider (Anthropic or OpenAI). Ported
// from CloudProvider.swift. NEVER eligible unless the PrivacyGate allows
// cloud routing AND a key is set. This is the "optional Cloud" half of the
// user's chosen Ollama-default-plus-cloud capability routing.
//

import type { ModelProvider } from '../provider'
import { ProviderError } from '../provider'
import type { ModelCapability, ModelManifest, GenerationOptions } from '../../../shared/ai'

export interface CloudConfig {
  provider: 'anthropic' | 'openai'
  model: string
  apiKey: string
  /** OpenAI-compatible base URL (Gemini/Groq/OpenRouter work here too). */
  baseURL?: string
  embedModel?: string
}

export class CloudProvider implements ModelProvider {
  readonly id: string
  readonly capabilities: Set<ModelCapability>
  readonly manifest: ModelManifest
  private cfg: CloudConfig

  constructor(cfg: CloudConfig) {
    this.cfg = cfg
    this.id = `provider.cloud.${cfg.provider}`
    const caps: ModelCapability[] = [
      'textGeneration', 'reasoning', 'summarization', 'extraction',
      'classification', 'longContext', 'structuredOutput', 'reranking', 'routing'
    ]
    if (cfg.provider === 'openai') caps.push('embedding')
    this.capabilities = new Set(caps)
    this.manifest = {
      id: this.id, displayName: `Cloud · ${cfg.provider} (${cfg.model})`, capabilities: caps,
      minRAMBytes: 0, diskBytes: 0, contextWindow: 128000,
      privacyLevel: 'cloud', requiresDownload: false, tier: 'large'
    }
  }

  async isAvailable(): Promise<boolean> {
    return !!this.cfg.apiKey
  }

  async generate(prompt: string, options: GenerationOptions): Promise<string> {
    if (!this.cfg.apiKey) throw new ProviderError('unavailable', 'No cloud API key set.')
    return this.cfg.provider === 'anthropic'
      ? this.anthropic(prompt, options)
      : this.openai(prompt, options)
  }

  private async anthropic(prompt: string, options: GenerationOptions): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        system: options.systemPrompt ?? undefined,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    if (!res.ok) throw new ProviderError('generationFailed', `Anthropic HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as any
    return (data.content?.[0]?.text as string) ?? ''
  }

  private async openai(prompt: string, options: GenerationOptions): Promise<string> {
    const messages: any[] = []
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt })
    messages.push({ role: 'user', content: prompt })
    const res = await fetch(`${this.cfg.baseURL || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model, messages,
        max_tokens: options.maxTokens, temperature: options.temperature
      })
    })
    if (!res.ok) throw new ProviderError('generationFailed', `OpenAI HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as any
    return (data.choices?.[0]?.message?.content as string) ?? ''
  }

  async *generateStream(prompt: string, options: GenerationOptions): AsyncGenerator<string> {
    // Scaffold: single-shot fallback. Real SSE streaming is a follow-on.
    yield await this.generate(prompt, options)
  }

  async embed(text: string): Promise<number[]> {
    if (this.cfg.provider !== 'openai') {
      throw new ProviderError('capabilityMissing', 'Cloud embeddings only via OpenAI.')
    }
    const res = await fetch(`${this.cfg.baseURL || 'https://api.openai.com/v1'}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({ model: this.cfg.embedModel || 'text-embedding-3-small', input: text })
    })
    if (!res.ok) throw new ProviderError('generationFailed', `OpenAI embeddings HTTP ${res.status}`)
    const data = (await res.json()) as any
    return (data.data?.[0]?.embedding as number[]) ?? []
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const out: number[][] = []
    for (const t of texts) out.push(await this.embed(t))
    return out
  }
}
