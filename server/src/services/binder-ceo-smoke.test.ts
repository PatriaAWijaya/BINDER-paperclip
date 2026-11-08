// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  approvals,
  binderTasks,
  companies,
  createDb,
  issueWorkProducts,
  issues,
  projects,
  type Db,
} from "@paperclipai/db";
import type { BinderHardViolationCode } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { assertCeoExcludedFromQcPool, registerCeo } from "./binder-ceo.js";
import {
  approveBinderTaskByOwner,
  createBinderTask,
  issueApprovedAction,
  registerAgentModel,
  registerQcReviewer,
  requestApprovedAction,
  submitQcScore,
  submitWorkForReview,
  transitionBinderTask,
  validateApprovedAction,
} from "./binder-task-flow.js";
import {
  approveBidEnvelope,
  createBidEnvelope,
  reconcileBinderLedger,
  reconcileTaskLedger,
  topUpBinderPool,
} from "./binder-funding.js";

/**
 * Smoke test Fase 3.4 — CEO Edison memakai fungsi Fase 3.2/3.3 end-to-end
 * pada DATA TEST berlabel (bukan data nyata, bukan task pilot — definisi
 * task pilot menunggu Patria di Tahap 6; Rencana Tahap 3 poin 6 DITUNDA).
 *
 * Alur: CEO terdaftar → pool $20 di-top-up → task TEST dibuat (maker =
 * agen TEST family anthropic) → admission memeriksa pool + amplop
 * (amplop proposed memblokir, sesudah disetujui lolos) → transisi status
 * → QC oleh agen TEST family meta (BUKAN CEO) → skor lolos ≥ 75 →
 * vonis owner → CEO menyiapkan pengajuan aksi → approved_action_id
 * diterbitkan (test) → ledger terekonsiliasi $0,00.
 * Tidak ada pemanggilan model live; tidak ada aksi eksternal yang
 * dijalankan (approved_action_id hanya diterbitkan + divalidasi).
 */

