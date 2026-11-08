import { and, eq, sql } from "drizzle-orm";
import {
  approvals,
  binderBidEnvelopes,
  binderPools,
  binderPoolTopups,
  companies,
  issues,
  ledgerEntries,
  projects,
  type BinderBidEnvelope,
  type BinderPool,
  type Db,
  type LedgerEntry,
} from "@paperclipai/db";
import {
  BINDER_ENVELOPE_MAX_CENTS,
  BINDER_ENVELOPE_MIN_CENTS,
  BINDER_POOL_DEFAULT_MONTHLY_CENTS,
  BINDER_WARN_PERCENT_70,
  BINDER_WARN_PERCENT_90,
  centsToUnits,
  formatUsdExact,
  unitsToCents,
  type BinderApproveEnvelope,
  type BinderChargeUsage,
  type BinderCreateEnvelope,
  type BinderTopUpPool,
} from "@paperclipai/shared";
import { badRequest, conflict, notFound } from "../errors.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";
import { withOperationAccountingTransaction } from "./accounting-transaction.js";
import { lockBudgetAdmissionControls } from "./budget-admission-controls.js";
import { withBudgetSpan } from "./budget-tracing.js";

/**
 * Pendanaan BINDER — pool top-up per company + amplop bid per tugas +
 * ledger kanonik (PRD Bab 3 / v1.16; rencana Tahap 3 Fase 3.2).
 *
 * Aturan yang ditegakkan di sini (bukan di UI):
 * - Pool terpisah per company; default $20/bulan, bisa diubah owner, sisa
 *   menggulung (saldo tidak pernah di-reset), hard stop di nol (berhenti +
 *   antre), tanpa auto top-up.
 * - Amplop $5–$30 per tugas, diusulkan + disetujui owner bersama tugas;
 *   tugas yang tidak muat di amplop WAJIB eskalasi (pecah / naikkan amplop /
 *   kurangi scope) — tidak boleh diam-diam diturunkan atau dilampaui.
 * - Biaya QC dibebankan ke pool, BUKAN ke amplop tugas (P1-10).
 * - Top-up dan persetujuan amplop WAJIB merujuk approval owner yang sudah
 *   disetujui (P2-23); tanpa itu ditolak.
 * - Ledger kanonik (P1-12): pemiliknya Modul Inti; tiap pergerakan dana
 *   tercatat sebagai LedgerEntry dengan company_id + project_id. Entri memo
 *   (`isMemo`) mencatat alokasi amplop — reservasi, bukan pergerakan dana —
 *   dan DIKECUALIKAN dari rekonsiliasi (P1-21: jumlah internal persis $0,00).
 * - Secret tidak pernah masuk log/artefak (P1-24): fungsi-fungsi ini tidak
 *   menulis apa pun selain jumlah, id, dan alasan.
 *
 * Semua mutasi berjalan dalam `withOperationAccountingTransaction`
 * (repeatable-read + retry) dengan urutan kunci yang sama seperti mesin
 * budget (`lockBudgetAdmissionControls`), supaya penulis ledger/budget
 * yang bersamaan memakai satu urutan lock.
 */

export type BinderWarnLevel = 0 | 70 | 90;

function currentPeriodUtc(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Level peringatan dari sisa dana terhadap total pagu. Definisi (P0-4):
 * level 70 saat sisa <= 30% pagu (70% terpakai), level 90 saat sisa <= 10%.
 * Total 0 (pagu nol) berarti tidak ada peringatan — yang berlaku hard stop.
 * Ambang diturunkan dari konstanta BINDER_WARN_PERCENT_* (persen terpakai).
 */
export function warnLevelFor(remainingUnits: bigint, totalUnits: bigint): BinderWarnLevel {
  if (totalUnits <= 0n) return 0;
  if (remainingUnits <= (totalUnits * BigInt(100 - BINDER_WARN_PERCENT_90)) / 100n) return 90;
  if (remainingUnits <= (totalUnits * BigInt(100 - BINDER_WARN_PERCENT_70)) / 100n) return 70;
  return 0;
}

async function requireApprovedOwnerApproval(
  tx: Db,
  companyId: string,
  approvalId: string,
): Promise<void> {
  const [approval] = await tx
    .select({ id: approvals.id, status: approvals.status })
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), eq(approvals.companyId, companyId)));
  if (!approval) throw notFound("Approval not found");
  if (approval.status !== "approved") {
    throw conflict("Top-up / persetujuan amplop membutuhkan approval owner yang sudah disetujui");
  }
}

