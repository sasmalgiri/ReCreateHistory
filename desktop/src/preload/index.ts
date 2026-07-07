//
// preload — the ONLY bridge between renderer and main. Exposes a typed
// `window.km` object. Every method is a thin invoke() over IPC; there is
// no direct Node access in the renderer (contextIsolation stays on).
//

import { contextBridge, ipcRenderer } from 'electron'
import { INVOKE_CHANNEL, PUSH_CHANNEL } from '../shared/ipc'
import type { KalsmritikoshApi, AskUpdate } from '../shared/ipc'

function call<T>(path: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(INVOKE_CHANNEL, path, args) as Promise<T>
}

function subscribe(topic: string, cb: (payload: unknown) => void): () => void {
  const listener = (_e: unknown, msg: { topic: string; payload: unknown }): void => {
    if (msg && msg.topic === topic) cb(msg.payload)
  }
  ipcRenderer.on(PUSH_CHANNEL, listener as never)
  return () => ipcRenderer.removeListener(PUSH_CHANNEL, listener as never)
}

const api: KalsmritikoshApi = {
  app: {
    status: () => call('app.status'),
    inventory: () => call('app.inventory'),
    ingestActivity: () => call('app.ingestActivity'),
    markOnboardingShown: () => call('app.markOnboardingShown'),
    openPath: (p) => call('app.openPath', p)
  },
  ingest: {
    pickFiles: () => call('ingest.pickFiles'),
    pickFolder: () => call('ingest.pickFolder'),
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
  live: {
    sample: () => call('live.sample')
  },
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

contextBridge.exposeInMainWorld('km', api)
