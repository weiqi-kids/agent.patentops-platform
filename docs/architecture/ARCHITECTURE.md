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
                           │ case_accepted (conflict check required)
                    ┌──────▼──────┐
              ┌─────│  DRAFTING   │─────┐
              │     └──────┬──────┘     │
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
              │     │   FILED     │◄────┤
              │     └──────┬──────┘     │
              │       │         │       │
              │       │    ┌────▼─────────────────┐
              │       │    │EXAMINATION_REQUESTED  │ (TW/EP/JP)
              │       │    └────┬─────────────────┘
              │       │         │
              │     ┌─▼─────────▼┐
              │     │ OA_RECEIVED │ ←── (can loop: FILED ↔ OA_RECEIVED)
              │     └──────┬─────┘
              │            │ allowed
              │     ┌──────▼──────┐
              │     │  ALLOWED    │ ← Notice of allowance / 核准審定
              │     └──────┬──────┘
              │            │ issue fee paid
              │     ┌──────▼──────┐
              │     │  GRANTED    │ ← Patent issued, maintenance phase
              │     └──────┬──────┘
              │            │ lapsed/expired
              │     ┌──────▼──────┐
              └────►│  CLOSED     │
                    └─────────────┘
```

States:
- `INTAKE` — Case created, conflict check pending
- `DRAFTING` — Claims and specification being drafted
- `REVIEW` — Human review of draft (mandatory checkpoint)
- `FILING` — Approved for filing, document generation in progress
- `FILED` — Filed with patent office, awaiting examination
- `EXAMINATION_REQUESTED` — Substantive examination requested (TW/EP/JP — some jurisdictions require separate request)
- `OA_RECEIVED` — Office Action received, response workflow triggered
- `ALLOWED` — Notice of allowance received, awaiting issue fee payment
- `GRANTED` — Patent issued, maintenance/annuity phase active
- `CLOSED` — Case terminated (abandoned, withdrawn, rejected, lapsed, expired)

### 4.2 Jurisdiction-Agnostic Design

This core platform uses **generic OA categories** and **generic rejection bases** that map to jurisdiction-specific terminology:

| Generic Category | US | TW | EP |
|-----------------|-----|-----|-----|
| `substantive_rejection` | Non-final OA | 審查意見通知 | Communication under Art. 94(3) |
| `final_rejection` | Final OA | 核駁審定 | Decision to refuse |
| `restriction` | Restriction requirement | 限制要求 | Unity objection |
| `allowance` | Notice of Allowance | 核准審定 | Decision to grant |

Each jurisdiction plugin provides:
- OA type mappings
- Rejection basis mappings (e.g., `novelty` → `35 USC §102` or `專利法§22-I-1`)
- Deadline rules (with jurisdiction-specific start date basis)
- Fee schedules and annuity rules

### 4.3 Office Action Response Sub-Workflow

Each OfficeAction entity has its own lifecycle, independent of the case-level state machine. A case may have multiple OAs progressing through this workflow concurrently.

```
┌──────────────┐
│  received    │
└──────┬───────┘
       │ start analysis (or skip → amending for simple OAs)
┌──────▼───────┐
│  analyzing   │ ← AI Sidecar: classify rejection, map cited art
└──────┬───────┘
       │ analysis complete
┌──────▼───────┐
│ strategizing │ ← AI Sidecar: suggest amendment strategies
└──────┬───────┘
       │ strategy selected
┌──────▼───────┐
│  amending    │ ← Attorney drafts amendments (AI-assisted)
└──────┬───────┘
       │ submitted for review
┌──────▼───────┐
│   review     │ ← Mandatory human review checkpoint
└──────┬───────┘  (can send back to amending)
       │ approved