export async function getBinderPool(tx: Db, companyId: string): Promise<BinderPool | null> {
  const [pool] = await tx.select().from(binderPools).where(eq(binderPools.companyId, companyId));
  return pool ?? null;
}

/** Buat pool bila belum ada (pagu default $20, saldo 0). Bukan top-up. */
export async function ensureBinderPoolInTransaction(tx: Db, companyId: string): Promise<BinderPool> {
  const existing = await getBinderPool(tx, companyId);
  if (existing) return existing;
  const [pool] = await tx
    .insert(binderPools)
    .values({
      companyId,
      monthlyTopUpCents: BINDER_POOL_DEFAULT_MONTHLY_CENTS,
      balanceCents: "0",
      currentPeriod: currentPeriodUtc(new Date()),
      periodStartBalanceCents: "0",
    })
    .returning();
  return pool;
}

async function insertLedgerEntry(
  tx: Db,
  entry: {
    companyId: string;
    projectId: string | null;
    issueId?: string | null;
    poolId?: string | null;
    envelopeId?: string | null;
    kind: string;
    direction: "credit" | "debit";
    isMemo: boolean;
    amountCents: string;
    reason: string;
    idempotencyKey?: string | null;
    relatedCostEventId?: string | null;
    createdByUserId?: string | null;
    createdByAgentId?: string | null;
  },
): Promise<LedgerEntry> {
  const [row] = await tx
    .insert(ledgerEntries)
    .values({
      companyId: entry.companyId,
      // Entri level-company (top-up) tidak punya project; entri kerja wajib
      // punya project (ditegakkan CHECK ledger_entries_project_scope_check).
      projectId: entry.projectId,
      issueId: entry.issueId ?? null,
      poolId: entry.poolId ?? null,
      envelopeId: entry.envelopeId ?? null,
      kind: entry.kind,
      direction: entry.direction,
      isMemo: entry.isMemo,
      amountCents: entry.amountCents,
      reason: entry.reason,
      idempotencyKey: entry.idempotencyKey ?? null,
      relatedCostEventId: entry.relatedCostEventId ?? null,
      createdByUserId: entry.createdByUserId ?? null,
      createdByAgentId: entry.createdByAgentId ?? null,
    })
    .returning();
  return row;
}

async function notePoolWarning(
  tx: Db,
  publications: ActivityPublication[],
  pool: BinderPool,
  level: BinderWarnLevel,
): Promise<void> {
  await logActivity(tx, {
    companyId: pool.companyId,
    actorType: "system",
    actorId: "binder-funding",
    action: `binder.pool.warn_${level}`,
    entityType: "binder_pool",
    entityId: pool.id,
    details: {
      level,
      balanceCents: pool.balanceCents,
      monthlyTopUpCents: pool.monthlyTopUpCents,
    },
  }, publications);
}

async function noteEnvelopeWarning(
  tx: Db,
  publications: ActivityPublication[],
  envelope: BinderBidEnvelope,
  level: BinderWarnLevel,
): Promise<void> {
  await logActivity(tx, {
    companyId: envelope.companyId,
    actorType: "system",
    actorId: "binder-funding",
    action: `binder.envelope.warn_${level}`,
    entityType: "binder_bid_envelope",
    entityId: envelope.id,
    issueId: envelope.issueId,
    details: {
      level,
      amountCents: envelope.amountCents,
      spentCents: envelope.spentCents,
    },
  }, publications);
}

