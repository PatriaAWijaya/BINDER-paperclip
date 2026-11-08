import { and, eq } from "drizzle-orm";
import {
  agents,
  binderDesktopJobs,
  binderGateDecisions,
  binderTasks,
  issueComments,
  issueWorkProducts,
  issues,
  type BinderDesktopJob,
  type BinderTask,
  type Db,
} from "@paperclipai/db";
import {
  BINDER_DESKTOP_JOB_STATUS_TO_BINDER_TASK,
  BINDER_GATE_ACTION_TO_APPROVED_KINDS,
  BINDER_SYNC_ADAPTER_CONTRACT_VERSION,
  centsToUnits,
  type BinderCreateDesktopJob,
  type BinderDesktopJobCosts,
  type BinderDesktopJobStatus,
  type BinderDesktopRuntime,
  type BinderExecuteExternalAction,
  type BinderFailDesktopJob,
  type BinderGateActionKind,
  type BinderGateCheck,
  type BinderGateDecision,
  type BinderGetDesktopJobStatus,
  type BinderReturnDesktopArtifact,
  type BinderRetryDesktopJob,
  type BinderStopVm,
  type BinderTaskStatus,
  type BinderTimeoutDesktopJob,
} from "@paperclipai/shared";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";
import { withOperationAccountingTransaction } from "./accounting-transaction.js";
import { lockBudgetAdmissionControls } from "./budget-admission-controls.js";
import { withBudgetSpan } from "./budget-tracing.js";
import { chargeBinderUsageInTransaction, checkBinderFundingAdmission, getBinderPool } from "./binder-funding.js";
import {
  applyBinderTransition,
  submitWorkForReview,
  validateApprovedAction,
  markApprovedActionUsed,
} from "./binder-task-flow.js";

/**
 * Sync Internal + Gate Internal BINDER
 * (PRD Bab 6.3; TRD Bab 3.3–3.5, Bab 4–5; Rencana Tahap 5).
 *
 * Sync Internal adalah satu-satunya jembatan resmi BINDER ↔ Mesin
 * Desktop. Modul ini TIDAK memanggil runtime desktop secara langsung:
 * semua akses VM lewat `DesktopRuntimeAdapter` (di-inject pemanggil),
 * dan semua aksi eksternal lewat `ExternalActionExecutor` + keputusan
 * Gate. Isolasi ini yang membuat Sync tahan terhadap API plugin yang
 * tidak stabil: adapter yang berubah endpoint / tidak cocok versi
 * kontrak membuat Sync gagal aman (status dicatat, job tidak dinyatakan
 * selesai, tidak ada aksi eksternal yang lolos tanpa Gate).
 *
 * Aturan yang ditegakkan di sini (kontrak Bab 6.3 point by point):
 * - (a) `binder_task_id` kunci kanonik — tanpa task_id, job ditolak.
 * - (b) Hanya CEO (Edison) yang boleh membuat job desktop dari task
 *   yang sudah disetujui scope-nya (todo/in_progress); bot tidak boleh
 *   membuat task BINDER sendiri (fungsi ini tidak pernah membuat task).
 * - (c) Status job desktop dipetakan ke status BINDER Bab 6.4, bukan
 *   menggantikannya (lihat mapDesktopJobStatusToBinderTaskStatus).
 * - (d) Setiap job wajib mengembalikan minimal satu artifact — tanpa
 *   artifact, task tidak bisa masuk In Review.
 * - (e) Biaya VM/token/tools dicatat ke task_id yang sama (ledger).
 * - Gate (TRD Bab 5): `gate_check(task, aksi)` → IZIN/TOLAK dengan
 *   alasan + jejak audit. Aksi eksternal HANYA jalan bila task membawa
 *   `approved_action_id` yang valid. Executor menolak aksi tanpa
 *   keputusan Gate yang mengizinkan (pertahanan lapis kedua — uji
 *   bypass langsung).
 * - Secret tidak pernah masuk log/artefak/transkrip (P1-24).
 *
 * CATATAN LINGKUNGAN (jujur): VM ini TIDAK BISA menjalankan container
 * (temuan Fase 3.0) — adapter runtime nyata (Docker/Podman) belum ada
 * di sini. Yang dipakai di Tahap 5 adalah adapter `test_double`
 * (test double, bukan VM nyata) untuk membuktikan logika Sync/Gate;
 * pembuktian VM live menunggu Docker Desktop di MacBook / Tahap 6.
 * Uji bypass Gate (matriks 5×2) sepenuhnya bisa diuji tanpa container
 * dan tidak dikurangi ketegasannya.
 */

// ---------------------------------------------------------------------------
// Adapter — batas antara Sync dan runtime/transport luar
// ---------------------------------------------------------------------------

/** Sinyal adapter: endpoint plugin berubah / tidak bisa dihubungi. */
export class PluginEndpointChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginEndpointChangedError";
  }
}

/**
 * Adapter runtime desktop (Mesin Desktop BINDER). Satu-satunya cara Sync
 * menyentuh VM. Implementasi nyata (Docker/Podman di MacBook) ditulis
 * Tahap 6; di Tahap 5 yang ada hanya test double.
 */
export interface DesktopRuntimeAdapter {
  /** Nama adapter (mis. 'test-double', 'docker-desktop-macbook'). */
  readonly name: string;
  /** Versi kontrak adapter — WAJIB sama dengan BINDER_SYNC_ADAPTER_CONTRACT_VERSION. */
  readonly contractVersion: string;
  createVm(input: {
    companyId: string;
    jobId: string;
    binderTaskId: string;
    runtime: BinderDesktopRuntime;
  }): Promise<{ vmId: string }>;
  stopVm(vmId: string): Promise<void>;
}

/**
 * Executor aksi eksternal (transport di belakang Gate — mis. SMTP, API
 * sosmed, deploy). Executor TIDAK PERNAH dipanggil langsung oleh bot:
 * hanya `executeExternalActionViaGate` yang boleh memanggilnya, dan
 * hanya dengan keputusan Gate yang mengizinkan. Test double mencatat
 * panggilan tanpa pernah benar-benar mengirim/publish/membayar.
 */
export interface ExternalActionExecutor {
  readonly name: string;
  execute(input: {
    companyId: string;
    issueId: string;
    actionKind: BinderGateActionKind;
    payload?: Record<string, unknown>;
  }): Promise<{ transportRef: string }>;
}

