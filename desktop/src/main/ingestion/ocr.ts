//
// ocr.ts (desktop) — LOCAL OCR via Tesseract (tesseract.js, WASM). Fully
// on-device: the English model (~11 MB) downloads once and is cached in the
// app's data directory; after that OCR works offline. Returns null → the
// caller records the image honestly as needs_ocr. Nothing fabricated.
//

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { log } from '../core/logger'

const OCR_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'])

let workerPromise: Promise<any> | null = null

async function cacheDir(): Promise<string> {
  try {
    const { app } = await import('electron')
    return join(app.getPath('userData'), 'tessdata')
  } catch {
    return join(tmpdir(), 'rch-tessdata') // plain-node test rigs
  }
}

async function getWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      const cachePath = await cacheDir()
      log.ingestion(`OCR: starting tesseract worker (models cached at ${cachePath})`)
      return createWorker('eng', 1, { cachePath })
    })()
  }
  return workerPromise
}

export async function tryOcr(path: string, ext: string): Promise<string | null> {
  if (!OCR_EXT.has(ext)) return null
  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(path)
    const text = String(data?.text ?? '').trim()
    // Tesseract emits noise on blank images; require a minimum of real words.
    const words = text.match(/[A-Za-z]{2,}/g) ?? []
    return words.length >= 2 ? text : null
  } catch (err) {
    log.ingestion.warn(`OCR failed for ${path}: ${String(err)}`)
    return null
  }
}