/** Top-up pool. Membuat pool bila belum ada. Wajib approval owner. */
export async function topUpBinderPool(db: Db, input: BinderTopUpPool) {
  const amountUnits = centsToUnits(input.amountCents);
  if (amountUnits <= 0n) throw badRequest("Top-up amount must be greater than zero");
  return withBudgetSpan("binder.funding.top_up", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      await requireApprovedOwnerApproval(tx, input.companyId, input.approvalId);
      if (input.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(binderPoolTopups)
          .where(
            and(
              eq(binderPoolTopups.companyId, input.companyId),
              eq(binderPoolTopups.idempotencyKey, input.idempotencyKey),
            ),
          );
        if (existing) {
          const pool = await getBinderPool(tx, input.companyId);
          // Invarian: top-up yang tercatat menyiratkan baris pool ada.
          if (!pool) throw notFound("Binder pool not found");
          return { pool, topup: existing, ledgerEntry: null, reused: true };
        }
      }
      const pool = await ensureBinderPoolInTransaction(tx, input.companyId);
      const now = new Date();
      const period = currentPeriodUtc(now);
      const newBalance = centsToUnits(pool.balanceCents) + amountUnits;
      const [topup] = await tx
        .insert(binderPoolTopups)
        .values({
          poolId: pool.id,
          companyId: input.companyId,
          amountCents: unitsToCents(amountUnits),
          approvalId: input.approvalId,
          approvedByUserId: input.approvedByUserId ?? null,
          reference: input.reference ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        })
        .returning();
      const ledgerEntry = await insertLedgerEntry(tx, {
        companyId: input.companyId,
        projectId: null,
        poolId: pool.id,
        kind: "top_up",
        direction: "credit",
        isMemo: false,
        amountCents: unitsToCents(amountUnits),
        reason: `Top-up pool ${formatUsdExact(input.amountCents)} atas approval owner`,
        idempotencyKey: input.idempotencyKey ? `topup:${input.idempotencyKey}` : null,
        createdByUserId: input.approvedByUserId ?? null,
      });
      // Top-up bisa menurunkan level peringatan (dana kembali tersedia).
      const level = warnLevelFor(newBalance, BigInt(pool.monthlyTopUpCents) * 10_000_000n);
      const [updated] = await tx
        .update(binderPools)
        .set({
          balanceCents: unitsToCents(newBalance),
          currentPeriod: pool.currentPeriod ?? period,
          warnLevelNotified: level,
          updatedAt: now,
        })
        .where(eq(binderPools.id, pool.id))
        .returning();
      return { pool: updated, topup, ledgerEntry, reused: false };
    }),
  );
}

/** Ubah pagu top-up bulanan pool (owner; nilai default $20). */
export async function updateBinderPoolCap(db: Db, companyId: string, monthlyTopUpCents: number) {
  if (!Number.isInteger(monthlyTopUpCents) || monthlyTopUpCents < 0) {
    throw badRequest("Monthly top-up cap must be a non-negative integer number of cents");
  }
  return withOperationAccountingTransaction(db, companyId, async (tx) => {
    await lockBudgetAdmissionControls(tx, companyId);
    const pool = await ensureBinderPoolInTransaction(tx, companyId);
    const [updated] = await tx
      .update(binderPools)
      .set({ monthlyTopUpCents, updatedAt: new Date() })
      .where(eq(binderPools.id, pool.id))
      .returning();
    return updated;
  });
}

/**
 * Rollover eksplisit ke periode baru: saldo menggulung apa adanya (tidak
 * di-reset); periode + saldo awal periode dicatat di baris pool. Bila periode
 * sudah sama, tidak ada perubahan (idempotent). Rollover yang benar-benar
 * terjadi dicatat sebagai memo ledger (kind 'rollover', BUKAN pergerakan
 * dana — dikecualikan dari rekonsiliasi P1-21); saldo nol tidak dicatat
 * karena CHECK ledger mensyaratkan jumlah > 0.
 */
export async function rolloverBinderPool(db: Db, companyId: string, period?: string) {
  const target = period ?? currentPeriodUtc(new Date());
  return withOperationAccountingTransaction(db, companyId, async (tx) => {
    await lockBudgetAdmissionControls(tx, companyId);
    const pool = await ensureBinderPoolInTransaction(tx, companyId);
    if (pool.currentPeriod === target) return { pool, rolled: false };
    const [updated] = await tx
      .update(binderPools)
      .set({
        currentPeriod: target,
        periodStartBalanceCents: pool.balanceCents,
        updatedAt: new Date(),
      })
      .where(eq(binderPools.id, pool.id))
      .returning();
    // Memo: saldo yang dibawa ke periode baru (bukan pergerakan dana).
    if (centsToUnits(pool.balanceCents) > 0n) {
      await insertLedgerEntry(tx, {
        companyId,
        projectId: null,
        poolId: pool.id,
        kind: "rollover",
        direction: "credit",
        isMemo: true,
        amountCents: pool.balanceCents,
        reason: `Saldo pool ${formatUsdExact(pool.balanceCents)} menggulung ke periode ${target}`,
      });
    }
    return { pool: updated, rolled: true };
  });
}

