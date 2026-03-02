# PatentOps Platform

Patent prosecution workflow management platform with event sourcing architecture. Designed for law firms, patent agencies, and IP professionals to manage the full patent lifecycle — from initial filing through grant and maintenance.

## Features

- **Case Management** — Track patent cases through a complete lifecycle: intake, drafting, review, filing, examination, office action response, allowance, grant, and closure
- **Office Action Workflow** — Structured sub-workflow for handling OA responses with AI-assisted analysis, strategy selection, amendment drafting, and mandatory human review
- **Deadline Engine** — Statutory and procedural deadline tracking with 6-level escalation (dashboard → email → SMS → all stakeholders). Missed deadlines auto-create incidents
- **Claim Management** — Version-controlled claims with amendment history, status tracking, and AI breadth scoring
- **Document Generation** — Template-based document generation with SHA-256 hash sealing for filing integrity
- **Conflict of Interest Check** — Automated fuzzy-matching at case intake with partner-level override for flagged conflicts
- **Patent Family Tracking** — Bidirectional family links (continuation, divisional, CIP, PCT national phase) with priority date validation
- **Fee Management** — Track filing, examination, issue, annuity, and extension fees with grace period and overdue detection
- **Prior Art Integration** — Multi-source prior art search with pluggable patent database adapters
- **AI Sidecar Integration** — AI-powered claim suggestions, OA analysis, breadth scoring, and amendment suggestions — all marked as DRAFT requiring human approval
- **Immutable Audit Trail** — Append-only event store with per-case SHA-256 hash chain for tamper detection
- **Multi-Tenant Isolation** — Complete data isolation via PostgreSQL Row-Level Security
- **Jurisdiction-Agnostic Core** — Generic OA categories, rejection bases, and deadline rules with jurisdiction plugin support

## Requirements

- Node.js >= 20
- PostgreSQL
- Redis

## Quick Start

### 1. Clone and install

```bash
git clone <repository-url>
cd agent.patentops-platform
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your database and Redis connection details:

```env
DATABASE_URL=postgresql://patentops:password@localhost:5432/patentops
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
PORT=7426
```

### 3. Development

```bash
npm run dev          # Start with hot reload (tsx watch)
```

The API server starts at `http://localhost:7426`. Health check: `GET /health`.

### 4. Production (PM2)

```bash
npm run build        # Compile TypeScript
npm run pm2:start    # Start all processes (API + workers)
npm run pm2:logs     # View logs
npm run pm2:stop     # Stop all processes
```

PM2 runs three processes:
| Process | Purpose |
|---------|---------|
| `patentops-api` | HTTP API server (cluster mode) |
| `patentops-deadline-worker` | Deadline sweep job (every 6 hours) |
| `patentops-event-projector` | Event → projection table sync |

## API Overview

All endpoints are prefixed with `/api/v1` and require JWT authentication (except `GET /health`).

### Cases
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/cases` | Create a new patent case |
| `GET` | `/cases/:case_id` | Get case details |
| `POST` | `/cases/:case_id/status` | Transition case status |
| `POST` | `/cases/:case_id/filing-receipt` | Record filing receipt |
| `POST` | `/cases/:case_id/close` | Close a case |
| `GET` | `/cases/:case_id/verify` | Verify hash chain integrity |
| `GET` | `/cases/:case_id/events` | Get all events for a case |

### Claims
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/cases/:case_id/claims` | Create a claim |
| `GET` | `/cases/:case_id/claims` | List claims |
| `GET` | `/cases/:case_id/claims/:claim_id` | Get a single claim |
| `POST` | `/cases/:case_id/claims/:claim_id/amend` | Amend claim text |
| `POST` | `/cases/:case_id/claims/:claim_id/status` | Change claim status |

### Office Actions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/cases/:case_id/office-actions` | Record a received office action |
| `GET` | `/cases/:case_id/office-actions` | List office actions |
| `POST` | `/cases/:case_id/office-actions/:oa_id/status` | Transition OA status |
| `POST` | `/cases/:case_id/office-actions/:oa_id/file` | File OA response |

### Deadlines
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/cases/:case_id/deadlines` | Create a deadline |
| `GET` | `/cases/:case_id/deadlines` | List deadlines |
| `POST` | `/cases/:case_id/deadlines/:deadline_id/complete` | Mark deadline completed |
| `POST` | `/cases/:case_id/deadlines/:deadline_id/extend` | Extend a deadline |

### Fees
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/cases/:case_id/fees` | Create a fee |
| `GET` | `/cases/:case_id/fees` | List fees |
| `POST` | `/cases/:case_id/fees/:fee_id/pay` | Record fee payment |
| `POST` | `/cases/:case_id/fees/:fee_id/waive` | Waive a fee |

### Patent Family
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/family/links` | Link two cases as family |
| `POST` | `/family/unlink` | Remove a family link |
| `GET` | `/cases/:case_id/family` | Get family links for a case |
| `POST` | `/cases/:case_id/priority-claims` | Record a priority claim |

### Conflict Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/cases/:case_id/conflict-check` | Run conflict check |
| `POST` | `/cases/:case_id/conflict-check/override` | Override conflict (partner only) |

### Prior Art
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/cases/:case_id/prior-art` | Add a prior art reference |
| `GET` | `/cases/:case_id/prior-art` | List prior art references |

## Case Lifecycle

```
INTAKE → DRAFTING → REVIEW → FILING → FILED → EXAMINATION_REQUESTED → OA_RECEIVED → ALLOWED → GRANTED → CLOSED
```

- **INTAKE** — New case, conflict check required before proceeding
- **DRAFTING** — Claims and specification in progress
- **REVIEW** — Mandatory human review checkpoint
- **FILING** — Approved, document generation in progress
- **FILED** — Filed with patent office
- **EXAMINATION_REQUESTED** — Substantive examination requested (required in some jurisdictions)
- **OA_RECEIVED** — Office action received, response workflow active
- **ALLOWED** — Notice of allowance, awaiting issue fee
- **GRANTED** — Patent issued, maintenance phase
- **CLOSED** — Terminated (abandoned, withdrawn, rejected, lapsed, expired)

Office actions cycle: `FILED ↔ OA_RECEIVED` can repeat.

## Roles

| Role | Description |
|------|-------------|
| `client` | Patent applicant/owner |
| `inventor` | Named inventor |
| `paralegal` | Docketing and administrative support |
| `associate` | Drafting attorney |
| `reviewer` | Senior attorney review |
| `partner` | Final authority, can override conflicts |
| `foreign_associate` | Correspondent in another jurisdiction |
| `admin` | System administrator |
| `system` | Automated processes |

## Testing

```bash
npm test             # Run all tests
npm run test:watch   # Watch mode
```

## Architecture

See [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) for detailed architecture documentation including state machine design, data model, security boundaries, and scalability model.

## License

Proprietary. All rights reserved.
