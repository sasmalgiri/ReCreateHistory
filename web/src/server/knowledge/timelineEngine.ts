//
// timelineEngine.ts — named views over events, built on read. Ported from
// Knowledge/Timelines/TimelineEngine.swift. The Timeline is the product's
// core moat: dated events, grouped and enriched with causal links.
//

import type { Repos } from '../storage'
import type { KEvent, UUID } from '../../shared/models'

export interface TimelinePeriod {
  label: string // e.g. "2025-03"
  events: KEvent[]
}

export class TimelineEngine {
  constructor(private repos: Repos) {}

  async events(query: { start?: number | null; end?: number | null; entityID?: UUID | null; limit?: number }): Promise<KEvent[]> {
    let events = query.entityID
      ? await this.repos.events.forEntity(query.entityID, query.limit ?? 400)
      : await this.repos.events.inRange(query.start, query.end, query.limit ?? 400)
    if (query.entityID && (query.start || query.end)) {
      const s = query.start ?? -8.64e15, e = query.end ?? 8.64e15
      events = events.filter((ev) => ev.date >= s && ev.date <= e)
    }
    return events
  }

  groupByMonth(events: KEvent[]): TimelinePeriod[] {
    const map = new Map<string, KEvent[]>()
    for (const e of events) {
      const label = new Date(e.date).toISOString().slice(0, 7)
      const arr = map.get(label) ?? []
      arr.push(e)
      map.set(label, arr)
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([label, evs]) => ({ label, events: evs.sort((a, b) => b.date - a.date) }))
  }
}