// ---------------------------------------------------------------------------
// Pemetaan status (murni — bisa diuji tanpa DB)
// ---------------------------------------------------------------------------

/**
 * Status job desktop → status task BINDER yang sepadan (PRD Bab 6.4).
 * 'done' → 'in_review' HANYA bila artifact kembali; tanpa artifact,
 * task tetap 'in_progress' (tidak bisa masuk In Review tanpa artifact).
 * Pemetaan ini tidak mengubah status task — perubahan tetap lewat mesin
 * transisi BINDER.
 */
export function mapDesktopJobStatusToBinderTaskStatus(
  jobStatus: BinderDesktopJobStatus,
  hasArtifact: boolean,
): BinderTaskStatus {
  if (jobStatus === "done" && !hasArtifact) return "in_progress";
  return BINDER_DESKTOP_JOB_STATUS_TO_BINDER_TASK[jobStatus];
}

// ---------------------------------------------------------------------------
// Gate — fungsi murni (TRD Bab 5)
// ---------------------------------------------------------------------------

/** Konteks yang sudah di-resolve untuk keputusan Gate murni. */
export type GateCheckContext = {
  /** Peran agen peminta (kolom `agents.role` — 'ceo'/'leads'/'finance'/'code_builder'/'general'). */
  agentRole: string;
  actionKind: BinderGateActionKind;
  /** approved_action_id yang diajukan (null = tidak ada — kasus yang harus ditolak). */
  approvedAction: {
    id: string;
    /** Lolos validasi Core: ada, berstatus 'issued', belum kedaluwarsa. */
    valid: boolean;
    /** Alasan tidak valid (bila valid=false) — mis. 'berstatus used'. */
    invalidReason: string | null;
    /** ID terikat ke task ini (action.issueId === issueId). */
    matchesTask: boolean;
    /** Jenis approved action mencakup jenis aksi Gate (peta cakupan Tahap 5). */
    kindCovers: boolean;
    /** Payload approved action memuat scopeRef yang diminta (bila diminta). */
    scopeOk: boolean;
  } | null;
  /** Sisa pagu (sen eksak) — null = pagu belum dipatok → Gate tidak menolak atas dasar pagu. */
  budgetRemainingCents: string | null;
};

/**
 * `gate_check` murni (TRD Bab 5): IZIN atau TOLAK dengan alasan.
 * Urutan aturan penting — aturan peran (Leads/Finance) di depan supaya
 * "tanpa pengecualian" berlaku walau ada approved_action_id yang valid.
 */
export function gateCheckPure(input: GateCheckContext): { allowed: boolean; reason: string } {
  // Aturan peran (TRD Bab 5) — tanpa pengecualian di Fase 1.
  if (input.agentRole === "leads") {
    return {
      allowed: false,
      reason: "Leads Generator dilarang aksi eksternal di Fase 1 (tanpa pengecualian)",
    };
  }
  if (input.agentRole === "finance" && input.actionKind === "bayar") {
    return {
      allowed: false,
      reason: "Finance dilarang tulis pembayaran/refund/trading di Fase 1 (tanpa pengecualian)",
    };
  }
  // approved_action_id kosong untuk aksi eksternal.
  if (!input.approvedAction) {
    return { allowed: false, reason: "approved_action_id kosong untuk aksi eksternal" };
  }
  const action = input.approvedAction;
  if (!action.valid) {
    return {
      allowed: false,
      reason: `approved_action_id tidak valid: ${action.invalidReason ?? "tidak diketahui"}`,
    };
  }
  if (!action.matchesTask) {
    return { allowed: false, reason: "approved_action_id tidak cocok dengan task_id" };
  }
  if (!action.kindCovers) {
    return {
      allowed: false,
      reason: `approved_action_id tidak mencakup jenis aksi ${input.actionKind}`,
    };
  }
  if (!action.scopeOk) {
    return { allowed: false, reason: "Aksi di luar scope task yang disetujui" };
  }
  // Pagu: hanya berlaku setelah pagu dipatok (TRD Bab 5).
  if (input.budgetRemainingCents !== null && centsToUnits(input.budgetRemainingCents) <= 0n) {
    return { allowed: false, reason: "Pagu habis (hard stop 100%) — top-up diperlukan" };
  }
  return { allowed: true, reason: "approved_action_id valid untuk aksi ini" };
}

// ---------------------------------------------------------------------------
// Helper internal
// ---------------------------------------------------------------------------

async function noteSyncActivity(
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
      actorId: "binder-sync-gate",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      issueId: input.issueId ?? undefined,
      details: input.details,
    },
    publications,
  );
}

