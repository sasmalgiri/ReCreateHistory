//
// SearchScreen — full-text + semantic search over the ledger. Mirrors
// UI/SearchView.swift, extended with a Keyword/Semantic mode toggle. Keyword
// runs FTS5 over chunks; Semantic runs vector similarity (needs an Ollama
// embedding model). Clicking a hit opens the underlying source file.
//

import { useCallback, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Search, FileText, ExternalLink, Sparkles, Type } from 'lucide-react'
import { km } from '../lib/km'
import { PageHeader, Card, Button, Input, Badge, Spinner, EmptyState, Scroll, ErrorNote } from '../components/ui'
import { fmtNum } from '../lib/format'
import type { SearchHit } from '../../../shared/ipc'

type Mode = 'Keyword' | 'Semantic'

const LIMIT = 40

export default function SearchScreen(): JSX.Element {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('Keyword')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ranMode, setRanMode] = useState<Mode>('Keyword')

  const runSearch = useCallback(async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setRanMode(mode)
    try {
      const results = mode === 'Keyword'
        ? await km.search.query(q, LIMIT)
        : await km.search.semantic(q, LIMIT)
      setHits(results)
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e))
      setHits(null)
    } finally {
      setLoading(false)
    }
  }, [query, mode])

  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') { e.preventDefault(); void runSearch() }
  }, [runSearch])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<Search className="h-5 w-5" />}
        title="Search"
        subtitle="Full-text and semantic search across your entire knowledge base — on-device."
      />
      <Scroll>
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search timelines, entities, summaries…"
                    className="pl-9"
                    autoFocus
                  />
                </div>
                <Button variant="primary" onClick={() => void runSearch()} disabled={loading || !query.trim()}>
                  Search
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <ModeButton icon={<Type className="h-3.5 w-3.5" />} label="Keyword" active={mode === 'Keyword'} onClick={() => setMode('Keyword')} />
                <ModeButton icon={<Sparkles className="h-3.5 w-3.5" />} label="Semantic" active={mode === 'Semantic'} onClick={() => setMode('Semantic')} />
                <span className="ml-auto text-xs text-ink-600">
                  {mode === 'Keyword' ? 'FTS5 over chunks' : 'Vector similarity — needs an Ollama embedding model'}
                </span>
              </div>
            </div>
          </Card>

          {error && <ErrorNote message={error} />}

          {loading ? (
            <Card><Spinner label={`Searching (${ranMode.toLowerCase()})…`} /></Card>
          ) : hits === null ? (
            <EmptyState
              icon={<Search className="h-8 w-8" />}
              title="Type to search across your knowledge base"
              hint="Keyword matches exact terms via full-text search. Semantic finds related meaning and requires an Ollama embedding model."
            />
          ) : hits.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title="No results"
              hint={ranMode === 'Semantic'
                ? 'Semantic search needs an Ollama embedding model configured in Settings, and ingested vectors to match against.'
                : 'Try broader or different keywords, or switch to Semantic search.'}
            />
          ) : (
            <>
              <div className="px-1 text-xs text-ink-500">
                {fmtNum(hits.length)} result{hits.length === 1 ? '' : 's'} · {ranMode.toLowerCase()}
              </div>
              <div className="space-y-2">
                {hits.map((hit) => (
                  <ResultCard key={`${hit.objectID}:${hit.chunkID ?? ''}`} hit={hit} />
                ))}
              </div>
            </>
          )}
        </div>
      </Scroll>
    </div>
  )
}

function ModeButton({ icon, label, active, onClick }: {
  icon: JSX.Element; label: string; active: boolean; onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={active
        ? 'inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent-soft'
        : 'inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-800/60 px-3 py-1 text-xs text-ink-400 hover:text-ink-200'}
    >
      {icon}
      {label}
    </button>
  )
}

function ResultCard({ hit }: { hit: SearchHit }): JSX.Element {
  const filename = hit.sourceFile.split(/[\\/]/).pop() ?? hit.sourceFile
  const open = (): void => { void km.app.openPath(hit.sourceFile) }
  return (
    <button
      onClick={open}
      className="group block w-full rounded-xl border border-ink-800 bg-ink-900/40 p-4 text-left transition-colors hover:border-ink-700 hover:bg-ink-900/70"
    >
      <div className="flex items-center gap-2">
        <Badge tone="neutral">{hit.sourceCategory}</Badge>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-medium text-ink-100">
            <FileText className="h-3.5 w-3.5 shrink-0 text-ink-500" />
            <span className="truncate">{filename}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-ink-600 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
      </div>
      <div className="mt-1 truncate text-xs text-ink-600" title={hit.sourceFile}>{hit.sourceFile}</div>
      <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-ink-300">{hit.snippet}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-500">
        <Badge tone="accent">via: {hit.via}</Badge>
        <span className="tabular-nums">score {hit.score.toFixed(3)}</span>
      </div>
    </button>
  )
}
