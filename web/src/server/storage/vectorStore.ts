//
// vectorStore.ts — int8 symmetric-quantized vectors, one row per chunk.
// Ported from Swift SQLiteVectorStore + the T5 `vectors` table. Brute-force
// cosine at scan time (an HNSW ANN index is the future optimization, exactly
// as the Swift comment notes). Good to tens of thousands of chunks.
//

import type { Ledger } from './database'
import type { UUID } from '../../shared/models'

export function quantize(vec: number[]): { q: Buffer; scale: number; dim: number } {
  let maxAbs = 0
  for (const v of vec) { const a = Math.abs(v); if (a > maxAbs) maxAbs = a }
  const scale = maxAbs > 0 ? maxAbs / 127 : 1
  const q = Buffer.alloc(vec.length)
  for (let i = 0; i < vec.length; i++) {
    let x = Math.round(vec[i] / scale)
    if (x > 127) x = 127
    if (x < -127) x = -127
    q.writeInt8(x, i)
  }
  return { q, scale, dim: vec.length }
}

export function dequantize(q: Buffer, scale: number): Float64Array {
  const out = new Float64Array(q.length)
  for (let i = 0; i < q.length; i++) out[i] = q.readInt8(i) * scale
  return out
}

function cosine(a: Float64Array | number[], b: Float64Array | number[]): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export class VectorStore {
  constructor(private L: Ledger) {}

  async put(chunkID: UUID, vec: number[]): Promise<void> {
    const { q, scale, dim } = quantize(vec)
    await this.L.run(
      `INSERT INTO vectors (chunk_id,dim,q,scale) VALUES (?,?,?,?)
       ON CONFLICT(chunk_id) DO UPDATE SET dim=excluded.dim, q=excluded.q, scale=excluded.scale`,
      [chunkID, dim, q, scale]
    )
  }

  async count(): Promise<number> {
    return Number(((await this.L.first(`SELECT COUNT(*) c FROM vectors`)) as any)?.c ?? 0)
  }

  /** Brute-force cosine nearest-neighbour. Returns chunkIDs + similarity. */
  async nearest(query: number[], k = 20): Promise<{ chunkID: UUID; score: number }[]> {
    const rows = await this.L.all(`SELECT chunk_id, q, scale FROM vectors`) as any[]
    const scored: { chunkID: UUID; score: number }[] = []
    for (const r of rows) {
      const vec = dequantize(Buffer.from(r.q as ArrayBuffer), Number(r.scale))
      scored.push({ chunkID: r.chunk_id, score: cosine(query, vec) })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  }
}