async function appendSyncTranscript(
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

type LoadedJob = { job: BinderDesktopJob };
type LoadedTask = {
  task: BinderTask;
  projectId: string | null;
  binderStatus: BinderTaskStatus;
  issue: typeof issues.$inferSelect;
};

async function loadDesktopJobForUpdate(
  tx: Db,
  companyId: string,
  jobId: string,
): Promise<LoadedJob> {
  const [job] = await tx
    .select()
    .from(binderDesktopJobs)
    .where(and(eq(binderDesktopJobs.id, jobId), eq(binderDesktopJobs.companyId, companyId)))
    .for("update");
  if (!job) throw notFound("Desktop job not found");
  return { job };
}

async function loadBinderTaskAndIssueForUpdate(
  tx: Db,
  companyId: string,
  issueId: string,
): Promise<LoadedTask> {
  const [task] = await tx
    .select()
    .from(binderTasks)
    .where(and(eq(binderTasks.companyId, companyId), eq(binderTasks.issueId, issueId)))
    .for("update");
  if (!task) throw notFound("Task BINDER tidak ditemukan — job desktop wajib merujuk task BINDER (tanpa task_id, job ditolak)");
  const [issue] = await tx
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
    .for("update");
  if (!issue) throw notFound("Task not found");
  return {
    task,
    projectId: task.projectId,
    binderStatus: task.binderStatus as BinderTaskStatus,
    issue,
  };
}

/**
 * Pembuat job WAJIB CEO (Edison) — satu-satunya agen role 'ceo' di akun
 * (getCeo: tidak ada → notFound; lebih dari satu → conflict).
 */
async function assertCeoAgent(tx: Db, agentId: string): Promise<{ id: string; companyId: string }> {
  const [creator] = await tx.select().from(agents).where(eq(agents.id, agentId));
  if (!creator) throw notFound("Agent pembuat job tidak ditemukan");
  if (creator.role !== "ceo") {
    throw forbidden("Hanya CEO (Edison) yang boleh membuat job desktop");
  }
  const ceoRows = await tx.select({ id: agents.id }).from(agents).where(eq(agents.role, "ceo"));
  if (ceoRows.length === 0) throw notFound("CEO BINDER belum terdaftar");
  if (ceoRows.length > 1) {
    throw conflict("Lebih dari satu CEO terdaftar — melanggar aturan satu CEO per akun");
  }
  if (ceoRows[0].id !== agentId) {
    throw forbidden("Hanya CEO terdaftar (Edison) yang boleh membuat job desktop");
  }
  return { id: creator.id, companyId: creator.companyId };
}

/** Biaya job (sen eksak) → sen yang > 0 saja, untuk dicatat ke ledger. */
function nonzeroCosts(costs: BinderDesktopJobCosts | undefined): Array<{ kind: "vm" | "token" | "tools"; cents: string }> {
  if (!costs) return [];
  const out: Array<{ kind: "vm" | "token" | "tools"; cents: string }> = [];
  if (costs.vmCents !== undefined && centsToUnits(costs.vmCents) > 0n) out.push({ kind: "vm", cents: costs.vmCents });
  if (costs.tokenCents !== undefined && centsToUnits(costs.tokenCents) > 0n) out.push({ kind: "token", cents: costs.tokenCents });
  if (costs.toolsCents !== undefined && centsToUnits(costs.toolsCents) > 0n) out.push({ kind: "tools", cents: costs.toolsCents });
  return out;
}

/** Catat biaya job ke ledger (kind 'usage', ke task_id yang sama). */
async function chargeJobCosts(
  tx: Db,
  publications: ActivityPublication[],
  input: {
    companyId: string;
    projectId: string;
    issueId: string;
    jobId: string;
    agentId: string;
    costs: BinderDesktopJobCosts | undefined;
  },
): Promise<void> {
  for (const cost of nonzeroCosts(input.costs)) {
    const label = cost.kind === "vm" ? "VM" : cost.kind === "token" ? "token model" : "tools";
    await chargeBinderUsageInTransaction(tx, publications, {
      companyId: input.companyId,
      projectId: input.projectId,
      issueId: input.issueId,
      amountCents: cost.cents,
      kind: "usage",
      reason: `Biaya ${label} job desktop ${input.jobId.slice(0, 8)}`,
      idempotencyKey: `binder-desktop-job-${input.jobId}-${cost.kind}`,
      createdByAgentId: input.agentId,
    });
  }
}

/**
 * Provisi VM untuk job yang sudah tercatat (status 'queued').
 * Panggilan adapter SELALU di luar transaksi DB (tidak pernah menahan
 * transaksi selama panggilan jaringan). Sukses → job 'running' + vmId;
 * gagal (mis. endpoint plugin berubah) → job 'failed' + catatan, lalu
 * lempar conflict — gagal aman: status dicatat, job tidak dinyatakan
 * selesai, tidak ada aksi eksternal yang lolos.
 */
async function provisionVmForJob(
  db: Db,
  adapter: DesktopRuntimeAdapter,
  job: BinderDesktopJob,
): Promise<BinderDesktopJob> {
  let vmId: string;
  try {
    const created = await adapter.createVm({
      companyId: job.companyId,
      jobId: job.id,
      binderTaskId: job.binderTaskId,
      runtime: job.runtime as BinderDesktopRuntime,
    });
    vmId = created.vmId;
  } catch (error) {
    const reason =
      error instanceof PluginEndpointChangedError
        ? `endpoint plugin berubah: ${error.message}`
        : error instanceof Error
          ? error.message
          : "adapter desktop gagal membuat VM";
    const failedJob = await withOperationAccountingTransaction(db, job.companyId, async (tx, publications) => {
      const [row] = await tx
        .update(binderDesktopJobs)
        .set({ status: "failed", endedAt: new Date(), failureNote: reason, updatedAt: new Date() })
        .where(eq(binderDesktopJobs.id, job.id))
        .returning();
      await appendSyncTranscript(tx, {
        companyId: job.companyId,
        issueId: job.issueId,
        body: `[BINDER] Job desktop ${job.id.slice(0, 8)} GAGAL dibuat — ${reason}`,
        authorAgentId: job.createdByAgentId,
      });
      await noteSyncActivity(tx, publications, {
        companyId: job.companyId,
        action: "binder.sync.job_provision_failed",
        entityType: "binder_desktop_job",
        entityId: job.id,
        issueId: job.issueId,
        details: { reason, adapter: adapter.name },
      });
      return row;
    });
    void failedJob;
    throw conflict(`Job desktop gagal dibuat — ${reason}`);
  }
  const running = await withOperationAccountingTransaction(db, job.companyId, async (tx) => {
    const [row] = await tx
      .update(binderDesktopJobs)
      .set({ status: "running", vmId, startedAt: new Date(), updatedAt: new Date() })
      .where(eq(binderDesktopJobs.id, job.id))
      .returning();
    return row;
  });
  return running;
}

/**
 * Hentikan VM job. Idempotent bila sudah dihentikan / tidak ada VM.
 * Gagal stop → vmStopFailed dicatat (VM liar potensial, Tahap 6 poin 9)
 * dan error dilempar supaya pemanggil tahu.
 */
async function stopVmForJob(
  db: Db,
  adapter: DesktopRuntimeAdapter,
  job: BinderDesktopJob,
): Promise<BinderDesktopJob> {
  if (!job.vmId || job.vmStoppedAt) return job;
  try {
    await adapter.stopVm(job.vmId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "adapter gagal menghentikan VM";
    await withOperationAccountingTransaction(db, job.companyId, async (tx, publications) => {
      await tx
        .update(binderDesktopJobs)
        .set({ vmStopFailed: true, updatedAt: new Date() })
        .where(eq(binderDesktopJobs.id, job.id));
      await noteSyncActivity(tx, publications, {
        companyId: job.companyId,
        action: "binder.sync.vm_stop_failed",
        entityType: "binder_desktop_job",
        entityId: job.id,
        issueId: job.issueId,
        details: { vmId: job.vmId, reason, adapter: adapter.name },
      });
    });
    throw conflict(`VM job ${job.id.slice(0, 8)} gagal dihentikan — ${reason} (dicatat vmStopFailed)`);
  }
  const stopped = await withOperationAccountingTransaction(db, job.companyId, async (tx) => {
    const [row] = await tx
      .update(binderDesktopJobs)
      .set({ vmStoppedAt: new Date(), updatedAt: new Date() })
      .where(eq(binderDesktopJobs.id, job.id))
      .returning();
    return row;
  });
  return stopped;
}

// ---------------------------------------------------------------------------
// Sync Internal — operasi (TRD Bab 4; Backend Schematic Bab 5.1 kosong,
// kontrak diambil dari TRD Bab 4 + PRD Bab 6.3 — lihat catatan konstanta)
// ---------------------------------------------------------------------------

/**
 * `create_desktop_job` — CEO membuat job desktop dari task yang sudah
 * disetujui scope-nya (status todo/in_progress). Bot tidak boleh membuat
 * task BINDER sendiri: fungsi ini tidak pernah membuat task; tanpa
 * task_id, job ditolak.
 */
export async function createDesktopJob(
  db: Db,
  adapter: DesktopRuntimeAdapter,
  input: BinderCreateDesktopJob,
): Promise<BinderDesktopJob> {
  const attempt = input.attempt ?? 1;
  if (attempt > 1) {
    throw conflict("Percobaan ke-n hanya lewat retryDesktopJob (butuh persetujuan CEO)");
  }
  if (adapter.contractVersion !== BINDER_SYNC_ADAPTER_CONTRACT_VERSION) {
    throw conflict(
      `Adapter desktop tidak kompatibel (versi kontrak ${adapter.contractVersion}, Sync butuh ${BINDER_SYNC_ADAPTER_CONTRACT_VERSION}) — gagal aman, tidak ada job dibuat`,
    );
  }
  if (input.snapshotRequested) {
    const idleOk = input.idleTimeoutSeconds !== undefined && input.idleTimeoutSeconds > 0;
    const paguOk = input.paguVmCents !== undefined && centsToUnits(input.paguVmCents) > 0n;
    if (!idleOk || !paguOk) {
      throw badRequest("Snapshot wajib idleTimeout + pagu (tanpa keduanya snapshot dilarang)");
    }
  }
  const queued = await withBudgetSpan("binder.sync.job.create", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId, input.projectId ?? null);
      await assertCeoAgent(tx, input.createdByAgentId);
      const loaded = await loadBinderTaskAndIssueForUpdate(tx, input.companyId, input.issueId);
      if (loaded.binderStatus !== "todo" && loaded.binderStatus !== "in_progress") {
        throw conflict(
          `Job desktop hanya bisa dibuat dari task Todo/In Progress (saat ini: ${loaded.binderStatus})`,
        );
      }
      if (!loaded.projectId && !input.projectId) {
        throw badRequest("Task BINDER wajib terikat project");
      }
      const [bot] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId)));
      if (!bot) throw notFound("Agen bot desktop tidak ditemukan di company ini");
      const [existing] = await tx
        .select({ id: binderDesktopJobs.id })
        .from(binderDesktopJobs)
        .where(
          and(
            eq(binderDesktopJobs.companyId, input.companyId),
            eq(binderDesktopJobs.binderTaskId, loaded.task.id),
            eq(binderDesktopJobs.attempt, attempt),
          ),
        );
      if (existing) {
        throw conflict(`Job desktop sudah ada untuk task ini (attempt ${attempt}) — pakai retry untuk percobaan berikut`);
      }
      // Pool wajib ada sebelum job (fail-closed): biaya job harus bisa dicatat.
      const pool = await getBinderPool(tx, input.companyId);
      if (!pool) {
        throw conflict("Pool company belum dibuat — top-up pertama (atas approval owner) diperlukan sebelum job desktop");
      }
      // Task Todo → In Progress (pemeriksaan admission sama seperti transisi generik).
      const issue = loaded.issue;
      if (loaded.binderStatus === "todo") {
        const blockReason = await checkBinderFundingAdmission(tx, input.companyId, input.issueId);
        if (blockReason) throw conflict(blockReason);
        await applyBinderTransition(tx, publications, {
          task: loaded.task,
          issue,
          toStatus: "in_progress",
          expectedStatusVersion: issue.statusVersion,
          actorAgentId: input.createdByAgentId,
          reason: "Job desktop dibuat",
        });
      }
      const [job] = await tx
        .insert(binderDesktopJobs)
        .values({
          companyId: input.companyId,
          projectId: loaded.projectId ?? input.projectId ?? null,
          issueId: input.issueId,
          binderTaskId: loaded.task.id,
          agentId: input.agentId,
          createdByAgentId: input.createdByAgentId,
          runtime: input.runtime,
          status: "queued",
          attempt,
          snapshotRequested: input.snapshotRequested ?? false,
          idleTimeoutSeconds: input.idleTimeoutSeconds ?? null,
          paguVmCents: input.paguVmCents ?? null,
        })
        .returning();
      await appendSyncTranscript(tx, {
        companyId: input.companyId,
        issueId: input.issueId,
        body: `[BINDER] Job desktop dibuat (attempt ${attempt}, runtime ${input.runtime}) — CEO Edison`,
        authorAgentId: input.createdByAgentId,
      });
      await noteSyncActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.sync.job_created",
        entityType: "binder_desktop_job",
        entityId: job.id,
        issueId: input.issueId,
        details: { attempt, runtime: input.runtime, agentId: input.agentId },
      });
      return job;
    }),
  );
  return provisionVmForJob(db, adapter, queued);
}

