//
// migrations.ts — versioned DDL, ported verbatim from SchemaMigrations.swift.
// Append-only: never edit a shipped migration; add a new one. Each bumps
// user_version and is applied exactly once inside a SAVEPOINT.
//

export const LATEST_SCHEMA_VERSION = 27

const v1 = `
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY NOT NULL, url TEXT NOT NULL, source_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0, modified_at REAL NOT NULL DEFAULT 0,
    ingested_at REAL, content_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_url ON files(url);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(source_type);

CREATE TABLE IF NOT EXISTS knowledge_objects (
    id TEXT PRIMARY KEY NOT NULL, file_id TEXT NOT NULL, source_type TEXT NOT NULL,
    content TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 1.0, created_at REAL NOT NULL, updated_at REAL NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ko_file ON knowledge_objects(file_id);

CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY NOT NULL, object_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    text TEXT NOT NULL, char_start INTEGER NOT NULL, char_end INTEGER NOT NULL,
    page_number INTEGER, created_at REAL NOT NULL,
    FOREIGN KEY (object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_object ON chunks(object_id);

CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, normalized TEXT,
    source_object_id TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (source_object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);
CREATE INDEX IF NOT EXISTS idx_entities_norm ON entities(normalized);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, date REAL NOT NULL, end_date REAL,
    title TEXT NOT NULL, summary TEXT, source_object_id TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5, attributes_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (source_object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

CREATE TABLE IF NOT EXISTS event_entities (
    event_id TEXT NOT NULL, entity_id TEXT NOT NULL,
    PRIMARY KEY (event_id, entity_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timelines (
    id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, scope_id TEXT,
    title TEXT NOT NULL, created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, from_entity_id TEXT NOT NULL,
    to_entity_id TEXT NOT NULL, via_event_id TEXT, source_object_id TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5, attributes_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (from_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (to_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (via_event_id) REFERENCES events(id) ON DELETE SET NULL,
    FOREIGN KEY (source_object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_entity_id);

CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY NOT NULL, level TEXT NOT NULL, length TEXT NOT NULL,
    scope_json TEXT NOT NULL, body TEXT NOT NULL, produced_at REAL NOT NULL,
    model_id TEXT, confidence REAL NOT NULL DEFAULT 0.5
);
CREATE INDEX IF NOT EXISTS idx_summaries_level ON summaries(level);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY NOT NULL, started_at REAL NOT NULL, title TEXT
);
CREATE TABLE IF NOT EXISTS conversation_turns (
    id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    role TEXT NOT NULL, body TEXT NOT NULL, created_at REAL NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, started_at REAL, ended_at REAL, notes TEXT
);
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, kind TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, notes TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_objects_fts USING fts5(
    content, content='knowledge_objects', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text, content='chunks', content_rowid='rowid', tokenize='porter unicode61'
);
`

const v2 = `
CREATE TABLE IF NOT EXISTS memory_objects (
    id TEXT PRIMARY KEY NOT NULL, subject_kind TEXT NOT NULL, subject_identifier TEXT NOT NULL,
    key_decisions_json TEXT NOT NULL DEFAULT '[]', key_event_ids_json TEXT NOT NULL DEFAULT '[]',
    important_relationship_ids_json TEXT NOT NULL DEFAULT '[]', risks_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active', narrative TEXT NOT NULL DEFAULT '',
    source_object_ids_json TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 0.5,
    version INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL, updated_at REAL NOT NULL,
    UNIQUE(subject_kind, subject_identifier)
);
CREATE INDEX IF NOT EXISTS idx_memory_subject ON memory_objects(subject_kind, subject_identifier);

CREATE TABLE IF NOT EXISTS memory_changes (
    id TEXT PRIMARY KEY NOT NULL, memory_object_id TEXT NOT NULL, subject_kind TEXT NOT NULL,
    subject_identifier TEXT NOT NULL, prior_version INTEGER NOT NULL, new_version INTEGER NOT NULL,
    delta_json TEXT NOT NULL, triggering_object_id TEXT, occurred_at REAL NOT NULL,
    FOREIGN KEY (memory_object_id) REFERENCES memory_objects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_changes_subject
    ON memory_changes(subject_kind, subject_identifier, occurred_at DESC);
`

