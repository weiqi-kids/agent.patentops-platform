# PatentOps Platform — Maintenance Guide

> This file is the single source of truth for AI-assisted development.
> Keep it in sync when adding modules, events, routes, or aggregates.

## Project Overview

Patent prosecution workflow management SaaS. Event sourcing architecture on Fastify/TypeScript.
Each jurisdiction is a separate project; this repo is the **jurisdiction-agnostic core platform**.

## Architecture Rules (Immutable)

- **Event Sourcing** — Every state change emits an immutable event. DB tables are projections only.
- **Append-only ledger** — No UPDATE or DELETE on `events` table.
- **AI as Sidecar** — AI layer is called by Workflow Engine, never writes to Evidence Ledger directly.
- **AI outputs = DRAFT** — Only reviewer/partner can mark FINAL.
- **SHA-256 hash chain** — Per-case hash chain for tamper detection. Filed documents hash-locked.
- **Multi-tenant isolation** — PostgreSQL RLS. Every query must be tenant-scoped.
- **Jurisdiction-agnostic core** — OA categories, rejection bases, fee types, deadline rules use generic terms. Jurisdiction plugins provide mappings.
- **Patent family integrity** — Bidirectional links; priority dates validated against parent filing dates.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ / PM2 |
| Language | TypeScript (strict mode, ES2022, Node16 module) |
| Framework | Fastify 5 |
| Database | PostgreSQL (Drizzle ORM 0.38) |
| Queue | BullMQ 5 + Redis (ioredis) |
| Validation | Zod 3.24 |
| Templating | Handlebars |
| Auth | @fastify/jwt (JWT + RBAC) |
| Logging | Pino |
| Testing | Vitest 3 |
| IDs | ULID (not UUID) |

## Code Conventions

- **IDs**: ULID for all entities
- **Timestamps**: ISO 8601 UTC
- **Event types**: `SCREAMING_SNAKE_CASE`
- **Domain types**: `PascalCase`
- **Files**: `kebab-case`
- **Every domain operation** must emit at least one event
- **Every event** must include: `tenant_id`, `event_id`, `case_id`, `correlation_id`, `causation_id`, `actor_id`, `actor_role`, `timestamp`

## File Inventory

