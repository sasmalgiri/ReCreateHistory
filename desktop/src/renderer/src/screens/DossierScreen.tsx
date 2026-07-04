//
// DossierScreen — per-entity dossier. Search a subject (person, org, project),
// pick an entity, and Atlas reconstructs everything the ledger knows about it:
// distilled memory, event timeline, relationships, neighbors, aliases. Mirrors
// UI/DossierView.swift, but scoped to the structured ledger via km.dossier.
//

import { useEffect, useMemo, useState } from 'react'
import { IdCard, Search, Brain, CalendarClock, GitBranch, Users, Tags } from 'lucide-react'
import { km } from '../lib/km'
import {
  PageHeader, Card, Button, Input, Badge, Spinner, EmptyState, StatTile, Scroll, ErrorNote, Meter
} from '../components/ui'
import { fmtDate, fmtNum, fmtPct, confidenceLabel, titleCase } from '../lib/format'
import type { Entity } from '../../../shared/models'
import type { EntityDossier } from '../../../shared/ipc'

export default function DossierScreen(): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Entity[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [dossier, setDossier] = useState<EntityDossier | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runSearch(): Promise<void> {
    const name = query.trim()
    if (!name) return
    setSearching(true)
    setSearchError(null)
    try {
      const hits = await km.dossier.search(name)
      setResults(hits)
      if (hits.length === 1) setSelectedID(hits[0].id)
    } catch (e) {
      setSearchError(String((e as Error)?.message ?? e))
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    if (!selectedID) { setDossier(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    km.dossier.forEntity(selectedID)
      .then((d) => { if (!cancelled) setDossier(d) })
      .catch((e) => { if (!cancelled) setError(String((e as Error)?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedID])

  const conf = useMemo(
    () => (dossier?.memory ? confidenceLabel(dossier.memory.confidence) : null),
    [dossier]
  )

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<IdCard className="h-5 w-5" />}
        title="Dossier"
        subtitle="Reconstruct everything the ledger knows about one subject — a person, organization, or project."
        actions={
          <div className="flex items-center gap-2">
            <Input
              placeholder="Subject (person, project, organization)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
              className="w-72"
            />
            <Button variant="primary" onClick={runSearch} disabled={searching || !query.trim()}>
              <Search className="h-4 w-4" /> Search
            </Button>
          </div>
        }
      />

      <Scroll>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
          {/* Results column */}
          <div className="space-y-3">
            <Card title={`Matches${results ? ` (${results.length})` : ''}`}>
              {searching ? <Spinner label="Searching…" /> : searchError ? (
                <ErrorNote message={searchError} />
              ) : !results ? (
                <div className="text-xs text-ink-500">Search a subject to begin.</div>
              ) : results.length === 0 ? (
                <div className="text-xs text-ink-500">No entities matched “{query}”.</div>
              ) : (
                <div className="space-y-1">
                  {results.map((ent) => (
                    <button
                      key={ent.id}
                      onClick={() => setSelectedID(ent.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        ent.id === selectedID ? 'bg-accent/10 text-accent-soft' : 'text-ink-300 hover:bg-ink-900/60'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{ent.value}</span>
                      <Badge tone="neutral">{titleCase(ent.kind)}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Dossier column */}
          <div className="min-w-0 space-y-4">
            {loading ? (
              <Card><Spinner label="Reconstructing dossier…" /></Card>
            ) : error ? (
              <ErrorNote message={error} />
            ) : !dossier ? (
              <EmptyState
                icon={<IdCard className="h-8 w-8" />}
                title="Open a dossier"
                hint="Search a person, project, organization, or topic. Select a match and Atlas reconstructs its full history from the ledger."
              />
            ) : (
              <DossierBody dossier={dossier} conf={conf} onSelect={setSelectedID} />
            )}
          </div>
        </div>
      </Scroll>
    </div>
  )
}

function DossierBody({ dossier, conf, onSelect }: {
  dossier: EntityDossier
  conf: { label: string; tone: 'high' | 'medium' | 'low' } | null
  onSelect: (id: string) => void
}): JSX.Element {
  const { entity, aliases, mentionCount, events, relationships, neighbors, memory, firstSeen, lastSeen } = dossier
  const sortedEvents = useMemo(() => [...events].sort((a, b) => a.date - b.date), [events])

  return (
    <>
      {/* Header card */}
      <Card>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink-50">{entity.value}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{titleCase(entity.kind)}</Badge>
            <span className="text-xs text-ink-500">
              First seen {fmtDate(firstSeen)} · Last seen {fmtDate(lastSeen)}
            </span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Mentions" value={fmtNum(mentionCount)} tone="accent" />
          <StatTile label="Events" value={fmtNum(events.length)} />
          <StatTile label="Relationships" value={fmtNum(relationships.length)} />
          <StatTile label="Neighbors" value={fmtNum(neighbors.length)} />
        </div>
      </Card>

      {/* Distilled memory */}
      {memory && (
        <Card
          title="Distilled memory"
          right={conf ? <Badge tone={conf.tone}>{conf.label} · {fmtPct(memory.confidence)}</Badge> : undefined}
        >
          <div className="flex items-start gap-2">
            <Brain className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-200">{memory.narrative}</p>
          </div>
          <div className="mt-3">
            <Meter value={memory.confidence} tone={conf?.tone ?? 'accent'} />
          </div>
        </Card>
      )}

      {/* Events timeline */}
      <Card title="Timeline" right={<CalendarClock className="h-4 w-4 text-ink-500" />}>
        {sortedEvents.length === 0 ? (
          <div className="text-xs text-ink-500">No dated events recorded for this subject.</div>
        ) : (
          <div className="space-y-2">
            {sortedEvents.map((ev) => (
              <div key={ev.id} className="flex items-start gap-3 border-l border-ink-800 pl-3">
                <div className="w-24 shrink-0 pt-0.5 text-xs tabular-nums text-ink-500">{fmtDate(ev.date)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink-200">{ev.title}</div>
                  {ev.summary && <div className="mt-0.5 truncate text-xs text-ink-500">{ev.summary}</div>}
                </div>
                <Badge tone="neutral">{titleCase(ev.kind)}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Relationships */}
      <Card title="Relationships" right={<GitBranch className="h-4 w-4 text-ink-500" />}>
        {relationships.length === 0 ? (
          <div className="text-xs text-ink-500">No relationships recorded.</div>
        ) : (
          <div className="space-y-1">
            {relationships.map((rel) => (
              <div key={rel.id} className="flex items-center justify-between rounded-md bg-ink-900/50 px-3 py-1.5 text-sm">
                <span className="text-ink-200">{titleCase(rel.kind)}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums text-ink-500">weight {rel.weight.toFixed(2)}</span>
                  <div className="w-20"><Meter value={Math.max(0, Math.min(1, rel.weight))} /></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Neighbors */}
      {neighbors.length > 0 && (
        <Card title="Neighbors" right={<Users className="h-4 w-4 text-ink-500" />}>
          <div className="flex flex-wrap gap-2">
            {neighbors.map((n) => (
              <button
                key={n.entity.id}
                onClick={() => onSelect(n.entity.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-800/60 px-3 py-1 text-xs text-ink-300 transition-colors hover:border-accent/40 hover:text-accent-soft"
                title={`weight ${n.weight.toFixed(2)}`}
              >
                <span className="truncate">{n.entity.value}</span>
                <span className="tabular-nums text-ink-600">{n.weight.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Aliases */}
      {aliases.length > 0 && (
        <Card title="Aliases" right={<Tags className="h-4 w-4 text-ink-500" />}>
          <div className="flex flex-wrap gap-2">
            {aliases.map((a) => (
              <Badge key={a} tone="neutral">{a}</Badge>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
