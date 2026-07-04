//
// AssertionsScreen — audit surface for the Vol 17 §A3 assertion substrate.
// Lists user assertions (subject-predicate-object triples), lets you add a
// literal triple with a confidence, and retract bad ones. Mirrors
// UI/AssertionsView.swift (this port also folds in the inline writer form).
//

import { useMemo, useState } from 'react'
import { ScrollText, Plus, XCircle, RefreshCw } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Card, Button, Input, Badge, Spinner, EmptyState, Scroll, ErrorNote, Meter } from '../components/ui'
import { fmtDateTime, fmtPct, confidenceLabel } from '../lib/format'
import type { Assertion } from '../../../shared/models'

export default function AssertionsScreen(): JSX.Element {
  const assertions = useAsync<Assertion[]>(() => km.assertions.list(), [])

  const [subject, setSubject] = useState('')
  const [predicate, setPredicate] = useState('')
  const [objectValue, setObjectValue] = useState('')
  const [confidence, setConfidence] = useState(0.75)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [predicateFilter, setPredicateFilter] = useState('')

  const rows: Assertion[] = assertions.data ?? []

  const filtered = useMemo<Assertion[]>(() => {
    const q = predicateFilter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((a: Assertion) => a.predicate.toLowerCase().includes(q))
  }, [rows, predicateFilter])

  const canAdd = subject.trim().length > 0 && predicate.trim().length > 0 && objectValue.trim().length > 0

  async function add(): Promise<void> {
    if (!canAdd || adding) return
    setAdding(true)
    setAddError(null)
    try {
      await km.assertions.add({
        subjectKind: 'topic',
        subjectID: subject.trim().toLowerCase(),
        predicate: predicate.trim(),
        objectKind: 'literal',
        objectValue: objectValue.trim(),
        objectEntityID: null,
        objectEventID: null,
        confidence,
        evidenceObjectIDs: [],
        agent: 'user',
        reason: null
      })
      setSubject('')
      setPredicate('')
      setObjectValue('')
      setConfidence(0.75)
      assertions.reload()
    } catch (e) {
      setAddError(String((e as { message?: string })?.message ?? e))
    } finally {
      setAdding(false)
    }
  }

  async function retract(id: string): Promise<void> {
    await km.assertions.retract(id)
    assertions.reload()
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<ScrollText className="h-5 w-5" />}
        title="Assertions"
        subtitle="Subject–predicate–object triples in the assertion substrate. Every fact carries an agent, a confidence, and a timestamp."
        actions={
          <>
            <Badge tone="neutral">{filtered.length} of {rows.length}</Badge>
            <Button onClick={assertions.reload}><RefreshCw className="h-3.5 w-3.5" /></Button>
          </>
        }
      />
      <Scroll>
        <div className="space-y-4">
          <Card title="Add assertion">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-ink-500">Subject (topic)</label>
                  <Input value={subject} placeholder="project-delta" onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink-500">Predicate</label>
                  <Input value={predicate} placeholder="status" onChange={(e) => setPredicate(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink-500">Object value</label>
                  <Input value={objectValue} placeholder="at risk" onChange={(e) => setObjectValue(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex min-w-[220px] flex-1 items-center gap-3">
                  <span className="text-xs text-ink-500">Confidence</span>
                  <input
                    type="range"
                    title="Confidence"
                    aria-label="Confidence"
                    min={0}
                    max={1}
                    step={0.05}
                    value={confidence}
                    onChange={(e) => setConfidence(Number(e.target.value))}
                    className="flex-1 accent-accent"
                  />
                  <span className="shrink-0">
                    <Badge tone={confidenceLabel(confidence).tone}>{fmtPct(confidence)} · {confidenceLabel(confidence).label}</Badge>
                  </span>
                </div>
                <Button variant="primary" onClick={add} disabled={!canAdd || adding}>
                  {adding ? <Spinner /> : <><Plus className="h-4 w-4" /> Add</>}
                </Button>
              </div>
              {addError && <ErrorNote message={addError} />}
            </div>
          </Card>

          <Card
            title={`Assertions (${rows.length})`}
            right={
              <Input
                value={predicateFilter}
                placeholder="filter predicate"
                onChange={(e) => setPredicateFilter(e.target.value)}
                className="w-48"
              />
            }
          >
            {assertions.loading ? (
              <Spinner />
            ) : assertions.error ? (
              <ErrorNote message={assertions.error} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<ScrollText className="h-8 w-8" />}
                title={rows.length === 0 ? 'No assertions yet' : 'No matches'}
                hint={
                  rows.length === 0
                    ? 'Add a subject–predicate–object triple above to seed the substrate. Future LLM extractions will populate it automatically.'
                    : 'No assertion predicate matches your filter.'
                }
              />
            ) : (
              <div className="space-y-2">
                {filtered.map((a: Assertion) => (
                  <AssertionRow key={a.id} a={a} onRetract={retract} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </Scroll>
    </div>
  )
}

function AssertionRow({ a, onRetract }: { a: Assertion; onRetract: (id: string) => void }): JSX.Element {
  const conf = confidenceLabel(a.confidence)
  const object =
    a.objectValue ??
    (a.objectEntityID
      ? `entity:${a.objectEntityID.slice(0, 8)}`
      : a.objectEventID
        ? `event:${a.objectEventID.slice(0, 8)}`
        : '—')
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900/50 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <Badge tone="accent">{a.subjectKind}</Badge>
            <span className="font-medium text-ink-100">{a.subjectID}</span>
            <span className="font-mono text-xs uppercase tracking-wide text-accent-soft">—{a.predicate}→</span>
            <span className="text-ink-200">{object}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-500">
            <span>agent: {a.agent}</span>
            <span>{fmtDateTime(a.recordedAt)}</span>
            {a.reason && <span className="italic text-ink-600">· {a.reason}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tone={conf.tone}>{fmtPct(a.confidence)}</Badge>
          <button
            className="text-ink-500 hover:text-rose-400"
            title="Retract this assertion"
            onClick={() => onRetract(a.id)}
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-2">
        <Meter value={a.confidence} tone={conf.tone} />
      </div>
    </div>
  )
}
