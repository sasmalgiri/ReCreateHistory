//
// smoke.ts — verifies the reused backend works in the Node/server context for a
// single UserApp: ingest a fixture → build the ledger → run a real Ask. Run
// with `npm run smoke`. Uses a throwaway DATA_DIR so it never touches real data.
//

import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'km-web-smoke-'))

const { UserApp } = await import('./userApp')
const { log } = await import('./core/logger')

const FIXTURE = `Project Delta — Program Notes

Project Delta kicked off in early 2025. On 2025-03-14, Acme Corporation signed a
services contract with Globex Ltd for the first delivery phase.

Invoice #INV-1001 for $12,500 was issued on 2025-04-02 and paid on 2025-04-20.

Email from alice@acme.com to bob@globex.com on 2025-04-05 discussed the delivery
schedule. The delivery originally due in April 2025 was delayed to May 2025 after
a components shortage. The final milestone was completed on 2025-05-28.
`

// Second source: corroborates the contract signing (same date) but CONTRADICTS
// the completion date (May 30 vs May 28) — exercises corroboration counting
// and the persisted contradiction ledger.
const FIXTURE2 = `Delta Program — Status Memo

On 2025-03-14, Acme Corporation signed a services contract with Globex Ltd for the first delivery phase.

The final milestone was completed on 2025-05-30.
`

// A small CSV exercises the structured table-row path.
const FIXTURE_CSV = `Invoice ID,Amount,Due Date,Status
INV-1001,"$12,500",2025-04-30,Paid
INV-1002,"$8,000",2025-06-15,Open
`

async function main(): Promise<void> {
  const app = await UserApp.create('smoke-user')
  const dir = mkdtempSync(join(tmpdir(), 'km-web-fixture-'))
  const file = join(dir, 'project-delta.txt')
  const file2 = join(dir, 'delta-status-memo.txt')
  const fileCsv = join(dir, 'invoices.csv')
  writeFileSync(file, FIXTURE, 'utf8')
  writeFileSync(file2, FIXTURE2, 'utf8')
  writeFileSync(fileCsv, FIXTURE_CSV, 'utf8')

  // Exact duplicate under a different name — must dedup by SHA-256, not re-parse.
  const fileDup = join(dir, 'project-delta-copy.txt')
  writeFileSync(fileDup, FIXTURE, 'utf8')

  log.app('SMOKE: ingesting 4 fixtures (txt + contradicting memo + csv + exact duplicate)')
  await app.coordinator.ingestPaths([file, file2, fileCsv, fileDup])
  await app.postIngest()

  const inv = await app.inventory()
  log.app(`SMOKE inventory: objects=${inv.objects} chunks=${inv.chunks} entities=${inv.entities} events=${inv.events} rels=${inv.relationships}`)

  // ── Evidence ledger assertions ──
  const { factMatrix, missingProof } = await import('./knowledge/factStatus')
  const blocks = await app.repos.blocks.count()
  const claims = await app.repos.claims.count()
  const rows = await app.repos.tableRows.count()
  const contradictions = await app.repos.contradictions.list()
  const matrix = await factMatrix(app.repos)
  const missing = await missingProof(app.repos)
  const runs = await app.repos.ingestionRuns.list(10)
  const dupRuns = runs.filter((r) => r.status === 'duplicate')
  const audits = await app.repos.answerAudits.count()
  log.app(`SMOKE ledger: blocks=${blocks} claims=${claims} tableRows=${rows} runs=${runs.length} (${runs.map((r) => r.status).join(',')})`)
  log.app(`SMOKE matrix: observed=${matrix.observed} asserted=${matrix.asserted} derived=${matrix.derived} inferred=${matrix.inferred} contradicted=${matrix.contradicted} corroborated=${matrix.corroborated}`)
  log.app(`SMOKE contradictions(${contradictions.length}): ${contradictions.map((c) => c.explanation.slice(0, 90)).join(' || ') || '(none)'}`)
  log.app(`SMOKE missingProof(${missing.length}): ${missing.slice(0, 3).map((m) => m.kind).join(', ')}`)

  const answer = await app.brain.ask('What happened with Project Delta and Acme Corporation, and who approved the budget?')
  log.app(`SMOKE answer: refused=${answer.refused} source=${answer.source} confidence=${answer.confidence.toFixed(2)} citations=${answer.citations.length} coverage=${answer.report?.coverage?.toFixed(2)}`)
  log.app(`SMOKE answer contradictions surfaced: ${answer.contradictions.length}`)
  log.app(`SMOKE gaps(${answer.gaps.length}): ${answer.gaps.join(' | ') || '(none)'}`)
  log.app(`SMOKE body: ${answer.body.replace(/\s+/g, ' ').slice(0, 260)}`)

  log.app(`SMOKE classification: ${answer.classification ?? '(none)'} | audits=${await app.repos.answerAudits.count()}`)

  const checks: [string, boolean][] = [
    ['entities extracted', inv.entities > 0],
    ['events reconstructed', inv.events > 0],
    ['evidence blocks persisted', blocks > 0],
    ['claims extracted', claims > 0],
    ['table rows structured', rows >= 2],
    ['ingestion runs recorded', runs.length >= 3],
    ['corroboration detected', matrix.corroborated >= 1],
    ['contradiction persisted', contradictions.length >= 1],
    ['answer not refused', !answer.refused],
    ['answer cited', answer.citations.length > 0],
    ['contradiction surfaced in answer', answer.contradictions.length >= 1],
    ['exact duplicate deduplicated (SHA-256)', dupRuns.length >= 1],
    ['answer classified (§18)', !!answer.classification],
    ['answer audit ledger written', (await app.repos.answerAudits.count()) > audits - 1 && (await app.repos.answerAudits.count()) >= 1]
  ]
  for (const [name, ok] of checks) log.app(`SMOKE check: ${ok ? 'PASS' : 'FAIL'} — ${name}`)
  const pass = checks.every(([, ok]) => ok)
  log.app(`SMOKE RESULT: ${pass ? 'PASS' : 'FAIL'}`)
  app.close()
  process.exit(pass ? 0 : 1)
}

main().catch((err) => { console.error('SMOKE crashed', err); process.exit(2) })
