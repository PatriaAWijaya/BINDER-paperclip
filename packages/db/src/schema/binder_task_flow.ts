import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { approvals } from "./approvals.js";
import { companies } from "./companies.js";
import { issueWorkProducts } from "./issue_work_products.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

/**
 * Skema alur task + QC + approved_action_id BINDER
 * (PRD Bab 3 / Bab 6.4; rencana Tahap 3 Fase 3.3; P0-1/2/3, P1-11/19).
 *
 * Prinsip: perluas domain Paperclip yang sudah ada, jangan duplikasi.
 * - Task = `issues` (atomic checkout via `status_version`, privasi
 *   per-agen, transkrip `issue_comments`, artifact `issue_work_products`).
 *   Mesin status BINDER tinggal di `binder_tasks` (satu baris per task);
 *   `issues.status` dicerminkan ke status Paperclip terdekat supaya board
 *   / query yang sudah ada tetap jalan (lihat
 *   BINDER_TASK_ISSUE_STATUS_MIRROR di @paperclipai/shared).
 * - Satu task = satu owner (`owner_agent_id`, sama dengan
 *   `issues.assignee_agent_id`), satu DoD (`dod`), satu artifact utama
 *   (`primary_artifact_id` → `issue_work_products.is_primary`).
 * - QC (P0-1): pool QC ditunjuk eksplisit (`binder_qc_roster`); family
 *   model agen dicatat di `binder_agent_models` — QC WAJIB beda family
 *   dari maker, round-robin, CEO tidak pernah di pool (role 'ceo'
 *   ditolak saat pendaftaran + disaring saat penunjukan; CEO BINDER
 *   adalah agen tingkat akun, bukan agen company).
 * - Rubrik QC (P0-3): Kebenaran/bukti 30, Kelengkapan 25, Kepatuhan 25,
 *   Kualitas 20; lolos ≥ 75 + NOL hard violation (P0-2); maks 2 putaran
 *   revisi lalu eskalasi ke owner. Lembar skor disimpan sebagai artifact
 *   (`issue_work_products` tipe `binder_qc_score_sheet`).
 * - `approved_action_id` (P1-11): Core menerbitkan atas vonis owner
 *   (baris `approvals` yang sudah 'approved'); CEO menyiapkan pengajuan.
 *   ID-nya adalah UUID baris `binder_approved_actions` — sekali pakai
 *   (status 'used' sesudah dipakai), bisa dicabut owner ('revoked').
 *   Penegakan di semua jalur aksi eksternal adalah Tahap 5 — di sini
 *   hanya penerbitan + pencatatan + validasi. Final send outreach tetap
 *   MANUAL oleh manusia dari draf yang disetujui (P1-19).
 * - Biaya QC dibebankan ke pool, BUKAN ke amplop (P1-10): `submitQcScore`
 *   memanggil `chargeBinderUsage` (kind 'qc_cost') di transaksi yang sama.
 * - Secret tidak pernah masuk log/artefak/transkrip (P1-24): yang dicatat
 *   hanya id, status, angka, dan alasan singkat.
 */

/** Family model agen — untuk aturan QC beda family (P0-1). */
export const binderAgentModels = pgTable(
  "binder_agent_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    modelFamily: text("model_family").notNull(),
    /** ID model, mis. 'muse-spark-1.3' / 'claude-sonnet-5-5'. Bukan secret. */
    modelId: text("model_id").notNull(),
    /** Provider yang menjalankan model, mis. 'opencode_local'. */
    provider: text("provider"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    familyCheck: check(
      "binder_agent_models_family_check",
      sql`${table.modelFamily} in ('meta', 'anthropic', 'google', 'openai', 'other')`,
    ),
    companyAgentUniqueIdx: uniqueIndex("binder_agent_models_company_agent_unique_idx").on(
      table.companyId,
      table.agentId,
    ),
    companyIdx: index("binder_agent_models_company_idx").on(table.companyId),
  }),
);

