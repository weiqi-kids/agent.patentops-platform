# PatentOps Platform — Master Architecture Document

Version: 1.1
Last Updated: 2026-03-02

---

## 1. Business Objective

Build a professional-grade PatentOps SaaS platform for accounting firms, legal advisors, and patent professionals. The platform manages:

- **Patent Prosecution Workflow**: From initial filing through grant
- **Office Action Response**: Classification, analysis, amendment strategy, and response filing
- **Deadline Management**: Statutory and procedural deadline tracking with escalation
- **Evidence Integrity**: Immutable audit trail for every action and artifact

Each market (jurisdiction) is a separate project/deployment. This core platform defines the shared architecture.

---

## 2. Layered Architecture

```
┌─────────────────────────────────────────────┐
│            Client Portal Layer              │
│   (Web UI, API consumers, notifications)    │
├─────────────────────────────────────────────┤
│          Workflow Engine Layer               │
│   (State machines, approvals, routing)      │
│                    ↕                        │
│          AI Intelligence Layer (Sidecar)    │
│   (Claim drafting, OA analysis, scoring)    │
├─────────────────────────────────────────────┤
│          Evidence Ledger Layer              │
│   (Event store, hash chain, audit trail)    │
└─────────────────────────────────────────────┘
```

### Critical Architectural Decision: AI as Sidecar

The AI Intelligence Layer operates as a **sidecar service**, invoked exclusively by the Workflow Engine. AI never writes directly to the Evidence Ledger.

Flow:
```
Client Portal → Workflow Engine → (calls) AI Sidecar
                                       ↓
                              AI returns DRAFT output
                                       ↓
                        Workflow Engine presents to human
                                       ↓
                        Human approves/rejects/amends
                                       ↓
                        Workflow Engine → Evidence Ledger
```

This ensures every AI output passes through a human checkpoint before becoming part of the official record.

---

## 3. Risk Boundary Analysis

### Liability Boundaries

| Boundary | Rule | Enforcement |
|----------|------|-------------|
| AI → Human | All AI outputs are DRAFT status | System-level enum constraint |
| Human → Filed | Only `reviewer` or `partner` roles can mark FINAL | RBAC + event validation |
| Filed → Ledger | Filed artifacts are SHA-256 hash-locked | Immutable event store |
| Tenant → Tenant | Complete data isolation | Row-level security + schema prefix |

### Risk Categories

| Risk | Severity | Mitigation |
|------|----------|------------|
| Missed deadline | Critical | Deadline Engine with multi-channel escalation |
| AI hallucination in claims | High | Mandatory human review, DRAFT watermark |
| Unauthorized amendment | High | Role-based state transitions, event audit |
| Data leak between tenants | Critical | PostgreSQL RLS, tenant_id on every query |
| Evidence tampering | Critical | Append-only ledger, hash chain verification |
| Conflict of interest | High | Automated conflict check at case intake |

---

## 4. State Machine Design

### 4.1 Patent Case Lifecycle

```
                    ┌─────────────┐
                    │   INTAKE    │
                    └──────┬──────┘
                           │ case_accepted
                    ┌──────▼──────┐
              ┌─────│  DRAFTING   │─────┐
              │     └──────┬──────┘     │
              │            │ draft_     │ case_
              │            │ submitted  │ withdrawn
              │     ┌──────▼──────┐     │
              │     │  REVIEW     │     │
              │     └──────┬──────┘     │
              │            │ approved   │
              │     ┌──────▼──────┐     │
              │     │  FILING     │     │
              │     └──────┬──────┘     │
              │            │ filed      │
              │     ┌──────▼──────┐     │
              │     │  PENDING    │◄────┤
              │     └──────┬──────┘     │
              │            │            │
              │     ┌──────▼──────┐     │
              │     │  OA_RECEIVED│     │
              │     └──────┬──────┘     │
              │            │ response_  │
              │            │ filed      │
              │     ┌──────▼──────┐     │
              │     │  PENDING    │     │ (loop)
              │     └──────┬──────┘     │
              │            │ granted    │
              │     ┌──────▼──────┐     │
              └────►│  CLOSED     │◄────┘
                    └─────────────┘
```

