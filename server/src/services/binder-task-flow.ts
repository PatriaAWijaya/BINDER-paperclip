import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  agents,
  approvals,
  binderAgentModels,
  binderApprovedActions,
  binderQcAssignments,
  binderQcRoster,
  binderQcScores,
  binderTasks,
  issueApprovals,
  issueComments,
  issueWorkProducts,
  issues,
  projects,
  type BinderApprovedAction,
  type BinderQcAssignment,
  type BinderTask,
  type Db,
} from "@paperclipai/db";
import {
  BINDER_APPROVED_ACTION_KINDS,
  BINDER_QC_MAX_REVISIONS,
  BINDER_QC_PASS_SCORE,
  BINDER_QC_REVIEW_COST_CENTS,
  BINDER_QC_RUBRIC_MAX,
  BINDER_TASK_ISSUE_STATUS_MIRROR,
  BINDER_TASK_TRANSITIONS,
  type BinderAgentModelInput,
  type BinderApprovedActionId,
  type BinderApprovedActionKind,
  type BinderApproveTask,
  type BinderCreateTask,
  type BinderIssueApprovedAction,
  type BinderModelFamily,
  type BinderRegisterQcReviewer,
  type BinderRejectTask,
  type BinderRequestApprovedAction,
  type BinderResolveEscalation,
  type BinderRevokeApprovedAction,
  type BinderSubmitQcScore,
  type BinderSubmitWork,
  type BinderTaskStatus,
  type BinderTransitionTask,
} from "@paperclipai/shared";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";
import { withOperationAccountingTransaction } from "./accounting-transaction.js";
import { lockBudgetAdmissionControls } from "./budget-admission-controls.js";
import { withBudgetSpan } from "./budget-tracing.js";
import { chargeBinderUsageInTransaction, checkBinderFundingAdmission } from "./binder-funding.js";

/**
 * Alur task + QC + approved_action_id BINDER
 * (PRD Bab 3 / Bab 6.4; rencana Tahap 3 Fase 3.3; P0-1/2/3, P1-11/19).
 *
 * Mesin status (BINDER_TASK_TRANSITIONS): Backlog → Todo → In Progress →
 * In Review (QC) → Butuh Approval Patria → Done/Cancelled; Revisi sesudah
 * QC gagal (maks 2 putaran, lalu eskalasi); Eskalasi = owner memutuskan.
 * - Keluar dari In Review HANYA lewat submitQcScore; masuk ke In Review
 *   HANYA lewat submitWorkForReview (wajib artifact utama).
 * - Vonis owner HANYA lewat approve/reject/resolve (tercatat decidedBy).
 * - Transisi memakai atomic checkout `issues.status_version` (CAS):
 *   pemanggil wajib membawa versi yang ia baca; versi basi → conflict.
 * - `issues.status` dicerminkan ke status Paperclip terdekat supaya board
 *   / query yang sudah ada tetap jalan (BINDER_TASK_ISSUE_STATUS_MIRROR).
 * - QC (P0-1): pool ditunjuk eksplisit, beda family dari maker,
 *   round-robin, CEO tidak pernah di pool, reviewer tidak mengulang task
 *   yang sama. Rubrik (P0-3) 30/25/25/20, lolos ≥ 75 + nol hard violation
 *   (P0-2); lembar skor = artifact. Biaya QC ke pool, BUKAN amplop (P1-10).
 * - `approved_action_id` (P1-11): Core menerbitkan atas vonis owner;
 *   sekali pakai; penegakan di jalur aksi eksternal adalah Tahap 5.
 * - Transkrip (`issue_comments`, author system) + activity log dicatat
 *   untuk tiap peristiwa; isinya hanya id, status, angka, alasan singkat
 *   — tidak pernah secret, prompt, atau isi artifact (P1-24).
 * - Semua mutasi berjalan dalam `withOperationAccountingTransaction`
 *   (repeatable-read + retry) dengan urutan kunci yang sama seperti mesin
 *   budget (`lockBudgetAdmissionControls`).
 */

type LoadedTask = { task: BinderTask; issue: typeof issues.$inferSelect };

async function loadBinderTaskForUpdate(
  tx: Db,
  companyId: string,
  issueId: string,
): Promise<LoadedTask> {
  const [task] = await tx
    .select()
    .from(binderTasks)
    .where(and(eq(binderTasks.companyId, companyId), eq(binderTasks.issueId, issueId)))
    .for("update");
  if (!task) throw notFound("Binder task not found");
  const [issue] = await tx
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
    .for("update");
  if (!issue) throw notFound("Task not found");
  return { task, issue };
}

/**
 * Transkrip BINDER: insert langsung ke `issue_comments` (bukan
 * `insertIssueComment`) supaya tidak memicu mesin notifikasi Paperclip
 * (status card / recovery / delivery) — transkrip ini audit-only.
 */
async function appendBinderTranscript(
  tx: Db,
  input: { companyId: string; issueId: string; body: string; authorAgentId?: string | null },
): Promise<void> {
  await tx.insert(issueComments).values({
    companyId: input.companyId,
    issueId: input.issueId,
    authorAgentId: input.authorAgentId ?? null,
    authorType: "system",
    body: input.body,
  });
}

async function noteBinderActivity(
  tx: Db,
  publications: ActivityPublication[],
  input: {
    companyId: string;
    action: string;
    entityType: string;
    entityId: string;
    issueId?: string | null;
    details: Record<string, unknown>;
  },
): Promise<void> {
  await logActivity(
    tx,
    {
      companyId: input.companyId,
      actorType: "system",
      actorId: "binder-task-flow",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      issueId: input.issueId ?? undefined,
      details: input.details,
    },
    publications,
  );
}

async function agentDisplayName(tx: Db, agentId: string): Promise<string> {
  const [agent] = await tx.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId));
  return agent?.name ?? `agent:${agentId.slice(0, 8)}`;
}

/**
 * Mesin transisi: validasi arah → CAS `status_version` → cermin
 * `issues.status` → catat transkrip + activity. Dipakai semua jalur
 * (generik, QC, vonis owner) supaya aturannya satu tempat.
 */