/** Status mesin task BINDER + satu DoD + satu artifact utama per task. */
export const binderTasks = pgTable(
  "binder_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    /** Satu owner — sama dengan `issues.assignee_agent_id`. */
    ownerAgentId: uuid("owner_agent_id").notNull().references(() => agents.id),
    /** Definition of Done — satu per task, wajib diisi saat dibuat. */
    dod: text("dod").notNull(),
    binderStatus: text("binder_status").notNull().default("backlog"),
    /** Putaran revisi yang sudah dijalani (0..2); 2 = eskalasi berikutnya. */
    revisionRound: integer("revision_round").notNull().default(0),
    /** Satu artifact utama (work product `is_primary`). */
    primaryArtifactId: uuid("primary_artifact_id").references(() => issueWorkProducts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      "binder_tasks_status_check",
      sql`${table.binderStatus} in ('backlog', 'todo', 'in_progress', 'in_review', 'revision', 'needs_owner_approval', 'escalated', 'done', 'cancelled')`,
    ),
    revisionRoundCheck: check(
      "binder_tasks_revision_round_check",
      sql`${table.revisionRound} >= 0 and ${table.revisionRound} <= 2`,
    ),
    companyIssueUniqueIdx: uniqueIndex("binder_tasks_company_issue_unique_idx").on(
      table.companyId,
      table.issueId,
    ),
    companyStatusIdx: index("binder_tasks_company_status_idx").on(table.companyId, table.binderStatus),
    companyOwnerIdx: index("binder_tasks_company_owner_idx").on(table.companyId, table.ownerAgentId),
  }),
);

/** Pool QC (P0-1): anggota ditunjuk eksplisit; CEO tidak pernah di pool. */
export const binderQcRoster = pgTable(
  "binder_qc_roster",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    /** Penugasan terakhir — penggerak round-robin (null = belum pernah). */
    lastAssignedAt: timestamp("last_assigned_at", { withTimezone: true }),
    assignmentsCount: integer("assignments_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentUniqueIdx: uniqueIndex("binder_qc_roster_company_agent_unique_idx").on(
      table.companyId,
      table.agentId,
    ),
    companyIdx: index("binder_qc_roster_company_idx").on(table.companyId),
  }),
);

/** Satu penugasan QC per (task, putaran). */
export const binderQcAssignments = pgTable(
  "binder_qc_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    binderTaskId: uuid("binder_task_id").notNull().references(() => binderTasks.id, { onDelete: "cascade" }),
    qcAgentId: uuid("qc_agent_id").notNull().references(() => agents.id),
    makerAgentId: uuid("maker_agent_id").notNull().references(() => agents.id),
    makerFamily: text("maker_family").notNull(),
    qcFamily: text("qc_family").notNull(),
    /** Putaran QC: 1 = review pertama, 2 = sesudah revisi pertama. */
    round: integer("round").notNull(),
    status: text("status").notNull().default("assigned"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Nomor pengajuan QC ke-n untuk task ini — MONOTONIK, tanpa batas atas:
    // sesudah owner memerintahkan resume (mandat baru), pengajuan
    // berikutnya adalah putaran ke-3 dst. Anggaran 2 putaran revisi per
    // mandat TIDAK ditegakkan di sini, melainkan oleh `revisionRound`
    // di `binder_tasks` (service `submitWorkForReview`).
    roundCheck: check("binder_qc_assignments_round_check", sql`${table.round} >= 1`),
    statusCheck: check(
      "binder_qc_assignments_status_check",
      sql`${table.status} in ('assigned', 'submitted', 'escalated')`,
    ),
    companyIssueRoundUniqueIdx: uniqueIndex("binder_qc_assignments_company_issue_round_unique_idx").on(
      table.companyId,
      table.issueId,
      table.round,
    ),
    companyIssueIdx: index("binder_qc_assignments_company_issue_idx").on(table.companyId, table.issueId),
    companyQcIdx: index("binder_qc_assignments_company_qc_idx").on(table.companyId, table.qcAgentId),
  }),
);

