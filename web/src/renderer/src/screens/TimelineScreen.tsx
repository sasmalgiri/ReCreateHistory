//
// TimelineScreen — the event timeline, the product's core moat. Mirrors
// UI/TimelineView.swift. Filter by date range / entity / kind, then browse a
// vertical timeline grouped by month. Selecting an event opens a detail panel
// with participating entities, the source snippet, and causal links.
//

import { useMemo, useState } from 'react'
import { CalendarClock, X, GitBranch } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import {
  PageHeader, Card, Button, Input, Badge, Spinner, EmptyState, Scroll, ErrorNote, Meter
} from '../components/ui'
import { fmtDate, fmtDateTime, fmtPct, confidenceLabel, titleCase } from '../lib/format'
import type { KEvent, Entity, EventLink, QualityTier, EventKind, UUID, KnowledgeObject } from '../../../shared/models'

const EVENT_KINDS: EventKind[] = [
  'emailSent', 'emailReceived', 'contractSigned', 'contractModified',
  'invoiceIssued', 'invoicePaid', 'meetingHeld', 'taskAssigned',
  'deliveryDelayed', 'deliveryCompleted', 'other'
]

function tierTone(tier: QualityTier): 'high' | 'neutral' | 'low' {
  return tier === 'T1' ? 'high' : tier === 'T3' ? 'low' : 'neutral'
}

function meterTone(v: number): 'high' | 'medium' | 'low' {
  return confidenceLabel(v).tone
}

/** Date input (YYYY-MM-DD) → epoch ms, or null when blank/invalid. */
function toMs(value: string): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

