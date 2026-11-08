// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  approvals,
  binderQcAssignments,
  binderQcScores,
  binderTasks,
  companies,
  createDb,
  issueComments,
  issueWorkProducts,
  issues,
  ledgerEntries,
  projects,
  type Db,
} from "@paperclipai/db";
import type { BinderHardViolationCode } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import {
  approveBinderTaskByOwner,
  assignQcReviewer,
  createBinderTask,
  listQcRoster,
  registerAgentModel,
  registerQcReviewer,
  rejectBinderTaskByOwner,
  resolveEscalatedTaskByOwner,
  submitQcScore,
  submitWorkForReview,
  transitionBinderTask,
} from "./binder-task-flow.js";
import {
  approveBidEnvelope,
  chargeBinderUsage,
  createBidEnvelope,
  getBinderFundingWarnings,
  reconcileBinderLedger,
  reconcileTaskLedger,
  topUpBinderPool,
} from "./binder-funding.js";

/**
 * Test Fase 3.3 — alur task + QC beda family + approved_action_id.
 * Semua data berlabel TEST (company/project/issue dibuat per test dan hanya
 * hidup di database embedded test ini); tidak ada data dummy aplikasi.
 * Migrasi 0444 teraplikasi oleh helper embedded Postgres — bila migrasi
 * gagal, seluruh file ini gagal (bukti migrasi teraplikasi).
 */

