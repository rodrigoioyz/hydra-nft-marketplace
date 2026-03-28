# Hydra + Aiken RAG Architecture

## 1. Purpose

This document defines the architecture for a **domain-specific Retrieval-Augmented Generation (RAG) system** focused on:

- **Hydra documentation and implementation details**
- **Aiken stdlib and validator development patterns**
- **Project-specific architecture, specs, tickets, and audit knowledge**

The system is intended to support two primary use cases:

1. **Development assistant**
   - answer implementation questions
   - explain Hydra lifecycle and API behavior
   - guide Aiken validator design
   - align answers to the project’s marketplace architecture

2. **Audit assistant**
   - check invariants in marketplace flows
   - identify missing validator checks
   - detect Hydra lifecycle assumptions and state desynchronization risks
   - propose missing tests and operational safeguards

---

## 2. Design goals

The RAG system must:

- retrieve **accurate, source-grounded** answers
- distinguish **Hydra Head behavior** from **L1 Cardano behavior**
- distinguish **conceptual docs** from **operational implementation details**
- support **typed reasoning** for Aiken validators
- support **project-aware responses** using local architecture/spec documents
- preserve **citations and source traceability**
- support **hybrid retrieval** rather than embeddings alone
- support **audit-focused skepticism**, not only dev convenience

---

## 3. Key architectural principle

> This RAG is not a single vector search index. It is a layered knowledge system with routing, hybrid retrieval, reranking, and mode-specific answer generation.

---

## 4. Knowledge layers

## 4.1 Layer A — Conceptual documentation

### Sources
- Hydra docs website
- Aiken stdlib docs

### Purpose
Used for:
- conceptual explanations
- protocol semantics
- API meaning
- validator patterns

### Examples
- Hydra Head lifecycle
- `NewTx` semantics
- snapshot UTxO queries
- Aiken `spend` handler patterns
- stdlib modules and helper functions

---

## 4.2 Layer B — Operational implementation knowledge

### Sources
- Hydra GitHub repository
- Hydra examples
- Hydra configuration and package structure

### Purpose
Used for:
- implementation guidance
- real command usage
- package/module awareness
- operational edge cases

### Examples
- repo examples
- package-level architecture
- CLI flows
- config structure

---

## 4.3 Layer C — Project-specific knowledge

### Sources
- `mvp-spec.md`
- `architecture.md`
- `tickets.md`
- ADRs
- runbooks
- audit notes
- internal contracts and code comments

### Purpose
Used for:
- answers aligned to your marketplace design
- architecture-constrained suggestions
- project-specific audit reasoning

---

## 4.4 Layer D — Generated audit knowledge

### Sources
Derived internally from:
- prior audit outputs
- issue reports
- postmortems
- failed test analyses

### Purpose
Used for:
- recurring risk detection
- invariant catalogs
- incident memory

---

## 5. System overview

```txt
User Query
   ↓
Intent Classifier
   ↓
Retrieval Router
   ↓
Hybrid Search Across Corpora
   ↓
Reranker
   ↓
Context Assembler
   ↓
Mode-Specific Prompt Builder
   ↓
LLM Answer Generator
   ↓
Cited Response
```

---

## 6. Main components

## 6.1 Ingestion service

### Responsibilities
- crawl docs sources
- pull repository content
- normalize raw documents
- preserve source metadata
- trigger chunking and indexing

### Inputs
- official documentation URLs
- repository paths or Git refs
- internal project docs

### Outputs
- normalized documents
- versioned source records

---

## 6.2 Chunking service

### Responsibilities
- split source documents into semantically meaningful chunks
- attach metadata needed for routing and audit
- preserve section boundaries and code associations

### Rule
Chunking must follow **domain structure**, not arbitrary token sizes.

---

## 6.3 Embedding service

### Responsibilities
- generate vector embeddings for chunks
- embed user queries
- support re-indexing when content changes

### Requirement
Embeddings must be paired with lexical search, not used alone.

---

## 6.4 Retrieval service

### Responsibilities
- classify query intent
- choose target corpora
- perform vector + keyword retrieval
- merge and deduplicate candidates

---

## 6.5 Reranking service

### Responsibilities
- score candidate chunks for final relevance
- prefer exact API / validator matches when needed
- improve result precision for technical questions

