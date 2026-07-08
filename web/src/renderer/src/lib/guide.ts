//
// guide.ts — all user-facing guidance in one place: personas (the home-screen
// cards and their tailored workspaces), per-screen intros, and the glossary
// that powers hover tips. Editing copy = editing this file only.
//

export interface Persona {
  id: string
  emoji: string
  title: string
  tagline: string
  /** The guided 3-step flow shown inside the workspace. */
  steps: { title: string; body: string; goto: string; gotoLabel: string }[]
  /** Click-to-ask example questions. */
  examples: string[]
  /** Which screens matter most for this persona. */
  keyScreens: { path: string; label: string; why: string }[]
  tips: string[]
}

export const PERSONAS: Persona[] = [
  {
    id: 'legal',
    emoji: '⚖️',
    title: 'For Lawyers',
    tagline: 'Build a defensible case chronology — every event linked to its source, every conflict preserved.',
    steps: [
      { title: 'Ingest the case file', body: 'Upload contracts, emails, invoices, statements. Each file is hashed (SHA-256), parsed into cited evidence blocks, and duplicates are detected automatically.', goto: '/sources', gotoLabel: 'Open Sources' },
      { title: 'Review the reconstruction', body: 'The Timeline tab labels every event by how it is known (observed / asserted / inferred). Check the Contradictions tab — conflicting dates and claims are preserved, never averaged away. Accept or reject events to build the reviewed record.', goto: '/history', gotoLabel: 'Open Reconstruction' },
      { title: 'Export the chronology', body: 'One click produces a Markdown report: source manifest with hashes, status-tagged timeline, contradictions, and missing evidence — ready to attach to a brief.', goto: '/history', gotoLabel: 'Export report' }
    ],
    examples: [
      'Reconstruct the timeline of the contract between the parties',
      'What evidence shows when payment was due and when it was made?',
      'Which facts are contradicted across the documents?',
      'What obligations appear in the documents and is there proof they were fulfilled?'
    ],
    keyScreens: [
      { path: '/history', label: 'Reconstruction', why: 'the case chronology with proof status and review controls' },
      { path: '/timeline', label: 'Timeline', why: 'filter events by date, entity, or kind' },
      { path: '/assertions', label: 'Assertions', why: 'record your own claims with confidence levels' }
    ],
    tips: [
      'An event marked “observed” came from a structured source (an email header, a timestamp). “Inferred” means indirect evidence only — treat it as a lead, not a fact.',
      'The report never asserts beyond the evidence; “Missing Proof” lists exactly what would strengthen the case.'
    ]
  },
  {
    id: 'investigation',
    emoji: '🔍',
    title: 'For Investigators',
    tagline: 'Who knew what, and when — connections, corroboration, and the gaps in the record.',
    steps: [
      { title: 'Load everything you have', body: 'Emails, spreadsheets, exports, ZIP archives — mixed formats are fine. The ledger extracts people, organizations, dates, amounts, and communications.', goto: '/sources', gotoLabel: 'Open Sources' },
      { title: 'Follow the connections', body: 'The Explore graph shows who communicated with whom; the Dossier compiles everything known about one person or organization: events, relationships, aliases, first/last seen.', goto: '/explore', gotoLabel: 'Open Explore' },
      { title: 'Interrogate the timeline', body: 'Ask “who knew what when” questions. Answers cite their sources and are classified (proven / supported / inferred). Missing Proof shows where the record is silent.', goto: '/ask', gotoLabel: 'Ask a question' }
    ],
    examples: [
      'Who communicated with whom, and when did each exchange happen?',
      'What is the full timeline of events involving [person or company]?',
      'Which events rest on a single source with no corroboration?',
      'What happened in the weeks before [event]?'
    ],
    keyScreens: [
      { path: '/dossier', label: 'Dossier', why: 'the complete profile of any person or organization' },
      { path: '/explore', label: 'Explore', why: 'the connection graph between entities' },
      { path: '/history', label: 'Reconstruction', why: 'proof status, contradictions, and evidence gaps' }
    ],
    tips: [
      'Corroboration counts matter: “2 sources” means two independent documents state the same fact.',
      'Timeline gaps (months with no evidence) often point to what to collect next.'
    ]
  },
  {
    id: 'journalism',
    emoji: '📰',
    title: 'For Journalists',
    tagline: 'Verify claims across a document dump — what is supported, what conflicts, what is missing.',
    steps: [
      { title: 'Drop in the documents', body: 'Leaked archives, FOIA responses, reports — the ledger parses them into claims (who asserted what, where) with page-level citations.', goto: '/sources', gotoLabel: 'Open Sources' },
      { title: 'Check the claims', body: 'The Evidence tab lists every extracted obligation, date assertion, amount, and communication with its source. Contradictions shows where sources disagree — both sides preserved.', goto: '/history', gotoLabel: 'Open Evidence' },
      { title: 'Ask before you write', body: 'Every answer is citation-backed and classified. “Supported by a single source” is your cue to seek corroboration before publishing.', goto: '/ask', gotoLabel: 'Ask a question' }
    ],
    examples: [
      'What claims do the documents make about [topic], and who asserted each?',
      'Which statements are corroborated by more than one source?',
      'Where do the sources contradict each other?',
      'What is the chronology of decisions described in these documents?'
    ],
    keyScreens: [
      { path: '/history', label: 'Reconstruction', why: 'claims, contradictions, and missing evidence in one place' },
      { path: '/search', label: 'Search', why: 'exact-phrase and semantic search across everything' },
      { path: '/saved', label: 'Saved', why: 'bookmark the questions you will re-run as new documents arrive' }
    ],
    tips: [
      'Answers never invent facts: if the documents don’t say it, the answer says so.',
      'Re-ask saved questions after each new ingest — answers update as evidence grows.'
    ]
  },
  {
    id: 'research',
    emoji: '🏺',
    title: 'For Researchers',
    tagline: 'Reconstruct past periods from archives — with honest uncertainty, not false precision.',
    steps: [
      { title: 'Ingest the corpus', body: 'Papers, transcriptions, catalogs, notes. Dates are extracted with their precision preserved — “March 2025” is never silently turned into a fake exact day.', goto: '/sources', gotoLabel: 'Open Sources' },
      { title: 'Study the timeline', body: 'Events carry date-confidence and precision. Vague dates compare at the right granularity, so a year-only mention never falsely “contradicts” an exact date.', goto: '/timeline', gotoLabel: 'Open Timeline' },
      { title: 'Trace every conclusion', body: 'Ask synthesis questions; every claim in the answer traces to its source. Export the chronology as a citable report.', goto: '/ask', gotoLabel: 'Ask a question' }
    ],
    examples: [
      'What is the chronological sequence of events described in the corpus?',
      'Which dates are uncertain or only approximately known?',
      'What sources mention [entity or place], and what do they say?',
      'Summarize what is known versus what is inferred about [topic]'
    ],
    keyScreens: [
      { path: '/timeline', label: 'Timeline', why: 'date-precision-aware event view' },
      { path: '/library', label: 'Library', why: 'browse documents, summaries, and distilled memories' },
      { path: '/knowledge', label: 'Knowledge', why: 'corpus-wide statistics and entity breakdowns' }
    ],
    tips: [
      'Date precision travels with every event — “derived” status means computed from stated facts.',
      'The Completeness screen shows how much of your corpus is actually indexed and searchable.'
    ]
  },
  {
    id: 'general',
    emoji: '🧠',
    title: 'For Everyone',
    tagline: 'Your private, searchable memory — ask anything about your own documents.',
    steps: [
      { title: 'Add your files', body: 'Documents, spreadsheets, emails — everything becomes searchable and connected. Nothing leaves your control.', goto: '/sources', gotoLabel: 'Open Sources' },
      { title: 'Just ask', body: 'Plain-language questions get cited answers. Follow-up suggestions keep you moving.', goto: '/ask', gotoLabel: 'Ask a question' },
      { title: 'Browse when curious', body: 'The Timeline shows your documents as a story; Search finds anything by keyword or meaning.', goto: '/timeline', gotoLabel: 'Open Timeline' }
    ],
    examples: [
      'What did I agree to in my rental contract?',
      'When did I last correspond with [person] and about what?',
      'Summarize everything about [project or topic]',
      'What deadlines or amounts appear in my documents?'
    ],
    keyScreens: [
      { path: '/ask', label: 'Ask', why: 'the fastest way to an answer' },
      { path: '/search', label: 'Search', why: 'keyword and meaning-based lookup' },
      { path: '/sources', label: 'Sources', why: 'manage what’s ingested' }
    ],
    tips: [
      'The answer card shows its classification — “Proven by direct evidence” means exactly that.',
      'Click “How this was verified” under any answer to see sources and confidence.'
    ]
  }
]