/** Buat amplop bid untuk satu tugas (status awal: proposed). */
export async function createBidEnvelope(db: Db, input: BinderCreateEnvelope) {
  const amountUnits = centsToUnits(input.amountCents);
  if (amountUnits < BigInt(BINDER_ENVELOPE_MIN_CENTS) * 10_000_000n ||
      amountUnits > BigInt(BINDER_ENVELOPE_MAX_CENTS) * 10_000_000n) {
    throw badRequest("Bid envelope must be between $5 and $30 per task");
  }
  return withBudgetSpan("binder.funding.envelope_create", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx) => {
      await lockBudgetAdmissionControls(tx, input.companyId, input.projectId);
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.companyId, input.companyId)));
      if (!project) throw notFound("Project not found");
      const [issue] = await tx
        .select({ id: issues.id, projectId: issues.projectId })
        .from(issues)
        .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));
      if (!issue) throw notFound("Task not found");
      if (issue.projectId !== input.projectId) {
        throw badRequest("Task does not belong to the given project");
      }
      const [existing] = await tx
        .select({ id: binderBidEnvelopes.id, status: binderBidEnvelopes.status })
        .from(binderBidEnvelopes)
        .where(
          and(
            eq(binderBidEnvelopes.companyId, input.companyId),
            eq(binderBidEnvelopes.issueId, input.issueId),
            sql`${binderBidEnvelopes.status} in ('proposed', 'approved', 'active', 'exhausted', 'escalated')`,
          ),
        );
      if (existing) throw conflict("Task already has a live bid envelope");
      const [envelope] = await tx
        .insert(binderBidEnvelopes)
        .values({
          companyId: input.companyId,
          projectId: input.projectId,
          issueId: input.issueId,
          amountCents: unitsToCents(amountUnits),
          proposedByUserId: input.proposedByUserId ?? null,
        })
        .returning();
      return envelope;
    }),
  );
}

/** Setujui amplop atas approval owner; alokasi dicatat sebagai memo ledger. */
export async function approveBidEnvelope(db: Db, input: BinderApproveEnvelope) {
  return withBudgetSpan("binder.funding.envelope_approve", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      await requireApprovedOwnerApproval(tx, input.companyId, input.approvalId);
      const [envelope] = await tx
        .select()
        .from(binderBidEnvelopes)
        .where(
          and(
            eq(binderBidEnvelopes.id, input.envelopeId),
            eq(binderBidEnvelopes.companyId, input.companyId),
          ),
        )
        .for("update");
      if (!envelope) throw notFound("Bid envelope not found");
      if (envelope.status !== "proposed") {
        throw conflict(`Bid envelope cannot be approved from status ${envelope.status}`);
      }
      const [updated] = await tx
        .update(binderBidEnvelopes)
        .set({
          status: "approved",
          approvedByUserId: input.approvedByUserId ?? null,
          approvalId: input.approvalId,
          updatedAt: new Date(),
        })
        .where(eq(binderBidEnvelopes.id, envelope.id))
        .returning();
      // Alokasi adalah reservasi, bukan pergerakan dana (memo).
      await insertLedgerEntry(tx, {
        companyId: input.companyId,
        projectId: updated.projectId,
        issueId: updated.issueId,
        poolId: null,
        envelopeId: updated.id,
        kind: "envelope_allocate",
        direction: "debit",
        isMemo: true,
        amountCents: updated.amountCents,
        reason: "Amplop bid disetujui owner (alokasi; dana tetap di pool sampai terpakai)",
        createdByUserId: input.approvedByUserId ?? null,
      });
      return updated;
    }),
  );
}

export async function getLiveBidEnvelope(
  tx: Db,
  companyId: string,
  issueId: string,
): Promise<BinderBidEnvelope | null> {
  const [envelope] = await tx
    .select()
    .from(binderBidEnvelopes)
    .where(
      and(
        eq(binderBidEnvelopes.companyId, companyId),
        eq(binderBidEnvelopes.issueId, issueId),
        sql`${binderBidEnvelopes.status} in ('proposed', 'approved', 'active', 'exhausted', 'escalated')`,
      ),
    );
  return envelope ?? null;
}