/** `get_job_status` — status job + pemetaan ke status BINDER (tanpa mengubah task). */
export async function getDesktopJobStatus(
  db: Db,
  input: BinderGetDesktopJobStatus,
): Promise<{
  job: BinderDesktopJob;
  binderTaskStatus: BinderTaskStatus;
  taskBinderStatus: BinderTaskStatus;
}> {
  const [job] = await db
    .select()
    .from(binderDesktopJobs)
    .where(and(eq(binderDesktopJobs.id, input.jobId), eq(binderDesktopJobs.companyId, input.companyId)));
  if (!job) throw notFound("Desktop job not found");
  const [task] = await db
    .select()
    .from(binderTasks)
    .where(and(eq(binderTasks.id, job.binderTaskId), eq(binderTasks.companyId, input.companyId)));
  if (!task) throw notFound("Task BINDER tidak ditemukan");
  return {
    job,
    binderTaskStatus: mapDesktopJobStatusToBinderTaskStatus(
      job.status as BinderDesktopJobStatus,
      job.artifactsReturned.length > 0,
    ),
    taskBinderStatus: task.binderStatus as BinderTaskStatus,
  };
}

/**
 * `return_artifact` — job mengembalikan minimal satu artifact.
 * Tanpa artifact, task tidak bisa masuk In Review (ditolak di sini).
 * Artifact dicatat sebagai work product, biaya dicatat ke ledger,
 * job 'done', VM dihentikan, lalu task diajukan ke review (QC).
 * Bila QC tidak bisa ditugaskan, job tetap 'done' + artifact tercatat,
 * tapi task tetap In Progress dengan reviewPendingReason (bukan gagal
 * diam-diam).
 */
