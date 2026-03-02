# PatentOps Platform — Development Conventions

## Project Overview
Patent prosecution workflow management SaaS with event sourcing architecture.
Runs on PM2 (Node.js/TypeScript).

## Architecture Rules
- **Event Sourcing**: Every state change emits an immutable event. Database tables are projections only.
- **AI as Sidecar**: AI Intelligence Layer is a sidecar service called by the Workflow Engine. AI never writes directly to the Evidence Ledger.
- **AI outputs are always DRAFT**: Only licensed professionals can mark artifacts as FINAL.
- **Hash integrity**: Filed versions must be SHA-256 hash-locked.
- **Multi-tenant isolation**: All queries must be tenant-scoped. Never mix tenant data.
- **Append-only ledger**: No UPDATE or DELETE on event store tables.

## Tech Stack
- Runtime: Node.js 20+ on PM2
- Language: TypeScript (strict mode)
- Framework: Fastify
- Database: PostgreSQL (via Drizzle ORM)
- Queue: BullMQ + Redis
- Validation: Zod
- Logging: Pino

## Code Conventions
- Use ULID for all entity IDs (not UUID)
- All timestamps in ISO 8601 UTC
- Event types use SCREAMING_SNAKE_CASE
- Domain types use PascalCase
- Files use kebab-case
- Every domain operation must emit at least one event
- Every event must include: tenant_id, event_id, case_id, correlation_id, causation_id, actor_id, actor_role, timestamp

## Directory Structure
- `src/domain/` — Domain aggregates (case, claim, deadline, office-action, conflict-check)
- `src/infrastructure/` — Event store, ledger, persistence
- `src/workflow/` — Workflow engine, state machines
- `src/ai/` — AI sidecar client interface
- `src/api/` — HTTP routes and handlers
- `src/document/` — Document generation pipeline
- `src/integration/` — External service integrations
- `src/workers/` — PM2 worker processes
- `src/shared/` — Shared types, events, utilities
- `governance/` — Control inventory, role matrix, RACI (audit artifacts)
- `audit/` — Evidence packages, findings log
- `qms/` — Quality management system docs

## Testing
- Use Vitest
- Domain logic must have unit tests
- Event emission must be tested for every state transition
- Workflow state machines must have transition coverage tests
