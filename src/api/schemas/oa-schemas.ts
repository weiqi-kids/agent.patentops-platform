/**
 * Zod validation schemas for Office Action API endpoints.
 */

import { z } from 'zod';
import {
  OA_CATEGORIES,
  REJECTION_BASES,
  RISK_RATINGS,
} from '../../shared/types/index.js';

const citedReferenceSchema = z.object({
  reference_id: z.string().min(1),
  publication_number: z.string().min(1),
  title: z.string().min(1),
  relevant_claims: z.array(z.number().int().positive()),
  relevance_summary: z.string(),
});

export const receiveOaSchema = z.object({
  oa_category: z.enum(OA_CATEGORIES),
  oa_type_label: z.string().min(1).max(200),
  mailing_date: z.string().datetime(),
  received_date: z.string().datetime(),
  response_deadline: z.string().datetime(),
  rejection_bases: z.array(z.enum(REJECTION_BASES)).default([]),
  statutory_references: z.array(z.string()).default([]),
  cited_references: z.array(citedReferenceSchema).default([]),
});

export const transitionOaSchema = z.object({
  to_status: z.string().min(1),
});

export const fileOaResponseSchema = z.object({
  document_id: z.string().min(1),
  filed_hash: z.string().min(1),
});

export type ReceiveOaInput = z.infer<typeof receiveOaSchema>;
export type TransitionOaInput = z.infer<typeof transitionOaSchema>;
export type FileOaResponseInput = z.infer<typeof fileOaResponseSchema>;