States:
- `INTAKE` — Case created, conflict check pending
- `DRAFTING` — Claims and specification being drafted
- `REVIEW` — Human review of draft (mandatory checkpoint)
- `FILING` — Approved for filing, document generation in progress
- `PENDING` — Filed with patent office, awaiting response
- `OA_RECEIVED` — Office Action received, response workflow triggered
- `CLOSED` — Case granted, withdrawn, or abandoned

### 4.2 Office Action Response Workflow

```
┌──────────────┐
│  OA_RECEIVED │
└──────┬───────┘
       │ oa_classified
┌──────▼───────┐
│  ANALYZING   │ ← AI Sidecar: classify rejection, map cited art
└──────┬───────┘
       │ analysis_complete
┌──────▼───────┐
│  STRATEGIZING│ ← AI Sidecar: suggest amendment strategies
└──────┬───────┘
       │ strategy_selected
┌──────▼───────┐
│  AMENDING    │ ← Attorney drafts amendments (AI-assisted)
└──────┬───────┘
       │ amendment_reviewed
┌──────▼───────┐
│  OA_REVIEW   │ ← Mandatory human review checkpoint
└──────┬───────┘
       │ approved
┌──────▼───────┐
│  OA_FILING   │ ← Generate response document, file
└──────────────┘
```

---

## 5. Data Model

### Core Aggregates

```
Tenant
├── tenant_id (ULID)
├── name
├── plan_tier
├── settings
└── created_at

Case
├── case_id (ULID)
├── tenant_id (FK)
├── case_number (jurisdiction-specific)
├── title
├── status (state machine)
├── applicant_id
├── assigned_attorney_id
├── assigned_associate_id
├── jurisdiction
├── filing_date
├── priority_date
├── current_version
└── created_at

Claim
├── claim_id (ULID)
├── case_id (FK)
├── version
├── claim_number
├── claim_type (independent | dependent)
├── depends_on_claim_id (nullable, FK)
├── claim_text
├── status (draft | reviewed | filed | amended)
├── breadth_score (nullable)
├── ai_generated (boolean)
├── created_by_actor_id
└── created_at

OfficeAction
├── oa_id (ULID)
├── case_id (FK)
├── oa_type (non_final | final | restriction | advisory)
├── received_date
├── response_deadline
├── extended_deadline (nullable)
├── cited_references (JSON)
├── rejection_type (102 | 103 | 112 | other)
├── status (received | analyzing | strategizing | amending | review | filed)
├── risk_rating (high | medium | low)
└── created_at

Deadline
├── deadline_id (ULID)
├── case_id (FK)
├── tenant_id (FK)
├── deadline_type (statutory | procedural | internal)
├── source_entity_type (case | office_action | maintenance)
├── source_entity_id
├── due_date
├── warning_sent_at (JSON array of timestamps)
├── escalation_level (0-3)
├── status (active | completed | waived | missed)
└── created_at

ConflictCheck
├── check_id (ULID)
├── tenant_id (FK)
├── case_id (FK)
├── checked_against_parties (JSON)
├── result (clear | conflict_found | review_needed)
├── reviewed_by_actor_id
├── reviewed_at
└── created_at

Document
├── document_id (ULID)
├── case_id (FK)
├── document_type (application | response | amendment | IDS | declaration)
├── version
├── template_id
├── content_hash (SHA-256)
├── status (draft | final | filed)
├── generated_at
├── finalized_by_actor_id
├── finalized_at
└── file_path

Actor
├── actor_id (ULID)
├── tenant_id (FK)
├── email
├── name
├── role (client | associate | reviewer | partner | admin)
├── license_number (nullable)
├── is_active
└── created_at
```

---

## 6. Event Schema (Enhanced)

All workflow transitions emit events in this format:

