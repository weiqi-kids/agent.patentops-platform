/**
 * Zod Schemas — Patent Family API Validation
 */

import { z } from 'zod';
import { FAMILY_RELATIONSHIP_TYPES } from '../../shared/types/index.js';

export const linkFamilySchema = z.object({
  parent_case_id: z.string().min(1),
  child_case_id: z.string().min(1),
  relationship_type: z.enum(FAMILY_RELATIONSHIP_TYPES),
  priority_date: z.string().datetime(),
  parent_filing_date: z.string().datetime().nullable().optional(),
});

export type LinkFamilyInput = z.infer<typeof linkFamilySchema>;

export const unlinkFamilySchema = z.object({
  parent_case_id: z.string().min(1),
  child_case_id: z.string().min(1),
  reason: z.string().min(1).max(1000),
});

export type UnlinkFamilyInput = z.infer<typeof unlinkFamilySchema>;

export const recordPriorityClaimSchema = z.object({
  parent_case_id: z.string().min(1),
  priority_date: z.string().datetime(),
  basis: z.string().min(1).max(500),
  parent_filing_date: z.string().datetime().nullable().optional(),
});

export type RecordPriorityClaimInput = z.infer<typeof recordPriorityClaimSchema>;