async function applyBinderTransition(
  tx: Db,
  publications: ActivityPublication[],
  input: {
    task: BinderTask;
    issue: typeof issues.$inferSelect;
    toStatus: BinderTaskStatus;
    expectedStatusVersion: number;
    actorUserId?: string | null;
    actorAgentId?: string | null;
    reason?: string | null;
    revisionRound?: number | null;
    resetRevisionRound?: boolean;
  },
): Promise<LoadedTask> {
  const from = input.task.binderStatus as BinderTaskStatus;
  const allowed = BINDER_TASK_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.toStatus)) {
    throw conflict(`Transisi task ${from} → ${input.toStatus} tidak diizinkan`);
  }
  const now = new Date();
  const [updatedIssue] = await tx
    .update(issues)
    .set({
      status: BINDER_TASK_ISSUE_STATUS_MIRROR[input.toStatus],
      statusVersion: sql`${issues.statusVersion} + 1`,
      startedAt:
        input.toStatus === "in_progress" && !input.issue.startedAt ? now : input.issue.startedAt,
      completedAt: input.toStatus === "done" ? now : input.issue.completedAt,
      cancelledAt: input.toStatus === "cancelled" ? now : input.issue.cancelledAt,
      updatedAt: now,
    })
    .where(
      and(eq(issues.id, input.issue.id), eq(issues.statusVersion, input.expectedStatusVersion)),
    )
    .returning();
  if (!updatedIssue) {
    throw conflict(
      "Status task berubah oleh pihak lain (statusVersion tidak cocok) — muat ulang lalu coba lagi",
    );
  }
  const revisionRound = input.resetRevisionRound
    ? 0
    : (input.revisionRound ?? input.task.revisionRound);
  const [updatedTask] = await tx
    .update(binderTasks)
    .set({ binderStatus: input.toStatus, revisionRound, updatedAt: now })
    .where(eq(binderTasks.id, input.task.id))
    .returning();
  const actor = input.actorAgentId
    ? await agentDisplayName(tx, input.actorAgentId)
    : (input.actorUserId ?? "system");
  await appendBinderTranscript(tx, {
    companyId: input.task.companyId,
    issueId: input.issue.id,
    body: `[BINDER] Status task: ${from} → ${input.toStatus}${input.reason ? ` — ${input.reason}` : ""} (oleh ${actor})`,
    authorAgentId: input.actorAgentId ?? null,
  });
  await noteBinderActivity(tx, publications, {
    companyId: input.task.companyId,
    action: "binder.task.transition",
    entityType: "binder_task",
    entityId: input.task.id,
    issueId: input.issue.id,
    details: { fromStatus: from, toStatus: input.toStatus, revisionRound },
  });
  return { task: updatedTask, issue: updatedIssue };
}

/** Baca satu task BINDER (tanpa lock). */
export async function getBinderTask(
  tx: Db,
  companyId: string,
  issueId: string,
): Promise<BinderTask | null> {
  const [task] = await tx
    .select()
    .from(binderTasks)
    .where(and(eq(binderTasks.companyId, companyId), eq(binderTasks.issueId, issueId)));
  return task ?? null;
}

/**
 * Buat task BINDER dari sebuah issue. Issue harus masih 'backlog';
 * owner disamakan dengan assignee issue (invarian single-assignee);
 * task wajib terikat project (ledger QC butuh project).
 */
export async function createBinderTask(db: Db, input: BinderCreateTask) {
  return withBudgetSpan("binder.task.create", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId, input.projectId ?? null);
      const [issue] = await tx
        .select()
        .from(issues)
        .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)))
        .for("update");
      if (!issue) throw notFound("Task not found");
      if (issue.status !== "backlog") {
        throw conflict(
          `Task BINDER hanya bisa dibuat dari issue berstatus backlog (saat ini: ${issue.status})`,
        );
      }
      const [existing] = await tx
        .select({ id: binderTasks.id })
        .from(binderTasks)
        .where(
          and(eq(binderTasks.companyId, input.companyId), eq(binderTasks.issueId, input.issueId)),
        );
      if (existing) throw conflict("Issue ini sudah menjadi task BINDER");
      const [owner] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, input.ownerAgentId), eq(agents.companyId, input.companyId)));
      if (!owner) throw notFound("Owner agent not found");
      const projectId = input.projectId ?? issue.projectId;
      if (!projectId) throw badRequest("Task BINDER wajib terikat project");
      if (issue.projectId && issue.projectId !== projectId) {
        throw badRequest("Task tidak termasuk project yang diberikan");
      }
      if (issue.assigneeAgentId && issue.assigneeAgentId !== input.ownerAgentId) {
        throw conflict("Owner task BINDER harus sama dengan assignee issue");
      }
      // Samakan assignee + project issue dengan task (satu owner, satu project).
      await tx
        .update(issues)
        .set({
          assigneeAgentId: issue.assigneeAgentId ?? input.ownerAgentId,
          projectId: issue.projectId ?? projectId,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issue.id));
      const [task] = await tx
        .insert(binderTasks)
        .values({
          companyId: input.companyId,
          projectId,
          issueId: input.issueId,
          ownerAgentId: input.ownerAgentId,
          dod: input.dod,
        })
        .returning();
      const ownerName = await agentDisplayName(tx, input.ownerAgentId);
      await appendBinderTranscript(tx, {
        companyId: input.companyId,
        issueId: input.issueId,
        body: `[BINDER] Task dibuat — owner: ${ownerName}. DoD: ${input.dod}`,
        authorAgentId: input.ownerAgentId,
      });
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.task.created",
        entityType: "binder_task",
        entityId: task.id,
        issueId: input.issueId,
        details: { ownerAgentId: input.ownerAgentId, projectId },
      });
      return task;
    }),
  );
}

/**
 * Transisi generik (operator menggerakkan pekerjaan). Jalur khusus DITOLAK
 * di sini dan wajib lewat fungsinya masing-masing: keluar/masuk In Review
 * (QC), vonis owner (approve/reject), keputusan eskalasi.
 * Masuk ke 'todo'/'in_progress' memeriksa admission pendanaan (pool +
 * amplop) — diblokir bila pool habis / amplop belum disetujui / habis.
 */