```json
{
  "event_id": "ULID",
  "tenant_id": "ULID",
  "case_id": "string",
  "event_type": "STATE_TRANSITION | ARTIFACT_CREATED | CLAIM_AMENDED | DEADLINE_SET | DEADLINE_WARNING | CONFLICT_CHECKED | DOCUMENT_GENERATED | OA_ANALYZED | AI_DRAFT_CREATED",
  "actor_id": "ULID",
  "actor_role": "client | associate | reviewer | partner | system",
  "correlation_id": "ULID — groups all events from a single business operation",
  "causation_id": "ULID — the event_id that directly caused this event",
  "timestamp": "ISO8601 UTC",
  "previous_hash": "SHA-256 of previous event in this case's chain",
  "new_hash": "SHA-256 of this event payload",
  "payload": {
    "from_state": "string (for state transitions)",
    "to_state": "string (for state transitions)",
    "artifact_type": "string (optional)",
    "artifact_hash": "string (optional)",
    "diff": "object (optional, for amendments)"
  },
  "metadata": {}
}
```

### Event Immutability Rules
- Events are INSERT-only. No UPDATE, no DELETE.
- Each event's `new_hash` is computed over: `event_id + case_id + event_type + actor_id + timestamp + JSON(payload) + previous_hash`
- The hash chain per case enables tamper detection.
- Events are the source of truth. All read-model tables are projections rebuilt from events.

---

## 7. Human-AI Interaction Flow

### Claim Drafting Assistance

```
Attorney → Workflow Engine: "Generate claim suggestions for case X"
    Workflow Engine → AI Sidecar: { case_context, prior_art, spec_summary }
    AI Sidecar → Workflow Engine: { suggested_claims[], breadth_scores[], reasoning }
    Workflow Engine: Creates ARTIFACT_CREATED event (status: AI_DRAFT)
Attorney → Reviews suggestions in Portal
Attorney → Edits/accepts/rejects each claim
    Workflow Engine: Creates CLAIM_AMENDED events for each change
Reviewer → Reviews final claims
    Workflow Engine: Creates STATE_TRANSITION (REVIEW → FILING)
```

### Office Action Analysis

```
System → Detects OA received (via integration or manual upload)
    Workflow Engine → AI Sidecar: { oa_document, case_claims, cited_art }
    AI Sidecar → Workflow Engine: {
        rejection_classification,
        claim_limitation_mapping,
        amendment_strategies[],  // multiple options with risk ratings
        legal_reasoning_summary  // labeled as AI-GENERATED
    }
    Workflow Engine: Creates OA_ANALYZED event (status: AI_DRAFT)
Attorney → Reviews analysis, selects strategy
Attorney → Drafts amendments (AI-assisted)
Reviewer → Mandatory review checkpoint
    Workflow Engine: Creates STATE_TRANSITION (OA_REVIEW → OA_FILING)
```

---

## 8. Multi-Tenant Isolation Strategy

### Database Level
- PostgreSQL Row-Level Security (RLS) policies on all tables
- Every table includes `tenant_id` column (NOT NULL)
- Application-level middleware sets `current_setting('app.tenant_id')` per request
- No cross-tenant JOINs permitted

### Application Level
- Tenant context extracted from JWT on every request
- All repository queries automatically scoped by tenant_id
- Event store partitioned by tenant_id
- File storage organized by tenant: `/{tenant_id}/cases/{case_id}/...`

### Infrastructure Level (future)
- Per-tenant encryption keys (envelope encryption)
- Tenant-aware rate limiting
- Data residency compliance per tenant configuration

---

## 9. Compliance Considerations

### Audit Trail Requirements (Inspired by SOC1 / ISQM1)

The governance structure follows patterns from the Assurance Ledger Platform:

- **Control Inventory**: `/governance/control-inventory.json` — all controls with owner, frequency, evidence types
- **Role Matrix**: `/governance/role-matrix.json` — RBAC role definitions
- **RACI Matrix**: `/governance/raci-matrix.json` — responsibility assignment
- **Evidence Packages**: `/audit/evidence-packages/YYYY-QX/` — quarterly evidence packs with manifest, hash, attestation
- **Findings Log**: `/audit/findings-log.json` — deviation tracking
- **Risk Register**: `/qms/risk-register.json` — risk identification and mitigation

### Evidence Hash Chain
- Every filed document has a SHA-256 hash stored in the event ledger
- Hash chain per case enables independent verification
- Quarterly evidence packs include hash recomputation proof

