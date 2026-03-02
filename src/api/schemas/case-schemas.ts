/**
 * Zod validation schemas for Case API endpoints.
 */

import { z } from 'zod';
import { PATENT_TYPES, CASE_CLOSE_REASONS } from '../../shared/types/index.js';

export const createCaseSchema = z.object({
  title: z.string().min(1).max(500),
  patent_type: z.enum(PATENT_TYPES),
  applicant_id: z.string().min(1),
  inventor_ids: z.array(z.string().min(1)).min(1),
  assigned_attorney_id: z.string().min(1),
  jurisdiction: z.string().min(2).max(10),
  priority_date: z.string().datetime().nullable().optional(),
  parent_case_id: z.string().nullable().optional(),
});

export const changeCaseStatusSchema = z.object({
  to_state: z.string().min(1),
  reason: z.string().nullable().optional(),
});

export const recordFilingReceiptSchema = z.object({
  application_number: z.string().min(1),
  filing_date: z.string().datetime(),
  filing_reference: z.string().nullable().optional(),
});

export const recordAllowanceSchema = z.object({
  allowance_date: z.string().datetime(),
  issue_fee_due_date: z.string().datetime(),
  conditions: z.string().nullable().optional(),
});

export const recordGrantSchema = z.object({
  patent_number: z.string().min(1),
  grant_date: z.string().datetime(),
  first_annuity_due_date: z.string().datetime().nullable().optional(),
});

export const closeCaseSchema = z.object({
  close_reason: z.enum(CASE_CLOSE_REASONS),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type ChangeCaseStatusInput = z.infer<typeof changeCaseStatusSchema>;
export type RecordFilingReceiptInput = z.infer<typeof recordFilingReceiptSchema>;
export type RecordAllowanceInput = z.infer<typeof recordAllowanceSchema>;
export type RecordGrantInput = z.infer<typeof recordGrantSchema>;
export type CloseCaseInput = z.infer<typeof closeCaseSchema>;
