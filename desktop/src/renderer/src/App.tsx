//
// App.tsx — the shell: sidebar navigation, ingest banner, and routes to all
// 16 surfaces (mirrors RootView.swift's TabView). Ask is home.
//

import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  MessagesSquare, Search, CalendarClock, BookOpen, NotebookPen, Bookmark,
  Activity, Library, Contact, Network, ScrollText, Boxes, FolderOpen,
  ListChecks, FileOutput, Settings as SettingsIcon, Loader2, CheckCircle2
} from 'lucide-react'
import { km } from './lib/km'

import AskScreen from './screens/AskScreen'
import SearchScreen from './screens/SearchScreen'
import TimelineScreen from './screens/TimelineScreen'
import HistoryScreen from './screens/HistoryScreen'
import NotebookScreen from './screens/NotebookScreen'
import SavedScreen from './screens/SavedScreen'
import LiveScreen from './screens/LiveScreen'
import LibraryScreen from './screens/LibraryScreen'
import DossierScreen from './screens/DossierScreen'
import ExploreScreen from './screens/ExploreScreen'
import AssertionsScreen from './screens/AssertionsScreen'
import KnowledgeScreen from './screens/KnowledgeScreen'
import SourcesScreen from './screens/SourcesScreen'
import CompletenessScreen from './screens/CompletenessScreen'
import ConvertScreen from './screens/ConvertScreen'
import SettingsScreen from './screens/SettingsScreen'
import OnboardingScreen from './screens/OnboardingScreen'

const NAV = [
  { to: '/', label: 'Ask', icon: MessagesSquare, el: <AskScreen /> },
  { to: '/search', label: 'Search', icon: Search, el: <SearchScreen /> },
  { to: '/timeline', label: 'Timeline', icon: CalendarClock, el: <TimelineScreen /> },
  { to: '/history', label: 'History', icon: BookOpen, el: <HistoryScreen /> },
  { to: '/notebook', label: 'Notebook', icon: NotebookPen, el: <NotebookScreen /> },
  { to: '/saved', label: 'Saved', icon: Bookmark, el: <SavedScreen /> },
  { to: '/live', label: 'Live', icon: Activity, el: <LiveScreen /> },
  { to: '/library', label: 'Library', icon: Library, el: <LibraryScreen /> },
  { to: '/dossier', label: 'Dossier', icon: Contact, el: <DossierScreen /> },
  { to: '/explore', label: 'Explore', icon: Network, el: <ExploreScreen /> },
  { to: '/assertions', label: 'Assertions', icon: ScrollText, el: <AssertionsScreen /> },
  { to: '/knowledge', label: 'Knowledge', icon: Boxes, el: <KnowledgeScreen /> },
  { to: '/sources', label: 'Sources', icon: FolderOpen, el: <SourcesScreen /> },
  { to: '/completeness', label: 'Completeness', icon: ListChecks, el: <CompletenessScreen /> },
  { to: '/convert', label: 'Convert', icon: FileOutput, el: <ConvertScreen /> },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, el: <SettingsScreen /> }
]

export default function App(): JSX.Element {
  const [ingest, setIngest] = useState<{ activeCount: number; lastFile: string | null }>({ activeCount: 0, lastFile: null })
  const [onboarding, setOnboarding] = useState(false)

  useEffect(() => {
    km.app.status().then((s) => { if (!s.onboardingShown && !s.hasRoots) setOnboarding(true) })
    km.app.ingestActivity().then((a) => setIngest({ activeCount: a.activeCount, lastFile: a.lastFile }))
    const off = km.ingest ? subscribeIngest(setIngest) : undefined
    return off
  }, [])

  return (
    <div className="flex h-full w-full bg-ink-950">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <IngestBanner activeCount={ingest.activeCount} lastFile={ingest.lastFile} />
        <div className="min-h-0 flex-1">
          <Routes>
            {NAV.map((n) => <Route key={n.to} path={n.to} element={n.el} />)}
            <Route path="*" element={<AskScreen />} />
          </Routes>
        </div>
      </main>
      {onboarding && (
        <OnboardingScreen
          onClose={() => { km.app.markOnboardingShown(); setOnboarding(false) }}
        />
      )}
    </div>
  )
}

function subscribeIngest(set: (v: { activeCount: number; lastFile: string | null }) => void): () => void {
  // The preload exposes ask.onUpdate; ingest ticks arrive on the same push
  // channel under topic 'ingest'. We reuse the generic subscription by
  // listening through a tiny shim on window.
  const handler = (e: MessageEvent): void => { void e }
  window.addEventListener('message', handler)
  // Poll as a robust fallback (push also updates this).
  const t = setInterval(() => {
    km.app.ingestActivity().then((a) => set({ activeCount: a.activeCount, lastFile: a.lastFile })).catch(() => {})
  }, 1500)
  return () => { window.removeEventListener('message', handler); clearInterval(t) }
}

function Sidebar(): JSX.Element {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-ink-800 bg-ink-900/40">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent-soft">RH</div>
        <div>
          <div className="text-sm font-semibold text-ink-50">ReCreateHistory</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500">knowledge OS</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
                isActive ? 'bg-accent/15 text-accent-soft' : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-100'
              )
            }
          >
            <n.icon className="h-4 w-4 shrink-0" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-ink-800 px-4 py-2 text-[10px] text-ink-600">
        local-first · private · Ollama
      </div>
    </aside>
  )
}

function IngestBanner({ activeCount, lastFile }: { activeCount: number; lastFile: string | null }): JSX.Element | null {
  if (activeCount === 0 && !lastFile) return null
  return (
    <div className={clsx('flex items-center gap-2 border-b px-4 py-1.5 text-xs',
      activeCount > 0 ? 'border-amber-900/50 bg-amber-950/20 text-amber-200' : 'border-emerald-900/40 bg-emerald-950/20 text-emerald-300')}>
      {activeCount > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      {activeCount > 0 ? `Ingesting ${activeCount} file${activeCount === 1 ? '' : 's'}…` : 'Ingestion idle'}
      {lastFile && <span className="truncate text-ink-500">· last: {lastFile}</span>}
    </div>
  )
}
