// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  approvals,
  companies,
  createDb,
  issues,
  projects,
  type Db,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { registerCeo } from "./binder-ceo.js";
import {
  approveBidEnvelope,
  chargeBinderUsage,
  createBidEnvelope,
  topUpBinderPool,
} from "./binder-funding.js";
import { getBinderCeoModelSummary, getBinderFundingSummary } from "./binder-hero.js";

/**
 * Test Fase 3.5 — data hero per company BINDER (PRD Bab 6/7; rencana
 * Tahap 3 Fase 3.5). Semua data berlabel TEST (company/project/issue
 * dibuat per test dan hanya hidup di database test ini); tidak ada
 * data dummy aplikasi; tidak ada pemanggilan model live.
 */

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("data hero per company BINDER", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let companyId: string;
  let projectId: string;
  let issueId: string;
  let approvedApprovalId: string;

  function randomName(prefix: string) {
    return `${prefix} TEST ${Math.random().toString(36).slice(2, 8)}`;
  }

  async function createCompany(prefix: string) {
    const [company] = await db
      .insert(companies)
      .values({
        name: randomName(prefix),
        issuePrefix: `HR${Math.floor(Math.random() * 1_000_000)}`,
      })
      .returning();
    return company.id;
  }

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("binder-hero-");
    db = createDb(database.connectionString);
  }, 180_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  }, 60_000);

  beforeEach(async () => {
    companyId = await createCompany("Binder Hero");
    const [project] = await db
      .insert(projects)
      .values({ companyId, name: "Project TEST" })
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
  });

  afterEach(async () => {
    await db.delete(agents).where(eq(agents.role, "ceo"));
  });

  it("ringkasan dana tanpa pool: pool null, amplop kosong, ledger seimbang", async () => {
    const summary = await getBinderFundingSummary(db, companyId);
    expect(summary.companyId).toBe(companyId);
    expect(summary.pool).toBeNull();
    expect(summary.envelopes).toEqual([]);
    expect(summary.ledgerBalanced).toBe(true);
    expect(summary.ledgerDifferenceCents).toBe("0.0000000");
  });

  it("ringkasan dana setelah top-up $20 + amplop $10 + pemakaian $2: saldo $18, amplop sisa $8, ledger seimbang", async () => {
    await topUpBinderPool(db, {
      companyId,
      amountCents: "2000",
      approvalId: approvedApprovalId,
      idempotencyKey: "hero-topup-2000",
    });
    const envelope = await createBidEnvelope(db, {
      companyId,
      projectId,
      issueId,
      amountCents: "1000",
    });
    await approveBidEnvelope(db, {
      companyId,
      envelopeId: envelope.id,
      approvalId: approvedApprovalId,
      approvedByUserId: "owner-test",
    });
    await chargeBinderUsage(db, {
      companyId,
      projectId,
      issueId,
      amountCents: "200",
      kind: "usage",
      reason: "Pemakaian uji TEST",
    });

    const summary = await getBinderFundingSummary(db, companyId);
    expect(summary.pool).toEqual({
      balanceCents: 1800,
      monthlyTopUpCents: 2000,
      level: 0,
      exhausted: false,
    });
    expect(summary.envelopes).toHaveLength(1);
    expect(summary.envelopes[0]).toMatchObject({
      issueId,
      status: "active",
      amountCents: 1000,
      spentCents: 200,
      remainingCents: 800,
    });
    expect(summary.ledgerBalanced).toBe(true);
    expect(summary.ledgerDifferenceCents).toBe("0.0000000");
  });

  it("ringkasan model CEO sebelum terdaftar: registered false, tanpa data", async () => {
    const summary = await getBinderCeoModelSummary(db, companyId);
    expect(summary).toEqual({
      registered: false,
      companyId: null,
      primary: null,
      fallback: null,
      runtimeDefault: null,
      budgetMonthlyCents: null,
    });
  });

  it("ringkasan model CEO setelah terdaftar: Meta utama + Claude fallback + referensi kunci saja", async () => {
    await registerCeo(db, { companyId });
    const summary = await getBinderCeoModelSummary(db, companyId);
    expect(summary.registered).toBe(true);
    expect(summary.companyId).toBe(companyId);
    expect(summary.primary).toEqual({
      modelFamily: "meta",
      modelId: "muse-spark-1.3",
      provider: "opencode_local",
      apiKeyRef: "{env:META_API_KEY}",
    });
    expect(summary.fallback).toEqual({
      modelFamily: "anthropic",
      modelId: "claude-sonnet-5-5",
      provider: "claude_local",
      apiKeyRef: "{env:ANTHROPIC_API_KEY}",
    });
    expect(summary.runtimeDefault).toBe("sandbox");
    expect(summary.budgetMonthlyCents).toBe(2000);
  });

  it("ringkasan model CEO tidak membocorkan company lain: CEO di company A, hero company B → registered false", async () => {
    await registerCeo(db, { companyId });
    const otherCompanyId = await createCompany("Binder Hero Lain");
    const summary = await getBinderCeoModelSummary(db, otherCompanyId);
    expect(summary.registered).toBe(false);
    expect(summary.companyId).toBeNull();
    expect(summary.primary).toBeNull();
    expect(summary.fallback).toBeNull();
  });
});
