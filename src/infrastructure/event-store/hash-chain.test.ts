import { describe, it, expect } from 'vitest';
import {
  computeEventHash,
  hashEvent,
  verifyEventHash,
  verifyChain,
  GENESIS_HASH,
} from './hash-chain.js';
import type { DomainEvent } from '../../shared/events/index.js';

function makeEvent(
  overrides: Partial<DomainEvent> = {},
  previousHash: string = GENESIS_HASH,
): DomainEvent {
  const base = {
    event_id: 'evt_001',
    tenant_id: 'tenant_1',
    case_id: 'case_1',
    event_type: 'CASE_CREATED',
    actor_id: 'actor_1',
    actor_role: 'partner',
    correlation_id: 'corr_1',
    causation_id: 'caus_1',
    timestamp: '2026-03-01T00:00:00.000Z',
    previous_hash: previousHash,
    new_hash: '', // will be computed
    payload: { title: 'Test Case' },
    metadata: {},
    ...overrides,
  } as DomainEvent;

  // Compute the correct hash
  base.new_hash = computeEventHash(
    base.event_id,
    base.case_id,
    base.event_type,
    base.actor_id,
    base.timestamp,
    base.payload,
    base.previous_hash,
  );

  return base;
}

describe('Hash Chain', () => {
  describe('computeEventHash', () => {
    it('produces a 64-character hex string', () => {
      const hash = computeEventHash(
        'evt_1', 'case_1', 'CASE_CREATED', 'actor_1',
        '2026-03-01T00:00:00Z', { title: 'Test' }, GENESIS_HASH,
      );
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('is deterministic', () => {
      const hash1 = computeEventHash('a', 'b', 'c', 'd', 'e', { x: 1 }, 'f');
      const hash2 = computeEventHash('a', 'b', 'c', 'd', 'e', { x: 1 }, 'f');
      expect(hash1).toBe(hash2);
    });

    it('changes when any input changes', () => {
      const base = ['a', 'b', 'c', 'd', 'e', { x: 1 }, 'f'] as const;
      const baseHash = computeEventHash(...base);

      // Change event_id
      expect(computeEventHash('z', 'b', 'c', 'd', 'e', { x: 1 }, 'f')).not.toBe(baseHash);
      // Change payload
      expect(computeEventHash('a', 'b', 'c', 'd', 'e', { x: 2 }, 'f')).not.toBe(baseHash);
      // Change previous_hash
      expect(computeEventHash('a', 'b', 'c', 'd', 'e', { x: 1 }, 'g')).not.toBe(baseHash);
    });
  });

  describe('verifyEventHash', () => {
    it('verifies a correctly hashed event', () => {
      const event = makeEvent();
      expect(verifyEventHash(event)).toBe(true);
    });

    it('detects tampered payload', () => {
      const event = makeEvent();
      (event.payload as any).title = 'Tampered';
      expect(verifyEventHash(event)).toBe(false);
    });

    it('detects tampered hash', () => {
      const event = makeEvent();
      event.new_hash = 'a'.repeat(64);
      expect(verifyEventHash(event)).toBe(false);
    });
  });

  describe('verifyChain', () => {
    it('validates an empty chain', () => {
      expect(verifyChain([])).toBe(-1); // -1 = valid
    });

    it('validates a single event chain', () => {
      const event = makeEvent();
      expect(verifyChain([event])).toBe(-1);
    });

    it('validates a multi-event chain', () => {
      const evt1 = makeEvent({ event_id: 'evt_1' });
      const evt2 = makeEvent({ event_id: 'evt_2', timestamp: '2026-03-01T01:00:00.000Z' }, evt1.new_hash);
      const evt3 = makeEvent({ event_id: 'evt_3', timestamp: '2026-03-01T02:00:00.000Z' }, evt2.new_hash);

      expect(verifyChain([evt1, evt2, evt3])).toBe(-1);
    });

    it('detects break in chain (tampered event)', () => {
      const evt1 = makeEvent({ event_id: 'evt_1' });
      const evt2 = makeEvent({ event_id: 'evt_2', timestamp: '2026-03-01T01:00:00.000Z' }, evt1.new_hash);
      const evt3 = makeEvent({ event_id: 'evt_3', timestamp: '2026-03-01T02:00:00.000Z' }, evt2.new_hash);

      // Tamper with evt2's payload
      (evt2.payload as any).title = 'Hacked';
      expect(verifyChain([evt1, evt2, evt3])).toBe(1); // Break at index 1
    });

    it('detects wrong genesis hash', () => {
      const evt = makeEvent({}, 'wrong_hash');
      expect(verifyChain([evt])).toBe(0);
    });

    it('detects missing link', () => {
      const evt1 = makeEvent({ event_id: 'evt_1' });
      const evt3 = makeEvent({ event_id: 'evt_3' }, 'wrong_previous');
      expect(verifyChain([evt1, evt3])).toBe(1);
    });
  });
});
