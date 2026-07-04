//
// format.ts — display helpers. Timestamps are epoch ms.
//

export function fmtDate(ms?: number | null): string {
  if (ms == null) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().slice(0, 10)
}

export function fmtDateTime(ms?: number | null): string {
  if (ms == null) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`
}

export function fmtRelative(ms?: number | null): string {
  if (ms == null) return '—'
  const diff = Date.now() - ms
  const days = Math.round(diff / 86_400_000)
  if (Math.abs(days) < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.round(days / 30)}mo ago`
  return `${Math.round(days / 365)}y ago`
}

export function fmtBytes(n?: number | null): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

export function fmtNum(n?: number | null): string {
  if (n == null) return '0'
  return n.toLocaleString('en-US')
}

export function fmtPct(v?: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

export function confidenceLabel(v: number): { label: string; tone: 'high' | 'medium' | 'low' } {
  if (v >= 0.75) return { label: 'High', tone: 'high' }
  if (v >= 0.45) return { label: 'Medium', tone: 'medium' }
  return { label: 'Low', tone: 'low' }
}

export function titleCase(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim()
}
