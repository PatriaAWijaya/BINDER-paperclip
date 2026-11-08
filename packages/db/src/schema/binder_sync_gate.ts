import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { binderTasks } from "./binder_task_flow.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

/**
 * Skema Sync Internal + Gate Internal BINDER
 * (PRD Bab 6.3; TRD Bab 3.3–3.5, Bab 4–5; Rencana Tahap 5).
 *
 * Prinsip: perluas domain Paperclip yang sudah ada, jangan duplikasi.
 * - Job desktop = `binder_desktop_jobs` (satu baris per percobaan job;
 *   kunci idempotensi binder_task_id + attempt, TRD Bab 4). Kunci kanonik
 *   tetap `binder_task_id` — job, VM, dan artifact selalu merujuk ke
 *   task_id ini; tanpa task_id, job ditolak (service).
 * - Keputusan Gate = `binder_gate_decisions` (satu baris per keputusan
 *   IZIN/TOLAK — log penolakan bypass yang bisa diaudit; TRD Bab 5:
 *   setiap penolakan dicatat dengan task_id, agentId, jenis_aksi, alasan,
 *   dan waktu). Activity log tetap dicatat untuk tiap keputusan.
 * - Artifact job = `issue_work_products` yang sudah ada (tipe
 *   'binder_desktop_artifact'); id-nya dicatat di
 *   `artifactsReturned` job. Tanpa artifact, task tidak bisa masuk
 *   In Review (service).
 * - Biaya (VM/token/tools) dicatat ke ledger BINDER lewat
 *   chargeBinderUsageInTransaction (kind 'usage', ke task_id yang sama)
 *   — bukan di tabel ini sebagai sumber kebenaran; kolom biaya di sini
 *   adalah salinan yang dicatat job untuk rekonsiliasi per task.
 * - Secret tidak pernah masuk tabel ini (P1-24): yang dicatat hanya id,
 *   status, angka, dan alasan singkat.
 * - Runtime 'test_double' = adapter palsu untuk uji — BUKAN VM nyata.
 *   VM nyata menunggu Docker Desktop di MacBook / Tahap 6.
 */