// v3 — canonical entities + per-mention rows + alias table. On a fresh DB the
// data-migration SELECTs are no-ops; only the final table shapes matter.
const v3 = `
PRAGMA defer_foreign_keys = ON;
CREATE TABLE entity_mentions (
    id TEXT PRIMARY KEY NOT NULL, entity_id TEXT NOT NULL, kind TEXT NOT NULL,
    surface TEXT NOT NULL, normalized TEXT NOT NULL, source_object_id TEXT NOT NULL,
    span_start INTEGER, span_end INTEGER, confidence REAL NOT NULL DEFAULT 0.5,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (source_object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE
);
CREATE INDEX idx_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX idx_mentions_source ON entity_mentions(source_object_id);
CREATE INDEX idx_mentions_normalized ON entity_mentions(normalized);

CREATE TABLE entities_new (
    id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, normalized TEXT NOT NULL,
    source_object_id TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (source_object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE,
    UNIQUE(kind, normalized)
);
INSERT INTO entities_new (id, kind, value, normalized, source_object_id, confidence, attributes_json)
SELECT id, kind, value, norm, source_object_id, confidence, attributes_json
FROM (
    SELECT e.id, e.kind, e.value, e.source_object_id, e.confidence, e.attributes_json,
           COALESCE(NULLIF(e.normalized, ''), lower(e.value)) AS norm,
           ROW_NUMBER() OVER (
               PARTITION BY e.kind, COALESCE(NULLIF(e.normalized, ''), lower(e.value))
               ORDER BY e.confidence DESC, e.id ASC
           ) AS rn
    FROM entities e
) ranked WHERE rn = 1;

DROP TABLE entities;
ALTER TABLE entities_new RENAME TO entities;
CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);
CREATE INDEX IF NOT EXISTS idx_entities_norm ON entities(normalized);

CREATE TABLE entity_aliases (
    entity_id TEXT NOT NULL, alias_normalized TEXT NOT NULL, source TEXT NOT NULL,
    UNIQUE(entity_id, alias_normalized),
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE INDEX idx_aliases_norm ON entity_aliases(alias_normalized);
`

const v4 = `
ALTER TABLE relationships ADD COLUMN weight INTEGER NOT NULL DEFAULT 1;
ALTER TABLE relationships ADD COLUMN evidence_object_ids_json TEXT NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX idx_rel_canonical ON relationships(kind, from_entity_id, to_entity_id);
`

const v5 = `
CREATE TABLE vectors (
    chunk_id TEXT PRIMARY KEY NOT NULL, dim INTEGER NOT NULL, q BLOB NOT NULL, scale REAL NOT NULL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);
`

const v6 = `
ALTER TABLE files ADD COLUMN alias_of TEXT NULL REFERENCES files(id) ON DELETE SET NULL;
CREATE INDEX idx_files_content_hash ON files(content_hash);
CREATE INDEX idx_files_alias_of ON files(alias_of);
`

const v7 = `
ALTER TABLE files ADD COLUMN availability TEXT NOT NULL DEFAULT 'available';
CREATE INDEX idx_files_availability ON files(availability);
`

const v8 = `ALTER TABLE events ADD COLUMN date_confidence REAL NOT NULL DEFAULT 0.5;`

const v9 = `
CREATE TABLE IF NOT EXISTS synthetic_questions (
    id TEXT PRIMARY KEY NOT NULL, chunk_id TEXT NOT NULL, object_id TEXT NOT NULL,
    text TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
    produced_by TEXT NOT NULL DEFAULT 'synthq.heuristic', created_at REAL NOT NULL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
    FOREIGN KEY (object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_synthq_chunk ON synthetic_questions(chunk_id);
CREATE INDEX IF NOT EXISTS idx_synthq_object ON synthetic_questions(object_id);
CREATE VIRTUAL TABLE IF NOT EXISTS synthetic_questions_fts USING fts5(
    text, content='synthetic_questions', content_rowid='rowid', tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS qa_pairs (
    id TEXT PRIMARY KEY NOT NULL, question_text TEXT NOT NULL, answer_text TEXT NOT NULL,
    question_object_id TEXT NOT NULL, answer_object_id TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5, produced_by TEXT NOT NULL DEFAULT 'qa.email.thread',
    created_at REAL NOT NULL,
    FOREIGN KEY (question_object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE,
    FOREIGN KEY (answer_object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_qa_q_object ON qa_pairs(question_object_id);
CREATE INDEX IF NOT EXISTS idx_qa_a_object ON qa_pairs(answer_object_id);
`

const v10 = `
CREATE VIRTUAL TABLE IF NOT EXISTS qa_pairs_fts USING fts5(
    question_text, answer_text, content='qa_pairs', content_rowid='rowid', tokenize='porter unicode61'
);
`

const v11 = `
ALTER TABLE entities ADD COLUMN fact_type TEXT NULL;
ALTER TABLE events ADD COLUMN fact_type TEXT NULL;
ALTER TABLE memory_objects ADD COLUMN fact_type TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_entities_fact_type ON entities(fact_type);
CREATE INDEX IF NOT EXISTS idx_events_fact_type ON events(fact_type);
CREATE INDEX IF NOT EXISTS idx_memory_objects_fact_type ON memory_objects(fact_type);
`

