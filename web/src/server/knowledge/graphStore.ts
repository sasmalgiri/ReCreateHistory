//
// graphStore.ts — traversal over the relationship edges. Ported from
// Knowledge/Graph/GraphStore.swift. Powers the Explorer graph view and the
// Dossier neighbor list.
//

import type { Repos } from '../storage'
import type { UUID } from '../../shared/models'
import type { GraphNeighborhood, GraphNode, GraphEdge } from '../../shared/ipc'

export class GraphStore {
  constructor(private repos: Repos) {}

  async neighborhood(entityID: UUID, hops = 1): Promise<GraphNeighborhood> {
    const nodes = new Map<UUID, GraphNode>()
    const edges: GraphEdge[] = []
    const seenEdge = new Set<string>()

    const addNode = async (id: UUID): Promise<void> => {
      if (nodes.has(id)) return
      const e = await this.repos.entities.byID(id)
      if (e) nodes.set(id, { id, label: e.value, kind: e.kind, weight: await this.repos.entities.mentionCount(id) })
    }

    await addNode(entityID)
    let frontier = [entityID]
    for (let h = 0; h < hops; h++) {
      const next: UUID[] = []
      for (const id of frontier) {
        for (const rel of await this.repos.relationships.forEntity(id, 40)) {
          const other = rel.fromEntityID === id ? rel.toEntityID : rel.fromEntityID
          await addNode(other)
          const key = [rel.fromEntityID, rel.toEntityID, rel.kind].join('|')
          if (!seenEdge.has(key)) {
            seenEdge.add(key)
            edges.push({ from: rel.fromEntityID, to: rel.toEntityID, kind: rel.kind, weight: rel.weight })
          }
          if (!nodes.has(other)) next.push(other)
          else if (h === 0) next.push(other)
        }
      }
      frontier = next
    }
    return { nodes: [...nodes.values()], edges }
  }

  async topEntities(limit = 40): Promise<GraphNode[]> {
    const list = await this.repos.entities.list(undefined, limit)
    return Promise.all(list.map(async (e) => ({
      id: e.id, label: e.value, kind: e.kind, weight: await this.repos.entities.mentionCount(e.id)
    })))
  }
}
