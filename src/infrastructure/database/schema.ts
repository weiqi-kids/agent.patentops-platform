/**
 * PatentOps Platform — Drizzle ORM Database Schema
 *
 * These tables are PROJECTIONS from the event store.
 * The event store (append-only) is the source of truth.
 * These tables exist for efficient querying only and can be rebuilt from events.
 *
 * All tables include tenant_id for Row-Level Security (RLS).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── Event Store (append-only, source of truth) ─────────────────────

export const events = pgTable(
  'events',
  {
    event_id: text('event_id').primaryKey(),
    tenant_id: text('tenant_id').notNull(),
    case_id: text('case_id').notNull(),
    event_type: text('event_type').notNull(),
    actor_id: text('actor_id').notNull(),
    actor_role: text('actor_role').notNull(),
    correlation_id: text('correlation_id').notNull(),
    causation_id: text('causation_id').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    previous_hash: text('previous_hash').notNull(),
    new_hash: text('new_hash').notNull(),
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    /** Monotonically increasing sequence per case for ordering */
    sequence_number: integer('sequence_number').notNull(),
  },
  (table) => [
    index('idx_events_tenant').on(table.tenant_id),
    index('idx_events_case').on(table.case_id),
    index('idx_events_type').on(table.event_type),
    index('idx_events_correlation').on(table.correlation_id),
    index('idx_events_case_sequence').on(table.case_id, table.sequence_number),
  ],
);

// ─── Tenants ────────────────────────────────────────────────────────

