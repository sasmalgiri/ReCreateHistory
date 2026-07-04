//
// ExploreScreen — knowledge-graph explorer. Mirrors UI/ExplorerView.swift, but
// draws the neighborhood as a dependency-free SVG radial graph. Pick a seed
// entity from the top-entity chips or the search bar, then click any node to
// recenter and keep traversing. A hops control widens the neighborhood.
//

import { useMemo, useState } from 'react'
import { Share2, Search, Circle } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Card, Button, Input, Badge, Spinner, EmptyState, Scroll, ErrorNote } from '../components/ui'
import { fmtNum } from '../lib/format'
import type { GraphNode, GraphNeighborhood } from '../../../shared/ipc'
import type { Entity } from '../../../shared/models'

const VIEW_W = 640
const VIEW_H = 480
const CX = VIEW_W / 2
const CY = VIEW_H / 2
const RADIUS = 180

interface Placed {
  node: GraphNode
  x: number
  y: number
  r: number
  isSeed: boolean
}

function truncate(s: string, n = 14): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Circle radius scaled from node weight, clamped to a legible range. */
function nodeRadius(weight: number, isSeed: boolean): number {
  if (isSeed) return 22
  const w = Math.max(0, weight)
  return Math.max(9, Math.min(18, 9 + Math.sqrt(w) * 2))
}

export default function ExploreScreen(): JSX.Element {
  const [seed, setSeed] = useState<GraphNode | null>(null)
  const [hops, setHops] = useState<1 | 2>(1)
  const [query, setQuery] = useState('')

  const top = useAsync<GraphNode[]>(() => km.graph.topEntities(30), [])
  const hood = useAsync<GraphNeighborhood | null>(
    () => (seed ? km.graph.neighborhood(seed.id, hops) : Promise.resolve(null)),
    [seed?.id, hops]
  )

  async function runSearch(): Promise<void> {
    const q = query.trim()
    if (q.length < 2) return
    const hits: Entity[] = await km.dossier.search(q)
    const first = hits[0]
    if (first) {
      setSeed({ id: first.id, label: first.value, kind: first.kind, weight: first.confidence })
    }
  }

  // Lay the neighborhood out: seed at center, everyone else on a ring.
  const placed = useMemo<Placed[]>(() => {
    if (!seed || !hood.data) return []
    const nodes = hood.data.nodes
    const others = nodes.filter((n) => n.id !== seed.id)
    const seedNode = nodes.find((n) => n.id === seed.id) ?? seed
    const out: Placed[] = [
      { node: seedNode, x: CX, y: CY, r: nodeRadius(seedNode.weight, true), isSeed: true }
    ]
    others.forEach((n, i) => {
      const theta = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2
      out.push({
        node: n,
        x: CX + RADIUS * Math.cos(theta),
        y: CY + RADIUS * Math.sin(theta),
        r: nodeRadius(n.weight, false),
        isSeed: false
      })
    })
    return out
  }, [seed, hood.data])

  const posByID = useMemo<Map<string, Placed>>(() => {
    const m = new Map<string, Placed>()
    for (const p of placed) m.set(p.node.id, p)
    return m
  }, [placed])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<Share2 className="h-5 w-5" />}
        title="Explore"
        subtitle="Traverse your knowledge graph. Pick a seed entity, then click any node to recenter."
        actions={
          <div className="flex items-center gap-1 rounded-md border border-ink-800 p-0.5">
            {([1, 2] as const).map((h) => (
              <button
                key={h}
                onClick={() => setHops(h)}
                className={
                  'rounded px-2.5 py-1 text-xs ' +
                  (hops === h ? 'bg-accent/15 text-accent-soft' : 'text-ink-400 hover:text-ink-200')
                }
              >
                {h} hop{h > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        }
      />
      <Scroll>
        <div className="space-y-4">
          <Card title="Seed entity">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void runSearch()
              }}
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-600" />
                <Input
                  className="pl-8"
                  placeholder="Search entities — a person, org, project, email…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Button variant="primary" type="submit" disabled={query.trim().length < 2}>
                Search
              </Button>
            </form>

            {top.error && <div className="mt-3"><ErrorNote message={top.error} /></div>}
            {top.loading ? (
              <div className="mt-3"><Spinner label="Loading top entities…" /></div>
            ) : top.data && top.data.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {top.data.map((n) => (
                  <button key={n.id} onClick={() => setSeed(n)} title={`${n.label} · ${n.kind}`}>
                    <Badge tone={seed?.id === n.id ? 'accent' : 'neutral'}>
                      <Circle className="h-2.5 w-2.5" /> {truncate(n.label, 22)}
                    </Badge>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-xs text-ink-500">No entities in the ledger yet.</div>
            )}
          </Card>

          {!seed ? (
            <EmptyState
              icon={<Share2 className="h-8 w-8" />}
              title="Explore your knowledge graph"
              hint="Choose a top entity above or search for one. Click any neighbor to keep traversing the graph."
            />
          ) : (
            <Card
              title={truncate(seed.label, 40)}
              right={
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{seed.kind}</Badge>
                  {hood.data && (
                    <span className="text-xs text-ink-500">
                      {fmtNum(hood.data.nodes.length)} nodes · {fmtNum(hood.data.edges.length)} edges
                    </span>
                  )}
                </div>
              }
            >
              {hood.error ? (
                <ErrorNote message={hood.error} />
              ) : hood.loading ? (
                <Spinner label="Building neighborhood…" />
              ) : !hood.data || hood.data.nodes.length === 0 ? (
                <EmptyState title="No connections found" hint="This entity has no recorded neighbors yet." />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <svg
                      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                      className="mx-auto block w-full max-w-3xl"
                      role="img"
                      aria-label="Entity neighborhood graph"
                    >
                      {hood.data.edges.map((e, i) => {
                        const a = posByID.get(e.from)
                        const b = posByID.get(e.to)
                        if (!a || !b) return null
                        return (
                          <line
                            key={`${e.from}-${e.to}-${i}`}
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            stroke="#4a4640"
                            strokeWidth={Math.max(0.75, Math.min(3, e.weight))}
                            strokeOpacity={0.7}
                          />
                        )
                      })}
                      {placed.map((p) => (
                        <g
                          key={p.node.id}
                          className={p.isSeed ? '' : 'cursor-pointer'}
                          onClick={() => {
                            if (!p.isSeed) setSeed(p.node)
                          }}
                        >
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={p.r}
                            fill={p.isSeed ? '#c98a3a' : '#57534e'}
                            stroke={p.isSeed ? '#e0b878' : '#3a3733'}
                            strokeWidth={1.5}
                          />
                          <text
                            x={p.x}
                            y={p.y + p.r + 12}
                            textAnchor="middle"
                            fontSize={11}
                            fill={p.isSeed ? '#e0b878' : '#b8b2a8'}
                          >
                            {truncate(p.node.label)}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                  <p className="mt-2 text-center text-xs text-ink-600">
                    Click any surrounding node to recenter the graph on it.
                  </p>
                </>
              )}
            </Card>
          )}
        </div>
      </Scroll>
    </div>
  )
}