```
src/
├── index.ts                              ← Fastify app entry point
├── config/
│   └── app.ts                            ← Application factory (Fastify instance, plugin registration)
│
├── shared/
│   ├── types/index.ts                    ← All branded ID types, domain interfaces, constant arrays
│   └── events/index.ts                   ← 37 event types, BaseEvent<T,P>, typed event aliases, DomainEvent union
│
├── domain/
│   ├── case/
│   │   ├── case-aggregate.ts             ← CaseAggregate (create, changeStatus, recordFilingReceipt, recordAllowance, recordGrant, closeCase)
│   │   ├── case-aggregate.test.ts
│   │   ├── filing-pre-check.ts           ← FilingPreChecker (validates required documents before filing)
│   │   ├── filing-pre-check.test.ts
│   │   └── cross-tenant-isolation.test.ts
│   ├── claim/
│   │   ├── claim-aggregate.ts            ← ClaimAggregate (create, amend, changeStatus) with line-based diff
│   │   └── claim-aggregate.test.ts
│   ├── office-action/
│   │   ├── office-action-aggregate.ts    ← OA lifecycle (receive, analyze, strategize, amend, review, file)
│   │   └── office-action-aggregate.test.ts
│   ├── deadline/
│   │   ├── deadline-engine.ts            ← Pure functions: resolveStartDate, calculateDeadline, evaluateDeadline
│   │   ├── deadline-engine.test.ts
│   │   ├── post-allowance-automation.ts  ← generateAllowanceDeadlines, generateGrantDeadlines
│   │   ├── post-allowance-automation.test.ts
│   │   └── types.ts                      ← DeadlineRule, ExtensionRule, EscalationRule interfaces
│   ├── family/
│   │   ├── family-aggregate.ts           ← FamilyAggregate (link, unlink, priorityClaim) + validatePriorityDate
│   │   └── family-aggregate.test.ts
│   ├── fee/
│   │   ├── fee-aggregate.ts              ← FeeAggregate (create, recordPayment, waive, isOverdue, isInGracePeriod)
│   │   └── fee-aggregate.test.ts
│   ├── specification/
│   │   ├── specification-aggregate.ts    ← SpecificationAggregate + checkNewMatter (NOTE: no event emission yet)
│   │   └── specification-aggregate.test.ts
│   └── conflict-check/
│       ├── conflict-checker.ts           ← Stateless service: Levenshtein fuzzy matching (threshold 0.8)
│       ├── conflict-checker.test.ts
│       └── types.ts
│
├── infrastructure/
│   ├── database/
│   │   └── schema.ts                     ← Drizzle table definitions (11 tables, all with tenant_id indexes)
│   └── event-store/
│       ├── types.ts                      ← EventStore interface, HashChainVerificationResult, EventSubscription
│       ├── pg-event-store.ts             ← PgEventStore: append, appendBatch, getEvents*, verifyHashChain, streamAllEvents
│       ├── hash-chain.ts                 ← GENESIS_HASH, computeEventHash, hashEvent, verifyEventHash, verifyChain
│       └── hash-chain.test.ts
│
├── workflow/
│   └── states/
│       ├── case-state-machine.ts         ← 20 transitions with role enforcement, conflict check gates
│       ├── case-state-machine.test.ts
│       ├── oa-response-state-machine.ts  ← 7 transitions (received→analyzing→strategizing→amending→review→filed)
│       └── oa-response-state-machine.test.ts
│
├── api/
│   ├── middleware/
│   │   ├── auth.ts                       ← JWT extraction + RBAC Fastify plugin
│   │   └── auth.test.ts
│   ├── routes/
│   │   ├── case-routes.ts               ← POST /cases, GET /cases/:id, POST status/filing-receipt/close, GET verify/events
│   │   ├── claim-routes.ts              ← CRUD + amend + status change
│   │   ├── oa-routes.ts                 ← Receive OA, list, transition status, file response
│   │   ├── deadline-routes.ts           ← Create, list, complete, extend
│   │   ├── conflict-routes.ts           ← Initiate check, partner override
│   │   ├── fee-routes.ts               ← Create, list, pay, waive
│   │   ├── prior-art-routes.ts          ← Add reference, list
│   │   ├── family-routes.ts             ← Link, unlink, get family, priority claims
│   │   └── api-integration.test.ts
│   └── schemas/
│       ├── case-schemas.ts              ← Zod schemas for case endpoints
│       ├── claim-schemas.ts
│       ├── oa-schemas.ts
│       ├── deadline-schemas.ts
│       ├── conflict-schemas.ts
│       ├── fee-schemas.ts
│       ├── prior-art-schemas.ts
│       └── family-schemas.ts
│
├── ai/
│   ├── types.ts                          ← AiSidecarClient interface (healthCheck, suggestClaims, analyzeOA, scoreBreadth, suggestAmendments)
│   ├── sidecar-client.ts                ← HttpAiSidecarClient (baseUrl, retry, timeout, X-Watermark header)
│   └── sidecar-client.test.ts
│
├── document/
│   ├── types.ts                          ← DocumentTemplate, data bindings (Application, OaResponse, Ids), GenerationRequest/Result
│   ├── generator.ts                     ← DocumentGenerator (generate via Handlebars substitution, seal with SHA-256)
│   ├── storage.ts                       ← LocalFileDocumentStorage, InMemoryTemplateRegistry
│   └── generator.test.ts
│
├── integration/
│   ├── types.ts                          ← PatentDatabaseAdapter interface, MonitoringWatch/Alert (phase 2-3)
│   └── prior-art-client.ts             ← PriorArtSearchClient (multi-adapter), HttpPatentDatabaseAdapter
│
└── workers/
    ├── deadline-worker.ts               ← runDeadlineSweep (PM2 fork, cron every 6h)
    ├── deadline-worker.test.ts
    ├── event-projector.ts               ← projectEvent → 16 event type handlers → Drizzle INSERT/UPDATE
    └── event-projector.test.ts

governance/
├── control-inventory.json               ← 12 controls (AC, TI, PI, AI, PG, DL, IR)
├── role-matrix.json                     ← 9 roles with granular permissions
└── raci-matrix.json                     ← 13 processes

audit/
└── findings-log.json                    ← Empty (no findings yet)

qms/
├── risk-register.json                   ← 12 risks (all pending acceptance)
└── document-index.json                  ← 13 docs (10 SOPs + 3 policies, all Draft)

docs/
├── architecture/ARCHITECTURE.md         ← Full architecture document (state machines, data model, flows)
└── system-prompt-v1.2.md
```

