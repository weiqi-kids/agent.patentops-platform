/**
 * Post-Allowance Deadline Automation
 *
 * When a case transitions to ALLOWED, automatically creates:
 * 1. Issue fee payment deadline
 * 2. (After grant) First annuity/maintenance fee deadline
 *
 * These deadlines are statutory and jurisdiction-specific.
 * The core platform emits deadline events; jurisdiction plugins
 * provide the actual due date rules.
 */

import { ulid } from 'ulid';
import type {
  CaseId,
  TenantId,
  EventId,
  DeadlineId,
  FeeId,
  ActorId,
  ActorRole,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';
import type { DomainEvent } from '../../shared/events/index.js';

// ─── Post-Allowance Rules ──────────────────────────────────────────

export interface AllowanceDeadlineRule {
  jurisdiction: string;
  issue_fee_period_months: number;
  issue_fee_rule_reference: string;
}

export interface GrantDeadlineRule {
  jurisdiction: string;
  first_annuity_months_after_grant: number;
  annuity_rule_reference: string;
}

// ─── Auto-Deadline Generator ──────────────────────────────────────

export function generateAllowanceDeadlines(
  caseId: CaseId,
  tenantId: TenantId,
  jurisdiction: string,
  allowanceDate: string,
  issueFeeRules: AllowanceDeadlineRule[],
  actorId: ActorId,
  actorRole: ActorRole,
  correlationId: CorrelationId,
  causationId: CausationId,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  const rule = issueFeeRules.find((r) => r.jurisdiction === jurisdiction);

  if (!rule) return events;

  const deadlineId = ulid() as DeadlineId;
  const feeId = ulid() as FeeId;
  const now = new Date().toISOString();

  // Calculate issue fee due date
  const dueDate = new Date(allowanceDate);
  dueDate.setMonth(dueDate.getMonth() + rule.issue_fee_period_months);

  // Emit DEADLINE_CREATED for issue fee
  events.push({
    event_id: ulid() as EventId,
    tenant_id: tenantId,
    case_id: caseId,
    event_type: 'DEADLINE_CREATED',
    actor_id: actorId,
    actor_role: actorRole,
    correlation_id: correlationId,
    causation_id: causationId,
    timestamp: now,
    previous_hash: '',
    new_hash: '',
    payload: {
      deadline_id: deadlineId,
      deadline_type: 'statutory',
      source_entity_type: 'fee',
      source_entity_id: feeId,
      due_date: dueDate.toISOString(),
      rule_reference: rule.issue_fee_rule_reference,
    },
    metadata: { auto_generated: true, trigger: 'allowance' },
  } as DomainEvent);

  // Emit FEE_CREATED for issue fee
  events.push({
    event_id: ulid() as EventId,
    tenant_id: tenantId,
    case_id: caseId,
    event_type: 'FEE_CREATED',
    actor_id: actorId,
    actor_role: actorRole,
    correlation_id: correlationId,
    causation_id: causationId,
    timestamp: now,
    previous_hash: '',
    new_hash: '',
    payload: {
      fee_id: feeId,
      fee_type: 'issue',
      fee_label: 'Issue / Certificate Fee',
      amount: 0, // Amount set by jurisdiction plugin
      currency: 'USD',
      due_date: dueDate.toISOString(),
      deadline_id: deadlineId,
    },
    metadata: { auto_generated: true, trigger: 'allowance' },
  } as DomainEvent);

  return events;
}

export function generateGrantDeadlines(
  caseId: CaseId,
  tenantId: TenantId,
  jurisdiction: string,
  grantDate: string,
  grantRules: GrantDeadlineRule[],
  actorId: ActorId,
  actorRole: ActorRole,
  correlationId: CorrelationId,
  causationId: CausationId,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  const rule = grantRules.find((r) => r.jurisdiction === jurisdiction);

  if (!rule) return events;

  const deadlineId = ulid() as DeadlineId;
  const feeId = ulid() as FeeId;
  const now = new Date().toISOString();

  // Calculate first annuity due date
  const dueDate = new Date(grantDate);
  dueDate.setMonth(dueDate.getMonth() + rule.first_annuity_months_after_grant);

  // Emit DEADLINE_CREATED for first annuity
  events.push({
    event_id: ulid() as EventId,
    tenant_id: tenantId,
    case_id: caseId,
    event_type: 'DEADLINE_CREATED',
    actor_id: actorId,
    actor_role: actorRole,
    correlation_id: correlationId,
    causation_id: causationId,
    timestamp: now,
    previous_hash: '',
    new_hash: '',
    payload: {
      deadline_id: deadlineId,
      deadline_type: 'statutory',
      source_entity_type: 'fee',
      source_entity_id: feeId,
      due_date: dueDate.toISOString(),
      rule_reference: rule.annuity_rule_reference,
    },
    metadata: { auto_generated: true, trigger: 'grant' },
  } as DomainEvent);

  // Emit FEE_CREATED for first annuity
  events.push({
    event_id: ulid() as EventId,
    tenant_id: tenantId,
    case_id: caseId,
    event_type: 'FEE_CREATED',
    actor_id: actorId,
    actor_role: actorRole,
    correlation_id: correlationId,
    causation_id: causationId,
    timestamp: now,
    previous_hash: '',
    new_hash: '',
    payload: {
      fee_id: feeId,
      fee_type: 'annuity',
      fee_label: 'First Annuity / Maintenance Fee',
      amount: 0, // Amount set by jurisdiction plugin
      currency: 'USD',
      due_date: dueDate.toISOString(),
      deadline_id: deadlineId,
    },
    metadata: { auto_generated: true, trigger: 'grant' },
  } as DomainEvent);

  return events;
}
