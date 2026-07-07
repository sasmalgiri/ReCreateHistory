//
// storage/index.ts — the Repos aggregate. AppState builds one of these after
// migration and hands it to every downstream layer (ingestion, knowledge,
// retrieval, brain, IPC handlers).
//

import { Ledger } from './database'
import type { LedgerOpts } from './database'
import { VectorStore } from './vectorStore'
import {
  FilesRepo, ObjectsRepo, ChunksRepo, EntitiesRepo, EventsRepo, RelationshipsRepo,
  MemoryRepo, SummariesRepo, ConversationsRepo, SavedQueriesRepo, InvestigationsRepo,
  AssertionsRepo, EventLinksRepo, BlocksRepo, ClaimsRepo, ContradictionsRepo,
  IngestionRunsRepo, TableRowsRepo, ReviewsRepo, AnswerAuditsRepo
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
  // Evidence Ledger (v28–v31)
  readonly blocks: BlocksRepo
  readonly claims: ClaimsRepo
  readonly contradictions: ContradictionsRepo
  readonly ingestionRuns: IngestionRunsRepo
  readonly tableRows: TableRowsRepo
  readonly reviews: ReviewsRepo
  readonly answerAudits: AnswerAuditsRepo

  static async open(opts: LedgerOpts): Promise<Repos> {
    const ledger = new Ledger(opts)
    await ledger.migrate()
    return new Repos(ledger)
  }

  private constructor(ledger: Ledger) {
    this.ledger = ledger
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
    this.blocks = new BlocksRepo(this.ledger)
    this.claims = new ClaimsRepo(this.ledger)
    this.contradictions = new ContradictionsRepo(this.ledger)
    this.ingestionRuns = new IngestionRunsRepo(this.ledger)
    this.tableRows = new TableRowsRepo(this.ledger)
    this.reviews = new ReviewsRepo(this.ledger)
    this.answerAudits = new AnswerAuditsRepo(this.ledger)
  }

  close(): void {
    this.ledger.close()
  }
}

export { Ledger } from './database'
export * from './repositories'
export { VectorStore } from './vectorStore'