const v12 = `
ALTER TABLE entities ADD COLUMN slot_values_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN slot_values_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE memory_objects ADD COLUMN slot_values_json TEXT NOT NULL DEFAULT '{}';
`

const v13 = `
CREATE TABLE fact_bonds (
    id TEXT PRIMARY KEY NOT NULL, bond_name TEXT NOT NULL, from_fact_kind TEXT NOT NULL,
    from_fact_id TEXT NOT NULL, to_fact_kind TEXT NOT NULL, to_fact_id TEXT NOT NULL,
    source_object_id TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5, weight INTEGER NOT NULL DEFAULT 1,
    evidence_object_ids_json TEXT NOT NULL DEFAULT '[]', created_at REAL NOT NULL,
    FOREIGN KEY (source_object_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_fact_bonds_unique ON fact_bonds(bond_name, from_fact_id, to_fact_id);
CREATE INDEX idx_fact_bonds_from ON fact_bonds(from_fact_id, bond_name);
CREATE INDEX idx_fact_bonds_to ON fact_bonds(to_fact_id, bond_name);
CREATE INDEX idx_fact_bonds_name ON fact_bonds(bond_name);
`

const v14 = `
CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
    INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS ko_fts_ai AFTER INSERT ON knowledge_objects BEGIN
    INSERT INTO knowledge_objects_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS ko_fts_ad AFTER DELETE ON knowledge_objects BEGIN
    INSERT INTO knowledge_objects_fts(knowledge_objects_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS ko_fts_au AFTER UPDATE ON knowledge_objects BEGIN
    INSERT INTO knowledge_objects_fts(knowledge_objects_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO knowledge_objects_fts(rowid, content) VALUES (new.rowid, new.content);
END;
INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');
INSERT INTO knowledge_objects_fts(knowledge_objects_fts) VALUES('rebuild');
`

const v15 = `
CREATE TABLE IF NOT EXISTS boilerplate_templates (
    id TEXT PRIMARY KEY, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'unknown',
    first_seen_at REAL NOT NULL, byte_size INTEGER NOT NULL, match_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_boilerplate_kind ON boilerplate_templates(kind);
CREATE TABLE IF NOT EXISTS boilerplate_uses (
    template_id TEXT NOT NULL, ko_id TEXT NOT NULL, PRIMARY KEY (template_id, ko_id),
    FOREIGN KEY (template_id) REFERENCES boilerplate_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (ko_id) REFERENCES knowledge_objects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_boilerplate_uses_ko ON boilerplate_uses(ko_id);
`

const v16 = `ALTER TABLE chunks ADD COLUMN context_prefix TEXT;`
const v17 = `ALTER TABLE chunks ADD COLUMN context_prefix_source TEXT;`

const v18 = `
ALTER TABLE entities ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'T2';
ALTER TABLE events ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'T2';
ALTER TABLE memory_objects ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'T2';
ALTER TABLE fact_bonds ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'T2';
CREATE INDEX IF NOT EXISTS idx_entities_quality_tier ON entities(quality_tier);
CREATE INDEX IF NOT EXISTS idx_events_quality_tier ON events(quality_tier);
CREATE INDEX IF NOT EXISTS idx_memory_objects_quality_tier ON memory_objects(quality_tier);
CREATE INDEX IF NOT EXISTS idx_fact_bonds_quality_tier ON fact_bonds(quality_tier);
`

const v19 = `
CREATE TABLE entity_cooccurrences (
    entity_a TEXT NOT NULL, entity_b TEXT NOT NULL, weight INTEGER NOT NULL DEFAULT 1,
    computed_at REAL NOT NULL, PRIMARY KEY (entity_a, entity_b),
    FOREIGN KEY (entity_a) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (entity_b) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cooc_b_a ON entity_cooccurrences(entity_b, entity_a);
CREATE INDEX IF NOT EXISTS idx_cooc_weight ON entity_cooccurrences(weight DESC);
`

const v20 = `
CREATE TABLE entity_communities (
    community_id TEXT NOT NULL, entity_id TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 0,
    computed_at REAL NOT NULL, PRIMARY KEY (community_id, entity_id, level),
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_communities_entity ON entity_communities(entity_id);
CREATE INDEX IF NOT EXISTS idx_communities_level ON entity_communities(level);
CREATE TABLE community_summaries (
    community_id TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL,
    summary TEXT NOT NULL, member_count INTEGER NOT NULL,
    top_entity_ids_json TEXT NOT NULL DEFAULT '[]', computed_at REAL NOT NULL,
    PRIMARY KEY (community_id, level)
);
`