┌──────▼───────┐
│   filed      │ ← Response filed with patent office
└──────────────┘
```

**Implemented in:** `src/workflow/states/oa-response-state-machine.ts`

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
├── inventor_ids (ULID[])
├── assigned_attorney_id
├── assigned_associate_id (nullable)
├── assigned_paralegal_id (nullable)
├── foreign_associate_id (nullable)
├── jurisdiction
├── filing_date
├── priority_date
├── parent_case_id (nullable, FK — for continuations/divisionals)
├── family_id (nullable, FK)
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
├── source_entity_type (case | office_action | maintenance | fee)
├── source_entity_id
├── due_date
├── rule_reference (statutory/regulatory source for this deadline)
├── warning_sent_at (JSON array of timestamps)
├── escalation_level (0-5)
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
├── role (client | inventor | paralegal | associate | reviewer | partner | foreign_associate | admin)
├── license_number (nullable)
├── jurisdiction (nullable — for foreign associates)
├── is_active
└── created_at

PatentFamilyLink
├── family_id (ULID)
├── tenant_id (FK)
├── parent_case_id (FK)
├── child_case_id (FK)
├── relationship_type (continuation | divisional | continuation_in_part | provisional_to_nonprovisional | pct_national_phase)
├── priority_date
└── created_at

Fee
├── fee_id (ULID)
├── case_id (FK)
├── tenant_id (FK)
├── fee_type (filing | search | examination | issue | maintenance_3_5 | maintenance_7_5 | maintenance_11_5 | extension | petition | foreign_filing)
├── amount
├── currency
├── due_date
├── status (pending | paid | overdue | waived)
├── paid_at (nullable)
├── payment_reference (nullable)
├── deadline_id (FK, nullable)
└── created_at

IdsRecord
├── ids_id (ULID)
├── case_id (FK)
├── tenant_id (FK)
├── references (JSON — IdsReference[])
├── status (draft | pending_review | approved | filed)
├── filed_date (nullable)
├── document_id (FK, nullable)
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

## 9. Compliance & Governance

### Patent Prosecution Governance

This platform's governance structure is designed specifically for patent prosecution workflows, not adapted from financial audit frameworks. The core governance requirements come from:

- **Professional responsibility rules** (e.g., USPTO Rules of Professional Conduct)
- **Statutory deadline obligations** (e.g., 37 CFR response periods)
- **Duty of candor** (37 CFR 1.56 — duty to disclose material prior art)
- **Attorney-client privilege** boundaries
- **Prosecution history estoppel** tracking requirements

### Governance Artifacts

- **Control Inventory**: `/governance/control-inventory.json` — prosecution and platform integrity controls
- **Role Matrix**: `/governance/role-matrix.json` — RBAC with patent-specific roles (paralegal, inventor, foreign associate)
- **RACI Matrix**: `/governance/raci-matrix.json` — responsibility assignment for 14 prosecution processes
- **Risk Register**: `/qms/risk-register.json` — 12 risks including IDS duty, fee management, patent family integrity
- **Findings Log**: `/audit/findings-log.json` — incident and deviation tracking

### Evidence Structure: Per-Case File Wrapper

Evidence is organized per case, not in quarterly batches. The patent case file wrapper is the natural unit of evidence:

```
/cases/{case_id}/
├── events/          ← complete event chain for this case
├── filings/         ← filed documents with hashes
├── claims/          ← claim version history
├── office-actions/  ← received OAs and responses
├── ids/             ← IDS filings and reference tracking
├── declarations/    ← inventor oath/declaration
└── correspondence/  ← client communications
```

### Hash Chain Integrity
- Every filed document has a SHA-256 hash stored in the event ledger
- Hash chain per case enables independent verification and tamper detection
- Verification is exhaustive (every event), not sampled — event sourcing makes this possible

### Professional Liability Controls
- All AI outputs watermarked: `AI-GENERATED DRAFT — NOT LEGAL ADVICE`
- Human approval checkpoints enforced by state machine (cannot skip)
- Only licensed professionals (reviewer/partner) can mark FINAL or FILE
- Amendment lineage tracking: full diff history from original to filed version
- Actor identity and role recorded on every state transition
- IDS completeness tracking: system warns when known prior art lacks IDS coverage
- Conflict of interest: mandatory gate at INTAKE, partner-level override with justification

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

The most critical operational module. A missed patent deadline can result in irrecoverable loss of rights.

**Responsibilities:**
- Calculate statutory deadlines from Office Action dates (jurisdiction-specific rules)
- Deadline calculation rules are **traceable to statutory/regulatory sources** (e.g., "37 CFR 1.111")
- Track procedural deadlines (internal review windows)
- Track fee payment deadlines (filing fees, maintenance fees, extension fees)
- Multi-level escalation: dashboard → email → SMS → all stakeholders
- Support deadline extensions (e.g., USPTO 3-month + extension fees)
- Daily sweep job + real-time event-triggered recalculation
- Paralegal is the primary operator; escalation reaches attorney → partner

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

### 12.5 IDS / Duty of Candor Tracker

**Why this exists:** Under 37 CFR 1.56, patent applicants have a duty to disclose all known material prior art to the USPTO. Failure to do so can render a granted patent unenforceable due to inequitable conduct. This is not optional.

**Responsibilities:**
- Track all known prior art references per case (from OA citations, applicant disclosures, search results)
- Track IDS filing status: which references have been covered by filed IDS
- Warn when references exist but no IDS has been filed covering them
- Warn when a case is approaching CLOSED(granted) with uncovered references
- Maintain complete reference → IDS mapping for audit

**Flow:**
```
Prior Art Reference Added → System checks IDS coverage
    → If uncovered: IDS_COVERAGE_WARNING event emitted
    → Paralegal/Associate prepares IDS draft
    → Reviewer approves IDS
    → IDS filed with patent office
    → IDS_FILED event with content hash
```

### 12.6 Fee Management

**Responsibilities:**
- Track all prosecution fees per case (filing, search, examination, issue, extensions)
- Track maintenance fee deadlines (3.5, 7.5, 11.5 year windows for US patents)
- Integrate with Deadline Engine — fee deadlines use the same escalation chain
- Record fee payments with payment references
- Support fee waivers (with partner approval and documented reason)

**Fee deadlines are treated with the same severity as OA response deadlines** — a missed maintenance fee can result in patent lapse.

### 12.7 Patent Family Tracker

**Responsibilities:**
- Track relationships between related applications: continuation, divisional, CIP, provisional→non-provisional, PCT national phase
- Enforce bidirectional links (if case A is parent of case B, case B must reference case A)
- Validate priority date chains (child's priority date must align with parent's filing date)
- Display family tree visualization in portal

**Rules:**
- Family links are recorded as events in the ledger
- Priority claims require reviewer-level approval
- Inconsistent priority dates are flagged automatically

### 12.8 Inventor Declaration Management

**Responsibilities:**
- Track which inventors need to sign oath/declaration for each case
- Generate declaration documents from templates
- Track signature status per inventor
- Warn when declarations are outstanding as case approaches filing
- Record signed declarations with content hash in ledger