/** Skor rubrik QC (P0-3) — satu skor per penugasan. */
export const binderQcScores = pgTable(
  "binder_qc_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id").notNull().references(() => binderQcAssignments.id, {
      onDelete: "cascade",
    }),
    /** Kebenaran/bukti: 0..30. */
    truthEvidence: integer("truth_evidence").notNull(),
    /** Kelengkapan: 0..25. */
    completeness: integer("completeness").notNull(),
    /** Kepatuhan: 0..25. */
    compliance: integer("compliance").notNull(),
    /** Kualitas: 0..20. */
    quality: integer("quality").notNull(),
    /** Jumlah keempat dimensi (0..100); lolos ≥ 75 + nol hard violation. */
    totalScore: integer("total_score").notNull(),
    passed: boolean("passed").notNull(),
    /** Kode hard violation (P0-2); satu saja = gagal apa pun skornya. */
    hardViolations: jsonb("hard_violations").$type<string[]>().notNull().default([]),
    /** Lembar skor sebagai artifact (`issue_work_products`). */
    scoreSheetWorkProductId: uuid("score_sheet_work_product_id").references(() => issueWorkProducts.id, {
      onDelete: "set null",
    }),
    submittedByAgentId: uuid("submitted_by_agent_id").notNull().references(() => agents.id),
    evidenceNote: text("evidence_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    truthRange: check("binder_qc_scores_truth_range", sql`${table.truthEvidence} >= 0 and ${table.truthEvidence} <= 30`),
    completenessRange: check(
      "binder_qc_scores_completeness_range",
      sql`${table.completeness} >= 0 and ${table.completeness} <= 25`,
    ),
    complianceRange: check(
      "binder_qc_scores_compliance_range",
      sql`${table.compliance} >= 0 and ${table.compliance} <= 25`,
    ),
    qualityRange: check("binder_qc_scores_quality_range", sql`${table.quality} >= 0 and ${table.quality} <= 20`),
    totalRange: check("binder_qc_scores_total_range", sql`${table.totalScore} >= 0 and ${table.totalScore} <= 100`),
    assignmentUniqueIdx: uniqueIndex("binder_qc_scores_assignment_unique_idx").on(table.assignmentId),
    companyAssignmentIdx: index("binder_qc_scores_company_assignment_idx").on(table.companyId, table.assignmentId),
  }),
);

/**
 * `approved_action_id` yang diterbitkan Core (P1-11). ID baris ini ADALAH
 * approved_action_id yang dipakai Gate untuk mengizinkan satu aksi
 * eksternal. Sekali pakai: sesudah 'used' tidak bisa dipakai lagi; owner
 * bisa mencabut sebelum dipakai ('revoked'). Satu vonis owner
 * (approval) hanya menerbitkan satu id (unik per approval).
 */
export const binderApprovedActions = pgTable(
  "binder_approved_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    /** Vonis owner yang mendasari penerbitan (baris `approvals`). */
    approvalId: uuid("approval_id").notNull().references(() => approvals.id),
    actionKind: text("action_kind").notNull(),
    /** Isi pengajuan (draf, target, dsb.) — TIDAK BOLEH berisi secret. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** Agen yang menyiapkan pengajuan (CEO). */
    requestedByAgentId: uuid("requested_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** Owner (user) yang menyetujui. */
    decidedByUserId: text("decided_by_user_id"),
    status: text("status").notNull().default("issued"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      "binder_approved_actions_kind_check",
      sql`${table.actionKind} in ('outreach_send', 'external_post', 'external_call', 'external_message', 'other')`,
    ),
    statusCheck: check(
      "binder_approved_actions_status_check",
      sql`${table.status} in ('issued', 'used', 'revoked', 'expired')`,
    ),
    companyApprovalUniqueIdx: uniqueIndex("binder_approved_actions_company_approval_unique_idx").on(
      table.companyId,
      table.approvalId,
    ),
    companyStatusIdx: index("binder_approved_actions_company_status_idx").on(table.companyId, table.status),
    companyIssueIdx: index("binder_approved_actions_company_issue_idx").on(table.companyId, table.issueId),
  }),
);

export type BinderAgentModel = typeof binderAgentModels.$inferSelect;
export type BinderTask = typeof binderTasks.$inferSelect;
export type BinderQcRosterMember = typeof binderQcRoster.$inferSelect;
export type BinderQcAssignment = typeof binderQcAssignments.$inferSelect;
export type BinderQcScore = typeof binderQcScores.$inferSelect;
export type BinderApprovedAction = typeof binderApprovedActions.$inferSelect;
