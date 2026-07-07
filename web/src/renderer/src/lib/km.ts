//
// km.ts (web) — the SAME KalsmritikoshApi surface the desktop screens expect,
// but backed by HTTP + SSE instead of Electron IPC. Every screen imports `km`
// unchanged; only the transport differs. File picking uploads to the server.
//

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KalsmritikoshApi, AskUpdate } from '../../../shared/ipc'

// ── Core transport ──────────────────────────────────────────────────────

async function call<T>(path: string, ...args: unknown[]): Promise<T> {
  const res = await fetch('/api/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ path, args })
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return (await res.json()).result as T
}

// One shared SSE stream, fanned out to topic listeners.
type Listener = (payload: unknown) => void
const topicListeners = new Map<string, Set<Listener>>()
let es: EventSource | null = null

function ensureStream(): void {
  if (es) return
  es = new EventSource('/api/events', { withCredentials: true })
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data) as { topic: string; payload: unknown }
      topicListeners.get(msg.topic)?.forEach((cb) => cb(msg.payload))
    } catch {
      /* ignore malformed */
    }
  }
  es.onerror = () => {
    /* EventSource auto-reconnects */
  }
}

function subscribe(topic: string, cb: Listener): () => void {
  ensureStream()
  let set = topicListeners.get(topic)
  if (!set) { set = new Set(); topicListeners.set(topic, set) }
  set.add(cb)
  return () => { set!.delete(cb) }
}

// ── Browser file upload (stands in for native file dialogs) ──────────────

function chooseAndUpload(multiple: boolean): Promise<string[]> {
  return new Promise((resolvePromise) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = async () => {
      const files = Array.from(input.files ?? [])
      input.remove()
      if (!files.length) { resolvePromise([]); return }
      const form = new FormData()
      for (const f of files) form.append('files', f)
      const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: form })
      if (!res.ok) { resolvePromise([]); return }
      const data = (await res.json()) as { paths: string[] }
      resolvePromise(data.paths)
    }
    input.click()
  })
}

// Exposed so the web SourcesScreen can upload + ingest in one step.
export async function uploadAndIngest(): Promise<number> {
  const paths = await chooseAndUpload(true)
  if (!paths.length) return 0
  await km.ingest.addPaths(paths)
  return paths.length
}

// ── The API object (mirrors the desktop preload bridge) ──────────────────

export const km: KalsmritikoshApi = {
  app: {
    status: () => call('app.status'),
    inventory: () => call('app.inventory'),
    ingestActivity: () => call('app.ingestActivity'),
    markOnboardingShown: () => call('app.markOnboardingShown'),
    openPath: () => call('app.openPath')
  },
  ingest: {
    pickFiles: () => chooseAndUpload(true),
    pickFolder: async () => null,
    addPaths: (paths) => call('ingest.addPaths', paths),
    listFiles: (limit) => call('ingest.listFiles', limit),
    reingest: (id) => call('ingest.reingest', id),
    remove: (id) => call('ingest.remove', id),
    roots: () => call('ingest.roots'),
    addRoot: (p) => call('ingest.addRoot', p),
    removeRoot: (p) => call('ingest.removeRoot', p)
  },
  ask: {
    ask: (q) => call('ask.ask', q),
    start: (q) => call('ask.start', q),
    onUpdate: (cb) => subscribe('ask', (p) => cb(p as AskUpdate)),
    conversations: () => call('ask.conversations'),
    detectIntent: (q) => call('ask.detectIntent', q),
    retrieveOnly: (q) => call('ask.retrieveOnly', q)
  },
  search: {
    query: (t, limit) => call('search.query', t, limit),
    semantic: (t, limit) => call('search.semantic', t, limit)
  },
  timeline: {
    events: (q) => call('timeline.events', q),
    eventDetail: (id) => call('timeline.eventDetail', id),
    causalLinks: (id) => call('timeline.causalLinks', id)
  },
  knowledge: {
    entities: (kind, limit) => call('knowledge.entities', kind, limit),
    events: (limit) => call('knowledge.events', limit),
    memories: () => call('knowledge.memories'),
    summaries: (level) => call('knowledge.summaries', level),
    objects: (limit) => call('knowledge.objects', limit),
    objectContent: (id) => call('knowledge.objectContent', id)
  },
  dossier: {
    forEntity: (id) => call('dossier.forEntity', id),
    search: (name) => call('dossier.search', name)
  },
  graph: {
    neighborhood: (id, hops) => call('graph.neighborhood', id, hops),
    topEntities: (limit) => call('graph.topEntities', limit)
  },
  assertions: {
    list: (subjectID) => call('assertions.list', subjectID),
    add: (a) => call('assertions.add', a),
    retract: (id) => call('assertions.retract', id)
  },
  notebook: {
    list: () => call('notebook.list'),
    get: (id) => call('notebook.get', id),
    run: (q) => call('notebook.run', q),
    remove: (id) => call('notebook.remove', id)
  },
  saved: {
    list: () => call('saved.list'),
    add: (q, title, notes) => call('saved.add', q, title, notes),
    remove: (id) => call('saved.remove', id),
    touch: (id) => call('saved.touch', id)
  },
  live: { sample: () => call('live.sample') },
  ledger: {
    blocks: (objectID) => call('ledger.blocks', objectID),
    claims: (objectID, limit) => call('ledger.claims', objectID, limit),
    contradictions: () => call('ledger.contradictions'),
    contradictionDetail: (id) => call('ledger.contradictionDetail', id),
    missingProof: () => call('ledger.missingProof'),
    factMatrix: () => call('ledger.factMatrix'),
    ingestionRuns: (limit) => call('ledger.ingestionRuns', limit),
    eventsByStatus: (status, limit) => call('ledger.eventsByStatus', status, limit),
    reviewEvent: (id, status) => call('ledger.reviewEvent', id, status),
    exportReport: () => call('ledger.exportReport')
  },
  convert: {
    file: (p) => call('convert.file', p),
    text: (t, from, to) => call('convert.text', t, from, to)
  },
  settings: {
    get: () => call('settings.get'),
    set: (patch) => call('settings.set', patch),
    providers: () => call('settings.providers'),
    ollamaModels: () => call('settings.ollamaModels'),
    setCloudKey: (k) => call('settings.setCloudKey', k)
  }
}

// ── useAsync (identical to the desktop hook) ─────────────────────────────

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const run = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fnRef.current()
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const cleanup = run()
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, loading, error, reload: run }
}
