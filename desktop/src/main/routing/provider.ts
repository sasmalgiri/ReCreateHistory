//
// provider.ts — the ModelProvider interface (ported from Core/Services/
// ModelProvider.swift). Every AI call goes through CapabilityRegistry, which
// resolves a CapabilitySpec to one of these. Callers never name a provider.
//

import type {
  ModelCapability, ModelManifest, GenerationOptions, CapabilitySpec
} from '../../shared/ai'

export interface ModelProvider {
  readonly id: string
  readonly capabilities: Set<ModelCapability>
  readonly manifest: ModelManifest
  isAvailable(): Promise<boolean>
  generate(prompt: string, options: GenerationOptions): Promise<string>
  generateStream(prompt: string, options: GenerationOptions): AsyncGenerator<string>
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

export class ProviderError extends Error {
  constructor(
    public code: 'unavailable' | 'capabilityMissing' | 'generationFailed' | 'noProvider',
    message: string
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export function specDescription(spec: CapabilitySpec): string {
  return `requires=[${spec.requires.join(',')}] privacy=${spec.privacy} purpose="${spec.purpose}"`
}