// ── Per-screen intros (dismissible GuideBox content) ────────────────────

export const SCREEN_GUIDES: Record<string, { title: string; body: string }> = {
  ask: {
    title: 'Ask — cited answers from your evidence',
    body: 'Type a question in plain language. The answer is built only from your ingested sources: every claim cites its evidence, the badge shows how strongly it is established, and anything your sources don’t cover is listed as a gap instead of being guessed.'
  },
  history: {
    title: 'Reconstruction — the evidence-backed story',
    body: 'Four tabs: Timeline (every event labeled by how it is known, with accept/reject review), Evidence (extracted claims with citations), Contradictions (where sources disagree — both sides kept), and Missing Proof (what the record does not establish). Export produces a citable chronology report.'
  },
  sources: {
    title: 'Sources — what the ledger knows',
    body: 'Upload files here. Supported: PDF, Word, Excel/CSV, PowerPoint (PPTX), EPUB books, emails (EML/MBOX), HTML, Markdown, text, ZIP archives, and audio (MP3/WAV — transcribed by AI). Every file is hashed, parsed into evidence blocks, and indexed; exact duplicates are detected automatically. Unsupported formats are recorded honestly — never faked.'
  },
  timeline: {
    title: 'Timeline — your documents as dated events',
    body: 'Every dated fact extracted from your sources, in order. Filter by date range, entity, or event kind. Click an event to see its participants, source document, and causal links.'
  },
  search: {
    title: 'Search — exact or by meaning',
    body: 'Keyword mode finds exact terms, names, and numbers. Semantic mode finds passages that mean the same thing even with different words (needs an embedding model configured).'
  },
  explore: {
    title: 'Explore — the connection graph',
    body: 'Pick a person or organization and see who and what it is connected to. Click any node to re-center on it.'
  },
  dossier: {
    title: 'Dossier — everything about one entity',
    body: 'Search for a person or organization to get its full profile: timeline of events, relationships, aliases, distilled memory, and when it first/last appears in your sources.'
  }
}

// ── Glossary (hover tips) ───────────────────────────────────────────────

export const GLOSSARY: Record<string, string> = {
  observed: 'Directly visible in a structured source — an email header, a log entry, a timestamp. Highest trust.',
  asserted: 'Stated in a document’s text with an explicit date. True that it was said; the statement itself may still be wrong.',
  derived: 'Computed deterministically from stated facts (e.g. invoice date + 30-day term).',
  inferred: 'Reconstructed from indirect evidence only (e.g. a file’s modification time). A lead, not a fact.',
  contradicted: 'Another source states a conflicting version. Both sides are preserved — check the Contradictions tab.',
  corroborated: 'The same fact appears in two or more independent source documents.',
  confidence: 'How strongly the evidence supports this item, from 0 to 100%. Calibrated, not a guess.',
  citation: 'The exact source (file, page, row) a statement came from. Click through to verify.',
  classification: 'The overall grade of an answer: Proven by direct evidence, Supported by multiple sources, Supported by a single source, Derived, Inferred, Contradicted, or Unsupported.',
  missingProof: 'Evidence that would be needed to establish a claim but is absent from your sources.'
}
