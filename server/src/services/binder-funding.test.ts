import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  approvals,
  binderBidEnvelopes,
  binderPools,
  companies,
  createDb,
  issues,
  ledgerEntries,
  projects,
  type Db,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import {
  approveBidEnvelope,
  chargeBinderUsage,
  checkBinderFundingAdmission,
  createBidEnvelope,
  getBinderFundingWarnings,
  getBinderPool,
  reconcileBinderLedger,
  reconcileTaskLedger,
  rolloverBinderPool,
  topUpBinderPool,
  updateBinderPoolCap,
} from "./binder-funding.js";

/**
 * Test Fase 3.2 — pool top-up + amplop bid + ledger kanonik.
 * Semua data berlabel TEST (company/project/issue dibuat per test dan hanya
 * hidup di database embedded test ini); tidak ada data dummy aplikasi.
 * Migrasi 0442 + 0443 teraplikasi oleh helper embedded Postgres — bila
 * migrasi gagal, seluruh file ini gagal (bukti migrasi teraplikasi).
 */

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("binder funding: pool, envelope, ledger", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let companyId: string;
  let projectId: string;
  let issueId: string;
  let approvedApprovalId: string;
  let pendingApprovalId: string;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("binder-funding-");
    db = createDb(database.connectionString);
  }, 180_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  }, 60_000);

  beforeEach(async () => {
    const [company] = await db
      .insert(companies)
      .values({ name: "Binder funding TEST", issuePrefix: `BFT${Math.floor(Math.random() * 1_000_000)}` })
      .returning();
    companyId = company.id;
    const [project] = await db
      .insert(projects)
      .values({ companyId, name: "Proyek uji TEST" })
      .returning();
    projectId = project.id;
    const [issue] = await db
      .insert(issues)
      .values({ companyId, projectId, title: "Tugas uji TEST" })
      .returning();
    issueId = issue.id;
    const [approved] = await db
      .insert(approvals)
      .values({ companyId, type: "binder_pool_topup", status: "approved", payload: {} })
      .returning();
    approvedApprovalId = approved.id;
    const [pending] = await db
      .insert(approvals)
      .values({ companyId, type: "binder_pool_topup", status: "pending", payload: {} })
      .returning();
    pendingApprovalId = pending.id;
  });

  it("menolak top-up tanpa approval owner yang disetujui", async () => {
    await expect(
      topUpBinderPool(db, {
        companyId,
        amountCents: "2000",
        approvalId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/Approval not found/);
    await expect(
      topUpBinderPool(db, {
        companyId,
        amountCents: "2000",
        approvalId: pendingApprovalId,
      }),
    ).rejects.toThrow(/approval owner yang sudah disetujui/);
    expect(await getBinderPool(db, companyId)).toBeNull();
  });

  it("top-up $20 atas approval owner: saldo + entri ledger kredit + rekonsiliasi seimbang", async () => {
    const result = await topUpBinderPool(db, {
      companyId,
      amountCents: "2000",
      approvalId: approvedApprovalId,
      approvedByUserId: "owner-test",
      idempotencyKey: "topup-2000",
    });
    expect(result.reused).toBe(false);
    expect(result.pool.balanceCents).toBe("2000.0000000");
    expect(result.pool.monthlyTopUpCents).toBe(2000);
    expect(result.ledgerEntry?.kind).toBe("top_up");
    expect(result.ledgerEntry?.direction).toBe("credit");
    const recon = await reconcileBinderLedger(db, companyId);
    expect(recon.balanced).toBe(true);
    expect(recon.differenceCents).toBe("0.0000000");
    expect(recon.balanceCents).toBe("2000.0000000");
    expect(recon.entryCount).toBe(1);
  });

  it("top-up idempotent: kunci yang sama tidak menggandakan saldo", async () => {
    const input = {
      companyId,
      amountCents: "2000",
      approvalId: approvedApprovalId,
      idempotencyKey: "topup-dup",
    } as const;
    const first = await topUpBinderPool(db, input);
    const second = await topUpBinderPool(db, input);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.pool.balanceCents).toBe("2000.0000000");
    const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.companyId, companyId));
    expect(rows).toHaveLength(1);
  });

  it("rollover: sisa saldo menggulung ke periode berikut tanpa di-reset", async () => {
    await topUpBinderPool(db, { companyId, amountCents: "2000", approvalId: approvedApprovalId });
    await chargeBinderUsage(db, {
      companyId,
      projectId,
      amountCents: "500",
      kind: "usage",
      reason: "Pemakaian uji TEST",
    });
    const rolled = await rolloverBinderPool(db, companyId, "2026-12");
    expect(rolled.rolled).toBe(true);
    expect(rolled.pool.balanceCents).toBe("1500.0000000");
    expect(rolled.pool.currentPeriod).toBe("2026-12");
    expect(rolled.pool.periodStartBalanceCents).toBe("1500.0000000");
    // Rollover dicatat sebagai memo (bukan pergerakan dana): rekonsiliasi
    // tetap seimbang, memo tidak mengubah jumlah non-memo.
    const rolloverMemos = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.companyId, companyId));
    expect(rolloverMemos.filter((row) => row.kind === "rollover")).toHaveLength(1);
    expect(rolloverMemos.find((row) => row.kind === "rollover")?.isMemo).toBe(true);
    expect(rolloverMemos.find((row) => row.kind === "rollover")?.amountCents).toBe("1500.0000000");
    const reconAfterRollover = await reconcileBinderLedger(db, companyId);
    expect(reconAfterRollover.balanced).toBe(true);
    expect(reconAfterRollover.entryCount).toBe(2);
    expect(reconAfterRollover.memoEntryCount).toBe(1);
    const again = await rolloverBinderPool(db, companyId, "2026-12");
    expect(again.rolled).toBe(false);
    expect(again.pool.balanceCents).toBe("1500.0000000");
    const memosAfterAgain = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.companyId, companyId));
    expect(memosAfterAgain.filter((row) => row.kind === "rollover")).toHaveLength(1);
  });

  it("amplop: di bawah $5 dan di atas $30 ditolak; satu amplop hidup per tugas", async () => {
    await expect(
      createBidEnvelope(db, { companyId, projectId, issueId, amountCents: "400" }),
    ).rejects.toThrow(/between \$5 and \$30/);
    await expect(
      createBidEnvelope(db, { companyId, projectId, issueId, amountCents: "3100" }),
    ).rejects.toThrow(/between \$5 and \$30/);
    const envelope = await createBidEnvelope(db, { companyId, projectId, issueId, amountCents: "1000" });
    expect(envelope.status).toBe("proposed");
    await expect(
      createBidEnvelope(db, { companyId, projectId, issueId, amountCents: "1500" }),
    ).rejects.toThrow(/already has a live bid envelope/);
  });

  it("amplop: persetujuan butuh approval owner; alokasi tercatat sebagai memo (rekonsiliasi tetap seimbang)", async () => {
    const envelope = await createBidEnvelope(db, { companyId, projectId, issueId, amountCents: "1000" });
    await expect(
      approveBidEnvelope(db, { companyId, envelopeId: envelope.id, approvalId: pendingApprovalId }),
    ).rejects.toThrow(/approval owner yang sudah disetujui/);
    const approved = await approveBidEnvelope(db, {
      companyId,
      envelopeId: envelope.id,
      approvalId: approvedApprovalId,
      approvedByUserId: "owner-test",
    });
    expect(approved.status).toBe("approved");
    const memos = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.companyId, companyId));
    expect(memos).toHaveLength(1);
    expect(memos[0]?.kind).toBe("envelope_allocate");
    expect(memos[0]?.isMemo).toBe(true);
    const recon = await reconcileBinderLedger(db, companyId);
    expect(recon.balanced).toBe(true);
    expect(recon.memoEntryCount).toBe(1);
  });

  it("pemakaian dalam amplop: saldo pool + spent amplop berkurang; melewati amplop ditolak tanpa perubahan", async () => {
    await topUpBinderPool(db, { companyId, amountCents: "2000", approvalId: approvedApprovalId });
    const envelope = await createBidEnvelope(db, { companyId, projectId, issueId, amountCents: "1000" });
    await approveBidEnvelope(db, { companyId, envelopeId: envelope.id, approvalId: approvedApprovalId });
    const charged = await chargeBinderUsage(db, {
      companyId,
      projectId,
      issueId,
      amountCents: "600",
      kind: "usage",
      reason: "Pemakaian tugas uji TEST",
    });
    expect(charged.charged).toBe(true);
    expect(charged.pool.balanceCents).toBe("1400.0000000");
    expect(charged.envelope?.spentCents).toBe("600.0000000");
    expect(charged.envelope?.status).toBe("active");
    await expect(
      chargeBinderUsage(db, {
        companyId,
        projectId,
        issueId,
        amountCents: "500",
        kind: "usage",
        reason: "Melewati amplop TEST",
      }),
    ).rejects.toThrow(/tidak muat — eskalasi diperlukan/);
    const pool = await getBinderPool(db, companyId);
    expect(pool?.balanceCents).toBe("1400.0000000");
    const [kept] = await db.select().from(binderBidEnvelopes).where(eq(binderBidEnvelopes.id, envelope.id));
    expect(kept?.spentCents).toBe("600.0000000");
    expect(kept?.status).toBe("active");
  });

  it("biaya QC dibebankan ke pool saja — amplop tidak tersentuh", async () => {
    await topUpBinderPool(db, { companyId, amountCents: "2000", approvalId: approvedApprovalId });
    const envelope = await createBidEnvelope(db, { companyId, projectId, issueId, amountCents: "1000" });
    await approveBidEnvelope(db, { companyId, envelopeId: envelope.id, approvalId: approvedApprovalId });
    await chargeBinderUsage(db, {
      companyId,
      projectId,
      issueId,
      amountCents: "600",
      kind: "usage",
      reason: "Pemakaian tugas uji TEST",
    });
    const qc = await chargeBinderUsage(db, {
      companyId,
      projectId,
      issueId,
      amountCents: "200",
      kind: "qc_cost",
      reason: "Biaya QC tugas uji TEST",
    });
    expect(qc.pool.balanceCents).toBe("1200.0000000");
    expect(qc.envelope).toBeNull();
    const [kept] = await db.select().from(binderBidEnvelopes).where(eq(binderBidEnvelopes.id, envelope.id));
    expect(kept?.spentCents).toBe("600.0000000");
    const task = await reconcileTaskLedger(db, companyId, issueId);
    expect(task.usageCents).toBe("600.0000000");
    expect(task.qcCostCents).toBe("200.0000000");
    expect(task.totalCents).toBe("800.0000000");
    expect(task.envelopeSpentCents).toBe("600.0000000");
  });

  it("hard stop pool di nol: pemakaian lanjut ditolak; admission memblokir", async () => {
    await topUpBinderPool(db, { companyId, amountCents: "2000", approvalId: approvedApprovalId });
    await chargeBinderUsage(db, {
      companyId,
      projectId,
      amountCents: "2000",
      kind: "usage",
      reason: "Kuras pool TEST",
    });
    expect((await getBinderPool(db, companyId))?.balanceCents).toBe("0.0000000");
    await expect(
      chargeBinderUsage(db, {
        companyId,
        projectId,
        amountCents: "100",
        kind: "usage",
        reason: "Melewati nol TEST",
      }),
    ).rejects.toThrow(/hard stop di nol/);
    expect(await checkBinderFundingAdmission(db, companyId)).toBe(
      "Pool company habis — top-up diperlukan sebelum pekerjaan baru",
    );
    const recon = await reconcileBinderLedger(db, companyId);
    expect(recon.balanced).toBe(true);
    expect(recon.differenceCents).toBe("0.0000000");
  });

  it("admission: tanpa pool tidak memblokir; pool berisi tidak memblokir", async () => {
    expect(await checkBinderFundingAdmission(db, companyId)).toBeNull();
    await topUpBinderPool(db, { companyId, amountCents: "2000", approvalId: approvedApprovalId });
    expect(await checkBinderFundingAdmission(db, companyId)).toBeNull();
    expect(await checkBinderFundingAdmission(db, companyId, issueId)).toBeNull();
  });

  it("admission: amplop proposed memblokir; amplop exhausted memblokir", async () => {
    await topUpBinderPool(db, { companyId, amountCents: "2000", approvalId: approvedApprovalId });
    const envelope = await createBidEnvelope(db, { companyId, projectId, issueId, amountCents: "500" });
    expect(await checkBinderFundingAdmission(db, companyId, issueId)).toMatch(/belum disetujui owner/);
    await approveBidEnvelope(db, { companyId, envelopeId: envelope.id, approvalId: approvedApprovalId });
    expect(await checkBinderFundingAdmission(db, companyId, issueId)).toBeNull();
    await chargeBinderUsage(db, {
      companyId,
      projectId,
      issueId,
      amountCents: "500",
      kind: "usage",
      reason: "Kuras amplop TEST",
    });
    expect(await checkBinderFundingAdmission(db, companyId, issueId)).toMatch(/Amplop tugas habis/);
  });

  it("peringatan 70%/90% pool dicatat sekali per level di activity log", async () => {
    await topUpBinderPool(db, { companyId, amountCents: "2000", approvalId: approvedApprovalId });
    await chargeBinderUsage(db, {
      companyId,
      projectId,
      amountCents: "1500",
      kind: "usage",
      reason: "Pakai 75% TEST",
    });
    const pool = await getBinderPool(db, companyId);
    expect(pool?.warnLevelNotified).toBe(70);
    const warnings = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId));
    expect(warnings.map((row) => row.action)).toContain("binder.pool.warn_70");
    await chargeBinderUsage(db, {
      companyId,
      projectId,
      amountCents: "300",
      kind: "usage",
      reason: "Pakai sampai 90% TEST",
    });
    const pool2 = await getBinderPool(db, companyId);
    expect(pool2?.warnLevelNotified).toBe(90);
    const warnings2 = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId));
    expect(warnings2.map((row) => row.action)).toContain("binder.pool.warn_90");
    const view = await getBinderFundingWarnings(db, companyId);
    expect(view.pool?.level).toBe(90);
  });

  it("pagu bulanan pool bisa diubah owner", async () => {
    const pool = await updateBinderPoolCap(db, companyId, 5000);
    expect(pool.monthlyTopUpCents).toBe(5000);
    expect(pool.balanceCents).toBe("0.0000000");
  });
});
