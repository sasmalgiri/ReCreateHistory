//
// mediaAI.ts (web) — image OCR + audio/video transcription via the configured
// AI provider. Selective AI in the spec's "specialized model" slot: one call
// per media file, only when a provider is configured; null → the caller
// records the file honestly as unsupported/needs_ocr. Nothing is fabricated.
//
// On Gemini (the free default) we call the NATIVE generateContent endpoint,
// which understands images, audio, AND video inline. On plain OpenAI-style
// providers we fall back to chat/completions image_url for images only.
//

import { readFile } from 'node:fs/promises'
import { config } from '../config'
import { log } from '../core/logger'

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', heic: 'image/heic'
}
const MEDIA_MIME: Record<string, string> = {
  mp3: 'audio/mp3', wav: 'audio/wav', m4a: 'audio/aac', aac: 'audio/aac',
  mp4: 'video/mp4', mov: 'video/mov'
}
const MAX_BYTES = 4.2 * 1024 * 1024 // Vercel body limit governs uploads anyway

function ready(): boolean {
  return config.cloud.provider === 'openai' && !!config.cloud.key
}

function isGemini(): boolean {
  return config.cloud.baseURL.includes('generativelanguage.googleapis.com')
}

/** Native Gemini generateContent with inline media. */
async function geminiInline(mime: string, data: Buffer, prompt: string): Promise<string | null> {
  const base = config.cloud.baseURL.replace(/\/openai\/?$/, '')
  const res = await fetch(`${base}/models/${config.cloud.model}:generateContent?key=${config.cloud.key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: data.toString('base64') } }
      ] }],
      generationConfig: { maxOutputTokens: 8000, temperature: 0 }
    })
  })
  if (!res.ok) {
    log.ingestion.warn(`media AI failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 160))}`)
    return null
  }
  const j: any = await res.json()
  const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('').trim()
  return text || null
}

/** OpenAI-compatible vision fallback (images only). */
async function compatImage(mime: string, data: Buffer, prompt: string): Promise<string | null> {
  const res = await fetch(`${config.cloud.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.cloud.key}` },
    body: JSON.stringify({
      model: config.cloud.model, max_tokens: 8000,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${data.toString('base64')}` } }
      ] }]
    })
  })
  if (!res.ok) return null
  const j: any = await res.json()
  return j.choices?.[0]?.message?.content?.trim() || null
}

/** OCR an image. Returns extracted text, 'NO_TEXT' handling done by caller via null. */
export async function tryOcr(path: string, ext: string): Promise<string | null> {
  const mime = IMAGE_MIME[ext]
  if (!mime || !ready()) return null
  try {
    const buf = await readFile(path)
    if (buf.length > MAX_BYTES) return null
    const prompt = 'Extract ALL text from this image verbatim (OCR). Preserve reading order and line breaks. Output ONLY the extracted text. If the image contains no readable text, output exactly: NO_TEXT'
    const text = isGemini() ? await geminiInline(mime, buf, prompt) : await compatImage(mime, buf, prompt)
    if (!text || /^NO_TEXT\b/.test(text)) return null
    return text.length > 3 ? text : null
  } catch (err) {
    log.ingestion.warn(`OCR failed: ${String(err)}`)
    return null
  }
}

/** Transcribe audio or video. */
export async function tryTranscribe(path: string, format: string): Promise<string | null> {
  const mime = MEDIA_MIME[format]
  if (!mime || !ready() || !isGemini()) return null // A/V inline needs Gemini
  try {
    const buf = await readFile(path)
    if (buf.length > MAX_BYTES) return null
    const text = await geminiInline(mime, buf,
      'Transcribe the speech in this file verbatim. Output ONLY the transcript text — no preamble, no timestamps, no speaker labels, no commentary. If there is no speech, output exactly: NO_SPEECH')
    if (!text || /^NO_SPEECH\b/.test(text)) return null
    return text.length > 10 ? text : null
  } catch (err) {
    log.ingestion.warn(`ASR failed: ${String(err)}`)
    return null
  }
}