/**
 * Inti `chargeBinderUsage` — dipakai di dalam transaksi pemanggil supaya
 * pemakaian dana dan pencatatan yang menyertainya (mis. skor QC di
 * `submitQcScore`) atomik: satu transaksi, satu urutan lock, satu
 * publikasi activity. Jangan panggil langsung dari luar service BINDER
 * tanpa transaksi `withOperationAccountingTransaction` di sekelilingnya.
 *
 * Hard stop: pool habis atau amplop habis → conflict, TIDAK ada
 * pembebanan sebagian dan TIDAK ada penurunan kualitas diam-diam.
 * kind=qc_cost SELALU ke pool saja (P1-10), amplop tidak tersentuh.
 */
export async function chargeBinderUsageInTransaction(
  tx: Db,
  publications: ActivityPublication[],
  input: BinderChargeUsage,
) {
  const amountUnits = centsToUnits(input.amountCents);
  if (amountUnits <= 0n) throw badRequest("Charge amount must be greater than zero");
  await lockBudgetAdmissionControls(tx, input.companyId, input.projectId);
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.companyId, input.companyId)));
  if (!project) throw notFound("Project not found");
  if (input.idempotencyKey) {
    const [existing] = await tx
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.companyId, input.companyId),
          eq(ledgerEntries.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) {
      const pool = await getBinderPool(tx, input.companyId);
      // Invarian: entri ledger yang tercatat menyiratkan baris pool ada.
      if (!pool) throw notFound("Binder pool not found");
      return { pool, ledgerEntry: existing, envelope: null, charged: false };
    }
  }
  const pool = await getBinderPool(tx, input.companyId);
  if (!pool) {
    throw conflict("Pool company belum dibuat — top-up pertama (atas approval owner) diperlukan sebelum pemakaian");
  }
  const balanceUnits = centsToUnits(pool.balanceCents);
  if (balanceUnits < amountUnits) {
    throw conflict("Pool company habis — hard stop di nol; top-up diperlukan sebelum pemakaian lanjut");
  }
  let envelope: BinderBidEnvelope | null = null;
  if (input.kind === "usage" && input.issueId) {
    envelope = await getLiveBidEnvelope(tx, input.companyId, input.issueId);
    if (envelope) {
      if (envelope.status === "proposed") {
        throw conflict("Amplop tugas belum disetujui owner — pemakaian ditolak");
      }
      if (envelope.status !== "approved" && envelope.status !== "active") {
        throw conflict(`Amplop tugas berstatus ${envelope.status} — pemakaian ditolak, eskalasi diperlukan`);
      }
      const spentUnits = centsToUnits(envelope.spentCents);
      const amountCentsUnits = centsToUnits(envelope.amountCents);
      if (spentUnits + amountUnits > amountCentsUnits) {
        throw conflict(
          "Amplop tugas tidak muat — eskalasi diperlukan (pecah tugas / naikkan amplop / kurangi scope)",
        );
      }
    }
  }
  const newBalance = balanceUnits - amountUnits;
  const [updatedPool] = await tx
    .update(binderPools)
    .set({ balanceCents: unitsToCents(newBalance), updatedAt: new Date() })
    .where(eq(binderPools.id, pool.id))
    .returning();
  let updatedEnvelope: BinderBidEnvelope | null = null;
  if (envelope) {
    const spentUnits = centsToUnits(envelope.spentCents) + amountUnits;
    const amountCentsUnits = centsToUnits(envelope.amountCents);
    const status = spentUnits >= amountCentsUnits ? "exhausted" : "active";
    const [row] = await tx
      .update(binderBidEnvelopes)
      .set({ spentCents: unitsToCents(spentUnits), status, updatedAt: new Date() })
      .where(eq(binderBidEnvelopes.id, envelope.id))
      .returning();
    updatedEnvelope = row;
    const remainingUnits = amountCentsUnits - spentUnits;
    const level = warnLevelFor(remainingUnits, amountCentsUnits);
    if (level > envelope.warnLevelNotified) {
      await tx
        .update(binderBidEnvelopes)
        .set({ warnLevelNotified: level })
        .where(eq(binderBidEnvelopes.id, envelope.id));
      await noteEnvelopeWarning(tx, publications, { ...row, warnLevelNotified: level }, level);
    }
  }
  const ledgerEntry = await insertLedgerEntry(tx, {
    companyId: input.companyId,
    projectId: input.projectId,
    issueId: input.issueId ?? null,
    poolId: pool.id,
    envelopeId: updatedEnvelope?.id ?? envelope?.id ?? null,
    kind: input.kind,
    direction: "debit",
    isMemo: false,
    amountCents: unitsToCents(amountUnits),
    reason: input.reason,
    idempotencyKey: input.idempotencyKey ?? null,
    relatedCostEventId: input.costEventId ?? null,
    createdByUserId: input.createdByUserId ?? null,
    createdByAgentId: input.createdByAgentId ?? null,
  });
  const poolLevel = warnLevelFor(newBalance, BigInt(pool.monthlyTopUpCents) * 10_000_000n);
  if (poolLevel > pool.warnLevelNotified) {
    const [warnedPool] = await tx
      .update(binderPools)
      .set({ warnLevelNotified: poolLevel })
      .where(eq(binderPools.id, pool.id))
      .returning();
    await notePoolWarning(tx, publications, warnedPool, poolLevel);
    return { pool: warnedPool, ledgerEntry, envelope: updatedEnvelope, charged: true };
  }
  return { pool: updatedPool, ledgerEntry, envelope: updatedEnvelope, charged: true };
}

