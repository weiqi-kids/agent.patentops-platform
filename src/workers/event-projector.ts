/**
 * Event Projector Worker
 *
 * PM2-managed worker process that subscribes to the event stream and
 * updates projection tables (materialized views) in real time.
 *
 * Projections are read-only views optimized for querying.
 * They can always be rebuilt from the event store.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import {
  cases,
  claims,
  officeActions,
  deadlines,
  conflictChecks,
  documents,
  fees,
  priorArtReferences,
} from '../infrastructure/database/schema.js';
import type { DomainEvent } from '../shared/events/index.js';
import type {
  CaseCreatedPayload,
  CaseStatusChangedPayload,
  FilingReceiptPayload,
  PatentGrantedPayload,
  ClaimCreatedPayload,
  ClaimAmendedPayload,
  OaReceivedPayload,
  DeadlineCreatedPayload,
  ConflictCheckCompletedPayload,
  DocumentGeneratedPayload,
} from '../shared/events/index.js';
import pino from 'pino';

const logger = pino({ name: 'event-projector' });

type DB = NodePgDatabase<Record<string, never>>;

/**
 * Project a single event to the appropriate read-model table.
 */
export async function projectEvent(db: DB, event: DomainEvent): Promise<void> {
  try {
    switch (event.event_type) {
      case 'CASE_CREATED':
        await projectCaseCreated(db, event);
        break;
      case 'CASE_STATUS_CHANGED':
        await projectCaseStatusChanged(db, event);
        break;
      case 'CASE_CLOSED':
        await projectCaseClosed(db, event);
        break;
      case 'FILING_RECEIPT_RECORDED':
        await projectFilingReceipt(db, event);
        break;
      case 'PATENT_GRANTED':
        await projectPatentGranted(db, event);
        break;
      case 'CLAIM_CREATED':
        await projectClaimCreated(db, event);
        break;
      case 'CLAIM_AMENDED':
        await projectClaimAmended(db, event);
        break;
      case 'CLAIM_STATUS_CHANGED':
        await projectClaimStatusChanged(db, event);
        break;
      case 'OA_RECEIVED':
        await projectOaReceived(db, event);
        break;
      case 'DEADLINE_CREATED':
        await projectDeadlineCreated(db, event);
        break;
      case 'DEADLINE_COMPLETED':
        await projectDeadlineCompleted(db, event);
        break;
      case 'DEADLINE_MISSED':
        await projectDeadlineMissed(db, event);
        break;
      case 'CONFLICT_CHECK_COMPLETED':
        await projectConflictCheckCompleted(db, event);
        break;
      case 'DOCUMENT_GENERATED':
        await projectDocumentGenerated(db, event);
        break;
      case 'FEE_CREATED':
        await projectFeeCreated(db, event);
        break;
      case 'FEE_PAYMENT_RECORDED':
        await projectFeePayment(db, event);
        break;
      case 'PRIOR_ART_REFERENCE_ADDED':
        await projectPriorArtAdded(db, event);
        break;
      default:
        logger.debug({ event_type: event.event_type }, 'No projection handler');
    }
  } catch (err) {
    logger.error({ err, event_type: event.event_type, event_id: event.event_id }, 'Projection failed');
    throw err;
  }
}

// ─── Case Projections ──────────────────────────────────────────────

async function projectCaseCreated(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as CaseCreatedPayload;
  await db.insert(cases).values({
    case_id: event.case_id,
    tenant_id: event.tenant_id,
    patent_type: p.patent_type,
    title: p.title,
    status: 'INTAKE',
    applicant_id: p.applicant_id,
    inventor_ids: p.inventor_ids,
    assigned_attorney_id: p.assigned_attorney_id,
    jurisdiction: p.jurisdiction,
    priority_date: p.priority_date ? new Date(p.priority_date) : null,
    parent_case_id: p.parent_case_id,
    created_at: new Date(event.timestamp),
  });
}

async function projectCaseStatusChanged(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as CaseStatusChangedPayload;
  await db
    .update(cases)
    .set({ status: p.to_state })
    .where(eq(cases.case_id, event.case_id));
}

async function projectCaseClosed(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as { from_state: string; close_reason: string };
  await db
    .update(cases)
    .set({ status: 'CLOSED', close_reason: p.close_reason })
    .where(eq(cases.case_id, event.case_id));
}

async function projectFilingReceipt(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as FilingReceiptPayload;
  await db
    .update(cases)
    .set({
      application_number: p.application_number,
      filing_date: new Date(p.filing_date),
    })
    .where(eq(cases.case_id, event.case_id));
}

async function projectPatentGranted(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as PatentGrantedPayload;
  await db
    .update(cases)
    .set({
      patent_number: p.patent_number,
      grant_date: new Date(p.grant_date),
    })
    .where(eq(cases.case_id, event.case_id));
}

// ─── Claim Projections ─────────────────────────────────────────────

