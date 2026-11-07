import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { approvals } from "./approvals.js";
import { companies } from "./companies.js";
import { costEvents } from "./cost_events.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

/**
 * Skema pendanaan BINDER (PRD Bab 3 / v1.16; rencana Tahap 3 Fase 3.2).
 *
 * - `binder_pools`: satu pool top-up per company. Default $20/bulan, bisa
 *   diubah owner, sisa menggulung (saldo tidak pernah di-reset bulanan),
 *   hard stop di nol. Pool TERPISAH dari `companies.budgetMonthlyCents` /
 *   `spentMonthlyCents` (tampilan ringkas Paperclip, bukan sumber kebenaran)
 *   dan dari `budget_policies` (mesin budget yang sudah ada).
 * - `binder_pool_topups`: tiap top-up WAJIB merujuk approval owner yang
 *   sudah disetujui — tanpa auto top-up (P2-23).
 * - `binder_bid_envelopes`: amplop bid $5–$30 per tugas; biaya QC TIDAK
 *   pernah dibebankan ke amplop (P1-10), hanya ke pool.
 * - `ledger_entries`: ledger kanonik Modul Inti (P1-12). `company_id` selalu
 *   wajib (PRD v1.15); `project_id` wajib untuk entri kerja dan boleh kosong
 *   hanya untuk entri level-company (top-up/adjustment/rollover) — lihat
 *   CHECK `ledger_entries_project_scope_check`. Entri memo
 *   (`is_memo = true`: alokasi amplop + rollover) mencatat reservasi /
 *   peristiwa, BUKAN pergerakan dana — rekonsiliasi (P1-21) hanya
 *   menjumlah entri non-memo, dan jumlah internal harus persis $0,00.
 *
 * Uang disimpan sebagai numeric(24,7) sen (pola `budget_policies` /
 * `cost_events`); aritmetika memakai BigInt via `centsToUnits` /
 * `unitsToCents` di `@paperclipai/shared` — tidak pernah float.
 */

export const binderPools = pgTable(
  "binder_pools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    monthlyTopUpCents: integer("monthly_top_up_cents").notNull().default(2000),
    balanceCents: numeric("balance_cents", { precision: 24, scale: 7 }).notNull().default("0"),
    /** Periode berjalan "YYYY-MM" (UTC); saldo menggulung antar periode. */
    currentPeriod: text("current_period"),
    periodStartBalanceCents: numeric("period_start_balance_cents", { precision: 24, scale: 7 }).notNull().default("0"),
    /** Level peringatan terakhir yang sudah dicatat (0/70/90). */
    warnLevelNotified: integer("warn_level_notified").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniqueIdx: uniqueIndex("binder_pools_company_unique_idx").on(table.companyId),
    monthlyCapNonnegative: check("binder_pools_monthly_cap_nonnegative", sql`${table.monthlyTopUpCents} >= 0`),
    balanceNonnegative: check("binder_pools_balance_nonnegative", sql`${table.balanceCents} >= 0`),
    warnLevelCheck: check("binder_pools_warn_level_check", sql`${table.warnLevelNotified} in (0, 70, 90)`),
  }),
);

export const binderPoolTopups = pgTable(
  "binder_pool_topups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poolId: uuid("pool_id").notNull().references(() => binderPools.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    amountCents: numeric("amount_cents", { precision: 24, scale: 7 }).notNull(),
    /** Approval owner yang sudah disetujui — wajib; tanpa ini top-up ditolak. */
    approvalId: uuid("approval_id").notNull().references(() => approvals.id),
    approvedByUserId: text("approved_by_user_id"),
    /** Referensi eksternal (mis. nomor kwitansi). Bukan secret. */
    reference: text("reference"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    amountPositive: check("binder_pool_topups_amount_positive", sql`${table.amountCents} > 0`),
    receiptUniqueIdx: uniqueIndex("binder_pool_topups_company_receipt_idx").on(table.companyId, table.idempotencyKey),
    companyCreatedIdx: index("binder_pool_topups_company_created_idx").on(table.companyId, table.createdAt),
  }),
);