---

## 6.6 Context assembler

### Responsibilities
- build structured context blocks
- separate project facts from Hydra facts and Aiken facts
- include examples and failure notes
- preserve citations

---

## 6.7 Answer generator

### Responsibilities
- generate response in the correct mode
- remain grounded in retrieved content
- avoid inventing APIs, states, or validator behavior
- cite relevant retrieved chunks

---

## 6.8 Evaluation service

### Responsibilities
- run benchmark queries
- score retrieval quality
- score hallucination rate
- score citation correctness
- score lifecycle correctness

---

## 7. Corpus design

## 7.1 Corpus: `hydra_docs`

### Content
- tutorials
- how-to pages
- dev docs
- ops docs
- protocol pages

### Metadata focus
- head lifecycle phase
- API surface
- page type
- section hierarchy
- version

---

## 7.2 Corpus: `hydra_repo`

### Content
- README files
- example files
- package structure
- config examples
- docs folder content

### Metadata focus
- package name
- module path
- file type
- example relevance
- command references

---

## 7.3 Corpus: `aiken_docs`

### Content
- stdlib index
- module pages
- function docs
- examples
- Cardano-specific library docs

### Metadata focus
- module name
- function/type name
- validator relevance
- example presence
- code language

---

## 7.4 Corpus: `project_docs`

### Content
- MVP spec
- architecture docs
- tickets
- ADRs
- audit notes
- runbooks

### Metadata focus
- document type
- architecture domain
- feature area
- priority
- status

---

## 7.5 Corpus: `audit_memory`

### Content
- prior findings
- known risks
- failure patterns
- regression notes

### Metadata focus
- severity
- subsystem
- invariant type
- resolved/unresolved status

---

## 8. Chunking strategy

## 8.1 Hydra chunking rules

Create chunks by:
- lifecycle step
- API endpoint
- WebSocket command/event
- operational failure mode
- package/module summary
- worked example

### Good Hydra chunk examples
- `NewTx` usage
- `GET /snapshot/utxo`
- `Close` → contestation → fanout
- sideload snapshot recovery
- commit vs incremental commit

### Bad Hydra chunking
- merging multiple lifecycle stages into one chunk
- blending examples with unrelated prose

---

## 8.2 Aiken chunking rules

Create chunks by:
- stdlib module
- function signature + description
- validator pattern
- example block
- datum / redeemer pattern

### Good Aiken chunk examples
- `list.find` behavior
- `option.map` usage
- `transaction` inspection pattern
- `script_context` access pattern
- authorization via `extra_signatories`

### Bad Aiken chunking
- large multi-function blobs
- mixing unrelated helper functions

---

## 8.3 Project document chunking rules

Create chunks by:
- feature section
- architecture component
- requirement block
- ticket group
- ADR decision

### Good project chunk examples
- marketplace buy flow
- Head state source-of-truth rule
- escrow custody decision
- API endpoint definition

---

## 9. Metadata model

Every chunk should carry structured metadata.

```ts
export type ChunkRecord = {
  id: string
  corpus: "hydra_docs" | "hydra_repo" | "aiken_docs" | "project_docs" | "audit_memory"
  title: string
  source_path: string
  url?: string
  section_path: string[]
  chunk_type:
    | "concept"
    | "api"
    | "lifecycle"
    | "ops"
    | "example"
    | "module"
    | "validator"
    | "decision"
    | "audit"
  text: string
  code_text?: string
  language?: "md" | "txt" | "bash" | "json" | "haskell" | "aiken" | "ts"
  entities: string[]
  head_phase?: "init" | "commit" | "open" | "transact" | "close" | "fanout" | "recover"
  api_surface?: string[]
  package?: string
  module?: string
  function_name?: string
  validator_pattern?: string
  project_area?: string
  severity?: "low" | "medium" | "high" | "critical"
  version?: string
  updated_at: string
}
```

---

## 10. Storage architecture

## 10.1 Recommended storage

Use:
- **PostgreSQL** for documents, chunk metadata, logs, and evaluations
- **pgvector** for embeddings
- **full-text indexes** for lexical retrieval

### Why
This aligns with the rest of your stack and avoids unnecessary infrastructure complexity.

---