export async function transitionBinderTask(db: Db, input: BinderTransitionTask) {
  return withBudgetSpan("binder.task.transition", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const { task, issue } = await loadBinderTaskForUpdate(tx, input.companyId, input.issueId);
      const from = task.binderStatus as BinderTaskStatus;
      if (from === "in_review") {
        throw conflict("Keluar dari In Review hanya lewat submitQcScore");
      }
      if (input.toStatus === "in_review") {
        throw conflict("Masuk ke In Review hanya lewat submitWorkForReview (wajib artifact utama)");
      }
      if (from === "needs_owner_approval" && input.toStatus === "done") {
        throw conflict("Persetujuan owner hanya lewat approveBinderTaskByOwner");
      }
      if (from === "needs_owner_approval" && input.toStatus === "revision") {
        throw conflict("Penolakan owner hanya lewat rejectBinderTaskByOwner");
      }
      if (from === "escalated") {
        throw conflict("Keputusan eskalasi hanya lewat resolveEscalatedTaskByOwner");
      }
      if (input.toStatus === "todo" || input.toStatus === "in_progress") {
        const blockReason = await checkBinderFundingAdmission(tx, input.companyId, input.issueId);
        if (blockReason) throw conflict(blockReason);
      }
      return applyBinderTransition(tx, publications, {
        task,
        issue,
        toStatus: input.toStatus,
        expectedStatusVersion: input.expectedStatusVersion,
        actorUserId: input.actorUserId ?? null,
        actorAgentId: input.actorAgentId ?? null,
        reason: input.reason ?? null,
      });
    }),
  );
}

/**
 * Maker mengajukan artifact utama ke review: tetapkan artifact sebagai
 * satu-satunya primary, lalu tugaskan QC (nomor putaran = jumlah pengajuan
 * QC sebelumnya untuk task ini + 1 — monotonik; anggaran revisi maks 2x
 * dihitung terpisah dari revisionRound)
 * dan pindah ke In Review. Gagal bila tidak ada QC yang memenuhi syarat
 * (fail-closed — QC wajib, bukan opsional).
 */
export async function submitWorkForReview(db: Db, input: BinderSubmitWork) {
  return withBudgetSpan("binder.task.submit_work", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const { task, issue } = await loadBinderTaskForUpdate(tx, input.companyId, input.issueId);
      if (task.binderStatus !== "in_progress") {
        throw conflict(
          `Hanya task In Progress yang bisa diajukan ke review (saat ini: ${task.binderStatus})`,
        );
      }
      const [artifact] = await tx
        .select()
        .from(issueWorkProducts)
        .where(
          and(
            eq(issueWorkProducts.id, input.artifactWorkProductId),
            eq(issueWorkProducts.companyId, input.companyId),
            eq(issueWorkProducts.issueId, input.issueId),
          ),
        )
        .for("update");
      if (!artifact) throw notFound("Artifact tidak ditemukan untuk task ini");
      // Anggaran revisi (maks 2) dihitung dari revisionRound — yang di-reset
      // saat owner memutuskan eskalasi dengan resume. Nomor putaran QC
      // sendiri MONOTONIK per task (jumlah pengajuan sebelumnya + 1):
      // sesudah resume, pengajuan berikutnya adalah putaran ke-3 dst, bukan
      // putaran 1 lagi — karena unique (company, issue, round) melarang dua
      // penugasan dengan nomor putaran yang sama untuk satu task.
      if (task.revisionRound >= BINDER_QC_MAX_REVISIONS) {
        throw conflict("Sudah 2 putaran revisi — eskalasi ke owner diperlukan");
      }
      const priorAssignments = await tx
        .select({ id: binderQcAssignments.id })
        .from(binderQcAssignments)
        .where(
          and(
            eq(binderQcAssignments.companyId, input.companyId),
            eq(binderQcAssignments.issueId, input.issueId),
          ),
        );
      const round = priorAssignments.length + 1;
      // Satu artifact utama: turunkan yang lama, tetapkan yang baru.
      await tx
        .update(issueWorkProducts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(issueWorkProducts.companyId, input.companyId),
            eq(issueWorkProducts.issueId, input.issueId),
            eq(issueWorkProducts.isPrimary, true),
          ),
        );
      await tx
        .update(issueWorkProducts)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(issueWorkProducts.id, artifact.id));
      await tx
        .update(binderTasks)
        .set({ primaryArtifactId: artifact.id, updatedAt: new Date() })
        .where(eq(binderTasks.id, task.id));
      const makerFamily = await getAgentModelFamily(tx, input.companyId, task.ownerAgentId);
      if (!makerFamily) {
        throw conflict("Owner task belum punya model family terdaftar — daftarkan dulu sebelum QC");
      }
      const assignment = await assignQcReviewer(tx, {
        companyId: input.companyId,
        projectId: task.projectId,
        issueId: input.issueId,
        binderTaskId: task.id,
        makerAgentId: task.ownerAgentId,
        makerFamily,
        round,
      });
      const moved = await applyBinderTransition(tx, publications, {
        task,
        issue,
        toStatus: "in_review",
        expectedStatusVersion: input.expectedStatusVersion,
        actorAgentId: input.actorAgentId ?? task.ownerAgentId,
        reason: `Artifact utama diajukan: ${artifact.title}`,
      });
      const qcName = await agentDisplayName(tx, assignment.qcAgentId);
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.qc.assigned",
        entityType: "binder_qc_assignment",
        entityId: assignment.id,
        issueId: input.issueId,
        details: {
          round,
          qcAgentId: assignment.qcAgentId,
          qcFamily: assignment.qcFamily,
          makerFamily,
        },
      });
      await appendBinderTranscript(tx, {
        companyId: input.companyId,
        issueId: input.issueId,
        body: `[BINDER] QC putaran ${round} ditugaskan ke ${qcName} (family ${assignment.qcFamily}, beda dari maker ${makerFamily})`,
        authorAgentId: assignment.qcAgentId,
      });
      return { task: moved.task, issue: moved.issue, assignment, artifact };
    }),
  );
}

/**
 * Daftarkan / perbarui model agen (upsert per company+agent). Family inilah
 * yang dipakai aturan QC beda family (P0-1).
 */
export async function registerAgentModel(db: Db, input: BinderAgentModelInput) {
  return withOperationAccountingTransaction(db, input.companyId, async (tx) => {
    await lockBudgetAdmissionControls(tx, input.companyId);
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId)));
    if (!agent) throw notFound("Agent not found");
    const [row] = await tx
      .insert(binderAgentModels)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        modelFamily: input.modelFamily,
        modelId: input.modelId,
        provider: input.provider ?? null,
      })
      .onConflictDoUpdate({
        target: [binderAgentModels.companyId, binderAgentModels.agentId],
        set: {
          modelFamily: input.modelFamily,
          modelId: input.modelId,
          provider: input.provider ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  });
}

