//
// index.ts — the HTTP entry for the hosted SaaS. Serves the React app + a
// small JSON/SSE API. Every /api call is authenticated and scoped to the
// caller's isolated UserApp. Files are uploaded (browser) → ingested.
//

import express, { type Response } from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { config } from './config'
import { users } from './users'
import { userManager } from './userManager'
import { createHandlers, type HandlerMap, type PushFn } from './domainHandlers'
import type { UserApp } from './userApp'
import { requireAuth, setSessionCookie, clearSessionCookie, userIdFromRequest, type AuthedRequest } from './auth'
import { userUploadsDir } from './paths'
import { log } from './core/logger'

// ── SSE hub: push events (ask streaming, ingest ticks) to a user's tabs ──
const sseClients = new Map<string, Set<Response>>()
function pushToUser(userId: string, topic: string, payload: unknown): void {
  const set = sseClients.get(userId)
  if (!set) return
  const line = `data: ${JSON.stringify({ topic, payload })}\n\n`
  for (const res of set) { try { res.write(line) } catch { /* dropped */ } }
}

// ── Per-user handler map, built once per UserApp ──
const handlerCache = new WeakMap<UserApp, HandlerMap>()
function handlersFor(app: UserApp): HandlerMap {
  let h = handlerCache.get(app)
  if (!h) {
    const push: PushFn = (topic, payload) => pushToUser(app.userId, topic, payload)
    h = createHandlers(app, push)
    handlerCache.set(app, h)
  }
  return h
}

const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

// ── Auth ──
app.post('/api/auth/signup', (req, res) => {
  try {
    const { email, password, displayName } = req.body ?? {}
    const user = users.create(String(email ?? ''), String(password ?? ''), displayName)
    setSessionCookie(res, user.id)
    res.json({ user })
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message ?? err) })
  }
})

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body ?? {}
  const user = users.verify(String(email ?? ''), String(password ?? ''))
  if (!user) { res.status(401).json({ error: 'Invalid email or password.' }); return }
  setSessionCookie(res, user.id)
  res.json({ user })
})

app.post('/api/auth/logout', (_req, res) => { clearSessionCookie(res); res.json({ ok: true }) })

app.get('/api/auth/me', (req, res) => {
  const uid = userIdFromRequest(req)
  const user = uid ? users.getById(uid) : null
  if (!user) { res.status(401).json({ error: 'unauthenticated' }); return }
  res.json({ user })
})

// ── Live events (SSE) ──
app.get('/api/events', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.userId!
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders?.()
  res.write(': connected\n\n')
  let set = sseClients.get(userId)
  if (!set) { set = new Set(); sseClients.set(userId, set) }
  set.add(res)
  const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 25000)
  req.on('close', () => { clearInterval(ping); set!.delete(res); if (set!.size === 0) sseClients.delete(userId) })
})

// ── The unified RPC surface (same as desktop window.km) ──
app.post('/api/invoke', requireAuth, async (req: AuthedRequest, res) => {
  const { path, args } = req.body ?? {}
  if (typeof path !== 'string') { res.status(400).json({ error: 'bad request' }); return }
  const userApp = userManager.get(req.userId!)
  const handlers = handlersFor(userApp)
  const fn = handlers[path]
  if (!fn) { res.status(404).json({ error: `Unknown method: ${path}` }); return }
  try {
    const result = await fn(...(Array.isArray(args) ? args : []))
    res.json({ result })
  } catch (err) {
    log.ipc.error(`invoke ${path} failed`, err)
    res.status(500).json({ error: String((err as Error).message ?? err) })
  }
})

// ── File upload → ingest ──
const upload = multer({
  storage: multer.diskStorage({
    destination: (req: AuthedRequest, _file, cb) => cb(null, userUploadsDir(req.userId!)),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.\- ]+/g, '_')}`)
  }),
  limits: { fileSize: config.maxUploadBytes }
})
app.post('/api/upload', requireAuth, upload.array('files', 200), (req: AuthedRequest, res) => {
  const files = (req.files as Express.Multer.File[]) ?? []
  res.json({ paths: files.map((f) => f.path), names: files.map((f) => f.originalname) })
})

// ── Static (prod): serve the built renderer ──
const publicDir = resolve('dist/public')
if (existsSync(publicDir)) {
  app.use(express.static(publicDir))
  app.get('*', (_req, res) => res.sendFile(join(publicDir, 'index.html')))
} else {
  app.get('/', (_req, res) => res.type('text').send('ReCreateHistory API running. In dev, open the Vite server at http://localhost:5173'))
}

const server = app.listen(config.port, () => {
  log.app(`ReCreateHistory web on http://localhost:${config.port} (${config.isProd ? 'prod' : 'dev'})`)
  log.app(`AI: ollama=${config.ollama.baseURL} (${config.ollama.model}) cloud=${config.cloud.provider}`)
  if (users.count() === 0) log.app('No users yet — sign up on the site to create the first account.')
})

process.on('SIGTERM', () => { userManager.closeAll(); server.close(() => process.exit(0)) })
process.on('SIGINT', () => { userManager.closeAll(); server.close(() => process.exit(0)) })