export async function returnDesktopArtifact(
  db: Db,
  adapter: DesktopRuntimeAdapter,
  input: BinderReturnDesktopArtifact,
): Promise<{
  job: BinderDesktopJob;
  taskBinderStatus: BinderTaskStatus;
  artifactIds: string[];
  reviewPending: string | null;
}> {
  const done = await withBudgetSpan("binder.sync.job.return_artifact", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const { job } = await loadDesktopJobForUpdate(tx, input.companyId, input.jobId);
      if (job.status !== "running" && job.status !== "need_approval") {
        throw conflict(`Hanya job running/need_approval yang bisa mengembalikan artifact (saat ini: ${job.status})`);
      }
      if (input.artifacts.length === 0) {
        throw badRequest("Job desktop wajib mengembalikan minimal satu artifact — tanpa artifact, task tidak bisa masuk In Review");
      }
      const loaded = await loadBinderTaskAndIssueForUpdate(tx, input.companyId, job.issueId);
      if (!loaded.projectId) throw badRequest("Task BINDER wajib terikat project");
      if (loaded.binderStatus !== "in_progress") {
        throw conflict(`Task harus In Progress saat artifact kembali (saat ini: ${loaded.binderStatus})`);
      }
      const artifactIds: string[] = [];
      for (const artifact of input.artifacts) {
        const [row] = await tx
          .insert(issueWorkProducts)
          .values({
            companyId: input.companyId,
            projectId: loaded.projectId,
            issueId: job.issueId,
            type: "binder_desktop_artifact",
            provider: "binder_desktop",
            title: artifact.title,
            url: artifact.url ?? null,
            status: "completed",
            summary: artifact.summary ?? null,
            metadata: { jobId: job.id, artifactKind: artifact.kind },
          })
          .returning();
        artifactIds.push(row.id);
      }
      const costs = nonzeroCosts(input.costs);
      const costVm = costs.find((c) => c.kind === "vm")?.cents ?? "0";
      const costToken = costs.find((c) => c.kind === "token")?.cents ?? "0";
      const costTools = costs.find((c) => c.kind === "tools")?.cents ?? "0";
      await chargeJobCosts(tx, publications, {
        companyId: input.companyId,
        projectId: loaded.projectId,
        issueId: job.issueId,
        jobId: job.id,
        agentId: job.agentId,
        costs: input.costs,
      });
      const [updated] = await tx
        .update(binderDesktopJobs)
        .set({
          status: "done",
          endedAt: new Date(),
          artifactsReturned: artifactIds,
          costVmCents: costVm,
          costTokenCents: costToken,
          costToolsCents: costTools,
          updatedAt: new Date(),
        })
        .where(eq(binderDesktopJobs.id, job.id))
        .returning();
      await appendSyncTranscript(tx, {
        companyId: input.companyId,
        issueId: job.issueId,
        body: `[BINDER] Job desktop ${job.id.slice(0, 8)} selesai — ${artifactIds.length} artifact kembali${input.note ? ` — ${input.note}` : ""}`,
        authorAgentId: job.agentId,
      });
      await noteSyncActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.sync.job_done",
        entityType: "binder_desktop_job",
        entityId: job.id,
        issueId: job.issueId,
        details: { artifactIds, costVmCents: costVm, costTokenCents: costToken, costToolsCents: costTools },
      });
      return { job: updated, artifactIds };
    }),
  );
  // Ajukan ke review (transaksi terpisah — submitWorkForReview membuka
  // transaksinya sendiri). Gagal QC (mis. tidak ada reviewer) bukan
  // kegagalan job: artifact sudah tercatat, dicatat alasannya.
  let reviewPending: string | null = null;
  try {
    const [issue] = await db
      .select()
      .from(issues)
      .where(and(eq(issues.id, done.job.issueId), eq(issues.companyId, input.companyId)));
    if (!issue) throw notFound("Task not found");
    await submitWorkForReview(db, {
      companyId: input.companyId,
      issueId: done.job.issueId,
      artifactWorkProductId: done.artifactIds[0],
      expectedStatusVersion: issue.statusVersion,
      actorAgentId: done.job.agentId,
    });
  } catch (error) {
    reviewPending = error instanceof Error ? error.message : "QC tidak bisa ditugaskan";
    await withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await tx
        .update(binderDesktopJobs)
        .set({ reviewPendingReason: reviewPending, updatedAt: new Date() })
        .where(eq(binderDesktopJobs.id, done.job.id));
      await appendSyncTranscript(tx, {
        companyId: input.companyId,
        issueId: done.job.issueId,
        body: `[BINDER] Job desktop ${done.job.id.slice(0, 8)} selesai tapi task belum masuk In Review — ${reviewPending}`,
        authorAgentId: done.job.agentId,
      });
      await noteSyncActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.sync.review_pending",
        entityType: "binder_desktop_job",
        entityId: done.job.id,
        issueId: done.job.issueId,
        details: { reason: reviewPending },
      });
    });
  }
  // VM dihentikan sesudah job selesai (gagal stop dicatat vmStopFailed).
  let finalJob = done.job;
  try {
    finalJob = await stopVmForJob(db, adapter, done.job);
  } catch {
    const [row] = await db
      .select()
      .from(binderDesktopJobs)
      .where(eq(binderDesktopJobs.id, done.job.id));
    if (row) finalJob = row;
  }
  const [task] = await db
    .select()
    .from(binderTasks)
    .where(and(eq(binderTasks.id, done.job.binderTaskId), eq(binderTasks.companyId, input.companyId)));
  return {
    job: finalJob,
    taskBinderStatus: (task?.binderStatus ?? "in_progress") as BinderTaskStatus,
    artifactIds: done.artifactIds,
    reviewPending,
  };
}

