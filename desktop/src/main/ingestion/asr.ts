//
// asr.ts (desktop) — LOCAL speech-to-text via Whisper (whisper-tiny.en over
// transformers.js/ONNX). Fully on-device: the model (~40 MB) downloads once
// into the app's data directory, then transcription works offline. MP3/WAV.
// Returns null → the caller records the file honestly as unsupported.
//

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { log } from '../core/logger'

let asrPromise: Promise<any> | null = null

async function cacheDir(): Promise<string> {
  try {
    const { app } = await import('electron')
    return join(app.getPath('userData'), 'models')
  } catch {
    return join(tmpdir(), 'rch-models') // plain-node test rigs
  }
}

async function getAsr(): Promise<any> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const t: any = await import('@huggingface/transformers')
      t.env.cacheDir = await cacheDir()
      log.ingestion(`ASR: loading whisper-tiny.en (cached at ${t.env.cacheDir}; first run downloads ~40 MB)`)
      return t.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en')
    })()
  }
  return asrPromise
}

/** Whisper expects 16 kHz mono Float32; cheap nearest-sample resample.
 *  audio-decode v3 returns { channelData: Float32Array[], sampleRate }. */
function toMono16k(audio: any): Float32Array {
  const ch: Float32Array = audio.channelData ? audio.channelData[0] : audio.getChannelData(0)
  const from = Number(audio.sampleRate)
  if (from === 16000) return ch
  const ratio = from / 16000
  const out = new Float32Array(Math.floor(ch.length / ratio))
  for (let i = 0; i < out.length; i++) out[i] = ch[Math.floor(i * ratio)]
  return out
}

export async function tryTranscribe(path: string, format: string): Promise<string | null> {
  if (!['mp3', 'wav'].includes(format)) return null
  try {
    const decodeMod: any = await import('audio-decode')
    const decode = decodeMod.default ?? decodeMod
    const buf = await readFile(path)
    const audio = await decode(buf)
    const pcm = toMono16k(audio)
    if (pcm.length < 16000) return null // under a second of audio
    const asr = await getAsr()
    const out = await asr(pcm, { chunk_length_s: 30, stride_length_s: 5 })
    const text = String(out?.text ?? '').trim()
    return text.length > 10 ? text : null
  } catch (err) {
    log.ingestion.warn(`whisper ASR failed for ${path}: ${String(err)}`)
    return null
  }
}