/** Family model agen, atau null bila belum terdaftar. */
export async function getAgentModelFamily(
  tx: Db,
  companyId: string,
  agentId: string,
): Promise<BinderModelFamily | null> {
  const [row] = await tx
    .select({ modelFamily: binderAgentModels.modelFamily })
    .from(binderAgentModels)
    .where(
      and(eq(binderAgentModels.companyId, companyId), eq(binderAgentModels.agentId, agentId)),
    );
  return (row?.modelFamily as BinderModelFamily | undefined) ?? null;
}

/**
 * Daftarkan agen ke pool QC (P0-1). CEO tidak boleh masuk pool (role
 * 'ceo' ditolak; CEO BINDER adalah agen tingkat akun, bukan agen company,
 * jadi secara struktural pun ia tidak bisa terdaftar di pool company —
 * penolakan role ini pertahanan kedua). Agen wajib punya model family
 * terdaftar supaya aturan beda family bisa ditegakkan.
 */
export async function registerQcReviewer(db: Db, input: BinderRegisterQcReviewer) {
  return withBudgetSpan("binder.qc.register", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const [agent] = await tx
        .select({ id: agents.id, role: agents.role })
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId)));
      if (!agent) throw notFound("Agent not found");
      if (agent.role === "ceo") {
        throw conflict("CEO tidak boleh masuk pool QC (P0-1)");
      }
      const family = await getAgentModelFamily(tx, input.companyId, input.agentId);
      if (!family) {
        throw conflict("Agen belum punya model family terdaftar — daftarkan modelnya dulu");
      }
      const [existing] = await tx
        .select({ id: binderQcRoster.id })
        .from(binderQcRoster)
        .where(
          and(
            eq(binderQcRoster.companyId, input.companyId),
            eq(binderQcRoster.agentId, input.agentId),
          ),
        );
      if (existing) throw conflict("Agen sudah menjadi anggota pool QC");
      const [member] = await tx
        .insert(binderQcRoster)
        .values({ companyId: input.companyId, agentId: input.agentId })
        .returning();
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.qc.roster_added",
        entityType: "binder_qc_roster",
        entityId: member.id,
        details: { agentId: input.agentId, modelFamily: family },
      });
      return member;
    }),
  );
}

/** Keluarkan agen dari pool QC — ditolak bila masih ada penugasan aktif. */
export async function removeQcReviewer(db: Db, input: BinderRegisterQcReviewer) {
  return withOperationAccountingTransaction(db, input.companyId, async (tx) => {
    const [busy] = await tx
      .select({ id: binderQcAssignments.id })
      .from(binderQcAssignments)
      .where(
        and(
          eq(binderQcAssignments.companyId, input.companyId),
          eq(binderQcAssignments.qcAgentId, input.agentId),
          eq(binderQcAssignments.status, "assigned"),
        ),
      )
      .limit(1);
    if (busy) {
      throw conflict(
        "Agen masih punya penugasan QC aktif — selesaikan dulu sebelum dikeluarkan dari pool",
      );
    }
    const [removed] = await tx
      .delete(binderQcRoster)
      .where(
        and(
          eq(binderQcRoster.companyId, input.companyId),
          eq(binderQcRoster.agentId, input.agentId),
        ),
      )
      .returning();
    if (!removed) throw notFound("Anggota pool QC tidak ditemukan");
    return removed;
  });
}

/** Daftar anggota pool QC beserta family-nya (CEO sudah disaring). */
export async function listQcRoster(tx: Db, companyId: string) {
  return tx
    .select({
      id: binderQcRoster.id,
      agentId: binderQcRoster.agentId,
      modelFamily: binderAgentModels.modelFamily,
      lastAssignedAt: binderQcRoster.lastAssignedAt,
      assignmentsCount: binderQcRoster.assignmentsCount,
    })
    .from(binderQcRoster)
    .innerJoin(
      binderAgentModels,
      and(
        eq(binderAgentModels.companyId, binderQcRoster.companyId),
        eq(binderAgentModels.agentId, binderQcRoster.agentId),
      ),
    )
    .innerJoin(agents, eq(agents.id, binderQcRoster.agentId))
    .where(and(eq(binderQcRoster.companyId, companyId), sql`${agents.role} <> 'ceo'`))
    .orderBy(
      sql`${binderQcRoster.lastAssignedAt} asc nulls first`,
      asc(binderQcRoster.assignmentsCount),
      asc(binderQcRoster.agentId),
    );
}

/**
 * Penunjukan QC (P0-1): round-robin di antara anggota pool yang family-nya
 * beda dari maker, bukan maker sendiri, bukan CEO, dan BUKAN reviewer
 * putaran sebelumnya untuk task ini (larangan 2x berturut-turut — bukan
 * larangan seumur task: sesudah owner memerintahkan resume, mandat baru
 * dimulai dan reviewer boleh ditunjuk lagi, tetap bergiliran; kalau tidak,
 * pool kecil akan kehabisan reviewer dan task tidak bisa lanjut).
 * Urutan: yang paling lama tidak ditugaskan dulu (null = belum pernah),
 * lalu jumlah penugasan paling sedikit, lalu id (deterministik). Baris
 * roster dikunci supaya dua penunjukan bersamaan tidak memilih reviewer
 * yang sama.
 */
