import { exactCentsSchema } from "../accounting.js";
import { z } from "zod";
import {
  BINDER_ENVELOPE_MAX_CENTS,
  BINDER_ENVELOPE_MIN_CENTS,
  BINDER_ENVELOPE_STATUSES,
  BINDER_LEDGER_KINDS,
  BINDER_POOL_DEFAULT_MONTHLY_CENTS,
} from "../constants.js";

/**
 * Validator input API pendanaan BINDER (pool top-up + amplop bid + ledger).
 * Aturan yang ditegakkan di sini adalah aturan PRD Bab 3 / v1.16:
 * - Pool: default $20/bulan per company, bisa diubah owner, sisa menggulung,
 *   hard stop di nol, tanpa auto top-up.
 * - Amplop: $5–$30 per tugas, diusulkan + disetujui owner bersama tugas.
 * - Top-up dan persetujuan amplop WAJIB merujuk approval owner yang sudah
 *   disetujui (status "approved") — tanpa itu service menolak (P2-23).
 * - Biaya QC dibebankan ke pool, BUKAN ke amplop tugas (P1-10).
 *
 * Jumlah uang memakai exactCentsSchema (string sen desimal eksak, tanpa
 * pembulatan diam-diam); validasi rentang dolar dilakukan di service dengan
 * membandingkan nilai sen terhadap konstanta di atas.
 */

export const binderTopUpPoolSchema = z.object({
  companyId: z.string().guid(),
  amountCents: exactCentsSchema,
  /** Approval owner yang sudah disetujui untuk top-up ini — wajib. */
  approvalId: z.string().guid(),
  approvedByUserId: z.string().min(1).max(256).optional(),
  /** Referensi eksternal (mis. nomor kwitansi) — bukan secret. */
  reference: z.string().max(512).optional().nullable(),
  idempotencyKey: z.string().min(1).max(256).optional(),
});

export type BinderTopUpPool = z.infer<typeof binderTopUpPoolSchema>;

export const binderCreateEnvelopeSchema = z.object({
  companyId: z.string().guid(),
  projectId: z.string().guid(),
  issueId: z.string().guid(),
  /** Sen; rentang $5–$30 ditegakkan di service (500–3000 sen). */
  amountCents: exactCentsSchema,
  proposedByUserId: z.string().min(1).max(256).optional(),
});

export type BinderCreateEnvelope = z.infer<typeof binderCreateEnvelopeSchema>;

export const binderApproveEnvelopeSchema = z.object({
  companyId: z.string().guid(),
  envelopeId: z.string().guid(),
  /** Approval owner yang sudah disetujui untuk amplop ini — wajib. */
  approvalId: z.string().guid(),
  approvedByUserId: z.string().min(1).max(256).optional(),
});

export type BinderApproveEnvelope = z.infer<typeof binderApproveEnvelopeSchema>;

export const binderChargeUsageSchema = z.object({
  companyId: z.string().guid(),
  projectId: z.string().guid(),
  issueId: z.string().guid().optional(),
  amountCents: exactCentsSchema,
  kind: z.enum(["usage", "qc_cost"]),
  reason: z.string().min(1).max(1000),
  costEventId: z.string().guid().optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
  createdByUserId: z.string().min(1).max(256).optional(),
  createdByAgentId: z.string().guid().optional(),
});

export type BinderChargeUsage = z.infer<typeof binderChargeUsageSchema>;

export const binderUpdatePoolCapSchema = z.object({
  companyId: z.string().guid(),
  monthlyTopUpCents: z.number().int().min(0).max(2_147_483_647),
});

export type BinderUpdatePoolCap = z.infer<typeof binderUpdatePoolCapSchema>;

/** Konstanta pagu diekspor ulang agar service/UI membaca satu sumber. */
export {
  BINDER_ENVELOPE_MAX_CENTS,
  BINDER_ENVELOPE_MIN_CENTS,
  BINDER_ENVELOPE_STATUSES,
  BINDER_LEDGER_KINDS,
  BINDER_POOL_DEFAULT_MONTHLY_CENTS,
};
