//
// storage/index.ts — the Repos aggregate. AppState builds one of these after
// migration and hands it to every downstream layer (ingestion, knowledge,
// retrieval, brain, IPC handlers).
//

import { Ledger } from './database'
import { VectorStore } from './vectorStore'
import {
  FilesRepo, ObjectsRepo, ChunksRepo, EntitiesRepo, EventsRepo, RelationshipsRepo,
  MemoryRepo, SummariesRepo, ConversationsRepo, SavedQueriesRepo, InvestigationsRepo,
  AssertionsRepo, EventLinksRepo
} from './repositories'

export class Repos {
  readonly ledger: Ledger
  readonly files: FilesRepo
  readonly objects: ObjectsRepo
  readonly chunks: ChunksRepo
  readonly entities: EntitiesRepo
  readonly events: EventsRepo
  readonly relationships: RelationshipsRepo
  readonly memory: MemoryRepo
  readonly summaries: SummariesRepo
  readonly conversations: ConversationsRepo
  readonly saved: SavedQueriesRepo
  readonly investigations: InvestigationsRepo
  readonly assertions: AssertionsRepo
  readonly eventLinks: EventLinksRepo
  readonly vectors: VectorStore

  constructor(dbPath: string) {
    this.ledger = new Ledger(dbPath)
    this.ledger.migrate()
    this.files = new FilesRepo(this.ledger)
    this.objects = new ObjectsRepo(this.ledger)
    this.chunks = new ChunksRepo(this.ledger)
    this.entities = new EntitiesRepo(this.ledger)
    this.events = new EventsRepo(this.ledger)
    this.relationships = new RelationshipsRepo(this.ledger)
    this.memory = new MemoryRepo(this.ledger)
    this.summaries = new SummariesRepo(this.ledger)
    this.conversations = new ConversationsRepo(this.ledger)
    this.saved = new SavedQueriesRepo(this.ledger)
    this.investigations = new InvestigationsRepo(this.ledger)
    this.assertions = new AssertionsRepo(this.ledger)
    this.eventLinks = new EventLinksRepo(this.ledger)
    this.vectors = new VectorStore(this.ledger)
  }

  close(): void {
    this.ledger.close()
  }
}

export { Ledger } from './database'
export * from './repositories'
export { VectorStore } from './vectorStore'
