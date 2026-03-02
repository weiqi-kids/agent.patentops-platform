/**
 * Fee Management API Routes
 *
 * Create, pay, waive fees for cases.
 * All endpoints are tenant-scoped (tenant_id extracted from JWT).
 */

import type { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import {
  createFeeSchema,
  recordFeePaymentSchema,
  waiveFeeSchema,
} from '../schemas/fee-schemas.js';
import type {
  CreateFeeInput,
  RecordFeePaymentInput,
  WaiveFeeInput,
} from '../schemas/fee-schemas.js';
import type { EventStore } from '../../infrastructure/event-store/types.js';
import type {
  CaseId,
  FeeId,
  DeadlineId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';
import type { DomainEvent } from '../../shared/events/index.js';

export async function feeRoutes(
  fastify: FastifyInstance,
  opts: { eventStore: EventStore },
): Promise<void> {
  const { eventStore } = opts;

  // ─── Create Fee ────────────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string };
    Body: CreateFeeInput;
  }>('/cases/:case_id/fees', async (request, reply) => {
    const parsed = createFeeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;
    const feeId = ulid() as FeeId;

    const event: DomainEvent = {
      event_id: ulid(),
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'FEE_CREATED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        fee_id: feeId,
        fee_type: input.fee_type,
        fee_label: input.fee_label,
        amount: input.amount,
        currency: input.currency,
        due_date: input.due_date,
        deadline_id: (input.deadline_id ?? null) as DeadlineId | null,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.status(201).send({
      fee_id: feeId,
      fee_type: input.fee_type,
      amount: input.amount,
      currency: input.currency,
      due_date: input.due_date,
      correlation_id: correlationId,
    });
  });

  // ─── List Fees for Case ────────────────────────────────────────
  fastify.get<{
    Params: { case_id: string };
  }>('/cases/:case_id/fees', async (request, reply) => {
    const caseId = request.params.case_id as CaseId;
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);

    const feeCreatedEvents = events.filter((e) => e.event_type === 'FEE_CREATED');
    const paidFees = new Map<string, { paid_at: string; payment_reference: string }>();
    const waivedFees = new Set<string>();

    for (const e of events) {
      if (e.event_type === 'FEE_PAYMENT_RECORDED') {
        const p = e.payload as { fee_id: string; paid_at: string; payment_reference: string };
        paidFees.set(p.fee_id, { paid_at: p.paid_at, payment_reference: p.payment_reference });
      }
      if (e.event_type === 'FEE_WAIVED') {
        waivedFees.add((e.payload as { fee_id: string }).fee_id);
      }
    }

    const feeList = feeCreatedEvents.map((e) => {
      const p = e.payload as {
        fee_id: string; fee_type: string; fee_label: string;
        amount: number; currency: string; due_date: string;
        deadline_id: string | null;
      };

      let status = 'pending';
      let paid_at: string | null = null;
      let payment_reference: string | null = null;

      if (paidFees.has(p.fee_id)) {
        status = 'paid';
        const payment = paidFees.get(p.fee_id)!;
        paid_at = payment.paid_at;
        payment_reference = payment.payment_reference;
      } else if (waivedFees.has(p.fee_id)) {
        status = 'waived';
      } else if (new Date(p.due_date) < new Date()) {
        status = 'overdue';
      }

      return {
        fee_id: p.fee_id,
        fee_type: p.fee_type,
        fee_label: p.fee_label,
        amount: p.amount,
        currency: p.currency,
        due_date: p.due_date,
        status,
        paid_at,
        payment_reference,
      };
    });

    return reply.send({ fees: feeList, total: feeList.length });
  });

  // ─── Record Fee Payment ──────────────────────────────────────
  fastify.post<{
    Params: { case_id: string; fee_id: string };
    Body: RecordFeePaymentInput;
  }>('/cases/:case_id/fees/:fee_id/pay', async (request, reply) => {
    const parsed = recordFeePaymentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const feeId = request.params.fee_id as FeeId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    // Verify fee exists
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const feeEvent = events.find(
      (e) => e.event_type === 'FEE_CREATED' && (e.payload as any).fee_id === feeId,
    );
    if (!feeEvent) {
      return reply.status(404).send({ error: 'Fee not found' });
    }

    const feePayload = feeEvent.payload as { fee_type: string; amount: number; currency: string };

    const event: DomainEvent = {
      event_id: ulid(),
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'FEE_PAYMENT_RECORDED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        fee_id: feeId,
        fee_type: feePayload.fee_type,
        amount: feePayload.amount,
        currency: feePayload.currency,
        payment_reference: input.payment_reference,
        paid_at: input.paid_at,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.send({
      fee_id: feeId,
      status: 'paid',
      paid_at: input.paid_at,
      correlation_id: correlationId,
    });
  });

  // ─── Waive Fee ──────────────────────────────────────────────
  fastify.post<{
    Params: { case_id: string; fee_id: string };
    Body: WaiveFeeInput;
  }>('/cases/:case_id/fees/:fee_id/waive', async (request, reply) => {
    const parsed = waiveFeeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation error', details: parsed.error.issues });
    }

    const caseId = request.params.case_id as CaseId;
    const feeId = request.params.fee_id as FeeId;
    const input = parsed.data;
    const correlationId = ulid() as CorrelationId;
    const causationId = ulid() as CausationId;

    // Verify fee exists
    const events = await eventStore.getEventsByCase(request.tenant_id, caseId);
    const feeEvent = events.find(
      (e) => e.event_type === 'FEE_CREATED' && (e.payload as any).fee_id === feeId,
    );
    if (!feeEvent) {
      return reply.status(404).send({ error: 'Fee not found' });
    }

    const feePayload = feeEvent.payload as { fee_type: string };

    const event: DomainEvent = {
      event_id: ulid(),
      tenant_id: request.tenant_id,
      case_id: caseId,
      event_type: 'FEE_WAIVED',
      actor_id: request.actor_id,
      actor_role: request.actor_role,
      correlation_id: correlationId,
      causation_id: causationId,
      timestamp: new Date().toISOString(),
      previous_hash: '',
      new_hash: '',
      payload: {
        fee_id: feeId,
        fee_type: feePayload.fee_type,
        waived_by: request.actor_id,
        reason: input.reason,
      },
      metadata: {},
    } as DomainEvent;

    await eventStore.appendBatch([event]);

    return reply.send({
      fee_id: feeId,
      status: 'waived',
      correlation_id: correlationId,
    });
  });
}
