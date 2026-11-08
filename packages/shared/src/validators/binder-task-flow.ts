import { exactCentsSchema } from "../accounting.js";
import { z } from "zod";
import {
  BINDER_APPROVED_ACTION_KINDS,
  BINDER_HARD_VIOLATION_CODES,
  BINDER_MODEL_FAMILIES,
  BINDER_QC_RUBRIC_MAX,
  BINDER_TASK_STATUSES,
} from "../constants.js";

/**
 * Validator input API alur task + QC + approved_action_id BINDER
 * (PRD Bab 3 / Bab 6.4; rencana Tahap 3 Fase 3.3; P0-1/2/3, P1-11/19).
 *
 * Aturan yang ditegakkan di sini adalah aturan PRD:
 * - Satu task = satu owner, satu DoD, satu artifact utama.
 * - QC beda family dari maker (P0-1), rubrik 30/25/25/20, lolos ≥ 75 +
 *   nol hard violation (P0-2/3), maks 2 putaran revisi lalu eskalasi.
 * - `approved_action_id` diterbitkan Core atas vonis owner (P1-11);
 *   final send outreach tetap MANUAL oleh manusia (P1-19).
 * - Biaya QC dibebankan ke pool, BUKAN ke amplop (P1-10).
 *
 * Jumlah uang memakai exactCentsSchema (string sen desimal eksak, tanpa
 * pembulatan diam-diam). Payload pengajuan aksi TIDAK BOLEH berisi secret
 * (P1-24) — service tidak memvalidasi isi rahasia, tetapi payload hanya
 * boleh berisi referensi draf/target, bukan kredensial.
 */

export const binderAgentModelSchema = z.object({
  companyId: z.string().guid(),
  agentId: z.string().guid(),
  /** Family model agen — QC wajib beda family dari maker (P0-1). */
  modelFamily: z.enum(BINDER_MODEL_FAMILIES),
  /** ID model, mis. 'muse-spark-1.3'. Bukan secret. */
  modelId: z.string().min(1).max(256),
  provider: z.string().min(1).max(256).optional().nullable(),
});

export type BinderAgentModelInput = z.infer<typeof binderAgentModelSchema>;

export const binderCreateTaskSchema = z.object({
  companyId: z.string().guid(),
  projectId: z.string().guid().optional().nullable(),
  issueId: z.string().guid(),
  /** Satu owner per task — sama dengan `issues.assignee_agent_id`. */
  ownerAgentId: z.string().guid(),
  /** Definition of Done — satu per task, wajib. */
  dod: z.string().min(1).max(5000),
  createdByUserId: z.string().min(1).max(256).optional(),
});

export type BinderCreateTask = z.infer<typeof binderCreateTaskSchema>;

export const binderTransitionTaskSchema = z.object({
  companyId: z.string().guid(),
  issueId: z.string().guid(),
  toStatus: z.enum(BINDER_TASK_STATUSES),
  /** Versi status yang dibaca pemanggil — untuk atomic checkout (CAS). */
  expectedStatusVersion: z.number().int().min(0),
  actorUserId: z.string().min(1).max(256).optional(),
  actorAgentId: z.string().guid().optional(),
  reason: z.string().min(1).max(1000).optional(),
});

export type BinderTransitionTask = z.infer<typeof binderTransitionTaskSchema>;

export const binderSubmitWorkSchema = z.object({
  companyId: z.string().guid(),
  issueId: z.string().guid(),
  /** Work product yang jadi artifact utama (satu per task). */
  artifactWorkProductId: z.string().guid(),
  expectedStatusVersion: z.number().int().min(0),
  actorAgentId: z.string().guid().optional(),
});

export type BinderSubmitWork = z.infer<typeof binderSubmitWorkSchema>;

export const binderRegisterQcReviewerSchema = z.object({
  companyId: z.string().guid(),
  agentId: z.string().guid(),
});

export type BinderRegisterQcReviewer = z.infer<typeof binderRegisterQcReviewerSchema>;