## 10.2 Main tables

### `documents`
Stores normalized source documents.

### `chunks`
Stores chunk text, metadata, lexical index columns, and embeddings.

### `ingestion_runs`
Tracks source pulls, crawl state, and errors.

### `query_logs`
Stores user queries, retrieval candidates, answer mode, and outputs.

### `eval_runs`
Stores benchmark results.

### `audit_findings`
Stores generated or human-reviewed audit notes.

---

## 11. Query intent classification

Before retrieval, classify each query.

### Intent types

```ts
export type QueryIntent =
  | "hydra_api"
  | "hydra_lifecycle"
  | "hydra_ops"
  | "aiken_validator"
  | "aiken_stdlib"
  | "project_design"
  | "audit"
```

### Examples
- “How do I submit a tx inside Hydra?” → `hydra_api`
- “What happens after Close?” → `hydra_lifecycle`
- “How do I recover a stuck Head?” → `hydra_ops`
- “How should I validate seller authorization in Aiken?” → `aiken_validator`
- “How should our buy flow work?” → `project_design`
- “Can this listing validator be bypassed?” → `audit`

---

## 12. Retrieval routing

Map intents to corpora.

```ts
const routing = {
  hydra_api: ["hydra_docs", "hydra_repo"],
  hydra_lifecycle: ["hydra_docs", "project_docs"],
  hydra_ops: ["hydra_docs", "hydra_repo", "audit_memory"],
  aiken_validator: ["aiken_docs", "project_docs", "audit_memory"],
  aiken_stdlib: ["aiken_docs"],
  project_design: ["project_docs", "hydra_docs", "aiken_docs"],
  audit: ["project_docs", "aiken_docs", "hydra_docs", "audit_memory"]
}
```

---

## 13. Hybrid retrieval pipeline

## 13.1 Steps

1. classify query intent
2. embed query
3. run vector search on selected corpora
4. run lexical search on selected corpora
5. merge candidates
6. deduplicate
7. rerank
8. select top context set

---

## 13.2 Why hybrid retrieval is required

Hydra and Aiken both contain exact technical terms that embeddings alone may underweight:
- `NewTx`
- `SnapshotConfirmed`
- `HeadIsClosed`
- `VerificationKeyHash`
- `extra_signatories`
- `OutputReference`

Lexical retrieval is necessary to preserve precision.

---

## 14. Reranking strategy

Use reranking to prioritize:
- exact API matches
- exact function/module matches
- lifecycle phase relevance
- code examples when query asks “how”
- audit-related chunks when risk terms are present

### Input
20–40 merged candidates.

### Output
Top 6–10 high-confidence chunks.

---

## 15. Context assembly

Context should be assembled into structured sections.

### Template

```txt
[Project Constraints]
[Hydra Facts]
[Aiken Facts]
[Examples]
[Failure / Audit Notes]
[Sources]
```

### Purpose
This prevents project assumptions from being mixed with upstream facts.

---

## 16. Answer generation modes

## 16.1 Dev mode

Used for:
- implementation guidance
- API usage
- architectural recommendations

### Behavior
- optimize for usefulness
- include examples
- keep alignment with project docs

---

## 16.2 Ops mode

Used for:
- incident diagnosis
- lifecycle issues
- stuck Head recovery
- config/debugging questions

### Behavior
- prioritize Hydra operational docs
- mention state assumptions explicitly
- mention recovery options

---

## 16.3 Audit mode

Used for:
- validator review
- invariant checking
- flow risk analysis
- missing test identification

### Behavior
- optimize for skepticism
- identify assumptions
- identify bypass conditions
- propose tests and mitigations

---

## 16.4 Spec mode

Used for:
- aligning answers to your marketplace design
- translating docs into project-specific implementation choices

### Behavior
- project docs first
- upstream docs second
- explicit references to chosen architecture

---

## 17. Prompting rules

## 17.1 Hydra prompting rules

Always force the answer generator to check:
1. whether the Head must be open
2. whether the operation is in-Head or on L1
3. which UTxO or snapshot assumptions are required
4. which API/event proves the state
5. which failure mode can invalidate the advice

---

## 17.2 Aiken prompting rules

