//
// chunker.ts — bounded slices of KnowledgeObject content, the granularity at
// which we embed and cite. Ported from Ingestion/Pipeline/Chunker.swift.
// Splits on paragraph/sentence boundaries, targets ~900 chars with overlap.
//

import type { Chunk, UUID } from '../../shared/models'
import { newID, nowMs } from '../core/ids'

const TARGET = 900
const OVERLAP = 120

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

function makeChunk(objectID: UUID, ordinal: number, text: string, start: number, end: number): Chunk {
  return {
    id: newID(), objectID, ordinal, text,
    characterRange: { lower: Math.max(0, start), upper: Math.max(start, end) },
    pageNumber: null, createdAt: nowMs(), contextPrefix: null, contextPrefixSource: null
  }
}