const v21 = `ALTER TABLE events ADD COLUMN narrative_slots_json TEXT NOT NULL DEFAULT '{}';`

const v22 = `
ALTER TABLE events ADD COLUMN date_precision INTEGER NOT NULL DEFAULT 5;
CREATE INDEX IF NOT EXISTS idx_events_precision ON events(date_precision);
`

const v23 = `
CREATE TABLE event_links (
    id TEXT PRIMARY KEY NOT NULL, source_event_id TEXT NOT NULL, target_event_id TEXT NOT NULL,
    relation TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
    evidence_object_ids_json TEXT NOT NULL DEFAULT '[]', allen TEXT,
    source TEXT NOT NULL DEFAULT 'heuristic', reason TEXT, created_at REAL NOT NULL, superseded_by TEXT,
    FOREIGN KEY (source_event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (target_event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_event_links_source ON event_links(source_event_id, relation);
CREATE INDEX IF NOT EXISTS idx_event_links_target ON event_links(target_event_id, relation);
CREATE INDEX IF NOT EXISTS idx_event_links_current ON event_links(superseded_by) WHERE superseded_by IS NULL;

CREATE TABLE event_links_hypothetical (
    id TEXT PRIMARY KEY NOT NULL, source_event_id TEXT NOT NULL, target_event_id TEXT NOT NULL,
    relation TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
    evidence_object_ids_json TEXT NOT NULL DEFAULT '[]', allen TEXT,
    source TEXT NOT NULL DEFAULT 'user', reason TEXT, hypothesis_note TEXT, created_at REAL NOT NULL,
    FOREIGN KEY (source_event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (target_event_id) REFERENCES events(id) ON DELETE CASCADE
);
`

const v24 = `
CREATE TABLE event_versions (
    id TEXT PRIMARY KEY NOT NULL, event_id TEXT NOT NULL, version INTEGER NOT NULL,
    valid_from REAL NOT NULL, valid_to REAL, payload_json TEXT NOT NULL,
    agent TEXT NOT NULL DEFAULT 'system', activity TEXT, reason TEXT, recorded_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_versions_event ON event_versions(event_id, version);
CREATE INDEX IF NOT EXISTS idx_event_versions_current ON event_versions(event_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_versions_recorded ON event_versions(recorded_at);
`

const v25 = `
CREATE TABLE investigations (
    id TEXT PRIMARY KEY NOT NULL, question TEXT NOT NULL, synthesis TEXT,
    created_at REAL NOT NULL, finished_at REAL
);
CREATE INDEX IF NOT EXISTS idx_investigations_created ON investigations(created_at DESC);
CREATE TABLE investigation_steps (
    id TEXT PRIMARY KEY NOT NULL, investigation_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    question TEXT NOT NULL, answer_body TEXT, answer_confidence REAL,
    answer_citations_json TEXT NOT NULL DEFAULT '[]', created_at REAL NOT NULL,
    FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_investigation_steps_inv ON investigation_steps(investigation_id, ordinal);
`

const v26 = `
CREATE TABLE saved_queries (
    id TEXT PRIMARY KEY NOT NULL, question TEXT NOT NULL, title TEXT, notes TEXT, category TEXT,
    created_at REAL NOT NULL, last_run_at REAL
);
CREATE INDEX IF NOT EXISTS idx_saved_queries_created ON saved_queries(created_at DESC);
`

const v27 = `
CREATE TABLE assertions (
    id TEXT PRIMARY KEY NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL,
    predicate TEXT NOT NULL, object_kind TEXT NOT NULL, object_value TEXT,
    object_entity_id TEXT, object_event_id TEXT, confidence REAL NOT NULL DEFAULT 0.5,
    evidence_object_ids_json TEXT NOT NULL DEFAULT '[]', agent TEXT NOT NULL DEFAULT 'user',
    reason TEXT, recorded_at REAL NOT NULL, retracted_at REAL
);
CREATE INDEX IF NOT EXISTS idx_assertions_subject ON assertions(subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_assertions_predicate ON assertions(predicate);
CREATE INDEX IF NOT EXISTS idx_assertions_recorded ON assertions(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_assertions_current ON assertions(retracted_at) WHERE retracted_at IS NULL;
`

export const MIGRATIONS: [number, string][] = [
  [1, v1], [2, v2], [3, v3], [4, v4], [5, v5], [6, v6], [7, v7], [8, v8], [9, v9],
  [10, v10], [11, v11], [12, v12], [13, v13], [14, v14], [15, v15], [16, v16],
  [17, v17], [18, v18], [19, v19], [20, v20], [21, v21], [22, v22], [23, v23],
  [24, v24], [25, v25], [26, v26], [27, v27]
]
