//
// LiveScreen — live observability. Mirrors UI/LiveDashboardView.swift. Polls
// the ledger + services every ~2s and shows the ingest pipeline strip.
//

import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { km } from '../lib/km'
import { PageHeader, Card, StatTile, Badge, Scroll } from '../components/ui'
import type { LiveSample } from '../../../shared/ipc'
import { fmtNum } from '../lib/format'

export default function LiveScreen(): JSX.Element {
  const [sample, setSample] = useState<LiveSample | null>(null)
  const [history, setHistory] = useState<number[]>([])

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      const s = await km.live.sample().catch(() => null)
      if (!alive || !s) return
      setSample(s)
      setHistory((h) => [...h.slice(-40), s.objects])
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<Activity className="h-5 w-5" />} title="Live"
        subtitle="Real-time ledger + ingest pipeline observability." />
      <Scroll>
        {!sample ? <div className="text-sm text-ink-500">Waiting for first sample…</div> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile label="Objects" value={fmtNum(sample.objects)} tone="accent" />
              <StatTile label="Chunks" value={fmtNum(sample.chunks)} />
              <StatTile label="Entities" value={fmtNum(sample.entities)} />
              <StatTile label="Events" value={fmtNum(sample.events)} />
              <StatTile label="Vectors" value={fmtNum(sample.vectors)} />
            </div>

            <Card title="Ingest pipeline">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {Object.entries(sample.pipeline).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <div className="rounded-md border border-ink-800 bg-ink-900/60 px-3 py-1.5">
                      <div className="uppercase tracking-wide text-ink-600">{k}</div>
                      <div className="text-base font-semibold tabular-nums text-ink-100">{fmtNum(v)}</div>
                    </div>
                    <span className="text-ink-700">→</span>
                  </div>
                ))}
                <Badge tone={sample.ingestActive > 0 ? 'medium' : 'high'}>{sample.ingestActive > 0 ? `${sample.ingestActive} active` : 'idle'}</Badge>
              </div>
              <Sparkline data={history} />
            </Card>

            <Card title="Services">
              <div className="space-y-1">
                {sample.services.map((s) => (
                  <div key={s.name} className="flex items-center justify-between rounded-md bg-ink-900/50 px-3 py-1.5 text-sm">
                    <span className="text-ink-200">{s.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-500">{s.detail}</span>
                      <Badge tone={s.healthy ? 'high' : 'low'}>{s.healthy ? 'healthy' : 'down'}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </Scroll>
    </div>
  )
}

function Sparkline({ data }: { data: number[] }): JSX.Element | null {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data)
  const w = 240, h = 40
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / (max - min || 1)) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg className="mt-3" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke="#c98a3a" strokeWidth={1.5} />
    </svg>
  )
}