export const tenants = pgTable('tenants', {
  tenant_id: text('tenant_id').primaryKey(),
  name: text('name').notNull(),
  plan_tier: text('plan_tier').notNull().default('starter'),
  default_jurisdiction: text('default_jurisdiction').notNull(),
  settings: jsonb('settings').notNull().default({}),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Actors ─────────────────────────────────────────────────────────

export const actors = pgTable(
  'actors',
  {
    actor_id: text('actor_id').primaryKey(),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull(),
    license_number: text('license_number'),
    jurisdiction: text('jurisdiction'),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_actors_tenant').on(table.tenant_id),
    uniqueIndex('idx_actors_email_tenant').on(table.tenant_id, table.email),
  ],
);

// ─── Cases (projection) ────────────────────────────────────────────

export const cases = pgTable(
  'cases',
  {
    case_id: text('case_id').primaryKey(),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    case_number: text('case_number'),
    patent_type: text('patent_type').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('INTAKE'),
    applicant_id: text('applicant_id').notNull().references(() => actors.actor_id),
    inventor_ids: jsonb('inventor_ids').notNull().default([]),
    assigned_attorney_id: text('assigned_attorney_id').notNull().references(() => actors.actor_id),
    assigned_associate_id: text('assigned_associate_id').references(() => actors.actor_id),
    assigned_paralegal_id: text('assigned_paralegal_id').references(() => actors.actor_id),
    foreign_associate_id: text('foreign_associate_id').references(() => actors.actor_id),
    jurisdiction: text('jurisdiction').notNull(),
    filing_date: timestamp('filing_date', { withTimezone: true }),
    priority_date: timestamp('priority_date', { withTimezone: true }),
    application_number: text('application_number'),
    patent_number: text('patent_number'),
    grant_date: timestamp('grant_date', { withTimezone: true }),
    examination_requested_date: timestamp('examination_requested_date', { withTimezone: true }),
    parent_case_id: text('parent_case_id'),
    family_id: text('family_id'),
    current_version: integer('current_version').notNull().default(1),
    close_reason: text('close_reason'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_cases_tenant').on(table.tenant_id),
    index('idx_cases_status').on(table.status),
    index('idx_cases_attorney').on(table.assigned_attorney_id),
    index('idx_cases_jurisdiction').on(table.jurisdiction),
    index('idx_cases_family').on(table.family_id),
  ],
);

// ─── Claims (projection) ───────────────────────────────────────────

export const claims = pgTable(
  'claims',
  {
    claim_id: text('claim_id').primaryKey(),
    case_id: text('case_id').notNull().references(() => cases.case_id),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    version: integer('version').notNull().default(1),
    claim_number: integer('claim_number').notNull(),
    claim_type: text('claim_type').notNull(),
    claim_category: text('claim_category'),
    depends_on_claim_id: text('depends_on_claim_id'),
    claim_text: text('claim_text').notNull(),
    status: text('status').notNull().default('draft'),
    breadth_score: numeric('breadth_score'),
    ai_generated: boolean('ai_generated').notNull().default(false),
    created_by_actor_id: text('created_by_actor_id').notNull().references(() => actors.actor_id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_claims_case').on(table.case_id),
    index('idx_claims_tenant').on(table.tenant_id),
  ],
);

// ─── Office Actions (projection) ───────────────────────────────────

export const officeActions = pgTable(
  'office_actions',
  {
    oa_id: text('oa_id').primaryKey(),
    case_id: text('case_id').notNull().references(() => cases.case_id),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    oa_category: text('oa_category').notNull(),
    oa_type_label: text('oa_type_label').notNull(),
    mailing_date: timestamp('mailing_date', { withTimezone: true }).notNull(),
    received_date: timestamp('received_date', { withTimezone: true }).notNull(),
    response_deadline: timestamp('response_deadline', { withTimezone: true }).notNull(),
    extended_deadline: timestamp('extended_deadline', { withTimezone: true }),
    cited_references: jsonb('cited_references').notNull().default([]),
    rejection_bases: jsonb('rejection_bases').notNull().default([]),
    statutory_references: jsonb('statutory_references').notNull().default([]),
    status: text('status').notNull().default('received'),
    risk_rating: text('risk_rating'),
    sequence_number: integer('sequence_number').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_oa_case').on(table.case_id),
    index('idx_oa_tenant').on(table.tenant_id),
    index('idx_oa_deadline').on(table.response_deadline),
  ],
);

// ─── Deadlines (projection) ────────────────────────────────────────

export const deadlines = pgTable(
  'deadlines',
  {
    deadline_id: text('deadline_id').primaryKey(),
    case_id: text('case_id').notNull().references(() => cases.case_id),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    deadline_type: text('deadline_type').notNull(),
    source_entity_type: text('source_entity_type').notNull(),
    source_entity_id: text('source_entity_id').notNull(),
    due_date: timestamp('due_date', { withTimezone: true }).notNull(),
    rule_reference: text('rule_reference'),
    warning_sent_at: jsonb('warning_sent_at').notNull().default([]),
    escalation_level: integer('escalation_level').notNull().default(0),
    status: text('status').notNull().default('active'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_deadlines_case').on(table.case_id),
    index('idx_deadlines_tenant').on(table.tenant_id),
    index('idx_deadlines_status').on(table.status),
    index('idx_deadlines_due_date').on(table.due_date),
    index('idx_deadlines_active').on(table.status, table.due_date),
  ],
);

// ─── Conflict Checks (projection) ──────────────────────────────────

export const conflictChecks = pgTable(
  'conflict_checks',
  {
    check_id: text('check_id').primaryKey(),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    case_id: text('case_id').notNull().references(() => cases.case_id),
    checked_against_parties: jsonb('checked_against_parties').notNull().default([]),
    result: text('result').notNull(),
    reviewed_by_actor_id: text('reviewed_by_actor_id').references(() => actors.actor_id),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_conflict_case').on(table.case_id),
    index('idx_conflict_tenant').on(table.tenant_id),
  ],
);

// ─── Documents (projection) ────────────────────────────────────────

export const documents = pgTable(
  'documents',
  {
    document_id: text('document_id').primaryKey(),
    case_id: text('case_id').notNull().references(() => cases.case_id),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    document_type: text('document_type').notNull(),
    version: integer('version').notNull().default(1),
    template_id: text('template_id'),
    content_hash: text('content_hash').notNull(),
    status: text('status').notNull().default('draft'),
    generated_at: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    finalized_by_actor_id: text('finalized_by_actor_id').references(() => actors.actor_id),
    finalized_at: timestamp('finalized_at', { withTimezone: true }),
    file_path: text('file_path').notNull(),
  },
  (table) => [
    index('idx_documents_case').on(table.case_id),
    index('idx_documents_tenant').on(table.tenant_id),
  ],
);

// ─── Patent Family Links (projection) ──────────────────────────────

export const patentFamilyLinks = pgTable(
  'patent_family_links',
  {
    family_id: text('family_id').primaryKey(),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    parent_case_id: text('parent_case_id').notNull().references(() => cases.case_id),
    child_case_id: text('child_case_id').notNull().references(() => cases.case_id),
    relationship_type: text('relationship_type').notNull(),
    priority_date: timestamp('priority_date', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_family_parent').on(table.parent_case_id),
    index('idx_family_child').on(table.child_case_id),
    index('idx_family_tenant').on(table.tenant_id),
  ],
);

// ─── Fees (projection) ─────────────────────────────────────────────

export const fees = pgTable(
  'fees',
  {
    fee_id: text('fee_id').primaryKey(),
    case_id: text('case_id').notNull().references(() => cases.case_id),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    fee_type: text('fee_type').notNull(),
    fee_label: text('fee_label').notNull(),
    amount: numeric('amount').notNull(),
    currency: text('currency').notNull().default('TWD'),
    due_date: timestamp('due_date', { withTimezone: true }).notNull(),
    grace_period_end: timestamp('grace_period_end', { withTimezone: true }),
    late_surcharge_amount: numeric('late_surcharge_amount'),
    status: text('status').notNull().default('pending'),
    paid_at: timestamp('paid_at', { withTimezone: true }),
    payment_reference: text('payment_reference'),
    deadline_id: text('deadline_id').references(() => deadlines.deadline_id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fees_case').on(table.case_id),
    index('idx_fees_tenant').on(table.tenant_id),
    index('idx_fees_status').on(table.status),
    index('idx_fees_due_date').on(table.due_date),
  ],
);

// ─── Prior Art References (projection) ─────────────────────────────

export const priorArtReferences = pgTable(
  'prior_art_references',
  {
    reference_id: text('reference_id').primaryKey(),
    case_id: text('case_id').notNull().references(() => cases.case_id),
    tenant_id: text('tenant_id').notNull().references(() => tenants.tenant_id),
    reference_type: text('reference_type').notNull(),
    document_number: text('document_number').notNull(),
    title: text('title').notNull(),
    inventor: text('inventor'),
    publication_date: timestamp('publication_date', { withTimezone: true }),
    jurisdiction: text('jurisdiction'),
    source: text('source').notNull(),
    added_at: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    added_by_actor_id: text('added_by_actor_id').notNull().references(() => actors.actor_id),
  },
  (table) => [
    index('idx_prior_art_case').on(table.case_id),
    index('idx_prior_art_tenant').on(table.tenant_id),
  ],
);