/** Satu percobaan job desktop untuk satu task BINDER (TRD Bab 3.3 VMJob). */
export const binderDesktopJobs = pgTable(
  "binder_desktop_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    /** Kunci kanonik (PRD Bab 6.3). */
    binderTaskId: uuid("binder_task_id").notNull().references(() => binderTasks.id, { onDelete: "cascade" }),
    /** Agen bot desktop yang menjalankan job. */
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    /** Pembuat job — WAJIB CEO (Edison); service menolak bukan-CEO. */
    createdByAgentId: uuid("created_by_agent_id").notNull().references(() => agents.id),
    /** Runtime: local_vm_docker_podman / boat / mac_patria_per_task / test_double. */
    runtime: text("runtime").notNull(),
    /** ID VM dari adapter runtime (null sebelum VM dibuat / bila gagal dibuat). */
    vmId: text("vm_id"),
    status: text("status").notNull().default("queued"),
    /** Percobaan ke-n untuk task ini (1 = pertama; retry = +1, butuh persetujuan CEO). */
    attempt: integer("attempt").notNull().default(1),
    /** Snapshot hanya bila task secara eksplisit membutuhkannya. */
    snapshotRequested: boolean("snapshot_requested").notNull().default(false),
    /** Batas idle VM (detik) — wajib bila snapshot diminta. */
    idleTimeoutSeconds: integer("idle_timeout_seconds"),
    /** Pagu VM untuk job ini (sen) — wajib bila snapshot diminta. */
    paguVmCents: numeric("pagu_vm_cents", { precision: 24, scale: 7 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Kapan VM dihentikan (null = VM belum dihentikan / tidak ada VM). */
    vmStoppedAt: timestamp("vm_stopped_at", { withTimezone: true }),
    /** Stop VM gagal — VM liar potensial, wajib diperiksa (Tahap 6 poin 9). */
    vmStopFailed: boolean("vm_stop_failed").notNull().default(false),
    /** ID work product artifact yang dikembalikan job (minimal 1 bila done). */
    artifactsReturned: jsonb("artifacts_returned").$type<string[]>().notNull().default([]),
    /** Alasan gagal / timeout — dicatat ke task saat kembali ke Todo. */
    failureNote: text("failure_note"),
    /** Checkpoint terakhir yang disimpan saat gagal/timeout. */
    checkpointNote: text("checkpoint_note"),
    /** Job done tapi task belum masuk In Review (mis. QC tidak bisa ditugaskan) — alasannya. */
    reviewPendingReason: text("review_pending_reason"),
    /** Biaya yang dicatat job (sen) — salinan untuk rekonsiliasi; sumber kebenaran tetap ledger. */
    costVmCents: numeric("cost_vm_cents", { precision: 24, scale: 7 }).notNull().default("0"),
    costTokenCents: numeric("cost_token_cents", { precision: 24, scale: 7 }).notNull().default("0"),
    costToolsCents: numeric("cost_tools_cents", { precision: 24, scale: 7 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      "binder_desktop_jobs_status_check",
      sql`${table.status} in ('queued', 'running', 'need_approval', 'done', 'failed')`,
    ),
    runtimeCheck: check(
      "binder_desktop_jobs_runtime_check",
      sql`${table.runtime} in ('local_vm_docker_podman', 'boat', 'mac_patria_per_task', 'test_double')`,
    ),
    attemptCheck: check("binder_desktop_jobs_attempt_check", sql`${table.attempt} >= 1`),
    idleTimeoutCheck: check(
      "binder_desktop_jobs_idle_timeout_check",
      sql`${table.idleTimeoutSeconds} is null or ${table.idleTimeoutSeconds} >= 0`,
    ),
    paguVmCheck: check(
      "binder_desktop_jobs_pagu_vm_check",
      sql`${table.paguVmCents} is null or ${table.paguVmCents} >= 0`,
    ),
    costsNonnegative: check(
      "binder_desktop_jobs_costs_nonnegative",
      sql`${table.costVmCents} >= 0 and ${table.costTokenCents} >= 0 and ${table.costToolsCents} >= 0`,
    ),
    // Snapshot tanpa idleTimeout dan pagu dilarang (PRD Bab 6.3).
    snapshotRequiresLimits: check(
      "binder_desktop_jobs_snapshot_requires_limits",
      sql`not ${table.snapshotRequested} or (${table.idleTimeoutSeconds} is not null and ${table.idleTimeoutSeconds} > 0 and ${table.paguVmCents} is not null and ${table.paguVmCents} > 0)`,
    ),
    // Kunci idempotensi: satu job per (task, percobaan) — TRD Bab 4.
    companyTaskAttemptUniqueIdx: uniqueIndex("binder_desktop_jobs_company_task_attempt_unique_idx").on(
      table.companyId,
      table.binderTaskId,
      table.attempt,
    ),
    companyIssueIdx: index("binder_desktop_jobs_company_issue_idx").on(table.companyId, table.issueId),
    companyStatusIdx: index("binder_desktop_jobs_company_status_idx").on(table.companyId, table.status),
    companyAgentIdx: index("binder_desktop_jobs_company_agent_idx").on(table.companyId, table.agentId),
  }),
);

/**
 * Keputusan Gate — satu baris per keputusan IZIN/TOLAK (TRD Bab 5).
 * Log penolakan bypass yang bisa diaudit; activity log tetap dicatat
 * untuk tiap keputusan. Executor aksi eksternal WAJIB merujuk keputusan
 * IZIN yang masih berlaku; tanpa itu, executor menolak (bypass langsung).
 */
export const binderGateDecisions = pgTable(
  "binder_gate_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    /** Agen yang meminta aksi eksternal. */
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    /** Jenis aksi eksternal (kirim/publish/bayar/ubah_akses/deploy/tulis_eksternal/hapus). */
    actionKind: text("action_kind").notNull(),
    /** approved_action_id yang diajukan (null = tidak ada — kasus yang harus ditolak). */
    approvedActionId: uuid("approved_action_id"),
    decision: text("decision").notNull(),
    /** Alasan keputusan — untuk TOLAK, alasan penolakan TRD Bab 5. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    decisionCheck: check(
      "binder_gate_decisions_decision_check",
      sql`${table.decision} in ('allowed', 'denied')`,
    ),
    actionKindCheck: check(
      "binder_gate_decisions_action_kind_check",
      sql`${table.actionKind} in ('kirim', 'publish', 'bayar', 'ubah_akses', 'deploy', 'tulis_eksternal', 'hapus')`,
    ),
    companyIssueIdx: index("binder_gate_decisions_company_issue_idx").on(table.companyId, table.issueId),
    companyDecisionIdx: index("binder_gate_decisions_company_decision_idx").on(
      table.companyId,
      table.decision,
    ),
    companyAgentIdx: index("binder_gate_decisions_company_agent_idx").on(table.companyId, table.agentId),
  }),
);

export type BinderDesktopJob = typeof binderDesktopJobs.$inferSelect;
export type BinderGateDecisionRow = typeof binderGateDecisions.$inferSelect;