export const binderBidEnvelopes = pgTable(
  "binder_bid_envelopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    amountCents: numeric("amount_cents", { precision: 24, scale: 7 }).notNull(),
    spentCents: numeric("spent_cents", { precision: 24, scale: 7 }).notNull().default("0"),
    status: text("status").notNull().default("proposed"),
    proposedByUserId: text("proposed_by_user_id"),
    approvedByUserId: text("approved_by_user_id"),
    /** Approval owner yang sudah disetujui — diisi saat amplop disetujui. */
    approvalId: uuid("approval_id").references(() => approvals.id),
    /** Level peringatan terakhir yang sudah dicatat (0/70/90). */
    warnLevelNotified: integer("warn_level_notified").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    amountRange: check("binder_bid_envelopes_amount_range", sql`${table.amountCents} >= 500 and ${table.amountCents} <= 3000`),
    spentNonnegative: check("binder_bid_envelopes_spent_nonnegative", sql`${table.spentCents} >= 0`),
    spentWithinAmount: check("binder_bid_envelopes_spent_within_amount", sql`${table.spentCents} <= ${table.amountCents}`),
    statusCheck: check(
      "binder_bid_envelopes_status_check",
      sql`${table.status} in ('proposed', 'approved', 'active', 'exhausted', 'escalated', 'closed', 'cancelled')`,
    ),
    warnLevelCheck: check("binder_bid_envelopes_warn_level_check", sql`${table.warnLevelNotified} in (0, 70, 90)`),
    liveEnvelopeUniqueIdx: uniqueIndex("binder_bid_envelopes_live_task_unique_idx")
      .on(table.companyId, table.issueId)
      .where(sql`${table.status} in ('proposed', 'approved', 'active', 'exhausted', 'escalated')`),
    companyProjectIdx: index("binder_bid_envelopes_company_project_idx").on(table.companyId, table.projectId),
    companyIssueIdx: index("binder_bid_envelopes_company_issue_idx").on(table.companyId, table.issueId),
  }),
);

/**
 * Ledger kanonik BINDER. Pemilik: Modul Inti Perusahaan (P1-12).
 * Satu baris = satu pergerakan dana (atau satu memo reservasi/peristiwa).
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /**
     * Project wajib untuk entri kerja (usage/qc_cost/alokasi amplop).
     * Entri level-company (top-up, adjustment, rollover) tidak punya project —
     * memaksakan project akan mengarang atribusi. CHECK
     * `ledger_entries_project_scope_check` di bawah menegakkan aturan ini;
     * company_id selalu wajib (PRD v1.15).
     */
    projectId: uuid("project_id").references(() => projects.id),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    poolId: uuid("pool_id").references(() => binderPools.id),
    envelopeId: uuid("envelope_id").references(() => binderBidEnvelopes.id),
    kind: text("kind").notNull(),
    direction: text("direction").notNull(),
    /** true = memo (alokasi amplop, rollover): bukan pergerakan dana. */
    isMemo: boolean("is_memo").notNull().default(false),
    amountCents: numeric("amount_cents", { precision: 24, scale: 7 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    reason: text("reason").notNull(),
    idempotencyKey: text("idempotency_key"),
    relatedCostEventId: uuid("related_cost_event_id").references(() => costEvents.id),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      "ledger_entries_kind_check",
      sql`${table.kind} in ('top_up', 'envelope_allocate', 'usage', 'qc_cost', 'envelope_release', 'adjustment', 'rollover')`,
    ),
    directionCheck: check("ledger_entries_direction_check", sql`${table.direction} in ('credit', 'debit')`),
    projectScopeCheck: check(
      "ledger_entries_project_scope_check",
      sql`${table.projectId} is not null or ${table.kind} in ('top_up', 'adjustment', 'rollover')`,
    ),
    amountPositive: check("ledger_entries_amount_positive", sql`${table.amountCents} > 0`),
    receiptUniqueIdx: uniqueIndex("ledger_entries_company_receipt_idx").on(table.companyId, table.idempotencyKey),
    companyOccurredIdx: index("ledger_entries_company_occurred_idx").on(table.companyId, table.occurredAt),
    companyProjectOccurredIdx: index("ledger_entries_company_project_occurred_idx").on(
      table.companyId,
      table.projectId,
      table.occurredAt,
    ),
    companyIssueOccurredIdx: index("ledger_entries_company_issue_occurred_idx").on(
      table.companyId,
      table.issueId,
      table.occurredAt,
    ),
  }),
);

export type BinderPool = typeof binderPools.$inferSelect;
export type BinderPoolTopup = typeof binderPoolTopups.$inferSelect;
export type BinderBidEnvelope = typeof binderBidEnvelopes.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