export async function assignQcReviewer(
  tx: Db,
  input: {
    companyId: string;
    projectId?: string | null;
    issueId: string;
    binderTaskId: string;
    makerAgentId: string;
    makerFamily: BinderModelFamily;
    round: number;
  },
): Promise<BinderQcAssignment> {
  const [lastReview] = await tx
    .select({ qcAgentId: binderQcAssignments.qcAgentId })
    .from(binderQcAssignments)
    .where(
      and(
        eq(binderQcAssignments.companyId, input.companyId),
        eq(binderQcAssignments.issueId, input.issueId),
      ),
    )
    .orderBy(desc(binderQcAssignments.round))
    .limit(1);
  const excluded = new Set<string>();
  if (lastReview) excluded.add(lastReview.qcAgentId);
  excluded.add(input.makerAgentId);
  const candidates = await tx
    .select({
      rosterId: binderQcRoster.id,
      agentId: binderQcRoster.agentId,
      qcFamily: binderAgentModels.modelFamily,
      lastAssignedAt: binderQcRoster.lastAssignedAt,
      assignmentsCount: binderQcRoster.assignmentsCount,
    })
    .from(binderQcRoster)
    .innerJoin(
      binderAgentModels,
      and(
        eq(binderAgentModels.companyId, binderQcRoster.companyId),
        eq(binderAgentModels.agentId, binderQcRoster.agentId),
      ),
    )
    .innerJoin(agents, eq(agents.id, binderQcRoster.agentId))
    .where(
      and(
        eq(binderQcRoster.companyId, input.companyId),
        sql`${agents.role} <> 'ceo'`,
        sql`${binderAgentModels.modelFamily} <> ${input.makerFamily}`,
      ),
    )
    .orderBy(
      sql`${binderQcRoster.lastAssignedAt} asc nulls first`,
      asc(binderQcRoster.assignmentsCount),
      asc(binderQcRoster.agentId),
    )
    .for("update");
  const chosen = candidates.find((row) => !excluded.has(row.agentId));
  if (!chosen) {
    throw conflict(
      "Tidak ada QC yang memenuhi syarat (beda family dari maker, bukan maker, bukan CEO, belum pernah mereview task ini) — tunjuk anggota pool QC dulu atau eskalasi ke owner",
    );
  }
  const now = new Date();
  await tx
    .update(binderQcRoster)
    .set({ lastAssignedAt: now, assignmentsCount: chosen.assignmentsCount + 1, updatedAt: now })
    .where(eq(binderQcRoster.id, chosen.rosterId));
  const [assignment] = await tx
    .insert(binderQcAssignments)
    .values({
      companyId: input.companyId,
      projectId: input.projectId ?? null,
      issueId: input.issueId,
      binderTaskId: input.binderTaskId,
      qcAgentId: chosen.agentId,
      makerAgentId: input.makerAgentId,
      makerFamily: input.makerFamily,
      qcFamily: chosen.qcFamily as BinderModelFamily,
      round: input.round,
    })
    .returning();
  return assignment;
}

/**
 * Kirim skor QC (P0-2/3): hanya QC yang ditugaskan, hanya sekali per
 * penugasan. Rubrik 30/25/25/20; lolos ≥ 75 + nol hard violation.
 * Lembar skor disimpan sebagai artifact; biaya QC dibebankan ke pool
 * (P1-10) ATOMIK dengan skor di transaksi yang sama. Hasil menentukan
 * transisi: lolos → Butuh Approval Patria; gagal → Revisi (maks 2x);
 * gagal putaran ke-2 → Eskalasi ke owner.
 */
