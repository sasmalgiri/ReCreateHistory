//
// asr.ts — audio transcription via the configured OpenAI-compatible provider
// (Gemini's free tier understands inline audio). Selective AI: one call per
// audio file, only when a provider is configured. Returns null → the caller
// records the file honestly as unsupported. ~4 MB cap (upload + inline limits).
//

import { readFile } from 'node:fs/promises'
import { config } from '../config'
import { log } from '../core/logger'

export async function tryTranscribe(path: string, format: string): Promise<string | null> {
  if (config.cloud.provider !== 'openai' || !config.cloud.key) return null
  if (!['mp3', 'wav'].includes(format)) return null
  try {
    const buf = await readFile(path)
    if (buf.length > 4.2 * 1024 * 1024) return null
    const res = await fetch(`${config.cloud.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.cloud.key}` },
      body: JSON.stringify({
        model: config.cloud.model,
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe this audio verbatim. Output ONLY the transcript text — no preamble, no timestamps, no commentary.' },
            { type: 'input_audio', input_audio: { data: buf.toString('base64'), format } }
          ]
        }]
      })
    })
    if (!res.ok) {
      log.ingestion.warn(`ASR failed: HTTP ${res.status}`)
      return null
    }
    const j: any = await res.json()
    const text = j.choices?.[0]?.message?.content?.trim()
    return text && text.length > 10 ? text : null
  } catch (err) {
    log.ingestion.warn(`ASR failed: ${String(err)}`)
    return null
  }
}
