import { exactCentsSchema } from "../accounting.js";
import { z } from "zod";
import {
  BINDER_DESKTOP_JOB_STATUSES,
  BINDER_DESKTOP_RUNTIMES,
  BINDER_GATE_ACTION_KINDS,
  BINDER_SYNC_ADAPTER_CONTRACT_VERSION,
} from "../constants.js";

/**
 * Validator input Sync Internal + Gate Internal BINDER
 * (PRD Bab 6.3; TRD Bab 3.3–3.5, Bab 4–5; Rencana Tahap 5).
 *
 * Prinsip: semua input yang masuk Sync/Gate divalidasi di sini sebelum
 * menyentuh service — tanpa task_id job ditolak (validator mewajibkan
 * issueId); tanpa approved_action_id Gate menolak (service, bukan
 * validator — id boleh kosong di input Gate supaya penolakannya tercatat
 * sebagai keputusan Gate, bukan sebagai error validasi).
 * Secret tidak pernah masuk input mana pun (P1-24).
 */

/** Runtime Mesin Desktop — 'test_double' hanya untuk uji, bukan VM nyata. */
export const binderDesktopRuntimeSchema = z.enum(BINDER_DESKTOP_RUNTIMES);
export type BinderDesktopRuntime = z.infer<typeof binderDesktopRuntimeSchema>;

/** Status job desktop. */
export const binderDesktopJobStatusSchema = z.enum(BINDER_DESKTOP_JOB_STATUSES);
export type BinderDesktopJobStatus = z.infer<typeof binderDesktopJobStatusSchema>;

/** Jenis aksi eksternal yang dijaga Gate. */
export const binderGateActionKindSchema = z.enum(BINDER_GATE_ACTION_KINDS);
export type BinderGateActionKind = z.infer<typeof binderGateActionKindSchema>;

/** Satu artifact yang dikembalikan job desktop (PRD Bab 6.3). */
export const binderDesktopArtifactSchema = z.object({
  /** Jenis artifact: file hasil, screenshot bukti, log ringkas, atau diff. */
  kind: z.enum(["file", "screenshot", "log", "diff"]),
  title: z.string().min(1).max(512),
  /** Ringkasan isi — bukan dump mentah; tidak boleh berisi secret. */
  summary: z.string().max(4000).optional(),
  /** URL/path artifact bila ada (path lokal VM atau URL — bukan secret). */
  url: z.string().max(2048).optional(),
});
export type BinderDesktopArtifact = z.infer<typeof binderDesktopArtifactSchema>;

/** Biaya job desktop per task (sen eksak; 0 = tidak ada biaya jenis itu). */
export const binderDesktopJobCostsSchema = z.object({
  vmCents: exactCentsSchema.optional(),
  tokenCents: exactCentsSchema.optional(),
  toolsCents: exactCentsSchema.optional(),
});
export type BinderDesktopJobCosts = z.infer<typeof binderDesktopJobCostsSchema>;

export const binderCreateDesktopJobSchema = z.object({
  companyId: z.string().guid(),
  projectId: z.string().guid().optional(),
  /** Kunci kanonik — tanpa task_id, job ditolak (PRD Bab 6.3). */
  issueId: z.string().guid(),
  /** Agen bot desktop yang menjalankan job (mis. Code Builder untuk GUI). */
  agentId: z.string().guid(),
  /** Pembuat job — WAJIB CEO (Edison); service menolak bukan-CEO. */
  createdByAgentId: z.string().guid(),
  runtime: binderDesktopRuntimeSchema,
  /** Percobaan ke-n untuk task ini (kunci idempotensi binder_task_id + attempt). Attempt > 1 hanya lewat retryDesktopJob. */
  attempt: z.number().int().min(1).max(100).optional(),
  /** Snapshot hanya bila task secara eksplisit membutuhkannya; wajib idleTimeout + pagu (service). */
  snapshotRequested: z.boolean().optional(),
  /** Batas idle VM (detik). Tanpa ini, snapshot dilarang. */
  idleTimeoutSeconds: z.number().int().min(0).max(2_592_000).optional(),
  /** Pagu VM untuk job ini (sen eksak). Tanpa ini, snapshot dilarang. */
  paguVmCents: exactCentsSchema.optional(),
});
export type BinderCreateDesktopJob = z.infer<typeof binderCreateDesktopJobSchema>;

export const binderGetDesktopJobStatusSchema = z.object({
  companyId: z.string().guid(),
  jobId: z.string().guid(),
});
export type BinderGetDesktopJobStatus = z.infer<typeof binderGetDesktopJobStatusSchema>;

