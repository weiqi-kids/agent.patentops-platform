# PatentOps Platform — Development Conventions

## Project Overview
Patent prosecution workflow management SaaS with event sourcing architecture.
Runs on PM2 (Node.js/TypeScript). Each jurisdiction is a separate project; this is the core platform.

**Core platform is jurisdiction-agnostic.** Jurisdiction-specific rules (OA types, rejection bases, fee schedules, deadline rules) are injected via jurisdiction plugins. Do not hardcode any single jurisdiction's terminology or rules into the core platform.

## Architecture Rules
- **Event Sourcing**: Every state change emits an immutable event. Database tables are projections only.
- **AI as Sidecar**: AI Intelligence Layer is a sidecar service called by the Workflow Engine. AI never writes directly to the Evidence Ledger.
- **AI outputs are always DRAFT**: Only licensed professionals (reviewer/partner) can mark artifacts as FINAL.
- **Hash integrity**: Filed versions must be SHA-256 hash-locked. Hash chain per case for tamper detection.
- **Multi-tenant isolation**: All queries must be tenant-scoped. Never mix tenant data. PostgreSQL RLS enforced.
- **Append-only ledger**: No UPDATE or DELETE on event store tables.
- **Deadline integrity**: Deadline calculation rules must be traceable to statutory/regulatory sources. Start date basis varies by jurisdiction (mailing_date, received_date, service_date).
- **Jurisdiction-agnostic core**: OA categories, rejection bases, fee types, deadline rules use generic terms. Jurisdiction plugins provide mappings.
- **Patent family integrity**: Family links must be bidirectional; priority dates validated against parent filing dates.

## Tech Stack
- Runtime: Node.js 20+ on PM2
- Language: TypeScript (strict mode)
- Framework: Fastify
- Database: PostgreSQL (via Drizzle ORM)
- Queue: BullMQ + Redis
- Validation: Zod
- Logging: Pino
- Testing: Vitest

## Code Conventions
- Use ULID for all entity IDs (not UUID)
- All timestamps in ISO 8601 UTC
- Event types use SCREAMING_SNAKE_CASE
- Domain types use PascalCase
- Files use kebab-case
- Every domain operation must emit at least one event
- Every event must include: tenant_id, event_id, case_id, correlation_id, causation_id, actor_id, actor_role, timestamp
- Roles: client, inventor, paralegal, associate, reviewer, partner, foreign_associate, admin, system
- Patent types: invention, utility_model, design
- OA categories (generic): substantive_rejection, final_rejection, restriction, advisory, search_report, allowance
- Rejection bases (generic): novelty, inventive_step, clarity, industrial_applicability, patent_eligibility, new_matter, double_patenting, unity_of_invention, other

## Case Lifecycle States
```
INTAKE → DRAFTING → REVIEW → FILING → FILED → EXAMINATION_REQUESTED → OA_RECEIVED → ALLOWED → GRANTED → CLOSED
```
- `FILED` replaces `PENDING` (clearer semantics)
- `EXAMINATION_REQUESTED` for jurisdictions requiring separate exam request (TW/EP/JP)
- `ALLOWED` for notice of allowance / 核准審定
- `GRANTED` for issued patents in maintenance phase
- `CLOSED` for terminated cases (abandoned, withdrawn, rejected, lapsed, expired)
- OA cycle: FILED → OA_RECEIVED → FILED (can repeat)

## OA Response Sub-workflow
Each OfficeAction has its own lifecycle:
```
RECEIVED → ANALYZING → STRATEGIZING → AMENDING → REVIEW → FILED
```

## Directory Structure
- `src/domain/` — Domain aggregates (case, claim, deadline, conflict-check)
- `src/infrastructure/` — Event store, database schema, ledger
- `src/workflow/` — Workflow engine, state machines (case + OA response)
- `src/ai/` — AI sidecar client interface
- `src/api/` — HTTP routes, middleware, Zod schemas
- `src/document/` — Document generation pipeline
- `src/integration/` — External service integrations (prior art databases)
- `src/workers/` — PM2 worker processes (deadline sweep, event projector)
- `src/shared/` — Shared types, events, utilities
- `src/config/` — Application factory, configuration
- `governance/` — Control inventory, role matrix, RACI matrix
- `audit/` — Findings log, incident tracking
- `qms/` — Risk register, document index

## Evidence Structure
Evidence is per-case (file wrapper), not quarterly batches:
```
/cases/{case_id}/events/         — event chain
/cases/{case_id}/filings/        — filed documents with hashes
/cases/{case_id}/claims/         — claim version history
/cases/{case_id}/office-actions/ — OAs and responses
/cases/{case_id}/declarations/   — inventor oath/declaration
```

## Testing
- Use Vitest
- Domain logic must have unit tests
- Event emission must be tested for every state transition
- Workflow state machines must have transition coverage tests
- Hash chain verification must be tested
- Cross-tenant isolation must be tested
- Conflict check logic must be tested
