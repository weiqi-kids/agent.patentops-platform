/**
 * Specification Aggregate & New Matter Validation — Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  SpecificationAggregate,
  checkNewMatter,
} from './specification-aggregate.js';
import type {
  CaseId,
  TenantId,
  ActorId,
  CorrelationId,
  CausationId,
} from '../../shared/types/index.js';

const CASE = 'case_1' as CaseId;
const T = 'tenant_1' as TenantId;
const ACTOR = 'actor_1' as ActorId;
const CORR = 'corr_1' as CorrelationId;
const CAUS = 'caus_1' as CausationId;

const SAMPLE_DESCRIPTION = `
The present invention relates to a data processing system comprising a processor
and a memory module. The processor is configured to execute machine learning
algorithms for pattern recognition. The memory module stores training data
and model parameters. The system further includes a network interface for
receiving input data from external sensors. The processor performs feature
extraction using convolutional neural networks, followed by classification
using a fully connected layer. The output is transmitted via the network
interface to a display device.
`;

describe('Specification Aggregate', () => {
  describe('createSpecification', () => {
    it('creates specification with hash', () => {
      const agg = new SpecificationAggregate();
      agg.createSpecification({
        tenant_id: T,
        case_id: CASE,
        title: 'Data Processing System',
        abstract_text: 'A system for processing data using ML.',
        description_text: SAMPLE_DESCRIPTION,
        drawing_references: ['FIG. 1', 'FIG. 2'],
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.currentState).not.toBeNull();
      expect(agg.currentState!.title).toBe('Data Processing System');
      expect(agg.currentState!.original_disclosure_hash).toHaveLength(64);
      expect(agg.currentState!.current_version).toBe(1);
    });

    it('throws if specification already exists', () => {
      const agg = new SpecificationAggregate();
      agg.createSpecification({
        tenant_id: T,
        case_id: CASE,
        title: 'Test',
        abstract_text: 'Test',
        description_text: 'Test description',
        drawing_references: [],
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(() =>
        agg.createSpecification({
          tenant_id: T,
          case_id: CASE,
          title: 'Another',
          abstract_text: 'Another',
          description_text: 'Another description',
          drawing_references: [],
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Specification already exists');
    });
  });

  describe('updateSpecification', () => {
    it('updates abstract and increments version', () => {
      const agg = new SpecificationAggregate();
      agg.createSpecification({
        tenant_id: T,
        case_id: CASE,
        title: 'Test',
        abstract_text: 'Original abstract',
        description_text: SAMPLE_DESCRIPTION,
        drawing_references: [],
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      agg.updateSpecification({
        tenant_id: T,
        case_id: CASE,
        abstract_text: 'Updated abstract',
        amendment_reason: 'Clarifying abstract',
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      expect(agg.currentState!.abstract_text).toBe('Updated abstract');
      expect(agg.currentState!.current_version).toBe(2);
    });

    it('throws if specification does not exist', () => {
      const agg = new SpecificationAggregate();
      expect(() =>
        agg.updateSpecification({
          tenant_id: T,
          case_id: CASE,
          abstract_text: 'Fail',
          amendment_reason: 'Should fail',
          actor_id: ACTOR,
          actor_role: 'associate',
          correlation_id: CORR,
          causation_id: CAUS,
        }),
      ).toThrow('Specification does not exist');
    });
  });

  describe('validateNoNewMatter', () => {
    it('passes for claim text supported by the description', () => {
      const agg = new SpecificationAggregate();
      agg.createSpecification({
        tenant_id: T,
        case_id: CASE,
        title: 'Data Processing System',
        abstract_text: 'Abstract',
        description_text: SAMPLE_DESCRIPTION,
        drawing_references: [],
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const result = agg.validateNoNewMatter(
        'A data processing system comprising a processor configured to execute machine learning algorithms for pattern recognition',
      );

      expect(result.has_new_matter).toBe(false);
      expect(result.unsupported_elements).toHaveLength(0);
    });

    it('detects new matter for unsupported elements', () => {
      const agg = new SpecificationAggregate();
      agg.createSpecification({
        tenant_id: T,
        case_id: CASE,
        title: 'Data Processing System',
        abstract_text: 'Abstract',
        description_text: SAMPLE_DESCRIPTION,
        drawing_references: [],
        actor_id: ACTOR,
        actor_role: 'associate',
        correlation_id: CORR,
        causation_id: CAUS,
      });

      const result = agg.validateNoNewMatter(
        'A quantum computing system comprising a superconducting qubit array configured for error correction',
      );

      expect(result.has_new_matter).toBe(true);
      expect(result.unsupported_elements.length).toBeGreaterThan(0);
    });

    it('throws if specification does not exist', () => {
      const agg = new SpecificationAggregate();
      expect(() => agg.validateNoNewMatter('Some claim text')).toThrow(
        'Specification does not exist',
      );
    });
  });
});

describe('checkNewMatter', () => {
  it('returns no new matter for supported text', () => {
    const result = checkNewMatter(
      'The device includes a processor and a memory',
      'A device comprising a processor and a memory',
    );
    expect(result.has_new_matter).toBe(false);
  });

  it('detects new matter for completely unsupported text', () => {
    const result = checkNewMatter(
      'The device includes a processor and a memory',
      'A blockchain-based distributed ledger system, wherein the ledger uses consensus mechanism for validation',
    );
    expect(result.has_new_matter).toBe(true);
  });
});