## Domain Aggregates Reference

### CaseAggregate
- **File**: `src/domain/case/case-aggregate.ts`
- **Commands**: `CreateCaseCommand`, `ChangeCaseStatusCommand`, `RecordFilingReceiptCommand`, `RecordAllowanceCommand`, `RecordGrantCommand`, `CloseCaseCommand`
- **Events**: `CASE_CREATED`, `CASE_STATUS_CHANGED`, `CASE_CLOSED`, `FILING_RECEIPT_RECORDED`, `ALLOWANCE_RECEIVED`, `PATENT_GRANTED`
- **Loads from**: event replay via `loadFromHistory(events)`

### ClaimAggregate
- **File**: `src/domain/claim/claim-aggregate.ts`
- **Commands**: `CreateClaimCommand`, `AmendClaimCommand`, `ChangeClaimStatusCommand`
- **Events**: `CLAIM_CREATED`, `CLAIM_AMENDED`, `CLAIM_STATUS_CHANGED`
- **Status transitions**: `draft → reviewed | cancelled`, `reviewed → filed | draft | cancelled`, `filed → amended | cancelled`, `amended → reviewed | cancelled`

### OfficeActionAggregate
- **File**: `src/domain/office-action/office-action-aggregate.ts`
- **Commands**: `ReceiveOaCommand`, `TransitionOaStatusCommand`, `RecordAnalysisCommand`, `SelectStrategyCommand`, `RecordAmendmentDraftCommand`, `RecordReviewCommand`, `FileOaResponseCommand`
- **Events**: `OA_RECEIVED`, `OA_CLASSIFIED`, `OA_ANALYSIS_COMPLETED`, `OA_STRATEGY_SELECTED`, `OA_AMENDMENT_DRAFTED`, `OA_RESPONSE_REVIEWED`, `OA_RESPONSE_FILED`

### FamilyAggregate
- **File**: `src/domain/family/family-aggregate.ts`
- **Commands**: `LinkFamilyCommand`, `UnlinkFamilyCommand`, `RecordPriorityClaimCommand`
- **Events**: `PATENT_FAMILY_LINKED`, `PATENT_FAMILY_UNLINKED`, `PRIORITY_CLAIM_RECORDED`
- **Exported helper**: `validatePriorityDate(priorityDate, parentFilingDate)`

### FeeAggregate
- **File**: `src/domain/fee/fee-aggregate.ts`
- **Commands**: `CreateFeeCommand`, `RecordPaymentCommand`, `WaiveFeeCommand`
- **Events**: `FEE_CREATED`, `FEE_PAYMENT_RECORDED`, `FEE_WAIVED`
- **Queries**: `isOverdue(now?)`, `isInGracePeriod(now?)`

### SpecificationAggregate
- **File**: `src/domain/specification/specification-aggregate.ts`
- **Commands**: `CreateSpecificationCommand`, `UpdateSpecificationCommand`
- **Events**: None yet (not integrated with event store)
- **Exported helper**: `checkNewMatter(originalDescription, amendedClaimText)`

### ConflictChecker (stateless service)
- **File**: `src/domain/conflict-check/conflict-checker.ts`
- **Method**: `checkConflicts(request): Promise<ConflictCheckResult>`
- **Algorithm**: Levenshtein fuzzy matching, threshold 0.8

### DeadlineEngine (pure functions)
- **File**: `src/domain/deadline/deadline-engine.ts`
- **Functions**: `resolveStartDate`, `calculateDeadline`, `evaluateDeadline`

### FilingPreChecker
- **File**: `src/domain/case/filing-pre-check.ts`
- **Method**: `check(caseId, tenantId, patentType, jurisdiction, existingDocuments)`
- **Default requirements**: application, declaration, power_of_attorney

### Post-Allowance Automation
- **File**: `src/domain/deadline/post-allowance-automation.ts`
- **Functions**: `generateAllowanceDeadlines(...)`, `generateGrantDeadlines(...)`

## Event Registry (37 events)

