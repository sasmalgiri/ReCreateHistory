// Full-stack HTTP smoke: signup → upload → ingest → ask, over the real API.
// Assumes the server is already listening on BASE. Exits 0 on PASS.

const BASE = process.env.BASE || 'http://localhost:8787'
let cookie = ''

async function jpost(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  })
  const set = res.headers.getSetCookie?.() ?? []
  if (set.length) cookie = set[0].split(';')[0]
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${data.error ?? ''}`)
  return data
}

const invoke = (p, ...args) => jpost('/api/invoke', { path: p, args }).then((d) => d.result)

const FIXTURE = `Project Delta — Program Notes

On 2025-03-14, Acme Corporation signed a services contract with Globex Ltd.
Invoice #INV-1001 for $12,500 was issued on 2025-04-02 and paid on 2025-04-20.
Email from alice@acme.com to bob@globex.com on 2025-04-05 discussed the delivery,
which was delayed to May 2025. The final milestone completed on 2025-05-28.`

async function main() {
  const email = `smoke_${Date.now()}@example.com`
  await jpost('/api/auth/signup', { email, password: 'password123', displayName: 'Smoke' })
  console.log('SMOKE signup OK', email)

  // Upload the fixture as a file.
  const form = new FormData()
  form.append('files', new Blob([FIXTURE], { type: 'text/plain' }), 'project-delta.txt')
  const up = await fetch(BASE + '/api/upload', { method: 'POST', headers: { Cookie: cookie }, body: form })
  const upData = await up.json()
  if (!up.ok || !upData.paths?.length) throw new Error('upload failed: ' + JSON.stringify(upData))
  console.log('SMOKE upload OK', upData.paths.length, 'file(s)')

  await invoke('ingest.addPaths', upData.paths)

  // Poll inventory until the ledger is built.
  let inv
  for (let i = 0; i < 30; i++) {
    inv = await invoke('app.inventory')
    if (inv.events > 0 && inv.entities > 0) break
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log(`SMOKE inventory: objects=${inv.objects} entities=${inv.entities} events=${inv.events} vectors=${inv.vectors}`)

  const answer = await invoke('ask.ask', 'What happened with Project Delta and Acme Corporation?')
  console.log(`SMOKE answer: refused=${answer.refused} source=${answer.source} confidence=${answer.confidence?.toFixed?.(2)} citations=${answer.citations.length}`)

  // Isolation check: a second fresh account must see an empty ledger.
  cookie = ''
  await jpost('/api/auth/signup', { email: `other_${Date.now()}@example.com`, password: 'password123' })
  const inv2 = await invoke('app.inventory')
  console.log(`SMOKE isolation: second user objects=${inv2.objects} events=${inv2.events} (expect 0)`)

  // ── Hardening checks ──
  // 1. Login brute-force rate limit: hammer wrong passwords until 429.
  let got429 = false
  for (let i = 0; i < 20; i++) {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrongwrong' })
    })
    if (r.status === 429) { got429 = true; break }
  }
  console.log(`SMOKE rate-limit: login brute force ${got429 ? 'blocked (429)' : 'NOT blocked'}`)

  // 2. Reset endpoint: no email provider configured → clear 501, not a crash.
  const rr = await fetch(BASE + '/api/auth/request-reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.com' })
  })
  const resetOk = rr.status === 501 || rr.status === 200
  console.log(`SMOKE reset endpoint: HTTP ${rr.status} (${resetOk ? 'ok' : 'unexpected'})`)

  // 3. Legal pages served.
  const terms = await fetch(BASE + '/terms')
  const legalOk = terms.ok && (await terms.text()).includes('Terms of Service')
  console.log(`SMOKE legal pages: ${legalOk ? 'served' : 'MISSING'}`)

  const pass = inv.entities > 0 && inv.events > 0 && !answer.refused && answer.citations.length > 0 &&
    inv2.objects === 0 && got429 && resetOk && legalOk
  console.log(`SMOKE HTTP RESULT: ${pass ? 'PASS' : 'FAIL'}`)
  process.exit(pass ? 0 : 1)
}

main().catch((e) => { console.error('SMOKE crashed:', e.message); process.exit(2) })