const TEST_NOTE = "TEST — hanya untuk pengujian otomatis";
const OWNER_USER_ID = "owner-test";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("smoke test CEO Edison BINDER", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;

  function randomName(prefix: string) {
    return `${prefix} TEST ${Math.random().toString(36).slice(2, 8)}`;
  }

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("binder-ceo-smoke-");
    db = createDb(database.connectionString);
  }, 180_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  }, 60_000);

  it("CEO memakai pool + amplop + alur task + QC + approved_action_id end-to-end (data TEST)", async () => {
    // --- Setup: company + proyek TEST; CEO Edison terdaftar. ---
    const [company] = await db
      .insert(companies)
      .values({
        name: randomName("Binder CEO Smoke"),
        issuePrefix: `BCS${Math.floor(Math.random() * 1_000_000)}`,
      })
      .returning();
    const companyId = company.id;
    const [project] = await db
      .insert(projects)
      .values({ companyId, name: `Proyek TEST ${TEST_NOTE}` })
      .returning();
    const projectId = project.id;

    const ceo = await registerCeo(db, { companyId });
    const ceoId = ceo.agent.id;
    expect(ceo.agent.name).toBe("Edison");
    expect(ceo.model.modelFamily).toBe("meta");

    // Maker (anthropic) + QC reviewer (meta — beda family dari maker).
    const [maker] = await db
      .insert(agents)
      .values({ companyId, name: `Maker ${TEST_NOTE}`, role: "general" })
      .returning();
    const [qcMeta] = await db
      .insert(agents)
      .values({ companyId, name: `QC Meta ${TEST_NOTE}`, role: "general" })
      .returning();
    await registerAgentModel(db, {
      companyId,
      agentId: maker.id,
      modelFamily: "anthropic",
      modelId: "claude-sonnet-5-5",
    });
    await registerAgentModel(db, {
      companyId,
      agentId: qcMeta.id,
      modelFamily: "meta",
      modelId: "muse-spark-1.3",
    });
    await registerQcReviewer(db, { companyId, agentId: qcMeta.id });

    // --- Fase 3.2: pool $20 di-top-up (approval owner). ---
    const [topupApproval] = await db
      .insert(approvals)
      .values({ companyId, type: "binder_pool_topup", status: "approved", payload: {} })
      .returning();
    const { pool } = await topUpBinderPool(db, {
      companyId,
      amountCents: "2000",
      approvalId: topupApproval.id,
    });
    expect(pool.balanceCents).toBe("2000.0000000");

    // --- Task TEST dibuat; maker (bukan CEO) jadi owner. ---
    const [issue] = await db
      .insert(issues)
      .values({ companyId, projectId, title: `Tugas smoke TEST ${TEST_NOTE}`, status: "backlog" })
      .returning();
    const issueId = issue.id;
    const created = await createBinderTask(db, {
      companyId,
      projectId,
      issueId,
      ownerAgentId: maker.id,
      dod: "DoD TEST smoke CEO",
    });
    expect(created.binderStatus).toBe("backlog");
    expect(created.ownerAgentId).toBe(maker.id);
    expect(created.ownerAgentId).not.toBe(ceoId);

    async function issueStatusVersion() {
      const [row] = await db
        .select({ statusVersion: issues.statusVersion })
        .from(issues)
        .where(eq(issues.id, issueId));
      return row.statusVersion;
    }

    // --- Admission: amplop proposed memblokir masuk todo; sesudah
    // disetujui owner, transisi lolos (pool + amplop diperiksa). ---
    const envelope = await createBidEnvelope(db, {
      companyId,
      projectId,
      issueId,
      amountCents: "1000",
    });
    await expect(
      transitionBinderTask(db, {
        companyId,
        issueId,
        toStatus: "todo",
        expectedStatusVersion: await issueStatusVersion(),
      }),
    ).rejects.toThrow(/belum disetujui/i);
    const [envelopeApproval] = await db
      .insert(approvals)
      .values({ companyId, type: "binder_pool_topup", status: "approved", payload: {} })
      .returning();
    await approveBidEnvelope(db, {
      companyId,
      envelopeId: envelope.id,
      approvalId: envelopeApproval.id,
      approvedByUserId: OWNER_USER_ID,
    });
    const toTodo = await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "todo",
      expectedStatusVersion: await issueStatusVersion(),
    });
    expect(toTodo.task.binderStatus).toBe("todo");
    const toProgress = await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "in_progress",
      expectedStatusVersion: await issueStatusVersion(),
    });
    expect(toProgress.task.binderStatus).toBe("in_progress");

    // --- Fase 3.3: kerja diajukan → QC ditugaskan ke agen meta (BUKAN CEO). ---
    const [artifact] = await db
      .insert(issueWorkProducts)
      .values({
        companyId,
        projectId,
        issueId,
        type: "document",
        provider: "binder",
        title: `Hasil TEST ${TEST_NOTE}`,
        status: "completed",
        reviewState: "none",
      })
      .returning();
    const reviewed = await submitWorkForReview(db, {
      companyId,
      issueId,
      artifactWorkProductId: artifact.id,
      expectedStatusVersion: await issueStatusVersion(),
    });
    expect(reviewed.task.binderStatus).toBe("in_review");
    expect(reviewed.assignment.qcAgentId).toBe(qcMeta.id);
    expect(reviewed.assignment.qcAgentId).not.toBe(ceoId);
    expect(reviewed.assignment.qcFamily).toBe("meta");
    expect(reviewed.assignment.makerFamily).toBe("anthropic");

    // --- QC lolos (75, nol hard violation); biaya $1 ke pool, bukan amplop. ---
    const scored = await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: reviewed.assignment.id,
      qcAgentId: qcMeta.id,
      truthEvidence: 25,
      completeness: 20,
      compliance: 20,
      quality: 10,
      hardViolations: [] as BinderHardViolationCode[],
      evidenceNote: TEST_NOTE,
      expectedStatusVersion: await issueStatusVersion(),
    });
    expect(scored.charge.pool.balanceCents).toBe("1900.0000000");
    expect(scored.charge.envelope).toBeNull();
    const [statusRow] = await db
      .select({ binderStatus: binderTasks.binderStatus })
      .from(binderTasks)
      .where(and(eq(binderTasks.companyId, companyId), eq(binderTasks.issueId, issueId)));
    expect(statusRow.binderStatus).toBe("needs_owner_approval");

    // --- Vonis owner → Done. ---
    const approved = await approveBinderTaskByOwner(db, {
      companyId,
      issueId,
      ownerUserId: OWNER_USER_ID,
      expectedStatusVersion: await issueStatusVersion(),
    });
    expect(approved.task.binderStatus).toBe("done");

    // --- CEO menyiapkan pengajuan aksi; owner menyetujui; Core menerbitkan
    // approved_action_id (test); Gate memvalidasinya. TIDAK ada aksi
    // eksternal yang dijalankan. ---
    const request = await requestApprovedAction(db, {
      companyId,
      projectId,
      issueId,
      actionKind: "other",
      payload: { draftRef: "TEST-draft-smoke-ceo", note: TEST_NOTE },
      requestedByAgentId: ceoId,
    });
    expect(request.type).toBe("binder_approved_action");
    expect(request.status).toBe("pending");
    expect(request.requestedByAgentId).toBe(ceoId);
    await db
      .update(approvals)
      .set({ status: "approved", decidedByUserId: OWNER_USER_ID, decidedAt: new Date() })
      .where(eq(approvals.id, request.id));
    const issued = await issueApprovedAction(db, { companyId, approvalId: request.id });
    expect(issued.reused).toBe(false);
    expect(issued.action.status).toBe("issued");
    expect(issued.action.requestedByAgentId).toBe(ceoId);
    const validation = await validateApprovedAction(db, companyId, issued.action.id);
    expect(validation.valid).toBe(true);
    expect(validation.reason).toBeNull();

    // --- Rekonsiliasi: ledger seimbang persis $0,00; biaya QC $1 ke pool. ---
    const taskLedger = await reconcileTaskLedger(db, companyId, issueId);
    expect(taskLedger.qcCostCents).toBe("100.0000000");
    expect(taskLedger.totalCents).toBe("100.0000000");
    const ledger = await reconcileBinderLedger(db, companyId);
    expect(ledger.balanced).toBe(true);
    expect(ledger.differenceCents).toBe("0.0000000");

    // --- CEO tetap di luar pool QC sesudah seluruh alur. ---
    const proof = await assertCeoExcludedFromQcPool(db, companyId);
    expect(proof.excluded).toBe(true);
    expect(proof.ceoAgentId).toBe(ceoId);
    expect(proof.rosterSize).toBe(1);
  });
});