| Category | Events |
|----------|--------|
| Case lifecycle | `CASE_CREATED`, `CASE_STATUS_CHANGED`, `CASE_CLOSED`, `EXAMINATION_REQUESTED`, `FILING_RECEIPT_RECORDED`, `ALLOWANCE_RECEIVED`, `PATENT_GRANTED` |
| Claims | `CLAIM_CREATED`, `CLAIM_AMENDED`, `CLAIM_STATUS_CHANGED`, `CLAIM_DELETED` |
| Office actions | `OA_RECEIVED`, `OA_CLASSIFIED`, `OA_ANALYSIS_COMPLETED`, `OA_STRATEGY_SELECTED`, `OA_AMENDMENT_DRAFTED`, `OA_RESPONSE_REVIEWED`, `OA_RESPONSE_FILED` |
| Deadlines | `DEADLINE_CREATED`, `DEADLINE_WARNING_SENT`, `DEADLINE_ESCALATED`, `DEADLINE_COMPLETED`, `DEADLINE_MISSED`, `DEADLINE_EXTENDED` |
| Conflict check | `CONFLICT_CHECK_INITIATED`, `CONFLICT_CHECK_COMPLETED`, `CONFLICT_OVERRIDE_APPROVED` |
| Documents | `DOCUMENT_GENERATED`, `DOCUMENT_FINALIZED`, `DOCUMENT_FILED` |
| AI sidecar | `AI_DRAFT_CREATED`, `AI_DRAFT_ACCEPTED`, `AI_DRAFT_REJECTED`, `AI_DRAFT_MODIFIED` |
| Patent family | `PATENT_FAMILY_LINKED`, `PATENT_FAMILY_UNLINKED`, `PRIORITY_CLAIM_RECORDED` |
| Fees | `FEE_CREATED`, `FEE_PAYMENT_RECORDED`, `FEE_WAIVED` |
| Prior art | `PRIOR_ART_REFERENCE_ADDED` |
| Declarations | `DECLARATION_REQUESTED`, `DECLARATION_SIGNED` |
| System | `ARTIFACT_HASH_RECORDED`, `INCIDENT_CREATED` |

Defined in `src/shared/events/index.ts`. Each has a typed payload interface and alias (e.g. `CaseCreatedEvent`).

## State Machines

### Case Lifecycle (`src/workflow/states/case-state-machine.ts`)
```
INTAKE → DRAFTING → REVIEW → FILING → FILED → EXAMINATION_REQUESTED → OA_RECEIVED → ALLOWED → GRANTED → CLOSED
```
- 20 transitions with role enforcement
- `INTAKE → DRAFTING` requires conflict check
- `REVIEW → FILING` requires human review (reviewer/partner only)
- `OA_RECEIVED → FILED` requires human review (reviewer/partner only)
- `* → CLOSED` partner only (except `GRANTED → CLOSED` also allows system)
- Close reasons: `abandoned`, `withdrawn`, `rejected`, `lapsed`, `expired`

### OA Response Lifecycle (`src/workflow/states/oa-response-state-machine.ts`)
```
received → analyzing → strategizing → amending → review → filed
```
- 7 transitions
- `received → analyzing`: triggers AI sidecar
- `review → filed`: reviewer/partner only
- `received → amending`: skip path for simple OAs (reviewer/partner)

## API Routes (all prefixed `/api/v1`)

| Resource | Endpoints | File |
|----------|-----------|------|
| Health | `GET /health` (unauthenticated) | `case-routes.ts` |
| Cases | 7 endpoints (CRUD, status, filing receipt, close, verify, events) | `case-routes.ts` |
| Claims | 5 endpoints (create, list, get, amend, status) | `claim-routes.ts` |
| Office Actions | 4 endpoints (receive, list, transition, file response) | `oa-routes.ts` |
| Deadlines | 4 endpoints (create, list, complete, extend) | `deadline-routes.ts` |
| Conflict Check | 2 endpoints (initiate, partner override) | `conflict-routes.ts` |
| Fees | 4 endpoints (create, list, pay, waive) | `fee-routes.ts` |
| Prior Art | 2 endpoints (add, list) | `prior-art-routes.ts` |
| Family | 4 endpoints (link, unlink, get family, priority claim) | `family-routes.ts` |

## Database Schema (11 projection tables)

Defined in `src/infrastructure/database/schema.ts`:
`events`, `tenants`, `actors`, `cases`, `claims`, `office_actions`, `deadlines`, `conflict_checks`, `documents`, `patent_family_links`, `fees`, `prior_art_references`

All tables have `tenant_id` + `case_id` indexes. The `events` table has a composite index on `(case_id, sequence_number)`.

## PM2 Processes (ecosystem.config.js)

