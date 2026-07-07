//
// guidance.tsx — the "never lost" kit: InfoTip (hover ?), GuideBox
// (dismissible per-screen intro), and StatusLegend (epistemic statuses).
// All copy lives in lib/guide.ts.
//

import { useState, type ReactNode } from 'react'
import { HelpCircle, X, BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { GLOSSARY, SCREEN_GUIDES } from '../lib/guide'
import { Badge } from './ui'

/** Small hover tooltip. `term` looks up the glossary; `text` overrides. */
export function InfoTip({ term, text, children }: { term?: string; text?: string; children?: ReactNode }): JSX.Element {
  const tip = text ?? (term ? GLOSSARY[term] : '') ?? ''
  return (
    <span className="group/tip relative inline-flex items-center">
      {children ?? <HelpCircle className="h-3.5 w-3.5 cursor-help text-ink-600 hover:text-ink-300" />}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-64 -translate-x-1/2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-xs font-normal normal-case leading-relaxed text-ink-200 shadow-xl group-hover/tip:block">
        {tip}
      </span>
    </span>
  )
}

/** Dismissible per-screen intro banner; remembers dismissal per screen. */
export function GuideBox({ screen }: { screen: keyof typeof SCREEN_GUIDES }): JSX.Element | null {
  const key = `rch.guide.${screen}.dismissed`
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(key) === '1')
  const g = SCREEN_GUIDES[screen]
  if (!g || dismissed) return null
  return (
    <div className="relative mb-4 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3">
      <button
        type="button"
        className="absolute right-2 top-2 rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
        title="Dismiss (you can re-read everything in the Guide)"
        onClick={() => { localStorage.setItem(key, '1'); setDismissed(true) }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-2.5 pr-6">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" />
        <div>
          <div className="text-sm font-medium text-ink-100">{g.title}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-ink-400">{g.body}</div>
          <Link to="/guide" className="mt-1 inline-block text-[11px] text-accent-soft hover:underline">
            Full guide →
          </Link>
        </div>
      </div>
    </div>
  )
}

/** Legend for the epistemic statuses, with hover definitions. */
export function StatusLegend(): JSX.Element {
  const items: [string, 'high' | 'accent' | 'medium' | 'low'][] = [
    ['observed', 'high'], ['asserted', 'accent'], ['derived', 'medium'],
    ['inferred', 'medium'], ['contradicted', 'low']
  ]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-ink-600">How events are known:</span>
      {items.map(([term, tone]) => (
        <InfoTip key={term} term={term}>
          <span className="cursor-help"><Badge tone={tone}>{term}</Badge></span>
        </InfoTip>
      ))}
    </div>
  )
}