/**
 * Bebankan pemakaian ke pool (dan ke amplop bila kind=usage dan tugas punya
 * amplop hidup). Hard stop: pool habis atau amplop habis → conflict, TIDAK
 * ada pembebanan sebagian dan TIDAK ada penurunan kualitas diam-diam.
 * kind=qc_cost SELALU ke pool saja (P1-10), amplop tidak tersentuh.
 */
export async function chargeBinderUsage(db: Db, input: BinderChargeUsage) {
  return withBudgetSpan("binder.funding.charge", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) =>
      chargeBinderUsageInTransaction(tx, publications, input),
    ),
  );
}

/**
 * Pemeriksaan admission pendanaan BINDER untuk gerbang dispatch mesin
 * budget. Mengembalikan alasan blokir, atau null bila lolos.
 * - Tanpa baris pool (pendanaan belum dikonfigurasi untuk company ini) →
 *   TIDAK memblokir: alur Paperclip yang sudah ada tetap jalan.
 * - Pool ada dan saldo <= 0 → blokir (hard stop di nol).
 * - Amplop hidup untuk tugas dan sisa <= 0 → blokir (eskalasi diperlukan).
 */
export async function checkBinderFundingAdmission(
  tx: Db,
  companyId: string,
  issueId?: string | null,
): Promise<string | null> {
  const pool = await getBinderPool(tx, companyId);
  if (pool && centsToUnits(pool.balanceCents) <= 0n) {
    return "Pool company habis — top-up diperlukan sebelum pekerjaan baru";
  }
  if (issueId) {
    const envelope = await getLiveBidEnvelope(tx, companyId, issueId);
    if (envelope && (envelope.status === "exhausted" || envelope.status === "escalated")) {
      return "Amplop tugas habis — eskalasi diperlukan (pecah tugas / naikkan amplop / kurangi scope)";
    }
    if (envelope && envelope.status === "proposed") {
      return "Amplop tugas belum disetujui owner — pekerjaan ditolak";
    }
  }
  return null;
}

/** Tampilan peringatan pool + amplop (untuk hero/dashboard + worker). */
export async function getBinderFundingWarnings(tx: Db, companyId: string) {
  const pool = await getBinderPool(tx, companyId);
  const envelopes = await tx
    .select()
    .from(binderBidEnvelopes)
    .where(
      and(
        eq(binderBidEnvelopes.companyId, companyId),
        sql`${binderBidEnvelopes.status} in ('proposed', 'approved', 'active', 'exhausted', 'escalated')`,
      ),
    );
  return {
    pool: pool
      ? {
          balanceCents: pool.balanceCents,
          monthlyTopUpCents: pool.monthlyTopUpCents,
          level: warnLevelFor(
            centsToUnits(pool.balanceCents),
            BigInt(pool.monthlyTopUpCents) * 10_000_000n,
          ),
          exhausted: centsToUnits(pool.balanceCents) <= 0n,
        }
      : null,
    envelopes: envelopes.map((envelope) => ({
      id: envelope.id,
      issueId: envelope.issueId,
      status: envelope.status,
      amountCents: envelope.amountCents,
      spentCents: envelope.spentCents,
      remainingCents: unitsToCents(centsToUnits(envelope.amountCents) - centsToUnits(envelope.spentCents)),
      level: warnLevelFor(
        centsToUnits(envelope.amountCents) - centsToUnits(envelope.spentCents),
        centsToUnits(envelope.amountCents),
      ),
    })),
  };
}