export const binderSubmitQcScoreSchema = z.object({
  companyId: z.string().guid(),
  issueId: z.string().guid(),
  assignmentId: z.string().guid(),
  qcAgentId: z.string().guid(),
  /** Kebenaran/bukti: 0..30. */
  truthEvidence: z.number().int().min(0).max(BINDER_QC_RUBRIC_MAX.truthEvidence),
  /** Kelengkapan: 0..25. */
  completeness: z.number().int().min(0).max(BINDER_QC_RUBRIC_MAX.completeness),
  /** Kepatuhan: 0..25. */
  compliance: z.number().int().min(0).max(BINDER_QC_RUBRIC_MAX.compliance),
  /** Kualitas: 0..20. */
  quality: z.number().int().min(0).max(BINDER_QC_RUBRIC_MAX.quality),
  /** Kode hard violation (P0-2); satu saja = gagal apa pun skornya. */
  hardViolations: z.array(z.enum(BINDER_HARD_VIOLATION_CODES)).default([]),
  /** Biaya review QC (sen) — default BINDER_QC_REVIEW_COST_CENTS, ke pool. */
  qcCostCents: exactCentsSchema.optional(),
  evidenceNote: z.string().max(2000).optional(),
  expectedStatusVersion: z.number().int().min(0),
  idempotencyKey: z.string().min(1).max(256).optional(),
});

export type BinderSubmitQcScore = z.infer<typeof binderSubmitQcScoreSchema>;

export const binderApproveTaskSchema = z.object({
  companyId: z.string().guid(),
  issueId: z.string().guid(),
  /** Owner (user) yang menyetujui. */
  ownerUserId: z.string().min(1).max(256),
  expectedStatusVersion: z.number().int().min(0),
  decisionNote: z.string().max(2000).optional(),
});

export type BinderApproveTask = z.infer<typeof binderApproveTaskSchema>;

export const binderRejectTaskSchema = z.object({
  companyId: z.string().guid(),
  issueId: z.string().guid(),
  ownerUserId: z.string().min(1).max(256),
  expectedStatusVersion: z.number().int().min(0),
  decisionNote: z.string().max(2000).optional(),
});

export type BinderRejectTask = z.infer<typeof binderRejectTaskSchema>;

export const binderResolveEscalationSchema = z.object({
  companyId: z.string().guid(),
  issueId: z.string().guid(),
  ownerUserId: z.string().min(1).max(256),
  /** 'resume' = kembali dikerjakan (putaran revisi di-reset); 'cancel' = batal. */
  decision: z.enum(["resume", "cancel"]),
  expectedStatusVersion: z.number().int().min(0),
  decisionNote: z.string().max(2000).optional(),
});

export type BinderResolveEscalation = z.infer<typeof binderResolveEscalationSchema>;

export const binderRequestApprovedActionSchema = z.object({
  companyId: z.string().guid(),
  projectId: z.string().guid().optional().nullable(),
  issueId: z.string().guid().optional().nullable(),
  actionKind: z.enum(BINDER_APPROVED_ACTION_KINDS),
  /** Isi pengajuan (referensi draf, target, dsb.) — TANPA secret. */
  payload: z.record(z.string(), z.unknown()),
  /** Agen yang menyiapkan pengajuan (CEO). */
  requestedByAgentId: z.string().guid(),
  requestedByUserId: z.string().min(1).max(256).optional(),
});

export type BinderRequestApprovedAction = z.infer<typeof binderRequestApprovedActionSchema>;

export const binderIssueApprovedActionSchema = z.object({
  companyId: z.string().guid(),
  /** Approval owner yang sudah 'approved' dan mendasari penerbitan. */
  approvalId: z.string().guid(),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
});

export type BinderIssueApprovedAction = z.infer<typeof binderIssueApprovedActionSchema>;

export const binderApprovedActionIdSchema = z.object({
  companyId: z.string().guid(),
  approvedActionId: z.string().guid(),
});

export type BinderApprovedActionId = z.infer<typeof binderApprovedActionIdSchema>;

export const binderRevokeApprovedActionSchema = z.object({
  companyId: z.string().guid(),
  approvedActionId: z.string().guid(),
  revokedByUserId: z.string().min(1).max(256),
});

export type BinderRevokeApprovedAction = z.infer<typeof binderRevokeApprovedActionSchema>;