Always force the answer generator to explain:
1. datum assumptions
2. redeemer assumptions
3. transaction context assumptions
4. pass/fail conditions
5. missing checks or unsafe assumptions

---

## 17.3 Audit prompting rules

Always force the answer generator to identify:
- invariant being protected
- trusted party assumptions
- replay or stale-state risks
- authorization gaps
- missing negative tests

---

## 18. Audit assistant design

Audit mode should work as a separate pipeline.

## 18.1 Inputs
- validator source code
- transaction flow description
- project architecture context

## 18.2 Steps
1. parse artifact under review
2. extract candidate invariants
3. retrieve matching Hydra + Aiken rules
4. compare implementation against intended behavior
5. emit findings

## 18.3 Output structure
- invariants satisfied
- invariants missing
- assumptions
- attack scenarios
- recommended tests
- severity level

---

## 19. Development assistant design

Dev mode should answer these question families well:
- how to use Hydra APIs
- how to reason about lifecycle transitions
- how to structure Aiken validators
- how to align marketplace flows with Hydra execution
- how to debug common integration issues

---

## 20. Evaluation framework

## 20.1 Retrieval benchmarks

Example benchmark queries:
- “How do I submit a transaction?”
- “What happens between Close and Fanout?”
- “How do I recover a stuck Head?”
- “How do I validate seller authorization in Aiken?”
- “How should our buy flow interact with Hydra?”

### Metrics
- top-k relevance
- exact source hit rate
- reranker precision

---

## 20.2 Answer quality benchmarks

### Metrics
- citation correctness
- lifecycle correctness
- no invented APIs
- no Hydra/L1 confusion
- no validator logic hallucination
- project alignment score

---

## 21. Service boundaries

## 21.1 `rag-worker`

Responsibilities:
- ingestion
- parsing
- chunking
- embedding
- indexing

## 21.2 `rag-api`

Responsibilities:
- query intake
- intent classification
- retrieval
- reranking
- context assembly
- answer generation
- citations

## 21.3 `rag-admin`

Responsibilities:
- dataset inspection
- chunk browser
- failed ingestion visibility
- eval dashboards
- audit finding browser

---

## 22. Suggested project structure

```txt
rag-system/
├── apps/
│   ├── rag-api/
│   ├── rag-worker/
│   └── rag-admin/
├── packages/
│   ├── domain/
│   ├── ingestion/
│   ├── chunking/
│   ├── retrieval/
│   ├── prompts/
│   ├── evaluation/
│   └── db/
├── data/
│   ├── raw/
│   ├── normalized/
│   └── fixtures/
└── docs/
    ├── rag-architecture.md
    ├── ingestion.md
    ├── retrieval.md
    └── evals.md
```

---

## 23. Build order

### Phase 1
- ingest Hydra docs
- ingest Aiken docs
- normalize and chunk
- store in Postgres/pgvector

### Phase 2
- build hybrid retrieval
- build intent classifier
- add reranker

### Phase 3
- ingest project docs
- add project-aware answering
- add citations and context inspector

### Phase 4
- build audit mode
- ingest audit memory
- add evaluation suite

### Phase 5
- ingest repo/code examples deeply
- add code-aware retrieval and contract review workflows

---

## 24. Recommended MVP for this RAG

The first production-usable version should include:
- Hydra docs corpus
- Aiken docs corpus
- project docs corpus
- Postgres + pgvector storage
- hybrid retrieval
- query intent routing
- citations
- dev mode
- audit mode

That is enough to create a strong internal development and review assistant.

---

## 25. Definition of done

The RAG architecture is complete when:
- queries route to the correct corpora
- Hydra answers distinguish lifecycle and API state correctly
- Aiken answers explain validator pass/fail conditions correctly
- project-aware answers align with your chosen marketplace design
- every answer includes traceable citations
- audit mode can produce useful findings and missing-test suggestions

---

## 26. Summary

This architecture is designed specifically for **Hydra + Aiken development and audit workflows**.

It avoids the most common RAG failure modes by:
- separating knowledge layers
- preserving protocol structure
- using hybrid retrieval
- routing by intent
- grounding answers in both upstream docs and project decisions
- supporting skeptical audit reasoning, not only coding assistance

This makes it a strong foundation for building a **Hydra-native development copilot and audit assistant**.