async function projectClaimCreated(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as ClaimCreatedPayload;
  await db.insert(claims).values({
    claim_id: p.claim_id,
    case_id: event.case_id,
    tenant_id: event.tenant_id,
    claim_number: p.claim_number,
    claim_type: p.claim_type,
    claim_category: p.claim_category,
    depends_on_claim_id: p.depends_on_claim_id,
    claim_text: p.claim_text,
    status: 'draft',
    ai_generated: p.ai_generated,
    created_by_actor_id: event.actor_id,
    created_at: new Date(event.timestamp),
  });
}

async function projectClaimAmended(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as ClaimAmendedPayload;
  await db
    .update(claims)
    .set({
      version: p.new_version,
      claim_text: p.new_text,
      status: 'amended',
    })
    .where(eq(claims.claim_id, p.claim_id));
}

async function projectClaimStatusChanged(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as { claim_id: string; to_status: string };
  await db
    .update(claims)
    .set({ status: p.to_status })
    .where(eq(claims.claim_id, p.claim_id));
}

// ─── Office Action Projections ─────────────────────────────────────

async function projectOaReceived(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as OaReceivedPayload;
  await db.insert(officeActions).values({
    oa_id: p.oa_id,
    case_id: event.case_id,
    tenant_id: event.tenant_id,
    oa_category: p.oa_category,
    oa_type_label: p.oa_type_label,
    mailing_date: new Date(p.mailing_date),
    received_date: new Date(p.received_date),
    response_deadline: new Date(p.response_deadline),
    cited_references: p.cited_references,
    rejection_bases: p.rejection_bases,
    statutory_references: p.statutory_references,
    status: 'received',
    sequence_number: p.sequence_number,
    created_at: new Date(event.timestamp),
  });
}

// ─── Deadline Projections ──────────────────────────────────────────

async function projectDeadlineCreated(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as DeadlineCreatedPayload;
  await db.insert(deadlines).values({
    deadline_id: p.deadline_id,
    case_id: event.case_id,
    tenant_id: event.tenant_id,
    deadline_type: p.deadline_type,
    source_entity_type: p.source_entity_type,
    source_entity_id: p.source_entity_id,
    due_date: new Date(p.due_date),
    rule_reference: p.rule_reference,
    status: 'active',
    created_at: new Date(event.timestamp),
  });
}

async function projectDeadlineCompleted(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as { deadline_id: string };
  await db
    .update(deadlines)
    .set({ status: 'completed' })
    .where(eq(deadlines.deadline_id, p.deadline_id));
}

async function projectDeadlineMissed(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as { deadline_id: string };
  await db
    .update(deadlines)
    .set({ status: 'missed' })
    .where(eq(deadlines.deadline_id, p.deadline_id));
}

// ─── Conflict Check Projections ────────────────────────────────────

async function projectConflictCheckCompleted(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as ConflictCheckCompletedPayload;
  await db.insert(conflictChecks).values({
    check_id: p.check_id,
    tenant_id: event.tenant_id,
    case_id: event.case_id,
    checked_against_parties: p.checked_parties,
    result: p.result,
    created_at: new Date(event.timestamp),
  });
}

// ─── Document Projections ──────────────────────────────────────────

async function projectDocumentGenerated(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as DocumentGeneratedPayload;
  await db.insert(documents).values({
    document_id: p.document_id,
    case_id: event.case_id,
    tenant_id: event.tenant_id,
    document_type: p.document_type,
    version: p.version,
    template_id: p.template_id,
    content_hash: p.content_hash,
    status: 'draft',
    file_path: p.file_path,
    generated_at: new Date(event.timestamp),
  });
}

// ─── Fee Projections ───────────────────────────────────────────────

async function projectFeeCreated(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as { fee_id: string; fee_type: string; fee_label: string; amount: number; currency: string; due_date: string; deadline_id: string | null };
  await db.insert(fees).values({
    fee_id: p.fee_id,
    case_id: event.case_id,
    tenant_id: event.tenant_id,
    fee_type: p.fee_type,
    fee_label: p.fee_label,
    amount: String(p.amount),
    currency: p.currency,
    due_date: new Date(p.due_date),
    deadline_id: p.deadline_id,
    status: 'pending',
    created_at: new Date(event.timestamp),
  });
}

async function projectFeePayment(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as { fee_id: string; paid_at: string; payment_reference: string };
  await db
    .update(fees)
    .set({
      status: 'paid',
      paid_at: new Date(p.paid_at),
      payment_reference: p.payment_reference,
    })
    .where(eq(fees.fee_id, p.fee_id));
}

// ─── Prior Art Projections ─────────────────────────────────────────

async function projectPriorArtAdded(db: DB, event: DomainEvent): Promise<void> {
  const p = event.payload as { reference_id: string; reference_type: string; document_number: string; title: string; source: string };
  await db.insert(priorArtReferences).values({
    reference_id: p.reference_id,
    case_id: event.case_id,
    tenant_id: event.tenant_id,
    reference_type: p.reference_type,
    document_number: p.document_number,
    title: p.title,
    source: p.source,
    added_by_actor_id: event.actor_id,
    added_at: new Date(event.timestamp),
  });
}
