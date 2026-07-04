//
// smokeTest.ts — end-to-end pipeline check (ported in spirit from
// App/SmokeTest.swift). Gated by KM_SMOKE=1. Ingests a fixture, builds the
// ledger, runs a real Ask through the MasterBrain, logs the result, exits.
//

import { app } from 'electron'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AppState } from './appState'
import { log } from '../core/logger'

const FIXTURE = `Project Delta — Program Notes

Project Delta kicked off in early 2025. On 2025-03-14, Acme Corporation signed a
services contract with Globex Ltd for the first delivery phase.

Invoice #INV-1001 for $12,500 was issued on 2025-04-02 and paid on 2025-04-20.

Email from alice@acme.com to bob@globex.com on 2025-04-05 discussed the delivery
schedule. The delivery originally due in April 2025 was delayed to May 2025 after
a components shortage. The final milestone was completed on 2025-05-28.
`

export async function runSmokeTest(appState: AppState): Promise<void> {
  const ok = { entities: false, events: false, answered: false }
  try {
    log.app('SMOKE: writing fixture')
    const dir = mkdtempSync(join(tmpdir(), 'km-smoke-'))
    const file = join(dir, 'project-delta.txt')
    writeFileSync(file, FIXTURE, 'utf8')

    log.app('SMOKE: ingesting fixture')
    await appState.coordinator.ingestPaths([file])

    const inv = appState.inventory()
    log.app(`SMOKE inventory: files=${inv.files} objects=${inv.objects} chunks=${inv.chunks} entities=${inv.entities} events=${inv.events} rels=${inv.relationships} vectors=${inv.vectors}`)
    ok.entities = inv.entities > 0
    ok.events = inv.events > 0

    log.app('SMOKE: asking "What happened with Project Delta and Acme Corporation?"')
    const answer = await appState.brain.ask('What happened with Project Delta and Acme Corporation?')
    log.app(`SMOKE answer: refused=${answer.refused} source=${answer.source} confidence=${answer.confidence.toFixed(2)} citations=${answer.citations.length}`)
    log.app(`SMOKE body: ${answer.body.replace(/\s+/g, ' ').slice(0, 240)}`)
    ok.answered = !answer.refused && answer.citations.length > 0

    const pass = ok.entities && ok.events && ok.answered
    log.app(`SMOKE RESULT: ${pass ? 'PASS' : 'FAIL'} (entities=${ok.entities} events=${ok.events} answered=${ok.answered})`)
    app.exit(pass ? 0 : 1)
  } catch (err) {
    log.app.error('SMOKE crashed', err)
    app.exit(2)
  }
}
