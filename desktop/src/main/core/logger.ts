//
// logger.ts — the AtlasLog equivalent. Category-tagged console logging.
// Every catch block in the backend should log through here.
//

type Category =
  | 'app' | 'storage' | 'ingestion' | 'knowledge' | 'retrieval'
  | 'routing' | 'brain' | 'ipc'

function emit(cat: Category, level: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 23)
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [${cat}] ${level} ${msg}`)
}

function make(cat: Category): {
  (msg: string): void
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string, err?: unknown) => void
  debug: (msg: string) => void
} {
  const fn = (msg: string): void => emit(cat, 'INFO', msg)
  fn.info = (msg: string): void => emit(cat, 'INFO', msg)
  fn.warn = (msg: string): void => emit(cat, 'WARN', msg)
  fn.error = (msg: string, err?: unknown): void =>
    emit(cat, 'ERROR', err ? `${msg} :: ${String(err)}` : msg)
  fn.debug = (msg: string): void => emit(cat, 'DEBUG', msg)
  return fn
}

export const log = {
  app: make('app'),
  storage: make('storage'),
  ingestion: make('ingestion'),
  knowledge: make('knowledge'),
  retrieval: make('retrieval'),
  routing: make('routing'),
  brain: make('brain'),
  ipc: make('ipc')
}