| Process | Mode | Instances | Notes |
|---------|------|-----------|-------|
| `patentops-api` | cluster | max | max_memory_restart: 1G |
| `patentops-deadline-worker` | fork | 1 | cron_restart every 6h |
| `patentops-event-projector` | fork | 1 | autorestart |

## Constants & Enums Reference

Defined in `src/shared/types/index.ts`:

- **Roles** (9): client, inventor, paralegal, associate, reviewer, partner, foreign_associate, admin, system
- **Patent types** (3): invention, utility_model, design
- **Case statuses** (10): INTAKE → ... → CLOSED
- **Close reasons** (5): abandoned, withdrawn, rejected, lapsed, expired
- **Claim types** (2): independent, dependent
- **Claim categories** (5): method, apparatus, system, composition, use
- **Claim statuses** (5): draft, reviewed, filed, amended, cancelled
- **OA categories** (6): substantive_rejection, final_rejection, restriction, advisory, search_report, allowance
- **Rejection bases** (9): novelty, inventive_step, clarity, industrial_applicability, patent_eligibility, new_matter, double_patenting, unity_of_invention, other
- **OA statuses** (6): received, analyzing, strategizing, amending, review, filed
- **Risk ratings** (3): high, medium, low
- **Deadline types** (3): statutory, procedural, internal
- **Deadline source entity types** (5): case, office_action, fee, examination_request, priority_claim
- **Deadline statuses** (4): active, completed, waived, missed
- **Escalation levels**: 0–5
- **Conflict results** (3): clear, conflict_found, review_needed
- **Document types** (8): application, response, amendment, declaration, power_of_attorney, ids, search_report, fee_receipt
- **Document statuses** (3): draft, final, filed
- **Family relationship types** (5): continuation, divisional, continuation_in_part, provisional_to_nonprovisional, pct_national_phase
- **Fee types** (10): filing, search, examination, issue, annuity, extension, petition, foreign_filing, late_surcharge, reexamination
- **Fee statuses** (4): pending, paid, overdue, waived
- **AI watermark**: `'AI-GENERATED DRAFT — NOT LEGAL ADVICE'`

## How to Add New Features

### Adding a new domain aggregate
1. Create `src/domain/{name}/{name}-aggregate.ts` with commands, event emission, and `loadFromHistory`
2. Add event types to `src/shared/events/index.ts` (with payload interface + typed alias)
3. Add projection table to `src/infrastructure/database/schema.ts`
4. Add event handler to `src/workers/event-projector.ts`
5. Add Zod schemas to `src/api/schemas/{name}-schemas.ts`
6. Add routes to `src/api/routes/{name}-routes.ts` (register in `src/config/app.ts`)
7. Write tests: `{name}-aggregate.test.ts`

### Adding a new event type
1. Add to `EVENT_TYPES` array in `src/shared/events/index.ts`
2. Define payload interface + typed alias
3. Add to `DomainEvent` union type
4. Handle in `src/workers/event-projector.ts` if it affects projections
5. Emit from the appropriate aggregate command

### Adding a new API endpoint
1. Add Zod schema in `src/api/schemas/`
2. Add route handler in `src/api/routes/`
3. All routes must extract `tenant_id` from JWT context
4. All mutations must go through an aggregate and emit events

### Adding a new state transition
1. Add to `CASE_STATE_TRANSITIONS` or `OA_RESPONSE_TRANSITIONS` in `src/workflow/states/`
2. Specify allowed roles, `requires_human_review`, `requires_conflict_check`, `ai_sidecar_invoked` flags
3. Add test coverage for the new transition

## Testing

- Framework: Vitest (`npm test` / `npm run test:watch`)
- All test files co-located: `*.test.ts` next to source
- Every aggregate command must test: correct event emission, validation errors, state after replay
- State machines must test: valid transitions, invalid transitions, role enforcement
- Hash chain tests in `src/infrastructure/event-store/hash-chain.test.ts`
- Cross-tenant isolation test in `src/domain/case/cross-tenant-isolation.test.ts`

## Known Gaps

- `SpecificationAggregate` does not emit events yet (not integrated with event store)
- Event projector handles 16 of 37 event types
- IDS (Information Disclosure Statement) aggregate not yet implemented
- Inventor declaration management not yet implemented
- Notification channels (email/SMS escalation) not yet implemented
- PostgreSQL RLS policies not yet applied (schema only)
- QMS documents all in Draft status, no SOPs finalized