export const binderReturnDesktopArtifactSchema = z.object({
  companyId: z.string().guid(),
  jobId: z.string().guid(),
  /** Minimal SATU artifact — tanpa artifact, task tidak bisa masuk In Review. */
  artifacts: z.array(binderDesktopArtifactSchema).min(1).max(50),
  /** Biaya yang dicatat ke task_id yang sama (ledger + tagihan VM). */
  costs: binderDesktopJobCostsSchema.optional(),
  /** Catatan ringkas job (bukan dump log). */
  note: z.string().max(2000).optional(),
});
export type BinderReturnDesktopArtifact = z.infer<typeof binderReturnDesktopArtifactSchema>;

export const binderFailDesktopJobSchema = z.object({
  companyId: z.string().guid(),
  jobId: z.string().guid(),
  /** Alasan gagal — dicatat ke task saat kembali ke Todo. */
  reason: z.string().min(1).max(2000),
  /** Checkpoint terakhir yang disimpan (handoff/checkpoint ringkas). */
  checkpointNote: z.string().max(4000).optional(),
  costs: binderDesktopJobCostsSchema.optional(),
});
export type BinderFailDesktopJob = z.infer<typeof binderFailDesktopJobSchema>;

export const binderTimeoutDesktopJobSchema = z.object({
  companyId: z.string().guid(),
  jobId: z.string().guid(),
  /** Alasan timeout (mis. 'VM timeout: idle 600 dtk'). */
  reason: z.string().min(1).max(2000),
  checkpointNote: z.string().max(4000).optional(),
  costs: binderDesktopJobCostsSchema.optional(),
});
export type BinderTimeoutDesktopJob = z.infer<typeof binderTimeoutDesktopJobSchema>;

export const binderStopVmSchema = z.object({
  companyId: z.string().guid(),
  jobId: z.string().guid(),
});
export type BinderStopVm = z.infer<typeof binderStopVmSchema>;

export const binderRetryDesktopJobSchema = z.object({
  companyId: z.string().guid(),
  /** Job gagal yang hendak diulang (attempt baru = attempt lama + 1). */
  jobId: z.string().guid(),
  /** Persetujuan CEO wajib — retry tanpa CEO ditolak (TRD Bab 4). */
  approvedByCeoAgentId: z.string().guid(),
  runtime: binderDesktopRuntimeSchema.optional(),
  snapshotRequested: z.boolean().optional(),
  idleTimeoutSeconds: z.number().int().min(0).max(2_592_000).optional(),
  paguVmCents: exactCentsSchema.optional(),
});
export type BinderRetryDesktopJob = z.infer<typeof binderRetryDesktopJobSchema>;

/**
 * Input Gate (TRD Bab 5): `gate_check(task, aksi)`.
 * approvedActionId boleh null — justru itu kasus yang HARUS ditolak Gate
 * dan tercatat (bukan error validasi). scopeRef opsional: bila diisi,
 * payload approved action harus memuat scopeRef yang sama, kalau tidak
 * aksi ditolak sebagai "di luar scope". budgetRemainingCents null =
 * pagu belum dipatok → Gate TIDAK menolak atas dasar pagu (TRD Bab 5).
 */
export const binderGateCheckSchema = z.object({
  companyId: z.string().guid(),
  issueId: z.string().guid(),
  agentId: z.string().guid(),
  actionKind: binderGateActionKindSchema,
  approvedActionId: z.string().guid().nullable().optional(),
  /** Referensi scope yang diminta (mis. id draf / target) — dicocokkan ke payload approved action. */
  scopeRef: z.string().min(1).max(512).optional(),
  /** Sisa pagu (sen eksak) — null bila pagu belum dipatok. */
  budgetRemainingCents: exactCentsSchema.nullable().optional(),
});
export type BinderGateCheck = z.infer<typeof binderGateCheckSchema>;

/** Keputusan Gate — hasil `gate_check`, dipakai executor sebagai bukti izin. */
export const binderGateDecisionSchema = z.object({
  decisionId: z.string().guid(),
  companyId: z.string().guid(),
  issueId: z.string().guid(),
  agentId: z.string().guid(),
  actionKind: binderGateActionKindSchema,
  approvedActionId: z.string().guid().nullable(),
  allowed: z.boolean(),
  reason: z.string().min(1).max(2000),
});
export type BinderGateDecision = z.infer<typeof binderGateDecisionSchema>;

/** Eksekusi aksi eksternal — HANYA dengan keputusan Gate yang mengizinkan. */
export const binderExecuteExternalActionSchema = z.object({
  companyId: z.string().guid(),
  issueId: z.string().guid(),
  agentId: z.string().guid(),
  actionKind: binderGateActionKindSchema,
  /** Keputusan Gate (dari gateCheck) — null = upaya bypass langsung, WAJIB ditolak executor. */
  gateDecision: binderGateDecisionSchema.nullable(),
  /** Payload aksi (draf, target, dsb.) — TIDAK BOLEH berisi secret. */
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type BinderExecuteExternalAction = z.infer<typeof binderExecuteExternalActionSchema>;

/** Konstanta kontrak diekspor ulang agar service membaca satu sumber. */
export { BINDER_SYNC_ADAPTER_CONTRACT_VERSION };