export async function submitQcScore(db: Db, input: BinderSubmitQcScore) {
  return withBudgetSpan("binder.qc.submit", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      // Validasi rentang dimensi (pertahanan kedua sesudah zod di API).
      const dimensions = [
        ["truthEvidence", input.truthEvidence, BINDER_QC_RUBRIC_MAX.truthEvidence],
        ["completeness", input.completeness, BINDER_QC_RUBRIC_MAX.completeness],
        ["compliance", input.compliance, BINDER_QC_RUBRIC_MAX.compliance],
        ["quality", input.quality, BINDER_QC_RUBRIC_MAX.quality],
      ] as const;
      for (const [name, value, max] of dimensions) {
        if (!Number.isInteger(value) || value < 0 || value > max) {
          throw badRequest(`Dimensi ${name} harus bilangan bulat 0..${max}`);
        }
      }
      const [assignment] = await tx
        .select()
        .from(binderQcAssignments)
        .where(
          and(
            eq(binderQcAssignments.id, input.assignmentId),
            eq(binderQcAssignments.companyId, input.companyId),
            eq(binderQcAssignments.issueId, input.issueId),
          ),
        )
        .for("update");
      if (!assignment) throw notFound("Penugasan QC tidak ditemukan");
      if (assignment.status !== "assigned") {
        throw conflict(`Penugasan QC sudah ${assignment.status} — skor tidak bisa dikirim dua kali`);
      }
      if (assignment.qcAgentId !== input.qcAgentId) {
        throw forbidden("Hanya QC yang ditugaskan yang boleh mengirim skor ini");
      }
      const { task, issue } = await loadBinderTaskForUpdate(tx, input.companyId, input.issueId);
      if (task.binderStatus !== "in_review") {
        throw conflict(`Task harus In Review untuk dinilai QC (saat ini: ${task.binderStatus})`);
      }
      if (!issue.projectId) {
        throw conflict("Task belum terikat project — biaya QC tidak bisa dibebankan ke ledger");
      }
      await lockBudgetAdmissionControls(tx, input.companyId, issue.projectId);
      const total =
        input.truthEvidence + input.completeness + input.compliance + input.quality;
      const passed = total >= BINDER_QC_PASS_SCORE && input.hardViolations.length === 0;
      const qcName = await agentDisplayName(tx, input.qcAgentId);
      // Lembar skor sebagai artifact (satu-satunya catatan skor yang dibaca manusia).
      const [sheet] = await tx
        .insert(issueWorkProducts)
        .values({
          companyId: input.companyId,
          projectId: issue.projectId,
          issueId: input.issueId,
          type: "binder_qc_score_sheet",
          provider: "binder",
          title: `Lembar skor QC putaran ${assignment.round} — ${issue.title}`,
          status: "completed",
          reviewState: passed ? "approved" : "changes_requested",
          isPrimary: false,
          healthStatus: "unknown",
          summary:
            `Skor ${total}/100 — ${passed ? "LOLOS" : "GAGAL"} ` +
            `(Kebenaran ${input.truthEvidence}/30, Kelengkapan ${input.completeness}/25, ` +
            `Kepatuhan ${input.compliance}/25, Kualitas ${input.quality}/20)` +
            (input.hardViolations.length > 0
              ? `; hard violation: ${input.hardViolations.join(", ")}`
              : ""),
          metadata: {
            kind: "binder_qc_score_sheet",
            assignmentId: assignment.id,
            round: assignment.round,
            qcAgentId: input.qcAgentId,
            makerAgentId: assignment.makerAgentId,
            makerFamily: assignment.makerFamily,
            qcFamily: assignment.qcFamily,
            rubric: {
              truthEvidence: { score: input.truthEvidence, max: BINDER_QC_RUBRIC_MAX.truthEvidence },
              completeness: { score: input.completeness, max: BINDER_QC_RUBRIC_MAX.completeness },
              compliance: { score: input.compliance, max: BINDER_QC_RUBRIC_MAX.compliance },
              quality: { score: input.quality, max: BINDER_QC_RUBRIC_MAX.quality },
            },
            totalScore: total,
            passScore: BINDER_QC_PASS_SCORE,
            passed,
            hardViolations: [...input.hardViolations],
            evidenceNote: input.evidenceNote ?? null,
          },
        })
        .returning();
      const [score] = await tx
        .insert(binderQcScores)
        .values({
          companyId: input.companyId,
          assignmentId: assignment.id,
          truthEvidence: input.truthEvidence,
          completeness: input.completeness,
          compliance: input.compliance,
          quality: input.quality,
          totalScore: total,
          passed,
          hardViolations: [...input.hardViolations],
          scoreSheetWorkProductId: sheet.id,
          submittedByAgentId: input.qcAgentId,
          evidenceNote: input.evidenceNote ?? null,
        })
        .returning();
      // Biaya QC ke pool (P1-10) — atomik dengan skor di transaksi ini.
      const qcCostCents = input.qcCostCents ?? String(BINDER_QC_REVIEW_COST_CENTS);
      const charge = await chargeBinderUsageInTransaction(tx, publications, {
        companyId: input.companyId,
        projectId: issue.projectId,
        issueId: input.issueId,
        amountCents: qcCostCents,
        kind: "qc_cost",
        reason: `Biaya QC putaran ${assignment.round} — ${passed ? "lolos" : "gagal"} (skor ${total}/100)`,
        idempotencyKey: input.idempotencyKey ?? `qc-score:${assignment.id}`,
        createdByAgentId: input.qcAgentId,
      });
      // Gagal putaran ke-N dalam mandat ini: revisionRound menghitung
      // putaran QC yang sudah gagal dalam mandat berjalan (di-reset saat
      // owner memutuskan eskalasi dengan resume). Gagal ke-2 → eskalasi.
      const failedRoundsInMandate = task.revisionRound + 1;
      const escalate = !passed && failedRoundsInMandate >= BINDER_QC_MAX_REVISIONS;
      const nextAssignmentStatus = escalate ? "escalated" : "submitted";
      await tx
        .update(binderQcAssignments)
        .set({ status: nextAssignmentStatus, updatedAt: new Date() })
        .where(eq(binderQcAssignments.id, assignment.id));
      let moved: LoadedTask;
      if (passed) {
        moved = await applyBinderTransition(tx, publications, {
          task,
          issue,
          toStatus: "needs_owner_approval",
          expectedStatusVersion: input.expectedStatusVersion,
          actorAgentId: input.qcAgentId,
          reason: `QC lolos (${total}/100) oleh ${qcName} — menunggu approval Patria`,
        });
      } else if (!escalate) {
        moved = await applyBinderTransition(tx, publications, {
          task,
          issue,
          toStatus: "revision",
          expectedStatusVersion: input.expectedStatusVersion,
          actorAgentId: input.qcAgentId,
          reason: `QC gagal (${total}/100) oleh ${qcName} — revisi putaran ${task.revisionRound + 1}`,
          revisionRound: task.revisionRound + 1,
        });
      } else {
        moved = await applyBinderTransition(tx, publications, {
          task,
          issue,
          toStatus: "escalated",
          expectedStatusVersion: input.expectedStatusVersion,
          actorAgentId: input.qcAgentId,
          reason: `QC gagal putaran ke-2 (${total}/100) oleh ${qcName} — eskalasi ke owner`,
        });
      }
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.qc.scored",
        entityType: "binder_qc_score",
        entityId: score.id,
        issueId: input.issueId,
        details: {
          assignmentId: assignment.id,
          round: assignment.round,
          totalScore: total,
          passed,
          hardViolations: input.hardViolations,
          qcCostCents,
        },
      });
      return {
        score,
        assignment: { ...assignment, status: nextAssignmentStatus },
        task: moved.task,
        issue: moved.issue,
        charge,
        scoreSheet: sheet,
      };
    }),
  );
}

/**
 * Vonis owner: setujui pekerjaan → Done. Hanya dari Butuh Approval.
 */
export async function approveBinderTaskByOwner(db: Db, input: BinderApproveTask) {
  return withBudgetSpan("binder.task.owner_decision", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const { task, issue } = await loadBinderTaskForUpdate(tx, input.companyId, input.issueId);
      if (task.binderStatus !== "needs_owner_approval") {
        throw conflict(
          `Hanya task Butuh Approval yang bisa disetujui owner (saat ini: ${task.binderStatus})`,
        );
      }
      const moved = await applyBinderTransition(tx, publications, {
        task,
        issue,
        toStatus: "done",
        expectedStatusVersion: input.expectedStatusVersion,
        actorUserId: input.ownerUserId,
        reason: input.decisionNote ?? "Disetujui Patria",
      });
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.task.owner_approved",
        entityType: "binder_task",
        entityId: task.id,
        issueId: input.issueId,
        details: { ownerUserId: input.ownerUserId },
      });
      return moved;
    }),
  );
}

/**
 * Vonis owner: tolak pekerjaan. Penolakan pertama → Revisi (putaran +1).
 * Penolakan kedua (anggaran revisi habis — sama seperti QC gagal putaran
 * ke-2) → Eskalasi: owner memutuskan langsung (lanjut dengan reset atau
 * batal) lewat resolveEscalatedTaskByOwner. Tidak ada revisi ke-3.
 */