export default function TimelineScreen(): JSX.Element {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState<EventKind | ''>('')
  const [entityQuery, setEntityQuery] = useState('')
  const [entity, setEntity] = useState<Entity | null>(null)
  const [selectedID, setSelectedID] = useState<UUID | null>(null)

  const start = toMs(from)
  const end = toMs(to)
  const entityID = entity?.id ?? null

  const events = useAsync<KEvent[]>(
    () => km.timeline.events({ start, end, entityID, kinds: kind ? [kind] : null, limit: 300 }),
    [start, end, entityID, kind]
  )

  // Entity picker: search the dossier as the user types.
  const matches = useAsync<Entity[]>(
    () => (entityQuery.trim().length >= 2 ? km.dossier.search(entityQuery.trim()) : Promise.resolve([])),
    [entityQuery]
  )

  const rows = events.data ?? []

  // Group by YYYY-MM, newest month first, events within a month newest first.
  const groups = useMemo(() => {
    const byMonth = new Map<string, KEvent[]>()
    for (const e of rows) {
      const key = fmtDate(e.date).slice(0, 7) // YYYY-MM
      const bucket = byMonth.get(key)
      if (bucket) bucket.push(e)
      else byMonth.set(key, [e])
    }
    return Array.from(byMonth.entries())
      .map(([month, list]) => ({ month, list: [...list].sort((a, b) => b.date - a.date) }))
      .sort((a, b) => (a.month < b.month ? 1 : -1))
  }, [rows])

  function resetEntity(): void {
    setEntity(null)
    setEntityQuery('')
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<CalendarClock className="h-5 w-5" />}
        title="Timeline"
        subtitle="Every dated event Atlas has reconstructed, grouped by month with per-event date confidence."
        actions={<Button onClick={events.reload}>Refresh</Button>}
      />

      <Scroll>
        <div className="space-y-4">
          <Card title="Filters">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-xs text-ink-500">
                <span>From</span>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="space-y-1 text-xs text-ink-500">
                <span>To</span>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <label className="space-y-1 text-xs text-ink-500">
                <span>Kind</span>
                <select
                  className="input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as EventKind | '')}
                >
                  <option value="">All kinds</option>
                  {EVENT_KINDS.map((k) => (
                    <option key={k} value={k}>{titleCase(k)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-ink-500">
                <span>Entity</span>
                {entity ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">{entity.value}</Badge>
                    <button className="text-ink-500 hover:text-rose-400" onClick={resetEntity} title="Clear entity">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <Input
                    placeholder="Filter by person, org…"
                    value={entityQuery}
                    onChange={(e) => setEntityQuery(e.target.value)}
                  />
                )}
              </label>
            </div>

            {!entity && entityQuery.trim().length >= 2 && (
              <div className="mt-2 space-y-1">
                {matches.loading ? <Spinner label="Searching…" /> : !matches.data?.length ? (
                  <div className="text-xs text-ink-600">No matching entities.</div>
                ) : (
                  matches.data.slice(0, 8).map((m) => (
                    <button
                      key={m.id}
                      className="flex w-full items-center justify-between rounded-md bg-ink-900/60 px-3 py-1.5 text-left text-xs hover:bg-ink-800"
                      onClick={() => { setEntity(m); setEntityQuery('') }}
                    >
                      <span className="truncate text-ink-200">{m.value}</span>
                      <Badge tone="neutral">{m.kind}</Badge>
                    </button>
                  ))
                )}
              </div>
            )}
          </Card>

          {events.error && <ErrorNote message={events.error} />}

          {events.loading ? (
            <Spinner label="Reconstructing timeline…" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="h-8 w-8" />}
              title="No events in range"
              hint="Ingest a folder and Atlas will reconstruct dated events here, or widen the filters above."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <div className="space-y-5">
                {groups.map((g) => (
                  <div key={g.month}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                      {g.month} · {g.list.length} event{g.list.length === 1 ? '' : 's'}
                    </div>
                    <div className="space-y-1 border-l border-ink-800 pl-3">
                      {g.list.map((e) => (
                        <EventRow
                          key={e.id}
                          event={e}
                          active={e.id === selectedID}
                          onSelect={() => setSelectedID(e.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {selectedID && <DetailPanel eventID={selectedID} onClose={() => setSelectedID(null)} />}
            </div>
          )}
        </div>
      </Scroll>
    </div>
  )
}

function EventRow({ event, active, onSelect }: {
  event: KEvent; active: boolean; onSelect: () => void
}): JSX.Element {
  return (
    <button
      className={`w-full rounded-md px-3 py-2 text-left transition-colors ${active ? 'bg-ink-800' : 'hover:bg-ink-900/60'}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 font-mono text-xs text-ink-500">
          {event.dateConfidence < 0.6 ? '~ ' : ''}{fmtDate(event.date)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-200">{event.title}</span>
        <Badge tone="accent">{titleCase(event.kind)}</Badge>
        <Badge tone={tierTone(event.qualityTier)}>{event.qualityTier}</Badge>
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-24">
        <span className="w-10 shrink-0 text-xs text-ink-600">date</span>
        <Meter value={event.dateConfidence} tone={meterTone(event.dateConfidence)} />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-500">{fmtPct(event.dateConfidence)}</span>
      </div>
    </button>
  )
}

function DetailPanel({ eventID, onClose }: { eventID: UUID; onClose: () => void }): JSX.Element {
  const detail = useAsync<{
    detail: { event: KEvent; entities: Entity[]; object: KnowledgeObject | null }
    links: EventLink[]
  }>(
    async () => {
      const [d, links] = await Promise.all([
        km.timeline.eventDetail(eventID),
        km.timeline.causalLinks(eventID)
      ])
      return { detail: d, links }
    },
    [eventID]
  )

  return (
    <Card
      title="Event detail"
      right={<button title="Close" className="text-ink-500 hover:text-ink-200" onClick={onClose}><X className="h-4 w-4" /></button>}
    >
      {detail.loading ? <Spinner /> : detail.error ? <ErrorNote message={detail.error} /> : !detail.data ? (
        <div className="text-sm text-ink-500">Not found.</div>
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-ink-100">{detail.data.detail.event.title}</div>
            <div className="mt-0.5 text-xs text-ink-500">{fmtDateTime(detail.data.detail.event.date)}</div>
            {detail.data.detail.event.summary && (
              <p className="mt-1 text-xs text-ink-400">{detail.data.detail.event.summary}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge tone="accent">{titleCase(detail.data.detail.event.kind)}</Badge>
            <Badge tone={tierTone(detail.data.detail.event.qualityTier)}>{detail.data.detail.event.qualityTier}</Badge>
            <Badge tone={meterTone(detail.data.detail.event.confidence)}>
              {confidenceLabel(detail.data.detail.event.confidence).label} · {fmtPct(detail.data.detail.event.confidence)}
            </Badge>
          </div>

          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-ink-600">Participants</div>
            {detail.data.detail.entities.length === 0 ? (
              <div className="text-xs text-ink-600">No linked entities.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {detail.data.detail.entities.map((en: Entity) => (
                  <Badge key={en.id} tone="neutral">{en.value}</Badge>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-ink-600">Source</div>
            {detail.data.detail.object ? (
              <div className="rounded-md bg-ink-900/60 px-3 py-2 text-xs text-ink-400">
                <div className="truncate text-ink-500">{detail.data.detail.object.sourceFile}</div>
                <p className="mt-1 line-clamp-4">{detail.data.detail.object.content.slice(0, 400)}</p>
              </div>
            ) : (
              <div className="text-xs text-ink-600">Source object unavailable.</div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-ink-600">
              <GitBranch className="h-3.5 w-3.5" /> Causal links
            </div>
            {detail.data.links.length === 0 ? (
              <div className="text-xs text-ink-600">No causal links recorded.</div>
            ) : (
              <div className="space-y-1">
                {detail.data.links.map((l: EventLink) => (
                  <div key={l.id} className="flex items-center gap-2 rounded-md bg-ink-900/60 px-3 py-1.5 text-xs">
                    <Badge tone="neutral">{l.relation}</Badge>
                    <span className="text-ink-500">→</span>
                    <span className="truncate font-mono text-ink-400">{l.targetEventID.slice(0, 8)}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-ink-600">{fmtPct(l.confidence)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
