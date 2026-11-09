// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues } from "@paperclipai/db";
import type {
  PostizBatchPostResult,
  PostizBatchPushResult,
  PostizSyncResult,
} from "@paperclipai/shared";
import { badRequest, forbidden, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { getCeo } from "./binder-ceo.js";
import {
  createPostizDraft,
  extractPostizContent,
  listPostizPosts,
  mapPostizStateToBinder,
  resolvePostizConnection,
  uploadPostizMedia,
  PostizHttpError,
  type PostizConnection,
  type PostizMediaInput,
} from "./binder-postiz.js";
import {
  executeExternalActionViaGate,
  gateCheck,
  type ExternalActionExecutor,
} from "./binder-sync-gate.js";
import { validateApprovedAction } from "./binder-task-flow.js";

/**
 * Batch push Postiz BINDER — integrasi planner hibrida opsi C
 * (rancangan tahap1/desain-integrasi-postiz-hibrida-2026-11-09.md;
 * Fase B). Satu batch issue dikirim ke Postiz sebagai DRAFT, lewat
 * Gate dengan SATU `approved_action_id` sekali pakai yang sudah
 * diterbitkan owner untuk batch itu.
 *
 * Urutan yang dijamin (tidak ada panggilan Postiz sebelum Gate
 * mengizinkan):
 *   1. Validasi id + scope (issue yang diminta harus subset dari
 *      `payload.postIssueIds` di approved action) + muat issue.
 *   2. `gateCheck` (kind `publish`, approved kind `external_post`).
 *   3. `executeExternalActionViaGate` menjalankan executor batch —
 *      executor yang memanggil Postiz (upload media bila ada, lalu
 *      create draft per post, berurutan). Baris issue ditulis
 *      sesudah tiap create berhasil, jadi progres parsial tahan.
 *   4. Galat transport/429 di tengah → berhenti langsung, lempar
 *      (id TIDAK terpakai, bisa retry); retry melewati post yang
 *      sudah pushed lewat `already_pushed`.
 *
 * Ledger TIDAK berubah: push ke Postiz bukan pengeluaran (tidak ada
 * biaya per draft; biaya QC sudah dibayar saat review, bukan saat
 * push). Kunci API sampai ke executor lewat closure saja — TIDAK
 * PERNAH lewat payload approved action yang tersimpan, TIDAK
 * PERNAH dicatat di log (P1-24).
 */

export type BinderPostizBatchInput = {
  companyId: string;
  approvedActionId: string;
  issueIds: string[];
  integrationId: string;
  baseUrl: string;
  /** Kunci sementara sekali pakai — TIDAK PERNAH disimpan. */
  apiKey?: string;
  /** Referensi kunci yang sudah terpasang di server. */
  apiKeyRef?: string;
  /** Media per issue (opsional) — bila ada, diunggah dulu sebelum create. */
  mediaByIssueId?: Record<string, PostizMediaInput>;
};

export type BinderPostizBatchDeps = {
  /** Transport HTTP — default fetch global; stub di test. */
  fetchImpl?: typeof fetch;
  /** Lingkungan untuk resolusi '{env:NAMA_VAR}' — default process.env. */
  env?: Record<string, string | undefined>;
};

type BatchIssueRow = {
  id: string;
  title: string | null;
  description: string | null;
  dueDate: Date | null;
  postizPostId: string | null;
  postizState: string | null;
};

function readPostIssueIds(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).postIssueIds;
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function countOutcomes(results: PostizBatchPostResult[]): {
  pushed: number;
  skipped: number;
  failed: number;
  alreadyPushed: number;
} {
  let pushed = 0;
  let skipped = 0;
  let failed = 0;
  let alreadyPushed = 0;
  for (const result of results) {
    if (result.outcome === "pushed") pushed += 1;
    else if (result.outcome === "skipped") skipped += 1;
    else if (result.outcome === "failed") failed += 1;
    else alreadyPushed += 1;
  }
  return { pushed, skipped, failed, alreadyPushed };
}

export async function pushBinderPostizBatch(
  db: Db,
  input: BinderPostizBatchInput,
  deps: BinderPostizBatchDeps = {},
): Promise<PostizBatchPushResult> {
  const env = deps.env ?? process.env;
  const { baseUrl, apiKey } = resolvePostizConnection(
    { baseUrl: input.baseUrl, apiKey: input.apiKey, apiKeyRef: input.apiKeyRef },
    env,
  );
  if (!apiKey) {
    throw badRequest(
      "Belum ada API key Postiz — masukkan API key, atau pasang '{env:POSTIZ_API_KEY}' di server, lalu coba lagi.",
    );
  }
  const conn: PostizConnection = { baseUrl, apiKey };

  // 1. Validasi id + scope — SEBELUM Gate, tanpa panggilan Postiz.
  // (Bacaan ini tidak butuh transaksi: Gate memvalidasi ulang id
  // saat gateCheck dan sekali lagi saat eksekusi — bacaan basi di
  // sini hanya mengubah pesan galat, bukan keamanan.)
  const check = await validateApprovedAction(db, input.companyId, input.approvedActionId);
  if (!check.valid || !check.action) {
    throw forbidden(
      `approved_action_id tidak berlaku: ${check.reason ?? "tidak ditemukan"} — batch ditolak Gate sebelum ada panggilan ke Postiz.`,
    );
  }
  const action = check.action;
  if (action.actionKind !== "external_post") {
    throw forbidden(
      `approved_action_id ini untuk jenis aksi '${action.actionKind}', bukan 'external_post' — batch ditolak Gate.`,
    );
  }
  if (!action.issueId) {
    throw forbidden("approved_action_id ini tidak terikat ke task pilot — batch ditolak Gate.");
  }
  const allowedIssueIds = readPostIssueIds(action.payload);
  if (!allowedIssueIds) {
    throw badRequest(
      "approved_action_id ini tidak membawa daftar issue batch (payload.postIssueIds) — minta CEO menyiapkan ulang pengajuan batch.",
    );
  }
  const extras = input.issueIds.filter((id) => !allowedIssueIds.includes(id));
  if (extras.length > 0) {
    throw forbidden(
      `Batch meminta ${extras.length} issue di luar cakupan persetujuan owner — batch ditolak Gate sebelum ada panggilan ke Postiz.`,
    );
  }
  const anchorIssueId = action.issueId;

  const rows = await db
    .select({
      id: issues.id,
      title: issues.title,
      description: issues.description,
      dueDate: issues.dueDate,
      postizPostId: issues.postizPostId,
      postizState: issues.postizState,
    })
    .from(issues)
    .where(and(eq(issues.companyId, input.companyId), inArray(issues.id, input.issueIds)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = input.issueIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw notFound(`Issue tidak ditemukan di company ini: ${missing.join(", ")}`);
  }
  const orderedIssues: BatchIssueRow[] = input.issueIds.map((id) => byId.get(id) as BatchIssueRow);

  // CEO adalah agen pelaksana batch (Gate butuh agentId).
  const ceo = await getCeo(db);

  // 2. Gate — keputusan dicatat di binderGateDecisions.
  const decision = await gateCheck(db, {
    companyId: input.companyId,
    issueId: anchorIssueId,
    agentId: ceo.agent.id,
    actionKind: "publish",
    approvedActionId: input.approvedActionId,
  });
  if (!decision.allowed) {
    throw forbidden(`Keputusan Gate menolak batch: ${decision.reason}`);
  }

  // 3. Executor batch — satu panggilan Gate, per post berurutan.
  const progress: PostizBatchPostResult[] = [];
  let batchError: unknown = null;
  const executor: ExternalActionExecutor = {
    name: "binder-postiz-batch",
    async execute() {
      try {
        for (const issue of orderedIssues) {
          if (issue.postizPostId) {
            progress.push({
              issueId: issue.id,
              outcome: "already_pushed",
              postizPostId: issue.postizPostId,
              mediaMissing: false,
              reason: "Sudah pernah dikirim ke Postiz — dilewati supaya tidak duplikat.",
            });
            continue;
          }
          const content = extractPostizContent(issue.description);
          if (!content) {
            progress.push({
              issueId: issue.id,
              outcome: "skipped",
              postizPostId: null,
              mediaMissing: false,
              reason:
                "Copy tidak ditemukan di deskripsi issue — dilewati; deskripsi mentah (arahan visual + sumber internal) tidak boleh diposting.",
            });
            continue;
          }
          let media: { id: string; path?: string }[] = [];
          let mediaMissing = true;
          const mediaInput = input.mediaByIssueId?.[issue.id];
          if (mediaInput) {
            const uploaded = await uploadPostizMedia(conn, mediaInput, deps);
            media = [uploaded];
            mediaMissing = false;
          }
          const date = issue.dueDate ? issue.dueDate.toISOString() : new Date().toISOString();
          const { postId } = await createPostizDraft(
            conn,
            { integrationId: input.integrationId, content, date, media },
            deps,
          );
          // Tulis baris issue sesudah create berhasil — progres parsial tahan
          // bila post berikutnya gagal (429/transport).
          await db
            .update(issues)
            .set({
              postizPostId: postId,
              postizState: "draft",
              postizPushedAt: new Date(),
            })
            .where(and(eq(issues.id, issue.id), eq(issues.companyId, input.companyId)));
          progress.push({
            issueId: issue.id,
            outcome: "pushed",
            postizPostId: postId,
            mediaMissing,
            reason: postId
              ? null
              : "Postiz tidak mengembalikan id post — draft tetap dibuat, tapi sinkronisasi tidak bisa mencocokkannya sampai id diisi manual.",
          });
        }
      } catch (error) {
        // Simpan galat asli supaya pemanggil bisa membedakan 429 dari
        // galat lain — wrapper Gate hanya membawa pesan sebagai teks.
        batchError = error;
        throw error;
      }
      const counts = countOutcomes(progress);
      return {
        transportRef: `postiz-batch:pushed=${counts.pushed},skipped=${counts.skipped},already=${counts.alreadyPushed}`,
      };
    },
  };

  let transportRef: string | null = null;
  try {
    const executed = await executeExternalActionViaGate(db, executor, {
      companyId: input.companyId,
      issueId: anchorIssueId,
      agentId: ceo.agent.id,
      actionKind: "publish",
      gateDecision: decision,
    });
    transportRef = executed.transportRef;
  } catch (error) {
    // Executor gagal di tengah (transport/429): id TIDAK dihabiskan
    // (aturan Gate), progres parsial di `progress` tetap dilaporkan.
    const original = batchError ?? error;
    const message =
      original instanceof Error ? original.message : "Eksekusi batch gagal di transport.";
    const counts = countOutcomes(progress);
    const rateLimited = original instanceof PostizHttpError && original.isRateLimited;
    logger.info(
      { pushed: counts.pushed, failed: counts.failed, rateLimited, error: message.slice(0, 200) },
      "binder postiz batch: berhenti di tengah",
    );
    return {
      approvedActionId: input.approvedActionId,
      ...counts,
      results: progress,
      transportRef: null,
      error: message,
      rateLimited,
    };
  }

  const counts = countOutcomes(progress);
  logger.info(
    { pushed: counts.pushed, skipped: counts.skipped, alreadyPushed: counts.alreadyPushed, transportRef },
    "binder postiz batch: selesai",
  );
  return {
    approvedActionId: input.approvedActionId,
    ...counts,
    results: progress,
    transportRef,
    error: null,
    rateLimited: false,
  };
}

export type BinderPostizSyncInput = {
  companyId: string;
  baseUrl: string;
  /** Kunci sementara sekali pakai — TIDAK PERNAH disimpan. */
  apiKey?: string;
  /** Referensi kunci yang sudah terpasang di server. */
  apiKeyRef?: string;
  startDate: string;
  endDate: string;
};

export type BinderPostizSyncDeps = {
  /** Transport HTTP — default fetch global; stub di test. */
  fetchImpl?: typeof fetch;
  /** Lingkungan untuk resolusi '{env:NAMA_VAR}' — default process.env. */
  env?: Record<string, string | undefined>;
};

/**
 * Sync status Postiz (Fase B) — HANYA MEMBACA. Tanpa Gate id
 * (sekelas Test Connection): GET /posts dalam rentang tanggal,
 * cocokkan ke issue lewat `postiz_post_id`, perbarui `postiz_state`
 * bila berubah. Status issue BINDER TIDAK diubah otomatis.
 */
export async function syncBinderPostizStatus(
  db: Db,
  input: BinderPostizSyncInput,
  deps: BinderPostizSyncDeps = {},
): Promise<PostizSyncResult> {
  const env = deps.env ?? process.env;
  const { baseUrl, apiKey } = resolvePostizConnection(
    { baseUrl: input.baseUrl, apiKey: input.apiKey, apiKeyRef: input.apiKeyRef },
    env,
  );
  if (!apiKey) {
    throw badRequest(
      "Belum ada API key Postiz — masukkan API key, atau pasang '{env:POSTIZ_API_KEY}' di server, lalu coba lagi.",
    );
  }
  const posts = await listPostizPosts(
    { baseUrl, apiKey },
    { startDate: input.startDate, endDate: input.endDate },
    deps,
  );

  const tracked = await db
    .select({ id: issues.id, postizPostId: issues.postizPostId, postizState: issues.postizState })
    .from(issues)
    .where(and(eq(issues.companyId, input.companyId), isNotNull(issues.postizPostId)));
  const byPostizId = new Map(
    tracked
      .filter((row) => row.postizPostId)
      .map((row) => [row.postizPostId as string, row]),
  );

  const result: PostizSyncResult = { checked: posts.length, updated: 0, unknown: [], changes: [] };
  for (const post of posts) {
    const issue = byPostizId.get(post.id);
    if (!issue) continue;
    const nextState = mapPostizStateToBinder(post.state);
    if (!nextState) {
      result.unknown.push({ postizPostId: post.id, state: post.state });
      continue;
    }
    const previousState = issue.postizState ?? "belum_dikirim";
    if (previousState === nextState) continue;
    await db
      .update(issues)
      .set({ postizState: nextState })
      .where(and(eq(issues.id, issue.id), eq(issues.companyId, input.companyId)));
    result.updated += 1;
    result.changes.push({
      issueId: issue.id,
      postizPostId: post.id,
      previousState,
      nextState,
    });
  }
  logger.info(
    { checked: result.checked, updated: result.updated, unknown: result.unknown.length },
    "binder postiz sync: selesai",
  );
  return result;
}