export async function rejectBinderTaskByOwner(db: Db, input: BinderRejectTask) {
  return withBudgetSpan("binder.task.owner_decision", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const { task, issue } = await loadBinderTaskForUpdate(tx, input.companyId, input.issueId);
      if (task.binderStatus !== "needs_owner_approval") {
        throw conflict(
          `Hanya task Butuh Approval yang bisa ditolak owner (saat ini: ${task.binderStatus})`,
        );
      }
      if (task.revisionRound >= 1) {
        // Penolakan ke-2: anggaran revisi habis → eskalasi (bukan revisi).
        const moved = await applyBinderTransition(tx, publications, {
          task,
          issue,
          toStatus: "escalated",
          expectedStatusVersion: input.expectedStatusVersion,
          actorUserId: input.ownerUserId,
          reason:
            input.decisionNote ??
            "Ditolak Patria ke-2 — anggaran revisi habis, eskalasi ke owner",
        });
        await noteBinderActivity(tx, publications, {
          companyId: input.companyId,
          action: "binder.task.owner_rejected",
          entityType: "binder_task",
          entityId: task.id,
          issueId: input.issueId,
          details: { ownerUserId: input.ownerUserId, escalated: true },
        });
        return moved;
      }
      const moved = await applyBinderTransition(tx, publications, {
        task,
        issue,
        toStatus: "revision",
        expectedStatusVersion: input.expectedStatusVersion,
        actorUserId: input.ownerUserId,
        reason: input.decisionNote ?? `Ditolak Patria — revisi putaran ${task.revisionRound + 1}`,
        revisionRound: task.revisionRound + 1,
      });
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.task.owner_rejected",
        entityType: "binder_task",
        entityId: task.id,
        issueId: input.issueId,
        details: { ownerUserId: input.ownerUserId, revisionRound: task.revisionRound + 1 },
      });
      return moved;
    }),
  );
}

/**
 * Keputusan owner atas task yang dieskalasi: 'resume' = kembali
 * dikerjakan (putaran revisi di-reset — mandat baru dari owner; admission
 * pendanaan diperiksa lagi) atau 'cancel' = batal.
 */
export async function resolveEscalatedTaskByOwner(db: Db, input: BinderResolveEscalation) {
  return withBudgetSpan("binder.task.owner_decision", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const { task, issue } = await loadBinderTaskForUpdate(tx, input.companyId, input.issueId);
      if (task.binderStatus !== "escalated") {
        throw conflict(
          `Hanya task yang dieskalasi yang bisa diputuskan owner (saat ini: ${task.binderStatus})`,
        );
      }
      if (input.decision === "resume") {
        const blockReason = await checkBinderFundingAdmission(tx, input.companyId, input.issueId);
        if (blockReason) throw conflict(blockReason);
      }
      const moved = await applyBinderTransition(tx, publications, {
        task,
        issue,
        toStatus: input.decision === "resume" ? "in_progress" : "cancelled",
        expectedStatusVersion: input.expectedStatusVersion,
        actorUserId: input.ownerUserId,
        reason:
          input.decisionNote ??
          (input.decision === "resume"
            ? "Eskalasi diputuskan Patria: kembali dikerjakan (putaran revisi di-reset)"
            : "Eskalasi diputuskan Patria: task dibatalkan"),
        resetRevisionRound: input.decision === "resume",
      });
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.task.escalation_resolved",
        entityType: "binder_task",
        entityId: task.id,
        issueId: input.issueId,
        details: { ownerUserId: input.ownerUserId, decision: input.decision },
      });
      return moved;
    }),
  );
}

// ---------------------------------------------------------------------------
// approved_action_id (P1-11)
// ---------------------------------------------------------------------------

/**
 * CEO menyiapkan pengajuan aksi eksternal: buat baris `approvals` tipe
 * `binder_approved_action` (status 'pending' — vonis owner belum ada)
 * + tautkan ke task bila ada. Belum menerbitkan apa pun: id baru lahir
 * di `issueApprovedAction` sesudah owner menyetujui.
 */
export async function requestApprovedAction(db: Db, input: BinderRequestApprovedAction) {
  return withBudgetSpan("binder.action.request", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId, input.projectId ?? null);
      const [requester] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(eq(agents.id, input.requestedByAgentId), eq(agents.companyId, input.companyId)),
        );
      if (!requester) throw notFound("Requesting agent not found");
      let issueProjectId: string | null = null;
      if (input.issueId) {
        const [row] = await tx
          .select({ id: issues.id, projectId: issues.projectId })
          .from(issues)
          .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));
        if (!row) throw notFound("Task not found");
        issueProjectId = row.projectId;
        if (input.projectId && row.projectId && row.projectId !== input.projectId) {
          throw badRequest("Task tidak termasuk project yang diberikan");
        }
      }
      if (input.projectId) {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), eq(projects.companyId, input.companyId)));
        if (!project) throw notFound("Project not found");
      }
      const [approval] = await tx
        .insert(approvals)
        .values({
          companyId: input.companyId,
          type: "binder_approved_action",
          requestedByAgentId: input.requestedByAgentId,
          requestedByUserId: input.requestedByUserId ?? null,
          status: "pending",
          payload: {
            ...input.payload,
            actionKind: input.actionKind,
            projectId: input.projectId ?? issueProjectId,
            issueId: input.issueId ?? null,
          },
        })
        .returning();
      if (input.issueId) {
        await tx.insert(issueApprovals).values({
          companyId: input.companyId,
          issueId: input.issueId,
          approvalId: approval.id,
          linkedByAgentId: input.requestedByAgentId,
        });
        await appendBinderTranscript(tx, {
          companyId: input.companyId,
          issueId: input.issueId,
          body: `[BINDER] Pengajuan aksi eksternal (${input.actionKind}) dibuat — menunggu vonis owner`,
          authorAgentId: input.requestedByAgentId,
        });
      }
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.action.requested",
        entityType: "approval",
        entityId: approval.id,
        issueId: input.issueId ?? undefined,
        details: { actionKind: input.actionKind },
      });
      return approval;
    }),
  );
}

/**
 * Core menerbitkan `approved_action_id` atas vonis owner: approval harus
 * sudah 'approved' + tercatat siapa owner-nya. Idempotent per approval —
 * vonis yang sama tidak pernah menerbitkan dua id.
 */
