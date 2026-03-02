/**
 * Event Projector Worker — Unit Tests
 *
 * Tests the projectEvent function with mocked database operations.
 * Each projection handler is verified to call the correct DB operation
 * with the correct data.
 */

import { describe, it, expect, vi } from 'vitest';
import { projectEvent } from './event-projector.js';
import type { DomainEvent } from '../shared/events/index.js';

// Mock the DB to capture insert/update calls
function createMockDb() {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

  const db = {
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    _insertValues: insertValues,
    _updateSet: updateSet,
  };

  return db;
}

function makeEvent(overrides: Partial<DomainEvent>): DomainEvent {
  return {
    event_id: 'evt_01',
    tenant_id: 'tenant_01',
    case_id: 'case_01',
    event_type: 'CASE_CREATED',
    actor_id: 'actor_01',
    actor_role: 'associate',
    correlation_id: 'corr_01',
    causation_id: 'caus_01',
    timestamp: '2025-01-15T10:00:00.000Z',
    previous_hash: '',
    new_hash: '',
    payload: {},
    metadata: {},
    ...overrides,
  } as DomainEvent;
}

describe('Event Projector', () => {
  it('projects CASE_CREATED to cases table insert', async () => {
    const db = createMockDb();

    await projectEvent(db as any, makeEvent({
      event_type: 'CASE_CREATED',
      payload: {
        patent_type: 'invention',
        title: 'Test Patent',
        applicant_id: 'app_01',
        inventor_ids: ['inv_01'],
        assigned_attorney_id: 'att_01',
        jurisdiction: 'US',
        priority_date: null,
        parent_case_id: null,
      },
    }));

    expect(db.insert).toHaveBeenCalled();
    expect(db._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: 'case_01',
        tenant_id: 'tenant_01',
        patent_type: 'invention',
        title: 'Test Patent',
        status: 'INTAKE',
      }),
    );
  });

  it('projects CASE_STATUS_CHANGED to cases table update', async () => {
    const db = createMockDb();

    await projectEvent(db as any, makeEvent({
      event_type: 'CASE_STATUS_CHANGED',
      payload: { from_state: 'INTAKE', to_state: 'DRAFTING', reason: null },
    }));

    expect(db.update).toHaveBeenCalled();
    expect(db._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DRAFTING' }),
    );
  });

  it('projects CASE_CLOSED to cases table update', async () => {
    const db = createMockDb();

    await projectEvent(db as any, makeEvent({
      event_type: 'CASE_CLOSED',
      payload: { from_state: 'FILED', close_reason: 'abandoned' },
    }));

    expect(db.update).toHaveBeenCalled();
    expect(db._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CLOSED', close_reason: 'abandoned' }),
    );
  });

  it('projects FILING_RECEIPT_RECORDED to cases table update', async () => {
    const db = createMockDb();

    await projectEvent(db as any, makeEvent({
      event_type: 'FILING_RECEIPT_RECORDED',
      payload: {
        application_number: 'US-2025-001',
        filing_date: '2025-01-15T00:00:00.000Z',
        filing_reference: null,
      },
    }));

    expect(db.update).toHaveBeenCalled();
    expect(db._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        application_number: 'US-2025-001',
      }),
    );
  });

  it('projects CLAIM_CREATED to claims table insert', async () => {
    const db = createMockDb();

    await projectEvent(db as any, makeEvent({
      event_type: 'CLAIM_CREATED',
      payload: {
        claim_id: 'claim_01',
        claim_number: 1,
        claim_type: 'independent',
        claim_category: 'method',
        depends_on_claim_id: null,
        claim_text: 'A method comprising...',
        ai_generated: false,
      },
    }));

    expect(db.insert).toHaveBeenCalled();
    expect(db._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        claim_id: 'claim_01',
        claim_number: 1,
        claim_type: 'independent',
        status: 'draft',
      }),
    );
  });

  it('projects OA_RECEIVED to officeActions table insert', async () => {
    const db = createMockDb();

    await projectEvent(db as any, makeEvent({
      event_type: 'OA_RECEIVED',
      payload: {
        oa_id: 'oa_01',
        oa_category: 'substantive_rejection',
        oa_type_label: 'Non-Final',
        mailing_date: '2025-01-10T00:00:00.000Z',
        received_date: '2025-01-15T00:00:00.000Z',
        response_deadline: '2025-04-10T00:00:00.000Z',
        rejection_bases: ['novelty'],
        statutory_references: ['35 USC §102'],
        cited_references: [],
        sequence_number: 1,
      },
    }));

    expect(db.insert).toHaveBeenCalled();
    expect(db._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        oa_id: 'oa_01',
        oa_category: 'substantive_rejection',
        status: 'received',
      }),
    );
  });

  it('projects FEE_CREATED to fees table insert', async () => {
    const db = createMockDb();

    await projectEvent(db as any, makeEvent({
      event_type: 'FEE_CREATED',
      payload: {
        fee_id: 'fee_01',
        fee_type: 'filing',
        fee_label: 'Filing Fee',
        amount: 1500,
        currency: 'USD',
        due_date: '2025-06-01T00:00:00.000Z',
        deadline_id: null,
      },
    }));

    expect(db.insert).toHaveBeenCalled();
    expect(db._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        fee_id: 'fee_01',
        fee_type: 'filing',
        status: 'pending',
      }),
    );
  });

  it('projects FEE_PAYMENT_RECORDED to fees table update', async () => {
    const db = createMockDb();

    await projectEvent(db as any, makeEvent({
      event_type: 'FEE_PAYMENT_RECORDED',
      payload: {
        fee_id: 'fee_01',
        paid_at: '2025-05-20T10:00:00.000Z',
        payment_reference: 'PAY-001',
      },
    }));

    expect(db.update).toHaveBeenCalled();
    expect(db._updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'paid',
        payment_reference: 'PAY-001',
      }),
    );
  });

  it('handles unknown event types gracefully', async () => {
    const db = createMockDb();

    // Should not throw
    await projectEvent(db as any, makeEvent({
      event_type: 'UNKNOWN_EVENT_TYPE' as any,
    }));

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('re-throws projection errors', async () => {
    const db = createMockDb();
    db._insertValues.mockRejectedValue(new Error('constraint violation'));

    await expect(
      projectEvent(db as any, makeEvent({
        event_type: 'CASE_CREATED',
        payload: {
          patent_type: 'invention', title: 'Test', applicant_id: 'a',
          inventor_ids: [], assigned_attorney_id: 'a', jurisdiction: 'US',
          priority_date: null, parent_case_id: null,
        },
      })),
    ).rejects.toThrow('constraint violation');
  });
});