async function failJobInTransaction(
  db: Db,
  adapter: DesktopRuntimeAdapter,
  input: { companyId: string; jobId: string; reason: string; checkpointNote?: string; costs?: BinderDesktopJobCosts },
  isTimeout: boolean,
): Promise<BinderDesktopJob> {
  const failed = await withBudgetSpan("binder.sync.job.fail", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const { job } = await loadDesktopJobForUpdate(tx, input.companyId, input.jobId);
      if (job.status !== "queued" && job.status !== "running" && job.status !== "need_approval") {
        throw conflict(`Hanya job queued/running/need_approval yang bisa digagalkan (saat ini: ${job.status})`);
      }
      const loaded = await loadBinderTaskAndIssueForUpdate(tx, input.companyId, job.issueId);
      if (!loaded.projectId) throw badRequest("Task BINDER wajib terikat project");
      const failureNote = isTimeout ? `VM timeout: ${input.reason}` : input.reason;
      await chargeJobCosts(tx, publications, {
        companyId: input.companyId,
        projectId: loaded.projectId,
        issueId: job.issueId,
        jobId: job.id,
        agentId: job.agentId,
        costs: input.costs,
      });
      const costs = nonzeroCosts(input.costs);
      const [updated] = await tx
        .update(binderDesktopJobs)
        .set({
          status: "failed",
          endedAt: new Date(),
          failureNote,
          checkpointNote: input.checkpointNote ?? null,
          costVmCents: costs.find((c) => c.kind === "vm")?.cents ?? "0",
          costTokenCents: costs.find((c) => c.kind === "token")?.cents ?? "0",
          costToolsCents: costs.find((c) => c.kind === "tools")?.cents ?? "0",
          updatedAt: new Date(),
        })
        .where(eq(binderDesktopJobs.id, job.id))
        .returning();
      // Task kembali ke Todo dengan catatan gagal (TRD Bab 4) — hanya bila
      // masih In Progress; status lain dibiarkan + dicatat.
      if (loaded.binderStatus === "in_progress") {
        await applyBinderTransition(tx, publications, {
          task: loaded.task,
          issue: loaded.issue,
          toStatus: "todo",
          expectedStatusVersion: loaded.issue.statusVersion,
          actorAgentId: job.agentId,
          reason: failureNote,
        });
      } else {
        await appendSyncTranscript(tx, {
          companyId: input.companyId,
          issueId: job.issueId,
          body: `[BINDER] Job desktop ${job.id.slice(0, 8)} gagal, tapi task berstatus ${loaded.binderStatus} — tidak dikembalikan ke Todo`,
          authorAgentId: job.agentId,
        });
      }
      await appendSyncTranscript(tx, {
        companyId: input.companyId,
        issueId: job.issueId,
        body: `[BINDER] Job desktop ${job.id.slice(0, 8)} GAGAL — ${failureNote}${input.checkpointNote ? ` — checkpoint terakhir disimpan: ${input.checkpointNote}` : ""}`,
        authorAgentId: job.agentId,
      });
      await noteSyncActivity(tx, publications, {
        companyId: input.companyId,
        action: isTimeout ? "binder.sync.job_timeout" : "binder.sync.job_failed",
        entityType: "binder_desktop_job",
        entityId: job.id,
        issueId: job.issueId,
        details: { reason: failureNote, checkpointSaved: Boolean(input.checkpointNote) },
      });
      return updated;
    }),
  );
  try {
    return await stopVmForJob(db, adapter, failed);
  } catch {
    const [row] = await db
      .select()
      .from(binderDesktopJobs)
      .where(eq(binderDesktopJobs.id, failed.id));
    return row ?? failed;
  }
}

/** `fail_job` — job gagal: checkpoint terakhir disimpan, task kembali ke Todo, VM dihentikan. */
export async function failDesktopJob(
  db: Db,
  adapter: DesktopRuntimeAdapter,
  input: BinderFailDesktopJob,
): Promise<BinderDesktopJob> {
  return failJobInTransaction(db, adapter, input, false);
}

/** Timeout VM → job failed (jalan yang sama dengan fail_job + label timeout). */
export async function timeoutDesktopJob(
  db: Db,
  adapter: DesktopRuntimeAdapter,
  input: BinderTimeoutDesktopJob,
): Promise<BinderDesktopJob> {
  return failJobInTransaction(db, adapter, input, true);
}

/** `stop_vm` — hentikan VM job (idempotent bila sudah dihentikan). */
export async function stopVm(
  db: Db,
  adapter: DesktopRuntimeAdapter,
  input: BinderStopVm,
): Promise<BinderDesktopJob> {
  const [job] = await db
    .select()
    .from(binderDesktopJobs)
    .where(and(eq(binderDesktopJobs.id, input.jobId), eq(binderDesktopJobs.companyId, input.companyId)));
  if (!job) throw notFound("Desktop job not found");
  return stopVmForJob(db, adapter, job);
}

/**
 * Retry job yang gagal — HANYA dengan persetujuan CEO (TRD Bab 4:
 * tidak ada retry otomatis tanpa batas). Membuat job baru attempt+1
 * untuk task yang sama; retry tanpa CEO ditolak.
 */
