// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  approvals,
  binderDesktopJobs,
  binderGateDecisions,
  binderPools,
  binderTasks,
  companies,
  createDb,
  issueWorkProducts,
  issues,
  ledgerEntries,
  projects,
  type Db,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import {
  approveBidEnvelope,
  createBidEnvelope,
  getBinderPool,
  reconcileBinderLedger,
  topUpBinderPool,
} from "./binder-funding.js";
import {
  createBinderTask,
  issueApprovedAction,
  registerAgentModel,
  registerQcReviewer,
  requestApprovedAction,
  revokeApprovedAction,
  transitionBinderTask,
} from "./binder-task-flow.js";
import {
  PluginEndpointChangedError,
  createDesktopJob,
  executeExternalActionViaGate,
  failDesktopJob,
  gateCheck,
  gateCheckPure,
  getDesktopJobStatus,
  mapDesktopJobStatusToBinderTaskStatus,
  markDesktopJobNeedsApproval,
  retryDesktopJob,
  returnDesktopArtifact,
  stopVm,
  timeoutDesktopJob,
  type DesktopRuntimeAdapter,
  type ExternalActionExecutor,
} from "./binder-sync-gate.js";

/**
 * Test Tahap 5 — Sync Internal + Gate Internal BINDER.
 * Semua data berlabel TEST (company/project/issue dibuat per test dan
 * hanya hidup di database test ini); tidak ada data dummy aplikasi.
 * Migrasi 0448 teraplikasi oleh helper — bila migrasi gagal, seluruh
 * file ini gagal (bukti migrasi teraplikasi).
 *
 * Adapter desktop di sini adalah TEST DOUBLE (bukan VM nyata — VM ini
 * tidak bisa menjalankan container, temuan Fase 3.0; pembuktian VM live
 * menunggu Docker Desktop di MacBook / Tahap 6). Yang dibuktikan di
 * sini: logika Sync/Gate, matriks bypass 10/10 ditolak, pemetaan
 * status, timeout, isolasi plugin.
 */

