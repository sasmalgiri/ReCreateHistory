//
// chunker.ts — bounded slices of KnowledgeObject content, the granularity at
// which we embed and cite. Two modes:
//   chunkBlocks — structure-aware (preferred): chunks NEVER split an evidence
//     block; small adjacent text blocks merge; every table row is its own
//     chunk (individually FTS-findable and citable); headings ride with their
//     body. This follows the "chunk by structure, not by token count" rule.
//   chunk — legacy character-window fallback for callers without blocks.
//

import type { Chunk, UUID } from '../../shared/models'
import { newID, nowMs } from '../core/ids'
import type { RawBlock } from './loaders'

const TARGET = 900
const OVERLAP = 120

/** Structure-aware chunking over parsed evidence blocks. */
export function chunkBlocks(objectID: UUID, blocks: RawBlock[]): Chunk[] {
  const chunks: Chunk[] = []
  let ordinal = 0
  let buf: string[] = []
  let bufLen = 0
  let bufStart: number | null = null
  let bufEnd = 0
  let bufPage: number | null = null

  const flush = (): void => {
    const text = buf.join('\n\n').trim()
    if (text) {
      chunks.push(makeChunk(objectID, ordinal++, text, bufStart ?? 0, bufEnd || text.length, bufPage))
    }
    buf = []; bufLen = 0; bufStart = null; bufEnd = 0; bufPage = null
  }

  for (const b of blocks) {
    const text = (b.text ?? '').trim()
    if (!text) continue

    // Table rows and email headers are atomic, individually citable chunks.
    if (b.blockType === 'table_row' || b.blockType === 'email_message') {
      flush()
      chunks.push(makeChunk(objectID, ordinal++, text, b.charStart ?? 0, b.charEnd ?? text.length, b.page ?? null))
      continue
    }

    // A block that alone exceeds the window still stays whole (never split a
    // block) — it just becomes its own chunk.
    if (bufLen + text.length > TARGET && bufLen > 0) flush()
    if (buf.length === 0) { bufStart = b.charStart ?? null; bufPage = b.page ?? null }
    buf.push(text)
    bufLen += text.length + 2
    bufEnd = b.charEnd ?? bufEnd + text.length
    // Headings start a new logical section — but stay glued to their body,
    // so we only flush BEFORE a heading (handled above via size) not after.
  }
  flush()
  return chunks
}

export function chunk(objectID: UUID, content: string): Chunk[] {
  const chunks: Chunk[] = []
  if (!content.trim()) return chunks

  // Split into paragraphs first, then pack into windows.
  const paras = content.split(/\n{2,}/)
  let buf = ''
  let bufStart = 0
  let cursor = 0
  let ordinal = 0

  const flush = (endPos: number): void => {
    const text = buf.trim()
    if (text.length === 0) return
    chunks.push(makeChunk(objectID, ordinal++, text, bufStart, endPos))
    // start next buffer with a tail overlap
    const tail = buf.slice(Math.max(0, buf.length - OVERLAP))
    buf = tail
    bufStart = endPos - tail.length
  }

  for (const para of paras) {
    const block = para + '\n\n'
    if (buf.length + block.length > TARGET && buf.trim().length > 0) {
      flush(cursor)
    }
    // If a single paragraph is huge, hard-split it by sentence.
    if (block.length > TARGET * 1.6) {
      const sentences = block.split(/(?<=[.!?])\s+/)
      for (const s of sentences) {
        if (buf.length + s.length > TARGET && buf.trim().length > 0) flush(cursor)
        buf += s + ' '
        cursor += s.length + 1
      }
    } else {
      buf += block
      cursor += block.length
    }
  }
  flush(cursor)
  return chunks
}

function makeChunk(objectID: UUID, ordinal: number, text: string, start: number, end: number, page: number | null = null): Chunk {
  return {
    id: newID(), objectID, ordinal, text,
    characterRange: { lower: Math.max(0, start), upper: Math.max(start, end) },
    pageNumber: page, createdAt: nowMs(), contextPrefix: null, contextPrefixSource: null
  }
}