export async function retryDesktopJob(
  db: Db,
  adapter: DesktopRuntimeAdapter,
  input: BinderRetryDesktopJob,
): Promise<BinderDesktopJob> {
  if (adapter.contractVersion !== BINDER_SYNC_ADAPTER_CONTRACT_VERSION) {
    throw conflict(
      `Adapter desktop tidak kompatibel (versi kontrak ${adapter.contractVersion}, Sync butuh ${BINDER_SYNC_ADAPTER_CONTRACT_VERSION}) — gagal aman, tidak ada job dibuat`,
    );
  }
  const queued = await withBudgetSpan("binder.sync.job.retry", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      await assertCeoAgent(tx, input.approvedByCeoAgentId);
      const { job } = await loadDesktopJobForUpdate(tx, input.companyId, input.jobId);
      if (job.status !== "failed") {
        throw conflict(`Hanya job failed yang bisa di-retry (saat ini: ${job.status})`);
      }
      const attempt = job.attempt + 1;
      const [existing] = await tx
        .select({ id: binderDesktopJobs.id })
        .from(binderDesktopJobs)
        .where(
          and(
            eq(binderDesktopJobs.companyId, input.companyId),
            eq(binderDesktopJobs.binderTaskId, job.binderTaskId),
            eq(binderDesktopJobs.attempt, attempt),
          ),
        );
      if (existing) throw conflict(`Job attempt ${attempt} sudah ada untuk task ini`);
      const snapshotRequested = input.snapshotRequested ?? job.snapshotRequested;
      const idleTimeoutSeconds = input.idleTimeoutSeconds ?? job.idleTimeoutSeconds ?? undefined;
      const paguVmCents = input.paguVmCents ?? job.paguVmCents ?? undefined;
      if (snapshotRequested) {
        const idleOk = idleTimeoutSeconds !== undefined && idleTimeoutSeconds > 0;
        const paguOk = paguVmCents !== undefined && centsToUnits(paguVmCents) > 0n;
        if (!idleOk || !paguOk) {
          throw badRequest("Snapshot wajib idleTimeout + pagu (tanpa keduanya snapshot dilarang)");
        }
      }
      const [created] = await tx
        .insert(binderDesktopJobs)
        .values({
          companyId: job.companyId,
          projectId: job.projectId,
          issueId: job.issueId,
          binderTaskId: job.binderTaskId,
          agentId: job.agentId,
          createdByAgentId: input.approvedByCeoAgentId,
          runtime: input.runtime ?? (job.runtime as BinderDesktopRuntime),
          status: "queued",
          attempt,
          snapshotRequested,
          idleTimeoutSeconds: idleTimeoutSeconds ?? null,
          paguVmCents: paguVmCents ?? null,
        })
        .returning();
      await appendSyncTranscript(tx, {
        companyId: job.companyId,
        issueId: job.issueId,
        body: `[BINDER] Retry job desktop disetujui CEO — attempt ${attempt} (job gagal: ${job.id.slice(0, 8)})`,
        authorAgentId: input.approvedByCeoAgentId,
      });
      await noteSyncActivity(tx, publications, {
        companyId: job.companyId,
        action: "binder.sync.job_retried",
        entityType: "binder_desktop_job",
        entityId: created.id,
        issueId: job.issueId,
        details: { attempt, previousJobId: job.id, approvedByCeoAgentId: input.approvedByCeoAgentId },
      });
      return created;
    }),
  );
  return provisionVmForJob(db, adapter, queued);
}

// ---------------------------------------------------------------------------
// Gate Internal — penegak DB (TRD Bab 5)
// ---------------------------------------------------------------------------

/** Baca satu keputusan Gate yang tercatat. */
/**
 * `gate_check(task, aksi)` — versi DB: resolve konteks (agen, task,
 * approved_action_id, pagu), putuskan lewat gateCheckPure, catat
 * keputusan ke `binder_gate_decisions` + activity log, kembalikan
 * keputusan untuk dipakai executor.
 */
export async function gateCheck(db: Db, input: BinderGateCheck): Promise<BinderGateDecision> {
  return withBudgetSpan("binder.gate.check", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const [agent] = await tx.select().from(agents).where(eq(agents.id, input.agentId));
      if (!agent) throw notFound("Agent tidak ditemukan");
      const [issue] = await tx
        .select({ id: issues.id, projectId: issues.projectId })
        .from(issues)
        .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));
      if (!issue) throw notFound("Task not found");
      const [task] = await tx
        .select({ projectId: binderTasks.projectId })
        .from(binderTasks)
        .where(and(eq(binderTasks.companyId, input.companyId), eq(binderTasks.issueId, input.issueId)));
      const projectId = task?.projectId ?? issue.projectId ?? null;

      let approvedAction: GateCheckContext["approvedAction"] = null;
      if (input.approvedActionId) {
        const check = await validateApprovedAction(tx, input.companyId, input.approvedActionId);
        const action = check.action;
        const kindCovers = action
          ? (BINDER_GATE_ACTION_TO_APPROVED_KINDS[input.actionKind] as readonly string[]).includes(action.actionKind)
          : false;
        const matchesTask = action?.issueId === input.issueId;
        let scopeOk = true;
        if (input.scopeRef && action) {
          const payload = (action.payload ?? {}) as Record<string, unknown>;
          scopeOk =
            payload["scopeRef"] === input.scopeRef ||
            payload["draftId"] === input.scopeRef ||
            payload["target"] === input.scopeRef ||
            payload["externalId"] === input.scopeRef;
        }
        approvedAction = {
          id: input.approvedActionId,
          valid: check.valid,
          invalidReason: check.reason,
          matchesTask,
          kindCovers,
          scopeOk,
        };
      }
      const pool = await getBinderPool(tx, input.companyId);
      const budgetRemainingCents =
        input.budgetRemainingCents !== undefined ? input.budgetRemainingCents : (pool ? pool.balanceCents : null);
      const verdict = gateCheckPure({
        agentRole: agent.role,
        actionKind: input.actionKind,
        approvedAction,
        budgetRemainingCents,
      });
      const [row] = await tx
        .insert(binderGateDecisions)
        .values({
          companyId: input.companyId,
          projectId,
          issueId: input.issueId,
          agentId: input.agentId,
          actionKind: input.actionKind,
          approvedActionId: input.approvedActionId ?? null,
          decision: verdict.allowed ? "allowed" : "denied",
          reason: verdict.reason,
        })
        .returning();
      await noteSyncActivity(tx, publications, {
        companyId: input.companyId,
        action: verdict.allowed ? "binder.gate.allowed" : "binder.gate.denied",
        entityType: "binder_gate_decision",
        entityId: row.id,
        issueId: input.issueId,
        details: {
          actionKind: input.actionKind,
          agentId: input.agentId,
          approvedActionId: input.approvedActionId ?? null,
          reason: verdict.reason,
        },
      });
      return {
        decisionId: row.id,
        companyId: input.companyId,
        issueId: input.issueId,
        agentId: input.agentId,
        actionKind: input.actionKind,
        approvedActionId: input.approvedActionId ?? null,
        allowed: verdict.allowed,
        reason: verdict.reason,
      };
    }),
  );
}