### Professional Liability
- All AI outputs watermarked: `AI-GENERATED DRAFT — NOT LEGAL ADVICE`
- Human approval checkpoints enforced by state machine (cannot skip)
- Amendment lineage tracking: full diff history from original to filed version
- Actor identity recorded on every state transition

---

## 10. Scalability Model

### Runtime
- PM2 cluster mode for API servers
- Dedicated PM2 workers for: deadline monitoring, event projection
- BullMQ for async job processing (document generation, AI calls, notifications)
- Redis for caching projections and job queues

### Database
- Event store: append-only, partitioned by tenant_id + year
- Projection tables: can be rebuilt from events
- Read replicas for portal queries (future)

### Growth Path
```
Phase 1: Single PostgreSQL + Redis, PM2 on single server
Phase 2: Read replicas, dedicated Redis cluster
Phase 3: Per-tenant database schemas (if regulatory requires)
Phase 4: Multi-region deployment (per jurisdiction requirements)
```

---

## 11. Monetization Hooks

Built-in tracking points for billing:

| Metric | Description |
|--------|-------------|
| Cases created | Per-case billing |
| AI operations invoked | AI usage metering |
| Documents generated | Document generation fees |
| Storage consumed | Per-tenant storage billing |
| Active users | Per-seat licensing |
| OA responses filed | Transaction-based billing |

Billing events are emitted to the event store like any other event, ensuring auditability.

---

## 12. Key Modules

### 12.1 Deadline Engine

The most critical operational module. A missed patent deadline can result in loss of rights.

**Responsibilities:**
- Calculate statutory deadlines from Office Action dates (jurisdiction-specific rules)
- Track procedural deadlines (internal review windows)
- Multi-level escalation: email → dashboard alert → manager notification → partner escalation
- Support deadline extensions (e.g., USPTO 3-month + extension fees)
- Daily sweep job + real-time event-triggered recalculation

**Escalation Matrix:**
| Days Before Due | Level | Action |
|----------------|-------|--------|
| 30 | Info | Dashboard indicator |
| 14 | Warning | Email to assigned attorney |
| 7 | Urgent | Email to attorney + manager |
| 3 | Critical | Email to attorney + manager + partner |
| 1 | Emergency | All channels + system flag |
| 0 (missed) | Incident | Auto-create incident record, notify all stakeholders |

### 12.2 Document Generation Pipeline

**Flow:**
```
Template Selection → Data Binding → Draft Preview → Human Approval → Hash + Seal → Export
```

- Handlebars templates for each document type per jurisdiction
- PDF generation for filing
- Hash computation on final output (SHA-256)
- Version tracking: every generated document is a new version, never overwritten
- Template versioning: templates are also version-controlled

**Supported Document Types (MVP):**
- Patent Application (specification, claims, abstract, drawings placeholder)
- Office Action Response
- Amendment
- Information Disclosure Statement (IDS)
- Declaration / Oath

### 12.3 Prior Art Integration Interface

**Phase 1 (MVP):** Manual upload + AI analysis
- Upload cited references from Office Actions
- AI Sidecar analyzes relevance to claim limitations
- Structured mapping output: { cited_ref → claim_limitation → relevance_score }

**Phase 2:** API integration
- USPTO PAIR / Patent Center API
- EPO Open Patent Services
- WIPO PATENTSCOPE
- Google Patents (search)

**Phase 3:** Proactive monitoring
- Watch for new publications in relevant classification codes
- Alert when potentially conflicting art is published

### 12.4 Conflict of Interest Check

**Trigger:** Automatically at case INTAKE, before acceptance.

**Check Logic:**
- Search existing cases for matching applicant names (fuzzy match)
- Search for opposing parties across all active cases in the tenant
- Flag potential conflicts: same technology area + competing applicants
- Result: `CLEAR` | `CONFLICT_FOUND` | `REVIEW_NEEDED`

**Rules:**
- Case cannot proceed past INTAKE without conflict check completion
- CONFLICT_FOUND requires partner-level review and explicit override with documented justification
- All conflict check results are recorded as events in the ledger
