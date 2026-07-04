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

async function main(): Promise<void> {
  const app = new UserApp('smoke-user')
  const dir = mkdtempSync(join(tmpdir(), 'km-web-fixture-'))
  const file = join(dir, 'project-delta.txt')
  writeFileSync(file, FIXTURE, 'utf8')

  log.app('SMOKE: ingesting fixture')
  await app.coordinator.ingestPaths([file])
  await app.postIngest()

  const inv = app.inventory()
  log.app(`SMOKE inventory: objects=${inv.objects} chunks=${inv.chunks} entities=${inv.entities} events=${inv.events} rels=${inv.relationships}`)

  const answer = await app.brain.ask('What happened with Project Delta and Acme Corporation?')
  log.app(`SMOKE answer: refused=${answer.refused} source=${answer.source} confidence=${answer.confidence.toFixed(2)} citations=${answer.citations.length}`)
  log.app(`SMOKE body: ${answer.body.replace(/\s+/g, ' ').slice(0, 200)}`)

  const pass = inv.entities > 0 && inv.events > 0 && !answer.refused && answer.citations.length > 0
  log.app(`SMOKE RESULT: ${pass ? 'PASS' : 'FAIL'}`)
  app.close()
  process.exit(pass ? 0 : 1)
}

main().catch((err) => { console.error('SMOKE crashed', err); process.exit(2) })