/**
 * Rekonsiliasi ledger per company (P1-21): jumlah internal harus persis
 * $0,00 — saldo pool == total kredit non-memo − total debit non-memo.
 * Entri memo (alokasi amplop, rollover) dikecualikan karena bukan pergerakan
 * dana. `differenceCents` "0.0000000" berarti seimbang.
 */
export async function reconcileBinderLedger(tx: Db, companyId: string) {
  const pool = await getBinderPool(tx, companyId);
  // Satu agregasi: jumlah pergerakan (non-memo) + hitung memo terpisah.
  // Memo (alokasi amplop) punya direction 'debit' tetapi bukan pergerakan
  // dana — harus dikecualikan dari penjumlahan, bukan dari hasil query.
  // count(*) lewat node-postgres datang sebagai string — koersi ke Number.
  const [sums] = await tx
    .select({
      credits: sql<string>`coalesce(sum(case when ${ledgerEntries.direction} = 'credit' and not ${ledgerEntries.isMemo} then ${ledgerEntries.amountCents} else 0 end), 0)`,
      debits: sql<string>`coalesce(sum(case when ${ledgerEntries.direction} = 'debit' and not ${ledgerEntries.isMemo} then ${ledgerEntries.amountCents} else 0 end), 0)`,
      entries: sql<string>`count(*) filter (where not ${ledgerEntries.isMemo})`,
      memos: sql<string>`count(*) filter (where ${ledgerEntries.isMemo})`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.companyId, companyId));
  const credits = centsToUnits(sums?.credits ?? "0");
  const debits = centsToUnits(sums?.debits ?? "0");
  const ledgerNet = credits - debits;
  const balance = pool ? centsToUnits(pool.balanceCents) : 0n;
  const difference = balance - ledgerNet;
  return {
    balanced: difference === 0n,
    balanceCents: unitsToCents(balance),
    ledgerNetCents: unitsToCents(ledgerNet),
    differenceCents: unitsToCents(difference),
    entryCount: Number(sums?.entries ?? 0),
    memoEntryCount: Number(sums?.memos ?? 0),
  };
}

/** Rekonsiliasi per tugas: pemakaian + biaya QC vs amplop tugas itu. */
export async function reconcileTaskLedger(tx: Db, companyId: string, issueId: string) {
  const [sums] = await tx
    .select({
      usage: sql<string>`coalesce(sum(case when ${ledgerEntries.kind} = 'usage' then ${ledgerEntries.amountCents} else 0 end), 0)`,
      qc: sql<string>`coalesce(sum(case when ${ledgerEntries.kind} = 'qc_cost' then ${ledgerEntries.amountCents} else 0 end), 0)`,
      entries: sql<string>`count(*)`,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.companyId, companyId),
        eq(ledgerEntries.issueId, issueId),
        eq(ledgerEntries.isMemo, false),
      ),
    );
  const envelope = await getLiveBidEnvelope(tx, companyId, issueId);
  const usage = centsToUnits(sums?.usage ?? "0");
  const qc = centsToUnits(sums?.qc ?? "0");
  return {
    issueId,
    usageCents: unitsToCents(usage),
    qcCostCents: unitsToCents(qc),
    totalCents: unitsToCents(usage + qc),
    envelopeAmountCents: envelope?.amountCents ?? null,
    envelopeSpentCents: envelope?.spentCents ?? null,
    envelopeStatus: envelope?.status ?? null,
    entryCount: Number(sums?.entries ?? 0),
  };
}

/** Pastikan company + project ada (untuk pemakaian di luar transaksi). */
export async function assertBinderFundingScope(tx: Db, companyId: string, projectId?: string | null) {
  const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw notFound("Company not found");
  if (projectId) {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)));
    if (!project) throw notFound("Budget project not found");
  }
}
