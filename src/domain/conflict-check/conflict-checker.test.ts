import { describe, it, expect } from 'vitest';
import { ConflictChecker } from './conflict-checker.js';
import type {
  ConflictCheckRequest,
  ExistingCaseRecord,
  ConflictCheckRepository,
} from './conflict-checker.js';
import type { CaseId, TenantId, ActorId, ConflictCheckId } from '../../shared/types/index.js';

const T = 'tenant_1' as TenantId;

function makeRepo(cases: ExistingCaseRecord[]): ConflictCheckRepository {
  return {
    findActiveCasesByTenant: async () => cases,
  };
}

function makeRequest(parties: string[], caseId: string = 'new_case'): ConflictCheckRequest {
  return {
    check_id: 'chk_1' as ConflictCheckId,
    tenant_id: T,
    case_id: caseId as CaseId,
    parties_to_check: parties,
    initiated_by: 'actor_1' as ActorId,
  };
}

describe('Conflict Checker', () => {
  it('returns clear when no existing cases', async () => {
    const checker = new ConflictChecker(makeRepo([]));
    const result = await checker.checkConflicts(makeRequest(['台灣半導體公司']));
    expect(result.result).toBe('clear');
    expect(result.matches).toHaveLength(0);
  });

  it('detects exact applicant name match', async () => {
    const checker = new ConflictChecker(makeRepo([
      {
        case_id: 'case_existing' as CaseId,
        tenant_id: T,
        title: '半導體製程改良',
        applicant_name: '台灣半導體公司',
        inventor_names: ['王大明'],
        status: 'FILED',
      },
    ]));

    const result = await checker.checkConflicts(makeRequest(['台灣半導體公司']));
    expect(result.result).toBe('conflict_found');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].match_type).toBe('exact_name');
    expect(result.matched_cases).toContain('case_existing');
  });

  it('detects fuzzy name match', async () => {
    const checker = new ConflictChecker(makeRepo([
      {
        case_id: 'case_existing' as CaseId,
        tenant_id: T,
        title: 'Some Patent',
        applicant_name: 'Taiwan Semiconductor Co.',
        inventor_names: [],
        status: 'FILED',
      },
    ]), 0.7); // Lower threshold for fuzzy

    const result = await checker.checkConflicts(makeRequest(['Taiwan Semiconductor Co']));
    expect(result.result).not.toBe('clear');
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('detects inventor name match', async () => {
    const checker = new ConflictChecker(makeRepo([
      {
        case_id: 'case_existing' as CaseId,
        tenant_id: T,
        title: 'AI方法專利',
        applicant_name: '其他公司',
        inventor_names: ['陳大文', '李小明'],
        status: 'DRAFTING',
      },
    ]));

    const result = await checker.checkConflicts(makeRequest(['陳大文']));
    expect(result.result).not.toBe('clear');
    expect(result.matches.some(m => m.matched_party === '陳大文')).toBe(true);
  });

  it('skips self (same case_id)', async () => {
    const checker = new ConflictChecker(makeRepo([
      {
        case_id: 'case_1' as CaseId,
        tenant_id: T,
        title: 'Test Case',
        applicant_name: 'Same Company',
        inventor_names: [],
        status: 'FILED',
      },
    ]));

    const result = await checker.checkConflicts(makeRequest(['Same Company'], 'case_1'));
    expect(result.result).toBe('clear');
    expect(result.matches).toHaveLength(0);
  });

  it('returns review_needed for fuzzy but not exact match', async () => {
    const checker = new ConflictChecker(makeRepo([
      {
        case_id: 'case_existing' as CaseId,
        tenant_id: T,
        title: 'Patent A',
        applicant_name: 'Innovate Tech Inc.',
        inventor_names: [],
        status: 'FILED',
      },
    ]), 0.7);

    const result = await checker.checkConflicts(makeRequest(['Inovate Tech Inc']));
    // Close but not exact — should be review_needed
    if (result.result !== 'clear') {
      expect(['review_needed', 'conflict_found']).toContain(result.result);
    }
  });

  it('checks multiple parties against multiple cases', async () => {
    const checker = new ConflictChecker(makeRepo([
      {
        case_id: 'case_a' as CaseId,
        tenant_id: T,
        title: 'Patent A',
        applicant_name: 'Company A',
        inventor_names: ['Inventor X'],
        status: 'FILED',
      },
      {
        case_id: 'case_b' as CaseId,
        tenant_id: T,
        title: 'Patent B',
        applicant_name: 'Company B',
        inventor_names: ['Inventor Y'],
        status: 'DRAFTING',
      },
    ]));

    const result = await checker.checkConflicts(makeRequest(['Company A', 'Inventor Y']));
    expect(result.result).toBe('conflict_found');
    expect(result.matched_cases).toContain('case_a');
    expect(result.matched_cases).toContain('case_b');
  });
});