export async function issueApprovedAction(db: Db, input: BinderIssueApprovedAction) {
  return withBudgetSpan("binder.action.issue", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const [approval] = await tx
        .select()
        .from(approvals)
        .where(
          and(eq(approvals.id, input.approvalId), eq(approvals.companyId, input.companyId)),
        )
        .for("update");
      if (!approval) throw notFound("Approval not found");
      if (approval.type !== "binder_approved_action") {
        throw badRequest(`Approval ini bertipe ${approval.type}, bukan binder_approved_action`);
      }
      if (approval.status !== "approved") {
        throw conflict(
          `Vonis owner belum 'approved' (saat ini: ${approval.status}) — approved_action_id tidak bisa diterbitkan`,
        );
      }
      if (!approval.decidedByUserId) {
        throw conflict("Approval disetujui tanpa identitas owner (decided_by_user_id kosong)");
      }
      const [existing] = await tx
        .select()
        .from(binderApprovedActions)
        .where(
          and(
            eq(binderApprovedActions.companyId, input.companyId),
            eq(binderApprovedActions.approvalId, input.approvalId),
          ),
        );
      if (existing) return { action: existing, reused: true };
      const payload = (approval.payload ?? {}) as Record<string, unknown>;
      const actionKind = payload["actionKind"];
      if (
        typeof actionKind !== "string" ||
        !(BINDER_APPROVED_ACTION_KINDS as readonly string[]).includes(actionKind)
      ) {
        throw badRequest("Payload approval tidak berisi actionKind yang valid");
      }
      const [link] = await tx
        .select({ issueId: issueApprovals.issueId })
        .from(issueApprovals)
        .where(eq(issueApprovals.approvalId, approval.id))
        .limit(1);
      const issueId =
        link?.issueId ?? (typeof payload["issueId"] === "string" ? payload["issueId"] : null);
      const projectId =
        typeof payload["projectId"] === "string" ? (payload["projectId"] as string) : null;
      const [action] = await tx
        .insert(binderApprovedActions)
        .values({
          companyId: input.companyId,
          projectId,
          issueId,
          approvalId: approval.id,
          actionKind: actionKind as BinderApprovedActionKind,
          payload,
          requestedByAgentId: approval.requestedByAgentId,
          decidedByUserId: approval.decidedByUserId,
          status: "issued",
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .returning();
      if (issueId) {
        await appendBinderTranscript(tx, {
          companyId: input.companyId,
          issueId,
          body: `[BINDER] approved_action_id diterbitkan (${actionKind}) atas vonis owner ${approval.decidedByUserId} — id: ${action.id}`,
          authorAgentId: approval.requestedByAgentId,
        });
      }
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.action.issued",
        entityType: "binder_approved_action",
        entityId: action.id,
        issueId: issueId ?? undefined,
        details: { approvalId: approval.id, actionKind },
      });
      return { action, reused: false };
    }),
  );
}

/** Baca satu approved action (tanpa lock). */
export async function getApprovedAction(
  tx: Db,
  companyId: string,
  approvedActionId: string,
): Promise<BinderApprovedAction | null> {
  const [action] = await tx
    .select()
    .from(binderApprovedActions)
    .where(
      and(
        eq(binderApprovedActions.id, approvedActionId),
        eq(binderApprovedActions.companyId, companyId),
      ),
    );
  return action ?? null;
}

/**
 * Validasi Gate (dipakai Tahap 5 di semua jalur aksi eksternal): id harus
 * ada di company ini, berstatus 'issued', dan belum kedaluwarsa. Read-only
 * — tidak mengubah status (kedaluwarsa dinilai saat validasi).
 */
export async function validateApprovedAction(
  tx: Db,
  companyId: string,
  approvedActionId: string,
): Promise<{ valid: boolean; reason: string | null; action: BinderApprovedAction | null }> {
  const action = await getApprovedAction(tx, companyId, approvedActionId);
  if (!action) {
    return { valid: false, reason: "approved_action_id tidak ditemukan", action: null };
  }
  if (action.status !== "issued") {
    return { valid: false, reason: `approved_action_id berstatus ${action.status}`, action };
  }
  if (action.expiresAt && action.expiresAt.getTime() <= Date.now()) {
    return { valid: false, reason: "approved_action_id kedaluwarsa", action };
  }
  return { valid: true, reason: null, action };
}

/** Tandai approved action sudah dipakai (sekali pakai). */
export async function markApprovedActionUsed(db: Db, input: BinderApprovedActionId) {
  return withBudgetSpan("binder.action.use", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      const [action] = await tx
        .select()
        .from(binderApprovedActions)
        .where(
          and(
            eq(binderApprovedActions.id, input.approvedActionId),
            eq(binderApprovedActions.companyId, input.companyId),
          ),
        )
        .for("update");
      if (!action) throw notFound("approved_action_id tidak ditemukan");
      if (action.status !== "issued") {
        throw conflict(`approved_action_id berstatus ${action.status} — tidak bisa dipakai`);
      }
      if (action.expiresAt && action.expiresAt.getTime() <= Date.now()) {
        throw conflict("approved_action_id kedaluwarsa");
      }
      const [used] = await tx
        .update(binderApprovedActions)
        .set({ status: "used", usedAt: new Date(), updatedAt: new Date() })
        .where(eq(binderApprovedActions.id, action.id))
        .returning();
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.action.used",
        entityType: "binder_approved_action",
        entityId: action.id,
        issueId: action.issueId ?? undefined,
        details: { approvalId: action.approvalId, actionKind: action.actionKind },
      });
      return used;
    }),
  );
}

/** Cabut approved action sebelum dipakai (owner). */
export async function revokeApprovedAction(db: Db, input: BinderRevokeApprovedAction) {
  return withBudgetSpan("binder.action.revoke", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      const [action] = await tx
        .select()
        .from(binderApprovedActions)
        .where(
          and(
            eq(binderApprovedActions.id, input.approvedActionId),
            eq(binderApprovedActions.companyId, input.companyId),
          ),
        )
        .for("update");
      if (!action) throw notFound("approved_action_id tidak ditemukan");
      if (action.status !== "issued") {
        throw conflict(`Hanya approved_action_id berstatus issued yang bisa dicabut (saat ini: ${action.status})`);
      }
      const [revoked] = await tx
        .update(binderApprovedActions)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(binderApprovedActions.id, action.id))
        .returning();
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.action.revoked",
        entityType: "binder_approved_action",
        entityId: action.id,
        issueId: action.issueId ?? undefined,
        details: {
          approvalId: action.approvalId,
          actionKind: action.actionKind,
          revokedByUserId: input.revokedByUserId,
        },
      });
      return revoked;
    }),
  );
}

/** Daftar penugasan QC untuk satu task (untuk audit / smoke test Fase 3.4). */
export async function listBinderQcAssignmentsForIssue(
  tx: Db,
  companyId: string,
  issueId: string,
): Promise<BinderQcAssignment[]> {
  return tx
    .select()
    .from(binderQcAssignments)
    .where(
      and(
        eq(binderQcAssignments.companyId, companyId),
        eq(binderQcAssignments.issueId, issueId),
      ),
    )
    .orderBy(asc(binderQcAssignments.round));
}