const TEST_NOTE = "TEST — hanya untuk pengujian otomatis";
const OWNER_USER_ID = "owner-test";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Sync Internal + Gate Internal BINDER", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let companyId: string;
  let projectId: string;
  let issueId: string;
  let ceoId: string;
  let makerId: string;
  let qcAId: string;
  let leadsId: string;
  let financeId: string;
  let codeBuilderId: string;
  let adapter: FakeDesktopRuntimeAdapter;
  let executor: FakeExternalExecutor;

  function randomName(prefix: string) {
    return `${prefix} TEST ${Math.random().toString(36).slice(2, 8)}`;
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
      .select({ binderStatus: binderTasks.binderStatus })
      .from(binderTasks)
      .where(and(eq(binderTasks.companyId, companyId), eq(binderTasks.issueId, issue)));
    return row.binderStatus as string;
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
    return topUpBinderPool(db, { companyId, amountCents: cents, approvalId: approval.id });
  }

  async function approveEnvelope(taskIssue: string, amountCents = "1000") {
    const envelope = await createBidEnvelope(db, {
      companyId,
      projectId,
      issueId: taskIssue,
      amountCents,
    });
    const approval = await approvedApproval();
    return approveBidEnvelope(db, {
      companyId,
      envelopeId: envelope.id,
      approvalId: approval.id,
      approvedByUserId: OWNER_USER_ID,
    });
  }

  /** Task BINDER sampai Todo (pool + amplop disetujui). */
  async function makeTaskTodo(taskIssue: string) {
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
  }

  /** approved_action_id yang sudah diterbitkan Core atas vonis owner. */
  async function makeApprovedAction(
    actionKind: "outreach_send" | "external_post" | "external_call" | "external_message" | "other",
    opts: { issue?: string; scopeRef?: string; expiresAt?: Date } = {},
  ) {
    const approval = await requestApprovedAction(db, {
      companyId,
      actionKind,
      projectId,
      issueId: opts.issue ?? issueId,
      requestedByAgentId: makerId,
      payload: opts.scopeRef ? { scopeRef: opts.scopeRef } : {},
    });
    await db
      .update(approvals)
      .set({ status: "approved", decidedByUserId: OWNER_USER_ID, decidedAt: new Date() })
      .where(eq(approvals.id, approval.id));
    const { action } = await issueApprovedAction(db, {
      companyId,
      approvalId: approval.id,
      expiresAt: opts.expiresAt?.toISOString(),
    });
    return action;
  }

  async function deniedDecisions() {
    return db
      .select()
      .from(binderGateDecisions)
      .where(and(eq(binderGateDecisions.companyId, companyId), eq(binderGateDecisions.decision, "denied")));
  }

  async function createJob(taskIssue = issueId, opts: { runtime?: "test_double"; snapshotRequested?: boolean; idleTimeoutSeconds?: number; paguVmCents?: string } = {}) {
    return createDesktopJob(db, adapter, {
      companyId,
      projectId,
      issueId: taskIssue,
      agentId: makerId,
      createdByAgentId: ceoId,
      runtime: opts.runtime ?? "test_double",
      snapshotRequested: opts.snapshotRequested,
      idleTimeoutSeconds: opts.idleTimeoutSeconds,
      paguVmCents: opts.paguVmCents,
    });
  }

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("binder-sync-gate-");
    db = createDb(database.connectionString);
  }, 180_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  }, 60_000);

  beforeEach(async () => {
    adapter = new FakeDesktopRuntimeAdapter();
    executor = new FakeExternalExecutor();
    const [company] = await db
      .insert(companies)
      .values({ name: randomName("Binder Sync Gate"), issuePrefix: `BSG${Math.floor(Math.random() * 1_000_000)}` })
      .returning();
    companyId = company.id;
    const [project] = await db
      .insert(projects)
      .values({ companyId, name: `Proyek TEST ${TEST_NOTE}` })
      .returning();
    projectId = project.id;
    const [issue] = await db
      .insert(issues)
      .values({ companyId, projectId, title: `Tugas uji ${TEST_NOTE}` })
      .returning();
    issueId = issue.id;
    // CEO SATU per akun (aturan produk): dibuat sekali di test pertama,
    // dipakai ulang semua test berikutnya — bukan satu CEO per company.
    const [existingCeo] = await db.select().from(agents).where(eq(agents.role, "ceo")).limit(1);
    let ceoRow = existingCeo;
    if (!ceoRow) {
      const [created] = await db
        .insert(agents)
        .values({ companyId, name: `Edison ${TEST_NOTE}`, role: "ceo" })
        .returning();
      ceoRow = created;
    }
    const [maker] = await db
      .insert(agents)
      .values({ companyId, name: `Maker ${TEST_NOTE}`, role: "general" })
      .returning();
    const [qcA] = await db
      .insert(agents)
      .values({ companyId, name: `QC A ${TEST_NOTE}`, role: "general" })
      .returning();
    const [leads] = await db
      .insert(agents)
      .values({ companyId, name: `Leads ${TEST_NOTE}`, role: "leads" })
      .returning();
    const [finance] = await db
      .insert(agents)
      .values({ companyId, name: `Finance ${TEST_NOTE}`, role: "finance" })
      .returning();
    const [codeBuilder] = await db
      .insert(agents)
      .values({ companyId, name: `Code Builder ${TEST_NOTE}`, role: "code_builder" })
      .returning();
    ceoId = ceoRow.id;
    makerId = maker.id;
    qcAId = qcA.id;
    leadsId = leads.id;
    financeId = finance.id;
    codeBuilderId = codeBuilder.id;
    await registerAgentModel(db, { companyId, agentId: makerId, modelFamily: "meta", modelId: "muse-spark-1.3" });
    await registerAgentModel(db, { companyId, agentId: qcAId, modelFamily: "anthropic", modelId: "claude-sonnet-5-5" });
    await registerQcReviewer(db, { companyId, agentId: qcAId });
    await fundPool("2000");
    await makeTaskTodo(issueId);
    await approveEnvelope(issueId, "1000");
  });

  describe("createDesktopJob — Sync Internal", () => {
    it("CEO membuat job: task Todo → In Progress, job running + vmId test-double", async () => {
      const job = await createJob();
      expect(job.status).toBe("running");
      expect(job.vmId).toMatch(/^vm-test-/);
      expect(job.runtime).toBe("test_double");
      expect(job.attempt).toBe(1);
      expect(await binderStatus(issueId)).toBe("in_progress");
      expect(adapter.createdVms).toContain(job.vmId);
    });

    it("menolak job tanpa task BINDER (issue biasa, bukan task)", async () => {
      const [other] = await db
        .insert(issues)
        .values({ companyId, projectId, title: `Bukan task ${TEST_NOTE}` })
        .returning();
      await expect(
        createDesktopJob(db, adapter, {
          companyId,
          issueId: other.id,
          agentId: makerId,
          createdByAgentId: ceoId,
          runtime: "test_double",
        }),
      ).rejects.toThrow(/wajib merujuk task BINDER/);
    });

    it("menolak pembuat bukan CEO", async () => {
      await expect(
        createDesktopJob(db, adapter, {
          companyId,
          issueId,
          agentId: makerId,
          createdByAgentId: makerId,
          runtime: "test_double",
        }),
      ).rejects.toThrow(/Hanya CEO/);
    });

    it("menolak job dari task Backlog (scope belum disetujui/dimulai)", async () => {
      const [other] = await db
        .insert(issues)
        .values({ companyId, projectId, title: `Backlog ${TEST_NOTE}` })
        .returning();
      await createBinderTask(db, { companyId, projectId, issueId: other.id, ownerAgentId: makerId, dod: "DoD TEST" });
      await expect(createJob(other.id)).rejects.toThrow(/Todo\/In Progress/);
    });

    it("menolak job ganda attempt 1 untuk task yang sama + attempt 2 langsung", async () => {
      await createJob();
      await expect(createJob()).rejects.toThrow(/sudah ada untuk task ini/);
      await expect(
        createDesktopJob(db, adapter, {
          companyId,
          issueId,
          agentId: makerId,
          createdByAgentId: ceoId,
          runtime: "test_double",
          attempt: 2,
        }),
      ).rejects.toThrow(/hanya lewat retryDesktopJob/);
    });

    it("snapshot tanpa idleTimeout/pagu ditolak; dengan keduanya lolos", async () => {
      await expect(createJob(issueId, { snapshotRequested: true })).rejects.toThrow(/Snapshot wajib idleTimeout/);
      await expect(
        createJob(issueId, { snapshotRequested: true, idleTimeoutSeconds: 600 }),
      ).rejects.toThrow(/Snapshot wajib idleTimeout/);
      const job = await createJob(issueId, { snapshotRequested: true, idleTimeoutSeconds: 600, paguVmCents: "500" });
      expect(job.snapshotRequested).toBe(true);
      expect(job.idleTimeoutSeconds).toBe(600);
    });

    it("adapter versi kontrak tidak cocok → gagal aman, tidak ada job dibuat", async () => {
      const badAdapter = new FakeDesktopRuntimeAdapter();
      badAdapter.contractVersion = "99";
      await expect(
        createDesktopJob(db, badAdapter, {
          companyId,
          issueId,
          agentId: makerId,
          createdByAgentId: ceoId,
          runtime: "test_double",
        }),
      ).rejects.toThrow(/tidak kompatibel/);
      const jobs = await db.select().from(binderDesktopJobs).where(eq(binderDesktopJobs.companyId, companyId));
      expect(jobs).toHaveLength(0);
    });

    it("tanpa pool company → job ditolak (fail-closed, biaya harus bisa dicatat)", async () => {
      const [company2] = await db
        .insert(companies)
        .values({ name: randomName("Tanpa Pool"), issuePrefix: `TP${Math.floor(Math.random() * 1_000_000)}` })
        .returning();
      const [project2] = await db.insert(projects).values({ companyId: company2.id, name: "P2 TEST" }).returning();
      const [issue2] = await db.insert(issues).values({ companyId: company2.id, projectId: project2.id, title: "T2 TEST" }).returning();
      const [maker2] = await db.insert(agents).values({ companyId: company2.id, name: "Maker2 TEST", role: "general" }).returning();
      await createBinderTask(db, { companyId: company2.id, projectId: project2.id, issueId: issue2.id, ownerAgentId: maker2.id, dod: "DoD TEST" });
      await transitionBinderTask(db, {
        companyId: company2.id,
        issueId: issue2.id,
        toStatus: "todo",
        expectedStatusVersion: await issueStatusVersion(issue2.id),
      });
      await expect(
        createDesktopJob(db, adapter, {
          companyId: company2.id,
          issueId: issue2.id,
          agentId: maker2.id,
          createdByAgentId: ceoId,
          runtime: "test_double",
        }),
      ).rejects.toThrow(/Pool company belum dibuat/);
    });
  });

  describe("getDesktopJobStatus + pemetaan status", () => {
    it("pemetaan murni: queued→todo, running→in_progress, need_approval→needs_owner_approval, done+artifact→in_review, done tanpa artifact→in_progress, failed→todo", () => {
      expect(mapDesktopJobStatusToBinderTaskStatus("queued", false)).toBe("todo");
      expect(mapDesktopJobStatusToBinderTaskStatus("running", false)).toBe("in_progress");
      expect(mapDesktopJobStatusToBinderTaskStatus("need_approval", false)).toBe("needs_owner_approval");
      expect(mapDesktopJobStatusToBinderTaskStatus("done", true)).toBe("in_review");
      expect(mapDesktopJobStatusToBinderTaskStatus("done", false)).toBe("in_progress");
      expect(mapDesktopJobStatusToBinderTaskStatus("failed", false)).toBe("todo");
    });

    it("getDesktopJobStatus: job running → peta in_progress, task tetap In Progress", async () => {
      const job = await createJob();
      const status = await getDesktopJobStatus(db, { companyId, jobId: job.id });
      expect(status.job.status).toBe("running");
      expect(status.binderTaskStatus).toBe("in_progress");
      expect(status.taskBinderStatus).toBe("in_progress");
    });

    it("need_approval: job running → need_approval, peta needs_owner_approval", async () => {
      const job = await createJob();
      const marked = await markDesktopJobNeedsApproval(db, {
        companyId,
        jobId: job.id,
        reason: "Butuh vonis owner sebelum lanjut",
      });
      expect(marked.status).toBe("need_approval");
      const status = await getDesktopJobStatus(db, { companyId, jobId: job.id });
      expect(status.binderTaskStatus).toBe("needs_owner_approval");
      expect(status.taskBinderStatus).toBe("in_progress");
    });
  });

  describe("returnDesktopArtifact — artifact kembali", () => {
    it("tanpa artifact → ditolak; task tidak masuk In Review", async () => {
      const job = await createJob();
      await expect(
        returnDesktopArtifact(db, adapter, { companyId, jobId: job.id, artifacts: [] }),
      ).rejects.toThrow(/minimal satu artifact/);
      expect(await binderStatus(issueId)).toBe("in_progress");
      const [row] = await db.select().from(binderDesktopJobs).where(eq(binderDesktopJobs.id, job.id));
      expect(row.status).toBe("running");
    });

    it("artifact kembali: job done + work product + task In Review + biaya ke ledger + VM dihentikan", async () => {
      const job = await createJob();
      const result = await returnDesktopArtifact(db, adapter, {
        companyId,
        jobId: job.id,
        artifacts: [
          { kind: "file", title: "Hasil GUI TEST", summary: "File hasil slice GUI" },
          { kind: "screenshot", title: "Bukti tampilan TEST", summary: "Screenshot verifikasi" },
          { kind: "log", title: "Log ringkas TEST", summary: "Log 12 baris" },
        ],
        costs: { vmCents: "120", tokenCents: "80", toolsCents: "0" },
        note: "Slice GUI selesai",
      });
      expect(result.job.status).toBe("done");
      expect(result.artifactIds).toHaveLength(3);
      expect(result.reviewPending).toBeNull();
      expect(result.taskBinderStatus).toBe("in_review");
      expect(result.job.vmStoppedAt).not.toBeNull();
      expect(adapter.stoppedVms).toContain(job.vmId);
      const products = await db
        .select()
        .from(issueWorkProducts)
        .where(and(eq(issueWorkProducts.companyId, companyId), eq(issueWorkProducts.issueId, issueId)));
      expect(products).toHaveLength(3);
      expect(products[0].type).toBe("binder_desktop_artifact");
      // Biaya $2.00 tercatat: pool $20 → $18; amplop $10 → terpakai $2.
      const pool = await getBinderPool(db, companyId);
      expect(pool?.balanceCents).toBe("1800.0000000");
      const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.companyId, companyId));
      const usage = entries.filter((e) => e.kind === "usage");
      expect(usage).toHaveLength(2);
      const recon = await reconcileBinderLedger(db, companyId);
      expect(recon.differenceCents).toBe("0.0000000");
    });

    it("tanpa QC yang bisa ditugaskan: job done + artifact tercatat, task tetap In Progress + alasan dicatat", async () => {
      // Company kedua tanpa QC roster.
      const [company2] = await db
        .insert(companies)
        .values({ name: randomName("Tanpa QC"), issuePrefix: `TQ${Math.floor(Math.random() * 1_000_000)}` })
        .returning();
      const [project2] = await db.insert(projects).values({ companyId: company2.id, name: "P2 TEST" }).returning();
      const [issue2] = await db.insert(issues).values({ companyId: company2.id, projectId: project2.id, title: "T2 TEST" }).returning();
      const [maker2] = await db.insert(agents).values({ companyId: company2.id, name: "Maker2 TEST", role: "general" }).returning();
      await registerAgentModel(db, { companyId: company2.id, agentId: maker2.id, modelFamily: "meta", modelId: "muse-spark-1.3" });
      const [approval2] = await db
        .insert(approvals)
        .values({ companyId: company2.id, type: "binder_pool_topup", status: "approved", payload: {} })
        .returning();
      await topUpBinderPool(db, { companyId: company2.id, amountCents: "2000", approvalId: approval2.id });
      await createBinderTask(db, { companyId: company2.id, projectId: project2.id, issueId: issue2.id, ownerAgentId: maker2.id, dod: "DoD TEST" });
      await transitionBinderTask(db, {
        companyId: company2.id,
        issueId: issue2.id,
        toStatus: "todo",
        expectedStatusVersion: await issueStatusVersion(issue2.id),
      });
      const job = await createDesktopJob(db, adapter, {
        companyId: company2.id,
        issueId: issue2.id,
        agentId: maker2.id,
        createdByAgentId: ceoId,
        runtime: "test_double",
      });
      const result = await returnDesktopArtifact(db, adapter, {
        companyId: company2.id,
        jobId: job.id,
        artifacts: [{ kind: "file", title: "Hasil TEST" }],
      });
      expect(result.job.status).toBe("done");
      expect(result.artifactIds).toHaveLength(1);
      expect(result.taskBinderStatus).toBe("in_progress");
      expect(result.reviewPending).toMatch(/QC/);
      expect(result.job.reviewPendingReason).toMatch(/QC/);
    });
  });

  describe("failDesktopJob / timeoutDesktopJob / retryDesktopJob", () => {
    it("job gagal: checkpoint disimpan, task kembali ke Todo, VM dihentikan, biaya dicatat", async () => {
      const job = await createJob();
      const failed = await failDesktopJob(db, adapter, {
        companyId,
        jobId: job.id,
        reason: "Aplikasi GUI crash di tengah slice",
        checkpointNote: "Checkpoint: 3 dari 5 langkah selesai",
        costs: { vmCents: "60", tokenCents: "40" },
      });
      expect(failed.status).toBe("failed");
      expect(failed.failureNote).toBe("Aplikasi GUI crash di tengah slice");
      expect(failed.checkpointNote).toBe("Checkpoint: 3 dari 5 langkah selesai");
      expect(failed.vmStoppedAt).not.toBeNull();
      expect(adapter.stoppedVms).toContain(job.vmId);
      expect(await binderStatus(issueId)).toBe("todo");
      const pool = await getBinderPool(db, companyId);
      expect(pool?.balanceCents).toBe("1900.0000000");
    });

    it("VM timeout: job failed + label timeout + task ke Todo + VM dihentikan", async () => {
      const job = await createJob();
      const timedOut = await timeoutDesktopJob(db, adapter, {
        companyId,
        jobId: job.id,
        reason: "idle 600 dtk",
        checkpointNote: "Checkpoint terakhir: form terisi setengah",
      });
      expect(timedOut.status).toBe("failed");
      expect(timedOut.failureNote).toMatch(/VM timeout: idle 600 dtk/);
      expect(timedOut.checkpointNote).toBe("Checkpoint terakhir: form terisi setengah");
      expect(await binderStatus(issueId)).toBe("todo");
      expect(adapter.stoppedVms).toContain(job.vmId);
    });

    it("job done tidak bisa digagalkan; job gagal tidak bisa dikembalikan artifact", async () => {
      const job = await createJob();
      await returnDesktopArtifact(db, adapter, {
        companyId,
        jobId: job.id,
        artifacts: [{ kind: "file", title: "Hasil TEST" }],
      });
      await expect(
        failDesktopJob(db, adapter, { companyId, jobId: job.id, reason: "terlambat" }),
      ).rejects.toThrow(/Hanya job queued\/running\/need_approval/);
      // Bagian B — job yang sudah failed, di task BINDER kedua (task pertama
      // sudah In Review dan tidak bisa dibuatkan job baru).
      const [issue2] = await db.insert(issues).values({ companyId, projectId, title: "T2 TEST" }).returning();
      await createBinderTask(db, { companyId, projectId, issueId: issue2.id, ownerAgentId: makerId, dod: "DoD TEST" });
      await transitionBinderTask(db, {
        companyId,
        issueId: issue2.id,
        toStatus: "todo",
        expectedStatusVersion: await issueStatusVersion(issue2.id),
      });
      const job2 = await createDesktopJob(db, adapter, {
        companyId,
        issueId: issue2.id,
        agentId: makerId,
        createdByAgentId: ceoId,
        runtime: "test_double",
      });
      await failDesktopJob(db, adapter, { companyId, jobId: job2.id, reason: "gagal" });
      await expect(
        returnDesktopArtifact(db, adapter, {
          companyId,
          jobId: job2.id,
          artifacts: [{ kind: "file", title: "Hasil TEST" }],
        }),
      ).rejects.toThrow(/Hanya job running\/need_approval/);
    });

    it("retry tanpa persetujuan CEO ditolak; dengan CEO → attempt 2, job baru running", async () => {
      const job = await createJob();
      await failDesktopJob(db, adapter, { companyId, jobId: job.id, reason: "gagal sekali" });
      await expect(
        retryDesktopJob(db, adapter, { companyId, jobId: job.id, approvedByCeoAgentId: makerId }),
      ).rejects.toThrow(/Hanya CEO/);
      const retried = await retryDesktopJob(db, adapter, { companyId, jobId: job.id, approvedByCeoAgentId: ceoId });
      expect(retried.attempt).toBe(2);
      expect(retried.status).toBe("running");
      expect(retried.binderTaskId).toBe(job.binderTaskId);
      expect(retried.id).not.toBe(job.id);
      expect(await binderStatus(issueId)).toBe("todo");
      // Retry job yang tidak gagal ditolak.
      await expect(
        retryDesktopJob(db, adapter, { companyId, jobId: retried.id, approvedByCeoAgentId: ceoId }),
      ).rejects.toThrow(/Hanya job failed/);
    });
  });

  describe("stopVm", () => {
    it("hentikan VM job running; panggilan kedua idempotent", async () => {
      const job = await createJob();
      const stopped = await stopVm(db, adapter, { companyId, jobId: job.id });
      expect(stopped.vmStoppedAt).not.toBeNull();
      expect(adapter.stoppedVms).toContain(job.vmId);
      const again = await stopVm(db, adapter, { companyId, jobId: job.id });
      expect(again.vmStoppedAt).toEqual(stopped.vmStoppedAt);
      expect(adapter.stoppedVms.filter((v) => v === job.vmId)).toHaveLength(1);
    });
  });

  describe("Gate — matriks bypass approval 5×2 (NOL LOLOS)", () => {
    const kinds = ["kirim", "publish", "bayar", "ubah_akses", "deploy"] as const;

    it("10/10 ditolak: 5 jalur normal tanpa approved_action_id + 5 bypass langsung tanpa keputusan Gate", async () => {
      for (const kind of kinds) {
        // (a) Jalur normal: bot meminta aksi lewat Gate tanpa approved_action_id.
        const decision = await gateCheck(db, {
          companyId,
          issueId,
          agentId: makerId,
          actionKind: kind,
        });
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/approved_action_id kosong/);
        // (b) Bypass langsung: bot memanggil executor tanpa keputusan Gate.
        await expect(
          executeExternalActionViaGate(db, executor, {
            companyId,
            issueId,
            agentId: makerId,
            actionKind: kind,
            gateDecision: null,
          }),
        ).rejects.toThrow(/tanpa keputusan Gate/);
      }
      // NOL eksekusi tercatat di executor; 10 penolakan tercatat di log Gate.
      expect(executor.executions).toHaveLength(0);
      const denied = await deniedDecisions();
      expect(denied).toHaveLength(10);
      for (const kind of kinds) {
        expect(denied.filter((d) => d.actionKind === kind)).toHaveLength(2);
      }
      // Activity log juga mencatat 10 penolakan.
      const deniedActivities = await db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "binder.gate.denied")));
      expect(deniedActivities.length).toBeGreaterThanOrEqual(10);
    });

    it("keputusan Gate yang menolak tidak bisa dipakai executor", async () => {
      const decision = await gateCheck(db, { companyId, issueId, agentId: makerId, actionKind: "publish" });
      expect(decision.allowed).toBe(false);
      await expect(
        executeExternalActionViaGate(db, executor, {
          companyId,
          issueId,
          agentId: makerId,
          actionKind: "publish",
          gateDecision: decision,
        }),
      ).rejects.toThrow(/Keputusan Gate menolak/);
      expect(executor.executions).toHaveLength(0);
    });
  });

  describe("Gate — approved_action_id valid + aturan peran + pagu + scope", () => {
    it("alur penuh: id valid → Gate IZIN → executor jalan 1x → id jadi used → pakai kedua ditolak", async () => {
      const action = await makeApprovedAction("external_post");
      const decision = await gateCheck(db, {
        companyId,
        issueId,
        agentId: makerId,
        actionKind: "publish",
        approvedActionId: action.id,
      });
      expect(decision.allowed).toBe(true);
      const result = await executeExternalActionViaGate(db, executor, {
        companyId,
        issueId,
        agentId: makerId,
        actionKind: "publish",
        gateDecision: decision,
        payload: { draftId: "draft-1" },
      });
      expect(result.executed).toBe(true);
      expect(result.transportRef).toMatch(/^transport-test-/);
      expect(executor.executions).toHaveLength(1);
      // Sekali pakai: Gate kedua dengan id yang sama ditolak.
      const second = await gateCheck(db, {
        companyId,
        issueId,
        agentId: makerId,
        actionKind: "publish",
        approvedActionId: action.id,
      });
      expect(second.allowed).toBe(false);
      expect(second.reason).toMatch(/berstatus used/);
      // Keputusan IZIN yang lama tidak bisa dipakai ulang (executor validasi ulang).
      await expect(
        executeExternalActionViaGate(db, executor, {
          companyId,
          issueId,
          agentId: makerId,
          actionKind: "publish",
          gateDecision: decision,
        }),
      ).rejects.toThrow(/sudah tidak berlaku/);
      expect(executor.executions).toHaveLength(1);
    });

    it("id terikat task lain → ditolak (tidak cocok task_id)", async () => {
      const [other] = await db
        .insert(issues)
        .values({ companyId, projectId, title: `Tugas lain ${TEST_NOTE}` })
        .returning();
      const action = await makeApprovedAction("external_post", { issue: other.id });
      const decision = await gateCheck(db, {
        companyId,
        issueId,
        agentId: makerId,
        actionKind: "publish",
        approvedActionId: action.id,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/tidak cocok dengan task_id/);
    });

    it("jenis id tidak mencakup jenis aksi → ditolak (post id untuk bayar)", async () => {
      const action = await makeApprovedAction("external_post");
      const decision = await gateCheck(db, {
        companyId,
        issueId,
        agentId: makerId,
        actionKind: "bayar",
        approvedActionId: action.id,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/tidak mencakup jenis aksi bayar/);
    });

    it("id kedaluwarsa → ditolak; id dicabut → ditolak", async () => {
      const expired = await makeApprovedAction("external_post", {
        expiresAt: new Date(Date.now() - 60_000),
      });
      const d1 = await gateCheck(db, {
        companyId,
        issueId,
        agentId: makerId,
        actionKind: "publish",
        approvedActionId: expired.id,
      });
      expect(d1.allowed).toBe(false);
      expect(d1.reason).toMatch(/kedaluwarsa/);
      const action = await makeApprovedAction("external_post");
      await revokeApprovedAction(db, { companyId, approvedActionId: action.id, revokedByUserId: OWNER_USER_ID });
      const d2 = await gateCheck(db, {
        companyId,
        issueId,
        agentId: makerId,
        actionKind: "publish",
        approvedActionId: action.id,
      });
      expect(d2.allowed).toBe(false);
      expect(d2.reason).toMatch(/berstatus revoked/);
    });

    it("scopeRef tidak cocok → ditolak sebagai di luar scope; cocok → diizinkan", async () => {
      const action = await makeApprovedAction("external_post", { scopeRef: "draft-1" });
      const wrong = await gateCheck(db, {
        companyId,
        issueId,
        agentId: makerId,
        actionKind: "publish",
        approvedActionId: action.id,
        scopeRef: "draft-2",
      });
      expect(wrong.allowed).toBe(false);
      expect(wrong.reason).toMatch(/di luar scope/);
      const right = await gateCheck(db, {
        companyId,
        issueId,
        agentId: makerId,
        actionKind: "publish",
        approvedActionId: action.id,
        scopeRef: "draft-1",
      });
      expect(right.allowed).toBe(true);
    });

    it("Leads Generator: aksi eksternal ditolak walau ada id valid (tanpa pengecualian)", async () => {
      const action = await makeApprovedAction("outreach_send");
      const decision = await gateCheck(db, {
        companyId,
        issueId,
        agentId: leadsId,
        actionKind: "kirim",
        approvedActionId: action.id,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/Leads Generator dilarang/);
    });

    it("Finance: bayar ditolak walau ada id valid (tanpa pengecualian)", async () => {
      const action = await makeApprovedAction("other");
      const decision = await gateCheck(db, {
        companyId,
        issueId,
        agentId: financeId,
        actionKind: "bayar",
        approvedActionId: action.id,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/Finance dilarang/);
    });

    it("Code Builder: deploy tanpa id ditolak; dengan id 'other' yang valid diizinkan", async () => {
      const denied = await gateCheck(db, {
        companyId,
        issueId,
        agentId: codeBuilderId,
        actionKind: "deploy",
      });
      expect(denied.allowed).toBe(false);
      const action = await makeApprovedAction("other");
      const allowed = await gateCheck(db, {
        companyId,
        issueId,
        agentId: codeBuilderId,
        actionKind: "deploy",
        approvedActionId: action.id,
      });
      expect(allowed.allowed).toBe(true);
    });

    it("pagu habis → ditolak; pagu belum dipatok (null) → tidak ditolak atas dasar pagu", () => {
      const base = {
        agentRole: "general",
        actionKind: "publish" as const,
        approvedAction: {
          id: "00000000-0000-0000-0000-000000000001",
          valid: true,
          invalidReason: null,
          matchesTask: true,
          kindCovers: true,
          scopeOk: true,
        },
      };
      expect(gateCheckPure({ ...base, budgetRemainingCents: "0" }).allowed).toBe(false);
      expect(gateCheckPure({ ...base, budgetRemainingCents: "0" }).reason).toMatch(/Pagu habis/);
      expect(gateCheckPure({ ...base, budgetRemainingCents: null }).allowed).toBe(true);
      expect(gateCheckPure({ ...base, budgetRemainingCents: "100" }).allowed).toBe(true);
    });
  });

  describe("isolasi plugin — endpoint berubah", () => {
    it("createVm gagal karena endpoint berubah: job tercatat failed, tidak done, Gate tetap menolak", async () => {
      adapter.endpointChanged = true;
      await expect(createJob()).rejects.toThrow(/endpoint plugin berubah/);
      const jobs = await db.select().from(binderDesktopJobs).where(eq(binderDesktopJobs.companyId, companyId));
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe("failed");
      expect(jobs[0].failureNote).toMatch(/endpoint plugin berubah/);
      expect(jobs[0].artifactsReturned).toEqual([]);
      // Tidak ada aksi eksternal yang lolos tanpa Gate sesudah kegagalan plugin.
      const decision = await gateCheck(db, { companyId, issueId, agentId: makerId, actionKind: "kirim" });
      expect(decision.allowed).toBe(false);
      await expect(
        executeExternalActionViaGate(db, executor, {
          companyId,
          issueId,
          agentId: makerId,
          actionKind: "kirim",
          gateDecision: null,
        }),
      ).rejects.toThrow(/tanpa keputusan Gate/);
      expect(executor.executions).toHaveLength(0);
    });

    it("stopVm gagal karena endpoint berubah: vmStopFailed dicatat + error dilempar", async () => {
      const job = await createJob();
      adapter.endpointChanged = true;
      await expect(stopVm(db, adapter, { companyId, jobId: job.id })).rejects.toThrow(/gagal dihentikan/);
      const [row] = await db.select().from(binderDesktopJobs).where(eq(binderDesktopJobs.id, job.id));
      expect(row.vmStopFailed).toBe(true);
      expect(row.vmStoppedAt).toBeNull();
    });
  });

  describe("gateCheckPure — aturan murni", () => {
    it("menolak tanpa id, id tidak valid, tidak cocok task, tidak mencakup jenis, di luar scope — berurutan", () => {
      const noId = gateCheckPure({
        agentRole: "general",
        actionKind: "kirim",
        approvedAction: null,
        budgetRemainingCents: "1000",
      });
      expect(noId).toEqual({ allowed: false, reason: "approved_action_id kosong untuk aksi eksternal" });
      const invalid = gateCheckPure({
        agentRole: "general",
        actionKind: "kirim",
        approvedAction: { id: "x", valid: false, invalidReason: "tidak ditemukan", matchesTask: true, kindCovers: true, scopeOk: true },
        budgetRemainingCents: "1000",
      });
      expect(invalid.reason).toMatch(/tidak ditemukan/);
      const mismatch = gateCheckPure({
        agentRole: "general",
        actionKind: "kirim",
        approvedAction: { id: "x", valid: true, invalidReason: null, matchesTask: false, kindCovers: true, scopeOk: true },
        budgetRemainingCents: "1000",
      });
      expect(mismatch.reason).toMatch(/tidak cocok dengan task_id/);
      const noCover = gateCheckPure({
        agentRole: "general",
        actionKind: "bayar",
        approvedAction: { id: "x", valid: true, invalidReason: null, matchesTask: true, kindCovers: false, scopeOk: true },
        budgetRemainingCents: "1000",
      });
      expect(noCover.reason).toMatch(/tidak mencakup jenis aksi bayar/);
      const outOfScope = gateCheckPure({
        agentRole: "general",
        actionKind: "publish",
        approvedAction: { id: "x", valid: true, invalidReason: null, matchesTask: true, kindCovers: true, scopeOk: false },
        budgetRemainingCents: "1000",
      });
      expect(outOfScope.reason).toMatch(/di luar scope/);
    });
  });
});

/**
 * TEST DOUBLE — adapter runtime desktop palsu (BUKAN VM nyata).
 * Mencatat panggilan create/stop; bisa disetel gagal seolah endpoint
 * plugin berubah. Tidak pernah menjalankan container atau menyentuh
 * jaringan.
 */
class FakeDesktopRuntimeAdapter implements DesktopRuntimeAdapter {
  name = "test-double";
  contractVersion = "1";
  createdVms: string[] = [];
  stoppedVms: string[] = [];
  endpointChanged = false;
  private counter = 0;

  async createVm(input: { companyId: string; jobId: string; binderTaskId: string; runtime: string }) {
    void input;
    if (this.endpointChanged) {
      throw new PluginEndpointChangedError("endpoint plugin /v2/jobs berubah (simulasi)");
    }
    this.counter += 1;
    const vmId = `vm-test-${this.counter}`;
    this.createdVms.push(vmId);
    return { vmId };
  }

  async stopVm(vmId: string) {
    if (this.endpointChanged) {
      throw new PluginEndpointChangedError("endpoint plugin /v2/vm/stop berubah (simulasi)");
    }
    this.stoppedVms.push(vmId);
  }
}

/**
 * TEST DOUBLE — executor aksi eksternal palsu (TIDAK PERNAH benar-benar
 * mengirim/publish/membayar). Mencatat eksekusi yang diizinkan Gate.
 */
class FakeExternalExecutor implements ExternalActionExecutor {
  name = "test-double-executor";
  executions: Array<{ companyId: string; issueId: string; actionKind: string; transportRef: string }> = [];
  private counter = 0;

  async execute(input: { companyId: string; issueId: string; actionKind: string; payload?: Record<string, unknown> }) {
    void input.payload;
    this.counter += 1;
    const transportRef = `transport-test-${this.counter}`;
    this.executions.push({
      companyId: input.companyId,
      issueId: input.issueId,
      actionKind: input.actionKind,
      transportRef,
    });
    return { transportRef };
  }
}