/**
 * Jalur aksi eksternal — SATU-SATUNYA jalan executor dipanggil.
 * Executor menolak bila: tidak ada keputusan Gate, keputusan menolak,
 * keputusan tidak cocok (jenis/task/company), atau approved_action_id
 * sudah tidak 'issued' lagi (sekali pakai — pertahanan lapis kedua).
 * Sesudah executor berhasil, approved_action_id ditandai 'used'.
 * Executor yang gagal (transport error) TIDAK menghabiskan id — id
 * tetap 'issued' dan bisa dipakai ulang lewat gate check baru.
 */
export async function executeExternalActionViaGate(
  db: Db,
  executor: ExternalActionExecutor,
  input: BinderExecuteExternalAction,
): Promise<{ executed: boolean; transportRef: string; decisionId: string }> {
  // 'refuse' menerima decision sebagai parameter (bukan closure) supaya
  // TypeScript tetap bisa mempersempit 'decision' sesudah guard pertama:
  // variabel yang ditangkap closure kehilangan narrowing sesudah await.
  const decision = input.gateDecision;
  const refuse = async (reason: string, dec: BinderGateDecision | null | undefined): Promise<never> => {
    await withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const [row] = await tx
        .insert(binderGateDecisions)
        .values({
          companyId: input.companyId,
          projectId: null,
          issueId: input.issueId,
          agentId: input.agentId,
          actionKind: input.actionKind,
          approvedActionId: dec?.approvedActionId ?? null,
          decision: "denied",
          reason,
        })
        .returning();
      await noteSyncActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.gate.denied",
        entityType: "binder_gate_decision",
        entityId: row.id,
        issueId: input.issueId,
        details: { actionKind: input.actionKind, agentId: input.agentId, reason },
      });
    });
    throw forbidden(reason);
  };
  if (!decision) {
    await refuse("Upaya bypass langsung: aksi eksternal tanpa keputusan Gate ditolak", decision);
    // 'refuse' selalu melempar, tapi TS tidak mempersempit lewat await
    // Promise<never> — throw langsung ini yang membuat narrowing bekerja.
    throw forbidden("Upaya bypass langsung: aksi eksternal tanpa keputusan Gate ditolak");
  }
  if (!decision.allowed) {
    await refuse(`Keputusan Gate menolak aksi ini: ${decision.reason}`, decision);
  }
  if (
    decision.companyId !== input.companyId ||
    decision.issueId !== input.issueId ||
    decision.agentId !== input.agentId ||
    decision.actionKind !== input.actionKind
  ) {
    await refuse("Keputusan Gate tidak cocok dengan aksi yang diminta (company/task/agent/jenis)", decision);
  }
  if (!decision.approvedActionId) {
    await refuse("Keputusan Gate yang mengizinkan wajib membawa approved_action_id", decision);
  }
  // Validasi ulang id (sekali pakai): bila sudah used/revoked/kedaluwarsa
  // sejak Gate mengizinkan, executor tetap menolak.
  const stillValid = await withOperationAccountingTransaction(db, input.companyId, async (tx) => {
    const check = await validateApprovedAction(tx, input.companyId, decision.approvedActionId as string);
    return check;
  });
  if (!stillValid.valid) {
    await refuse(`approved_action_id sudah tidak berlaku saat eksekusi: ${stillValid.reason}`, decision);
  }
  let transportRef: string;
  try {
    const result = await executor.execute({
      companyId: input.companyId,
      issueId: input.issueId,
      actionKind: input.actionKind,
      payload: input.payload,
    });
    transportRef = result.transportRef;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "executor gagal";
    await withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await noteSyncActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.gate.execute_failed",
        entityType: "binder_gate_decision",
        entityId: decision.decisionId,
        issueId: input.issueId,
        details: { actionKind: input.actionKind, agentId: input.agentId, reason },
      });
    });
    throw conflict(`Eksekusi aksi eksternal gagal di transport (${executor.name}) — ${reason}; approved_action_id TIDAK dihabiskan`);
  }
  await markApprovedActionUsed(db, {
    companyId: input.companyId,
    approvedActionId: decision.approvedActionId as string,
  });
  await withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
    await noteSyncActivity(tx, publications, {
      companyId: input.companyId,
      action: "binder.gate.executed",
      entityType: "binder_gate_decision",
      entityId: decision.decisionId,
      issueId: input.issueId,
      details: {
        actionKind: input.actionKind,
        agentId: input.agentId,
        approvedActionId: decision.approvedActionId,
        transportRef,
        executor: executor.name,
      },
    });
  });
  return { executed: true, transportRef, decisionId: decision.decisionId };
}

/**
 * Job meminta approval di tengah jalan (status 'need_approval') — bot
 * desktop berhenti dan menunggu vonis owner sebelum lanjut. Task BINDER
 * dipetakan ke 'needs_owner_approval' (bukan diganti). Kembali jalan
 * lewat kembalinya artifact (returnDesktopArtifact menerima job
 * need_approval) atau digagalkan (failDesktopJob).
 */
export async function markDesktopJobNeedsApproval(
  db: Db,
  input: { companyId: string; jobId: string; reason: string },
): Promise<BinderDesktopJob> {
  return withBudgetSpan("binder.sync.job.need_approval", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const { job } = await loadDesktopJobForUpdate(tx, input.companyId, input.jobId);
      if (job.status !== "running") {
        throw conflict(`Hanya job running yang bisa meminta approval (saat ini: ${job.status})`);
      }
      const [updated] = await tx
        .update(binderDesktopJobs)
        .set({ status: "need_approval", updatedAt: new Date() })
        .where(eq(binderDesktopJobs.id, job.id))
        .returning();
      await appendSyncTranscript(tx, {
        companyId: input.companyId,
        issueId: job.issueId,
        body: `[BINDER] Job desktop ${job.id.slice(0, 8)} meminta approval — ${input.reason}`,
        authorAgentId: job.agentId,
      });
      await noteSyncActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.sync.job_need_approval",
        entityType: "binder_desktop_job",
        entityId: job.id,
        issueId: job.issueId,
        details: { reason: input.reason },
      });
      return updated;
    }),
  );
}
