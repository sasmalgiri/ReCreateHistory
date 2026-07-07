//
// GuideScreen — the built-in guide book: what each screen does, what the
// badges mean, and how to get good answers. Content lives in lib/guide.ts.
//

import { BookOpen } from 'lucide-react'
import { PageHeader, Card, Scroll, Badge } from '../components/ui'
import { SCREEN_GUIDES, GLOSSARY, PERSONAS } from '../lib/guide'
import { Link } from 'react-router-dom'

const WORKFLOW = [
  ['1 · Ingest', 'Add files in Sources. Each is hashed, parsed into cited evidence blocks, and indexed. Duplicates are auto-detected; unsupported formats are reported honestly, never faked.'],
  ['2 · Reconstruct', 'The ledger extracts entities, dated events, and claims, corroborates them across documents, and preserves contradictions. See it all in Reconstruction.'],
  ['3 · Ask', 'Questions are answered only from your evidence, with citations, a classification badge, and explicit gaps. History-shaped questions are composed by rules, not generated.'],
  ['4 · Review & export', 'Accept/reject events, then export the chronology report — timeline, contradictions, missing evidence, and a SHA-256 source manifest.']
]

export default function GuideScreen(): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<BookOpen className="h-5 w-5" />} title="Guide"
        subtitle="Two minutes to never feel lost: the workflow, every screen, and what every badge means." />
      <Scroll>
        <div className="mx-auto max-w-3xl space-y-4">
          <Card title="How it works">
            <div className="grid gap-3 sm:grid-cols-2">
              {WORKFLOW.map(([t, b]) => (
                <div key={t} className="rounded-lg bg-ink-900/60 p-3">
                  <div className="text-sm font-medium text-accent-soft">{t}</div>
                  <div className="mt-1 text-xs leading-relaxed text-ink-400">{b}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="What the status badges mean">
            <div className="space-y-2">
              {(['observed', 'asserted', 'derived', 'inferred', 'contradicted', 'corroborated'] as const).map((k) => (
                <div key={k} className="flex items-start gap-2 text-xs">
                  <Badge tone={k === 'observed' || k === 'corroborated' ? 'high' : k === 'contradicted' ? 'low' : k === 'asserted' ? 'accent' : 'medium'}>{k}</Badge>
                  <span className="pt-0.5 leading-relaxed text-ink-400">{GLOSSARY[k]}</span>
                </div>
              ))}
              <div className="flex items-start gap-2 text-xs">
                <Badge tone="neutral">classification</Badge>
                <span className="pt-0.5 leading-relaxed text-ink-400">{GLOSSARY.classification}</span>
              </div>
            </div>
          </Card>

          <Card title="The screens">
            <div className="space-y-2">
              {Object.entries(SCREEN_GUIDES).map(([key, g]) => (
                <div key={key} className="rounded-lg bg-ink-900/50 px-3 py-2">
                  <div className="text-sm text-ink-100">{g.title}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-ink-500">{g.body}</div>
                </div>
              ))}
              <div className="rounded-lg bg-ink-900/50 px-3 py-2">
                <div className="text-sm text-ink-100">Notebook, Saved, Library, Knowledge, Live, Assertions, Completeness, Convert</div>
                <div className="mt-0.5 text-xs leading-relaxed text-ink-500">
                  Notebook runs multi-step investigations; Saved re-runs bookmarked questions as evidence grows;
                  Library browses documents, summaries and memories; Knowledge shows corpus statistics; Live shows
                  the ingest pipeline in real time; Assertions records your own claims; Completeness checks what is
                  indexed and ready; Convert extracts or transforms a single file without ingesting it.
                </div>
              </div>
            </div>
          </Card>

          <Card title="Guided starts by profession">
            <div className="flex flex-wrap gap-2">
              {PERSONAS.map((p) => (
                <Link key={p.id} to="/" className="chip hover:border-accent hover:text-accent-soft">
                  {p.emoji} {p.title}
                </Link>
              ))}
            </div>
            <div className="mt-2 text-xs text-ink-500">Each workspace on the Home screen gives a 3-step start, example questions, and tips for that kind of work.</div>
          </Card>
        </div>
      </Scroll>
    </div>
  )
}