const TEST_NOTE = "TEST — hanya untuk pengujian otomatis";
const OWNER_USER_ID = "owner-test";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("alur task + QC BINDER", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let companyId: string;
  let projectId: string;
  let makerId: string;
  let qcAId: string;
  let qcBId: string;
  let ceoId: string;
  let issueId: string;

  function randomName(prefix: string) {
    return `${prefix} TEST ${Math.random().toString(36).slice(2, 8)}`;
  }

  function failingScore() {
    return {
      truthEvidence: 15,
      completeness: 12,
      compliance: 12,
      quality: 11,
      hardViolations: [] as BinderHardViolationCode[],
      evidenceNote: TEST_NOTE,
    };
  }

  function passingScore() {
    return {
      truthEvidence: 25,
      completeness: 20,
      compliance: 20,
      quality: 10,
      hardViolations: [] as BinderHardViolationCode[],
      evidenceNote: TEST_NOTE,
    };
  }

  async function createIssue(title: string, status = "backlog") {
    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        projectId,
        title: `${title} ${TEST_NOTE}`,
        status,
      })
      .returning();
    return issue;
  }

  async function createArtifact(issue: string, title = "Draf hasil TEST") {
    const [artifact] = await db
      .insert(issueWorkProducts)
      .values({
        companyId,
        projectId,
        issueId: issue,
        type: "document",
        provider: "binder",
        title,
        status: "completed",
        reviewState: "none",
      })
      .returning();
    return artifact;
  }

  async function issueStatusVersion(issue: string) {
    const [row] = await db
      .select({ statusVersion: issues.statusVersion })
      .from(issues)
      .where(eq(issues.id, issue));
    return row.statusVersion;
  }

  async function binderStatus(issue: string) {
    const [row] = await db
      .select({ binderStatus: binderTasks.binderStatus, revisionRound: binderTasks.revisionRound })
      .from(binderTasks)
      .where(and(eq(binderTasks.companyId, companyId), eq(binderTasks.issueId, issue)));
    return row;
  }

  async function approvedApproval() {
    const [approval] = await db
      .insert(approvals)
      .values({ companyId, type: "binder_pool_topup", status: "approved", payload: {} })
      .returning();
    return approval;
  }

  async function fundPool(cents = "2000") {
    const approval = await approvedApproval();
    const result = await topUpBinderPool(db, {
      companyId,
      amountCents: cents,
      approvalId: approval.id,
    });
    return result.pool;
  }

  async function approveExistingEnvelope(envelopeId: string) {
    const approval = await approvedApproval();
    const approved = await approveBidEnvelope(db, {
      companyId,
      envelopeId,
      approvalId: approval.id,
      approvedByUserId: OWNER_USER_ID,
    });
    return approved;
  }

  async function approveEnvelope(taskIssue: string, amountCents = "1000") {
    const envelope = await createBidEnvelope(db, {
      companyId,
      projectId,
      issueId: taskIssue,
      amountCents,
    });
    return approveExistingEnvelope(envelope.id);
  }

  /** Task lengkap sampai In Progress: pool + amplop disetujui. */
  async function taskInProgress(taskIssue: string) {
    await createBinderTask(db, {
      companyId,
      projectId,
      issueId: taskIssue,
      ownerAgentId: makerId,
      dod: "DoD TEST",
    });
    await transitionBinderTask(db, {
      companyId,
      issueId: taskIssue,
      toStatus: "todo",
      expectedStatusVersion: await issueStatusVersion(taskIssue),
    });
    const moved = await transitionBinderTask(db, {
      companyId,
      issueId: taskIssue,
      toStatus: "in_progress",
      expectedStatusVersion: await issueStatusVersion(taskIssue),
    });
    return moved;
  }

  /** Task sampai In Review (QC putaran 1 ditugaskan). */
  async function taskInReview(taskIssue: string) {
    await taskInProgress(taskIssue);
    const artifact = await createArtifact(taskIssue);
    const submitted = await submitWorkForReview(db, {
      companyId,
      issueId: taskIssue,
      artifactWorkProductId: artifact.id,
      expectedStatusVersion: await issueStatusVersion(taskIssue),
    });
    return { ...submitted, artifact };
  }

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("binder-task-flow-");
    db = createDb(database.connectionString);
  }, 180_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  }, 60_000);

  beforeEach(async () => {
    const [company] = await db
      .insert(companies)
      .values({
        name: randomName("Binder Task Flow"),
        issuePrefix: `BTF${Math.floor(Math.random() * 1_000_000)}`,
      })
      .returning();
    companyId = company.id;
    const [project] = await db
      .insert(projects)
      .values({ companyId, name: `Proyek TEST ${TEST_NOTE}` })
      .returning();
    projectId = project.id;
    const [maker] = await db
      .insert(agents)
      .values({ companyId, name: `Maker ${TEST_NOTE}`, role: "general" })
      .returning();
    const [qcA] = await db
      .insert(agents)
      .values({ companyId, name: `QC A ${TEST_NOTE}`, role: "general" })
      .returning();
    const [qcB] = await db
      .insert(agents)
      .values({ companyId, name: `QC B ${TEST_NOTE}`, role: "general" })
      .returning();
    const [ceo] = await db
      .insert(agents)
      .values({ companyId, name: `CEO ${TEST_NOTE}`, role: "ceo" })
      .returning();
    makerId = maker.id;
    qcAId = qcA.id;
    qcBId = qcB.id;
    ceoId = ceo.id;
    await registerAgentModel(db, {
      companyId,
      agentId: makerId,
      modelFamily: "meta",
      modelId: "muse-spark-1.3",
    });
    await registerAgentModel(db, {
      companyId,
      agentId: qcAId,
      modelFamily: "anthropic",
      modelId: "claude-sonnet-5-5",
    });
    await registerAgentModel(db, {
      companyId,
      agentId: qcBId,
      modelFamily: "anthropic",
      modelId: "claude-sonnet-5-5",
    });
    await registerAgentModel(db, {
      companyId,
      agentId: ceoId,
      modelFamily: "meta",
      modelId: "muse-spark-1.3",
    });
    await registerQcReviewer(db, { companyId, agentId: qcAId });
    await registerQcReviewer(db, { companyId, agentId: qcBId });
    const issue = await createIssue("Tugas uji");
    issueId = issue.id;
  });

  it("membuat task: backlog + owner jadi assignee issue; duplikat dan status bukan backlog ditolak", async () => {
    const created = await createBinderTask(db, {
      companyId,
      projectId,
      issueId,
      ownerAgentId: makerId,
      dod: "DoD TEST",
    });
    expect(created.binderStatus).toBe("backlog");
    expect(created.ownerAgentId).toBe(makerId);
    expect(created.dod).toBe("DoD TEST");
    const [issue] = await db
      .select({ assigneeAgentId: issues.assigneeAgentId })
      .from(issues)
      .where(eq(issues.id, issueId));
    expect(issue.assigneeAgentId).toBe(makerId);

    await expect(
      createBinderTask(db, {
        companyId,
        projectId,
        issueId,
        ownerAgentId: makerId,
        dod: "DoD kedua",
      }),
    ).rejects.toThrow(/sudah menjadi task BINDER/i);

    const other = await createIssue("Tugas lain", "todo");
    await expect(
      createBinderTask(db, {
        companyId,
        projectId,
        issueId: other.id,
        ownerAgentId: makerId,
        dod: "DoD TEST",
      }),
    ).rejects.toThrow(/backlog/i);
  });

  it("transisi: backlog→todo→in_progress lolos; ilegal dan statusVersion basi ditolak", async () => {
    await createBinderTask(db, {
      companyId,
      projectId,
      issueId,
      ownerAgentId: makerId,
      dod: "DoD TEST",
    });
    await expect(
      transitionBinderTask(db, {
        companyId,
        issueId,
        toStatus: "in_progress",
        expectedStatusVersion: await issueStatusVersion(issueId),
      }),
    ).rejects.toThrow(/tidak diizinkan/i);
    const toTodo = await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "todo",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    expect(toTodo.task.binderStatus).toBe("todo");
    await expect(
      transitionBinderTask(db, {
        companyId,
        issueId,
        toStatus: "in_review",
        expectedStatusVersion: await issueStatusVersion(issueId),
      }),
    ).rejects.toThrow(/submitWorkForReview/i);
    await expect(
      transitionBinderTask(db, {
        companyId,
        issueId,
        toStatus: "in_progress",
        expectedStatusVersion: 999,
      }),
    ).rejects.toThrow(/Status task berubah oleh pihak lain/i);
    const toProgress = await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "in_progress",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    expect(toProgress.task.binderStatus).toBe("in_progress");
    const [issue] = await db
      .select({ status: issues.status })
      .from(issues)
      .where(eq(issues.id, issueId));
    expect(issue.status).toBe("in_progress");
  });

  it("admission: amplop proposed memblokir masuk todo; sesudah disetujui lolos", async () => {
    await fundPool();
    await createBinderTask(db, {
      companyId,
      projectId,
      issueId,
      ownerAgentId: makerId,
      dod: "DoD TEST",
    });
    const proposed = await createBidEnvelope(db, {
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
        expectedStatusVersion: await issueStatusVersion(issueId),
      }),
    ).rejects.toThrow(/belum disetujui/i);
    await approveExistingEnvelope(proposed.id);
    const moved = await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "todo",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    expect(moved.task.binderStatus).toBe("todo");
  });

  it("admission: pool habis memblokir masuk todo; tanpa pool tidak memblokir", async () => {
    await createBinderTask(db, {
      companyId,
      projectId,
      issueId,
      ownerAgentId: makerId,
      dod: "DoD TEST",
    });
    // Tanpa pool sama sekali: lolos (aliran Paperclip lama tetap jalan).
    const moved = await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "todo",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    expect(moved.task.binderStatus).toBe("todo");
    // Kuras pool sampai habis, lalu coba task kedua.
    await fundPool("2000");
    await chargeBinderUsage(db, {
      companyId,
      projectId,
      amountCents: "2000",
      kind: "usage",
      reason: TEST_NOTE,
    });
    const second = await createIssue("Tugas kedua");
    await createBinderTask(db, {
      companyId,
      projectId,
      issueId: second.id,
      ownerAgentId: makerId,
      dod: "DoD TEST",
    });
    await expect(
      transitionBinderTask(db, {
        companyId,
        issueId: second.id,
        toStatus: "todo",
        expectedStatusVersion: await issueStatusVersion(second.id),
      }),
    ).rejects.toThrow(/Pool company habis/i);
  });

  it("submit kerja: artifact jadi primary + QC ditugaskan + masuk In Review", async () => {
    await fundPool();
    await approveEnvelope(issueId);
    await taskInProgress(issueId);
    const artifact = await createArtifact(issueId);
    const submitted = await submitWorkForReview(db, {
      companyId,
      issueId,
      artifactWorkProductId: artifact.id,
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    expect(submitted.task.binderStatus).toBe("in_review");
    expect(submitted.issue.status).toBe("in_review");
    expect(submitted.assignment.round).toBe(1);
    expect(submitted.assignment.qcFamily).toBe("anthropic");
    expect(submitted.assignment.qcAgentId).not.toBe(makerId);
    const [task] = await db
      .select({ primaryArtifactId: binderTasks.primaryArtifactId })
      .from(binderTasks)
      .where(and(eq(binderTasks.companyId, companyId), eq(binderTasks.issueId, issueId)));
    expect(task.primaryArtifactId).toBe(artifact.id);
    const [product] = await db
      .select({ isPrimary: issueWorkProducts.isPrimary })
      .from(issueWorkProducts)
      .where(eq(issueWorkProducts.id, artifact.id));
    expect(product.isPrimary).toBe(true);
  });

  it("submit kerja: task bukan In Progress dan artifact tidak ada ditolak", async () => {
    await fundPool();
    await approveEnvelope(issueId);
    await createBinderTask(db, {
      companyId,
      projectId,
      issueId,
      ownerAgentId: makerId,
      dod: "DoD TEST",
    });
    await expect(
      submitWorkForReview(db, {
        companyId,
        issueId,
        artifactWorkProductId: "00000000-0000-0000-0000-000000000000",
        expectedStatusVersion: await issueStatusVersion(issueId),
      }),
    ).rejects.toThrow(/In Progress/i);
    await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "todo",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "in_progress",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    await expect(
      submitWorkForReview(db, {
        companyId,
        issueId,
        artifactWorkProductId: "00000000-0000-0000-0000-000000000000",
        expectedStatusVersion: await issueStatusVersion(issueId),
      }),
    ).rejects.toThrow(/tidak ditemukan/i);
  });

  it("QC: CEO tidak boleh masuk pool; agen tanpa model family tidak bisa didaftar", async () => {
    await expect(
      registerQcReviewer(db, { companyId, agentId: ceoId }),
    ).rejects.toThrow(/CEO tidak boleh/i);
    const [plain] = await db
      .insert(agents)
      .values({ companyId, name: `Tanpa Model ${TEST_NOTE}`, role: "general" })
      .returning();
    await expect(
      registerQcReviewer(db, { companyId, agentId: plain.id }),
    ).rejects.toThrow(/model family/i);
    const roster = await listQcRoster(db, companyId);
    expect(roster.map((row) => row.agentId).sort()).toEqual([qcAId, qcBId].sort());
    expect(roster.every((row) => row.modelFamily === "anthropic")).toBe(true);
  });

  it("QC: pool hanya family maker → submit gagal fail-closed", async () => {
    const [metaCompany] = await db
      .insert(companies)
      .values({
        name: randomName("Binder QC Meta Only"),
        issuePrefix: `QMO${Math.floor(Math.random() * 1_000_000)}`,
      })
      .returning();
    const metaCompanyId = metaCompany.id;
    const [project] = await db
      .insert(projects)
      .values({ companyId: metaCompanyId, name: `Proyek TEST ${TEST_NOTE}` })
      .returning();
    const [metaMaker] = await db
      .insert(agents)
      .values({ companyId: metaCompanyId, name: `Maker ${TEST_NOTE}`, role: "general" })
      .returning();
    const [metaQc] = await db
      .insert(agents)
      .values({ companyId: metaCompanyId, name: `QC ${TEST_NOTE}`, role: "general" })
      .returning();
    for (const agentId of [metaMaker.id, metaQc.id]) {
      await registerAgentModel(db, {
        companyId: metaCompanyId,
        agentId,
        modelFamily: "meta",
        modelId: "muse-spark-1.3",
      });
    }
    await registerQcReviewer(db, { companyId: metaCompanyId, agentId: metaQc.id });
    const [issue] = await db
      .insert(issues)
      .values({ companyId: metaCompanyId, projectId: project.id, title: `Tugas ${TEST_NOTE}` })
      .returning();
    await createBinderTask(db, {
      companyId: metaCompanyId,
      projectId: project.id,
      issueId: issue.id,
      ownerAgentId: metaMaker.id,
      dod: "DoD TEST",
    });
    // NB: statusVersion dibaca dinamis — createBinderTask menaikkan
    // statusVersion via trigger assignee Paperclip (0358), jadi angka
    // mentah 0/1/2 tidak bisa di-hardcode di sini.
    await transitionBinderTask(db, {
      companyId: metaCompanyId,
      issueId: issue.id,
      toStatus: "todo",
      expectedStatusVersion: await issueStatusVersion(issue.id),
    });
    await transitionBinderTask(db, {
      companyId: metaCompanyId,
      issueId: issue.id,
      toStatus: "in_progress",
      expectedStatusVersion: await issueStatusVersion(issue.id),
    });
    const [artifact] = await db
      .insert(issueWorkProducts)
      .values({
        companyId: metaCompanyId,
        projectId: project.id,
        issueId: issue.id,
        type: "document",
        provider: "binder",
        title: `Draf ${TEST_NOTE}`,
        status: "completed",
        reviewState: "none",
      })
      .returning();
    await expect(
      submitWorkForReview(db, {
        companyId: metaCompanyId,
        issueId: issue.id,
        artifactWorkProductId: artifact.id,
        expectedStatusVersion: await issueStatusVersion(issue.id),
      }),
    ).rejects.toThrow(/Tidak ada QC yang memenuhi syarat/i);
  });

  it("QC: round-robin berputar dan reviewer tidak mengulang task yang sama", async () => {
    await fundPool();
    await approveEnvelope(issueId);
    const second = await createIssue("Tugas kedua");
    await approveEnvelope(second.id);
    const first = await taskInReview(issueId);
    const secondReview = await taskInReview(second.id);
    expect(secondReview.assignment.qcAgentId).not.toBe(first.assignment.qcAgentId);
    expect(secondReview.assignment.qcFamily).toBe("anthropic");
    // QC gagal putaran 1 → revisi; ajukan lagi → putaran 2 dengan reviewer lain.
    const failed = await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: first.assignment.id,
      qcAgentId: first.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      ...failingScore(),
    });
    expect(failed.task.binderStatus).toBe("revision");
    expect((await binderStatus(issueId)).revisionRound).toBe(1);
    await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "in_progress",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    const resubmitted = await submitWorkForReview(db, {
      companyId,
      issueId,
      artifactWorkProductId: first.artifact.id,
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    expect(resubmitted.assignment.round).toBe(2);
    expect(resubmitted.assignment.qcAgentId).not.toBe(first.assignment.qcAgentId);
    expect(resubmitted.assignment.qcAgentId).toBe(secondReview.assignment.qcAgentId);
  });

  it("QC skor: rentang rubrik divalidasi; 74 gagal; 75 lolos; hard violation menggagalkan 90", async () => {
    await fundPool();
    await approveEnvelope(issueId);
    const reviewed = await taskInReview(issueId);
    await expect(
      submitQcScore(db, {
        companyId,
        issueId,
        assignmentId: reviewed.assignment.id,
        qcAgentId: reviewed.assignment.qcAgentId,
        expectedStatusVersion: await issueStatusVersion(issueId),
        truthEvidence: 31,
        completeness: 20,
        compliance: 20,
        quality: 10,
        hardViolations: [],
      }),
    ).rejects.toThrow(/truthEvidence harus bilangan bulat 0\.\.30/i);

    const failed74 = await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: reviewed.assignment.id,
      qcAgentId: reviewed.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      truthEvidence: 25,
      completeness: 20,
      compliance: 20,
      quality: 9,
      hardViolations: [],
      evidenceNote: TEST_NOTE,
    });
    expect(failed74.score.totalScore).toBe(74);
    expect(failed74.score.passed).toBe(false);
    expect(failed74.task.binderStatus).toBe("revision");
    expect(failed74.scoreSheet.reviewState).toBe("changes_requested");

    // Putaran 2: skor 90 tapi ada hard violation → tetap gagal → eskalasi.
    await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "in_progress",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    const resubmitted = await submitWorkForReview(db, {
      companyId,
      issueId,
      artifactWorkProductId: reviewed.artifact.id,
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    const failed90 = await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: resubmitted.assignment.id,
      qcAgentId: resubmitted.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      truthEvidence: 30,
      completeness: 25,
      compliance: 25,
      quality: 10,
      hardViolations: ["fabricated_evidence"],
      evidenceNote: TEST_NOTE,
    });
    expect(failed90.score.totalScore).toBe(90);
    expect(failed90.score.passed).toBe(false);
    expect(failed90.task.binderStatus).toBe("escalated");
    expect(failed90.assignment.status).toBe("escalated");
    const [issue] = await db
      .select({ status: issues.status })
      .from(issues)
      .where(eq(issues.id, issueId));
    expect(issue.status).toBe("blocked");
  });

  it("QC skor: 75 lolos → Butuh Approval Patria; hanya QC yang ditugaskan boleh menilai; skor ganda ditolak", async () => {
    await fundPool();
    await approveEnvelope(issueId);
    const reviewed = await taskInReview(issueId);
    const otherQc = reviewed.assignment.qcAgentId === qcAId ? qcBId : qcAId;
    await expect(
      submitQcScore(db, {
        companyId,
        issueId,
        assignmentId: reviewed.assignment.id,
        qcAgentId: otherQc,
        expectedStatusVersion: await issueStatusVersion(issueId),
        ...passingScore(),
      }),
    ).rejects.toThrow(/Hanya QC yang ditugaskan/i);
    const passed = await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: reviewed.assignment.id,
      qcAgentId: reviewed.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      ...passingScore(),
    });
    expect(passed.score.totalScore).toBe(75);
    expect(passed.score.passed).toBe(true);
    expect(passed.task.binderStatus).toBe("needs_owner_approval");
    expect(passed.scoreSheet.reviewState).toBe("approved");
    await expect(
      submitQcScore(db, {
        companyId,
        issueId,
        assignmentId: reviewed.assignment.id,
        qcAgentId: reviewed.assignment.qcAgentId,
        expectedStatusVersion: await issueStatusVersion(issueId),
        ...passingScore(),
      }),
    ).rejects.toThrow(/tidak bisa dikirim dua kali/i);
  });

  it("QC skor: biaya ke pool saja — amplop tidak tersentuh, rekonsiliasi seimbang", async () => {
    await fundPool("2000");
    await approveEnvelope(issueId, "1000");
    await chargeBinderUsage(db, {
      companyId,
      projectId,
      issueId,
      amountCents: "600",
      kind: "usage",
      reason: TEST_NOTE,
    });
    const reviewed = await taskInReview(issueId);
    const scored = await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: reviewed.assignment.id,
      qcAgentId: reviewed.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      qcCostCents: "200",
      ...passingScore(),
    });
    expect(scored.charge.pool.balanceCents).toBe("1200.0000000");
    expect(scored.charge.charged).toBe(true);
    // Biaya QC tidak menyentuh amplop: envelope null di hasil charge.
    expect(scored.charge.envelope).toBeNull();
    const [qcEntry] = await db
      .select({ kind: ledgerEntries.kind, amountCents: ledgerEntries.amountCents })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.companyId, companyId),
          eq(ledgerEntries.kind, "qc_cost"),
        ),
      );
    expect(qcEntry.amountCents).toBe("200.0000000");
    const taskLedger = await reconcileTaskLedger(db, companyId, issueId);
    expect(taskLedger.usageCents).toBe("600.0000000");
    expect(taskLedger.qcCostCents).toBe("200.0000000");
    expect(taskLedger.totalCents).toBe("800.0000000");
    // Amplop tetap 600 (hanya pemakaian usage) — QC tidak menambah spent.
    expect(taskLedger.envelopeSpentCents).toBe("600.0000000");
    const ledger = await reconcileBinderLedger(db, companyId);
    expect(ledger.balanced).toBe(true);
    expect(ledger.differenceCents).toBe("0.0000000");
    const warnings = await getBinderFundingWarnings(db, companyId);
    expect(warnings.pool?.balanceCents).toBe("1200.0000000");
    // Lembar skor tersimpan sebagai artifact dengan metadata lengkap.
    const [sheet] = await db
      .select({
        type: issueWorkProducts.type,
        metadata: issueWorkProducts.metadata,
      })
      .from(issueWorkProducts)
      .where(eq(issueWorkProducts.id, scored.scoreSheet.id));
    expect(sheet.type).toBe("binder_qc_score_sheet");
    expect((sheet.metadata as Record<string, unknown>)["totalScore"]).toBe(75);
    expect((sheet.metadata as Record<string, unknown>)["passed"]).toBe(true);
    const [scoreRow] = await db
      .select()
      .from(binderQcScores)
      .where(eq(binderQcScores.assignmentId, reviewed.assignment.id));
    expect(scoreRow.totalScore).toBe(75);
    expect(scoreRow.scoreSheetWorkProductId).toBe(scored.scoreSheet.id);
  });

  it("QC gagal 2x → eskalasi; owner resume → In Progress dengan putaran di-reset; transkrip tercatat", async () => {
    await fundPool();
    await approveEnvelope(issueId);
    const reviewed = await taskInReview(issueId);
    await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: reviewed.assignment.id,
      qcAgentId: reviewed.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      ...failingScore(),
    });
    await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "in_progress",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    const resubmitted = await submitWorkForReview(db, {
      companyId,
      issueId,
      artifactWorkProductId: reviewed.artifact.id,
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: resubmitted.assignment.id,
      qcAgentId: resubmitted.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      ...failingScore(),
    });
    expect((await binderStatus(issueId)).binderStatus).toBe("escalated");
    await expect(
      transitionBinderTask(db, {
        companyId,
        issueId,
        toStatus: "in_progress",
        expectedStatusVersion: await issueStatusVersion(issueId),
      }),
    ).rejects.toThrow(/Keputusan eskalasi hanya lewat resolveEscalatedTaskByOwner/i);
    const resumed = await resolveEscalatedTaskByOwner(db, {
      companyId,
      issueId,
      decision: "resume",
      ownerUserId: OWNER_USER_ID,
      expectedStatusVersion: await issueStatusVersion(issueId),
      decisionNote: "Lanjut dengan mandat baru",
    });
    expect(resumed.task.binderStatus).toBe("in_progress");
    expect((await binderStatus(issueId)).revisionRound).toBe(0);
    const comments = await db
      .select({ body: issueComments.body })
      .from(issueComments)
      .where(eq(issueComments.issueId, issueId));
    expect(comments.some((row) => row.body.includes("eskalasi"))).toBe(true);
    expect(comments.some((row) => row.body.includes("QC putaran"))).toBe(true);
    // QC putaran baru sesudah resume: pengajuan ke-3 untuk task ini
    // (nomor putaran monotonik — bukan putaran 1 lagi), anggaran revisi
    // baru karena revisionRound di-reset.
    const artifact = await createArtifact(issueId, "Draf hasil revisi TEST");
    const again = await submitWorkForReview(db, {
      companyId,
      issueId,
      artifactWorkProductId: artifact.id,
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    expect(again.assignment.round).toBe(3);
  });

  it("Owner: approve → Done; reject pertama → Revisi; reject kedua → Eskalasi", async () => {
    await fundPool();
    await approveEnvelope(issueId);
    const reviewed = await taskInReview(issueId);
    const passed = await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: reviewed.assignment.id,
      qcAgentId: reviewed.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      ...passingScore(),
    });
    expect(passed.task.binderStatus).toBe("needs_owner_approval");
    const rejected = await rejectBinderTaskByOwner(db, {
      companyId,
      issueId,
      ownerUserId: OWNER_USER_ID,
      expectedStatusVersion: await issueStatusVersion(issueId),
      decisionNote: "Kurang bukti, revisi",
    });
    expect(rejected.task.binderStatus).toBe("revision");
    expect((await binderStatus(issueId)).revisionRound).toBe(1);
    await transitionBinderTask(db, {
      companyId,
      issueId,
      toStatus: "in_progress",
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    const resubmitted = await submitWorkForReview(db, {
      companyId,
      issueId,
      artifactWorkProductId: reviewed.artifact.id,
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    expect(resubmitted.assignment.round).toBe(2);
    await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: resubmitted.assignment.id,
      qcAgentId: resubmitted.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      ...passingScore(),
    });
    expect((await binderStatus(issueId)).binderStatus).toBe("needs_owner_approval");
    // Penolakan kedua (anggaran revisi habis) → eskalasi, bukan revisi.
    const escalated = await rejectBinderTaskByOwner(db, {
      companyId,
      issueId,
      ownerUserId: OWNER_USER_ID,
      expectedStatusVersion: await issueStatusVersion(issueId),
      decisionNote: "Masih kurang, eskalasi",
    });
    expect(escalated.task.binderStatus).toBe("escalated");
    // Owner membatalkan dari eskalasi.
    const cancelled = await resolveEscalatedTaskByOwner(db, {
      companyId,
      issueId,
      decision: "cancel",
      ownerUserId: OWNER_USER_ID,
      expectedStatusVersion: await issueStatusVersion(issueId),
    });
    expect(cancelled.task.binderStatus).toBe("cancelled");
    await expect(
      transitionBinderTask(db, {
        companyId,
        issueId,
        toStatus: "todo",
        expectedStatusVersion: await issueStatusVersion(issueId),
      }),
    ).rejects.toThrow(/tidak diizinkan/i);
  });

  it("Owner: approve dari Butuh Approval → Done dan completedAt terisi", async () => {
    await fundPool();
    await approveEnvelope(issueId);
    const reviewed = await taskInReview(issueId);
    await submitQcScore(db, {
      companyId,
      issueId,
      assignmentId: reviewed.assignment.id,
      qcAgentId: reviewed.assignment.qcAgentId,
      expectedStatusVersion: await issueStatusVersion(issueId),
      ...passingScore(),
    });
    const approved = await approveBinderTaskByOwner(db, {
      companyId,
      issueId,
      ownerUserId: OWNER_USER_ID,
      expectedStatusVersion: await issueStatusVersion(issueId),
      decisionNote: "Disetujui",
    });
    expect(approved.task.binderStatus).toBe("done");
    expect(approved.issue.status).toBe("done");
    expect(approved.issue.completedAt).not.toBeNull();
    await expect(
      approveBinderTaskByOwner(db, {
        companyId,
        issueId,
        ownerUserId: OWNER_USER_ID,
        expectedStatusVersion: await issueStatusVersion(issueId),
      }),
    ).rejects.toThrow(/Butuh Approval/i);
  });

  it("assignQcReviewer langsung: round-robin memakai yang paling lama tidak ditugaskan", async () => {
    const task = await createBinderTask(db, {
      companyId,
      projectId,
      issueId,
      ownerAgentId: makerId,
      dod: "DoD TEST",
    });
    const secondIssue = await createIssue("Tugas kedua");
    const secondTask = await createBinderTask(db, {
      companyId,
      projectId,
      issueId: secondIssue.id,
      ownerAgentId: makerId,
      dod: "DoD TEST",
    });
    const first = await assignQcReviewer(db, {
      companyId,
      projectId,
      issueId,
      binderTaskId: task.id,
      makerAgentId: makerId,
      makerFamily: "meta",
      round: 1,
    });
    expect(first.qcFamily).toBe("anthropic");
    // Satu task hanya punya satu penugasan per putaran (unique
    // company+issue+round) — putaran kedua memakai task lain.
    const second = await assignQcReviewer(db, {
      companyId,
      projectId,
      issueId: secondIssue.id,
      binderTaskId: secondTask.id,
      makerAgentId: makerId,
      makerFamily: "meta",
      round: 1,
    });
    expect(second.qcAgentId).not.toBe(first.qcAgentId);
    const assignments = await db
      .select({ qcAgentId: binderQcAssignments.qcAgentId })
      .from(binderQcAssignments)
      .where(eq(binderQcAssignments.companyId, companyId));
    expect(assignments).toHaveLength(2);
  });
});
