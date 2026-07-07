//
// index.ts — the HTTP entry for the hosted SaaS. Serves the React app + a
// small JSON/SSE API. Every /api call is authenticated and scoped to the
// caller's isolated UserApp. Files are uploaded (browser) → ingested.
//

import express, { type Response } from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import { existsSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { config } from './config'
import { users } from './users'
import { userManager } from './userManager'
import { createHandlers, type HandlerMap, type PushFn } from './domainHandlers'
import type { UserApp } from './userApp'
import { requireAuth, setSessionCookie, clearSessionCookie, userIdFromRequest, type AuthedRequest } from './auth'
import { userUploadsDir } from './paths'
import { limitByIp, limitByUser } from './rateLimit'
import { quotas } from './quotas'
import { emailEnabled, sendEmail, verificationEmail, resetEmail } from './email'
import { termsHtml, privacyHtml } from './legal'
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

// ── Auth (rate-limited by IP; verification enforced when email is on) ──
const verificationRequired = (): boolean => emailEnabled() && config.email.requireVerification

app.post('/api/auth/signup', limitByIp('signup', 10, 15 * 60_000), async (req, res) => {
  try {
    const { email, password, displayName } = req.body ?? {}
    const user = await users.create(String(email ?? ''), String(password ?? ''), displayName)
    if (verificationRequired()) {
      const token = await users.issueVerifyToken(user.id)
      const link = `${config.appUrl}/#/verify?token=${token}`
      const mail = verificationEmail(link)
      await sendEmail(user.email, mail.subject, mail.html)
      res.json({ user: null, verifyEmailSent: true })
      return
    }
    setSessionCookie(res, user.id)
    res.json({ user })
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message ?? err) })
  }
})

app.post('/api/auth/login', limitByIp('login', 15, 15 * 60_000), async (req, res) => {
  const { email, password } = req.body ?? {}
  const user = await users.verify(String(email ?? ''), String(password ?? ''))
  if (!user) { res.status(401).json({ error: 'Invalid email or password.' }); return }
  if (verificationRequired() && !user.emailVerified) {
    res.status(403).json({ error: 'Please verify your email first — check your inbox.' })
    return
  }
  setSessionCookie(res, user.id)
  res.json({ user })
})

app.post('/api/auth/verify-email', limitByIp('verify', 30, 15 * 60_000), async (req, res) => {
  const ok = await users.verifyEmailByToken(String(req.body?.token ?? ''))
  if (!ok) { res.status(400).json({ error: 'Invalid or already-used verification link.' }); return }
  res.json({ ok: true })
})

app.post('/api/auth/request-reset', limitByIp('reset-req', 5, 15 * 60_000), async (req, res) => {
  // Always 200 — never leak whether the account exists.
  const email = String(req.body?.email ?? '')
  if (emailEnabled()) {
    const token = await users.issueResetToken(email)
    if (token) {
      const mail = resetEmail(`${config.appUrl}/#/reset?token=${token}`)
      await sendEmail(email.trim().toLowerCase(), mail.subject, mail.html)
    }
    res.json({ ok: true })
    return
  }
  res.status(501).json({ error: 'Password reset is not available on this deployment (no email provider configured). Contact the operator.' })
})

app.post('/api/auth/reset', limitByIp('reset', 10, 15 * 60_000), async (req, res) => {
  try {
    const ok = await users.resetPassword(String(req.body?.token ?? ''), String(req.body?.password ?? ''))
    if (!ok) { res.status(400).json({ error: 'Invalid or expired reset link. Request a new one.' }); return }
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message ?? err) })
  }
})

app.post('/api/auth/logout', (_req, res) => { clearSessionCookie(res); res.json({ ok: true }) })

app.get('/api/auth/me', async (req, res) => {
  const uid = userIdFromRequest(req)
  const user = uid ? await users.getById(uid) : null
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
const ASK_PATHS = new Set(['ask.ask', 'ask.start', 'notebook.run'])

app.post('/api/invoke', requireAuth, limitByUser('invoke', 240, 60_000), async (req: AuthedRequest, res) => {
  const { path, args } = req.body ?? {}
  if (typeof path !== 'string') { res.status(400).json({ error: 'bad request' }); return }
  // Daily LLM-answer cap — protects the operator's compute/API credits.
  if (ASK_PATHS.has(path)) {
    const q = await quotas.tryConsumeAsk(req.userId!)
    if (!q.ok) {
      res.status(429).json({ error: `Daily question limit reached (${q.limit}/day). Resets at midnight UTC.` })
      return
    }
  }
  const userApp = await userManager.getOrCreate(req.userId!)
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
app.post('/api/upload', requireAuth, limitByUser('upload', 60, 60 * 60_000), async (req: AuthedRequest, res, next) => {
  // Reject before accepting bytes when the user is already at quota.
  const pre = await quotas.storageAllows(req.userId!, 0)
  if (!pre.ok) {
    res.status(413).json({ error: `Storage quota reached (${Math.round(pre.limitBytes / 1048576)} MB). Delete files to free space.` })
    return
  }
  next()
}, upload.array('files', 200), async (req: AuthedRequest, res) => {
  const files = (req.files as Express.Multer.File[]) ?? []
  const total = files.reduce((a, f) => a + f.size, 0)
  const check = await quotas.storageAllows(req.userId!, total)
  if (!check.ok) {
    for (const f of files) { try { unlinkSync(f.path) } catch { /* best effort */ } }
    res.status(413).json({ error: `Upload exceeds your storage quota (${Math.round(check.limitBytes / 1048576)} MB).` })
    return
  }
  await quotas.recordStorage(req.userId!, total)
  // On Vercel, /tmp is per-invocation: ingest NOW, in this request, so the
  // bytes reach the user's Turso ledger before the sandbox evaporates.
  if (process.env.VERCEL) {
    const userApp = await userManager.getOrCreate(req.userId!)
    const paths = files.map((f) => f.path)
    const resIngest = await userApp.coordinator.ingestPaths(paths)
    await userApp.postIngest()
    res.json({ paths, names: files.map((f) => f.originalname), ingested: true, result: resIngest })
    return
  }
  res.json({ paths: files.map((f) => f.path), names: files.map((f) => f.originalname) })
})

// ── Legal pages ──
app.get('/terms', (_req, res) => res.type('html').send(termsHtml))
app.get('/privacy', (_req, res) => res.type('html').send(privacyHtml))

// ── Static (prod): serve the built renderer ──
const publicDir = resolve('dist/public')
if (existsSync(publicDir)) {
  app.use(express.static(publicDir))
  app.get('*', (_req, res) => res.sendFile(join(publicDir, 'index.html')))
} else {
  app.get('/', (_req, res) => res.type('text').send('ReCreateHistory API running. In dev, open the Vite server at http://localhost:5173'))
}

// Vercel imports the app (api/index.ts); only self-host runs a listener.
export default app

const server = process.env.VERCEL ? null : app.listen(config.port, () => {
  log.app(`ReCreateHistory web on http://localhost:${config.port} (${config.isProd ? 'prod' : 'dev'})`)
  log.app(`AI: ollama=${config.ollama.baseURL} (${config.ollama.model}) cloud=${config.cloud.provider}`)
  users.count().then((n) => { if (n === 0) log.app('No users yet — sign up on the site to create the first account.') }).catch(() => {})
})

process.on('SIGTERM', () => { userManager.closeAll(); server?.close(() => process.exit(0)) })
process.on('SIGINT', () => { userManager.closeAll(); server?.close(() => process.exit(0)) })
