//
// KnowledgeScreen — the knowledge inventory dashboard. Reads the ledger's
// aggregate counts (files → objects → chunks → entities/events/… → vectors)
// plus a category breakdown and temporal coverage, then samples the entity
// table to show a per-kind breakdown and the top entities. Read-only overview.
//

import { useMemo } from 'react'
import { Library, Boxes, Tags } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Card, StatTile, Badge, Spinner, EmptyState, Scroll, ErrorNote, Meter } from '../components/ui'
import { fmtNum, fmtDate, titleCase } from '../lib/format'
import type { Entity, EntityKind } from '../../../shared/models'
import type { KnowledgeInventory } from '../../../shared/ipc'

interface Bar {
  label: string
  value: number
}

/** Turn a count map into descending bars. */
function toBars(counts: Record<string, number>): Bar[] {
  return Object.entries(counts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
}

export default function KnowledgeScreen(): JSX.Element {
  const inv = useAsync<KnowledgeInventory>(() => km.app.inventory(), [])
  const entities = useAsync<Entity[]>(() => km.knowledge.entities(undefined, 100), [])

  const categoryBars = useMemo<Bar[]>(
    () => (inv.data ? toBars(inv.data.byCategory) : []),
    [inv.data]
  )

  const kindBars = useMemo<Bar[]>(() => {
    if (!entities.data) return []
    const counts: Record<string, number> = {}
    for (const e of entities.data) {
      const k: EntityKind = e.kind
      counts[k] = (counts[k] ?? 0) + 1
    }
    return toBars(counts)
  }, [entities.data])

  const topEntities = useMemo<Entity[]>(
    () => (entities.data ? entities.data.slice(0, 15) : []),
    [entities.data]
  )

  const categoryMax = categoryBars.reduce((m, b) => Math.max(m, b.value), 0)
  const kindMax = kindBars.reduce((m, b) => Math.max(m, b.value), 0)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<Library className="h-5 w-5" />}
        title="Knowledge"
        subtitle="Everything the ledger holds — objects, entities, events, and the memory distilled from them."
      />
      <Scroll>
        {inv.error && <ErrorNote message={inv.error} />}

        {inv.loading && !inv.data ? (
          <Spinner label="Reading the ledger…" />
        ) : !inv.data ? (
          <EmptyState
            icon={<Boxes className="h-8 w-8" />}
            title="Nothing here yet"
            hint="Ingest sources to populate the knowledge ledger."
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile label="Files" value={fmtNum(inv.data.files)} />
              <StatTile label="Objects" value={fmtNum(inv.data.objects)} tone="accent" />
              <StatTile label="Chunks" value={fmtNum(inv.data.chunks)} />
              <StatTile label="Entities" value={fmtNum(inv.data.entities)} />
              <StatTile label="Events" value={fmtNum(inv.data.events)} />
              <StatTile label="Relationships" value={fmtNum(inv.data.relationships)} />
              <StatTile label="Memories" value={fmtNum(inv.data.memories)} />
              <StatTile label="Summaries" value={fmtNum(inv.data.summaries)} />
              <StatTile label="Assertions" value={fmtNum(inv.data.assertions)} />
              <StatTile label="Vectors" value={fmtNum(inv.data.vectors)} tone="accent" />
            </div>

            <Card title="Coverage">
              <div className="flex items-center gap-3 text-sm text-ink-300">
                <span className="tabular-nums text-ink-100">{fmtDate(inv.data.earliestEvent)}</span>
                <span className="h-px flex-1 bg-ink-800" />
                <Badge tone="accent">{fmtNum(inv.data.events)} events</Badge>
                <span className="h-px flex-1 bg-ink-800" />
                <span className="tabular-nums text-ink-100">{fmtDate(inv.data.latestEvent)}</span>
              </div>
              {inv.data.earliestEvent == null && (
                <div className="mt-2 text-xs text-ink-500">No dated events yet.</div>
              )}
            </Card>

            <Card title="By category">
              {categoryBars.length === 0 ? (
                <div className="text-sm text-ink-500">No categorized objects yet.</div>
              ) : (
                <div className="space-y-2.5">
                  {categoryBars.map((b) => (
                    <div key={b.label}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-ink-300">{titleCase(b.label)}</span>
                        <span className="tabular-nums text-ink-500">{fmtNum(b.value)}</span>
                      </div>
                      <Meter value={categoryMax > 0 ? b.value / categoryMax : 0} />
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="Entities by kind"
              right={<span className="text-xs text-ink-600">sample of {fmtNum(entities.data?.length ?? 0)}</span>}
            >
              {entities.error ? (
                <ErrorNote message={entities.error} />
              ) : entities.loading && !entities.data ? (
                <Spinner />
              ) : kindBars.length === 0 ? (
                <div className="text-sm text-ink-500">No entities extracted yet.</div>
              ) : (
                <div className="space-y-2.5">
                  {kindBars.map((b) => (
                    <div key={b.label}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-ink-300">{titleCase(b.label)}</span>
                        <span className="tabular-nums text-ink-500">{fmtNum(b.value)}</span>
                      </div>
                      <Meter value={kindMax > 0 ? b.value / kindMax : 0} tone="high" />
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Top entities">
              {entities.loading && !entities.data ? (
                <Spinner />
              ) : topEntities.length === 0 ? (
                <EmptyState
                  icon={<Tags className="h-8 w-8" />}
                  title="No entities yet"
                  hint="Entities appear once ingested documents are structured."
                />
              ) : (
                <div className="divide-y divide-ink-800/60">
                  {topEntities.map((e) => (
                    <div key={e.id} className="flex items-center gap-3 py-2 text-sm">
                      <Badge tone="neutral">{titleCase(e.kind)}</Badge>
                      <div className="min-w-0 flex-1 truncate text-ink-200">{e.value}</div>
                      <span className="shrink-0 tabular-nums text-xs text-ink-500">{fmtNum(Math.round(e.confidence * 100))}%</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </Scroll>
    </div>
  )
}
