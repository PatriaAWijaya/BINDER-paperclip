// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import {
  BINDER_TEST_CONNECTION_TIMEOUT_MS,
  type PostizPostSummary,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import {
  normalizeBaseUrl,
  resolveApiKeyRef,
} from "./binder-postiz-test-connection.js";

/**
 * Klien HTTP Postiz BINDER — integrasi planner hibrida opsi C
 * (rancangan tahap1/desain-integrasi-postiz-hibrida-2026-11-09.md;
 * Fase B: upload media, create draft, list posts, pemetaan state).
 *
 * Kode BINDER sendiri, ditulis dari dokumentasi public API Postiz
 * (dipin ke postiz-app v2.21.6 — referensi API diverifikasi 9 Nov
 * 2026): header `Authorization: <key>` MENTAH (tanpa Bearer,
 * dikonfirmasi dari middleware Postiz sendiri); upload FormData
 * satu field `file`; CreatePostDto bentuk persis; GET /posts wajib
 * `startDate` + `endDate`. Postiz berlisensi AGPL-3.0: TIDAK ADA
 * kode/SDK/CLI Postiz yang di-bundle — hanya panggilan HTTP ke
 * public API-nya (pola yang sama seperti CanCut).
 *
 * Kunci API TIDAK PERNAH disimpan/dicatat: masuk lewat koneksi
 * yang sudah di-resolve (transient atau '{env:POSTIZ_API_KEY}'),
 * dipakai sekali untuk panggilan, lalu dibuang (P1-24).
 *
 * Service ini pure terhadap transport (fetch diinjeksikan) dan env
 * (record diinjeksikan) supaya bisa diuji tanpa jaringan dan tanpa
 * kunci nyata. TIDAK ADA instance Postiz live di Fase B — semua
 * test memakai fetch tiruan; pembuktian live adalah Fase C.
 */

/** MIME yang diterima POST /public/v1/upload (dokumen Postiz). */
export const POSTIZ_MEDIA_MIME_ALLOWLIST: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/tiff",
  "video/mp4",
];

/** State BINDER untuk `issues.postiz_state` (kolom Fase A). */
export type BinderPostizState = "belum_dikirim" | "draft" | "terjadwal" | "tayang" | "gagal";

export type PostizClientDeps = {
  /** Transport HTTP — default fetch global; stub di test. */
  fetchImpl?: typeof fetch;
  /** Lingkungan untuk resolusi '{env:NAMA_VAR}' — default process.env. */
  env?: Record<string, string | undefined>;
};

/** Koneksi Postiz yang sudah di-resolve (kunci siap dipakai sekali). */
export type PostizConnection = {
  baseUrl: string;
  apiKey: string;
};

/** Input koneksi sebelum resolusi kunci (dari route/UI). */
export type PostizConnectionInput = {
  baseUrl: string;
  apiKey?: string;
  apiKeyRef?: string;
};

/** Galat HTTP dari Postiz — dilempar, bukan dikembalikan. */
export class PostizHttpError extends Error {
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, status: number | null, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "PostizHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * Resolve koneksi Postiz dari input route: kunci transient diutamakan,
 * bila tidak ada pakai referensi '{env:...}'. Mengembalikan apiKey null
 * bila kunci tidak tersedia (pemanggil menjawab 'not_configured',
 * bukan melempar).
 */
export function resolvePostizConnection(
  input: PostizConnectionInput,
  env: Record<string, string | undefined> = process.env,
): { baseUrl: string; apiKey: string | null } {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const transientKey = input.apiKey?.trim() ? input.apiKey.trim() : null;
  const apiKey = transientKey ?? (input.apiKeyRef ? resolveApiKeyRef(input.apiKeyRef, env) : null);
  return { baseUrl, apiKey };
}

type PostizRequestOptions = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  json?: unknown;
  form?: FormData;
  query?: Record<string, string>;
};

function parseRetryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

function plainPostizError(status: number | null, msg: string): string {
  if (status === 401 || status === 403) {
    return `API key ditolak Postiz (${msg}) — periksa kembali key-nya.`;
  }
  if (status === 404) {
    return "Alamat Postiz tidak ditemukan (404) — periksa base URL instance-nya.";
  }
  if (status === 429) {
    return `Postiz membatasi laju (429) — ${msg}. Berhenti, jangan retry buta.`;
  }
  if (status !== null && status >= 500) {
    return `Postiz sedang bermasalah (galat ${status}) — coba lagi nanti.`;
  }
  if (status !== null) {
    return `Postiz menolak permintaan (galat ${status}) — ${msg}.`;
  }
  return `Tidak bisa menghubungi Postiz — ${msg}.`;
}

async function postizRequest(
  conn: PostizConnection,
  path: string,
  options: PostizRequestOptions,
  deps: PostizClientDeps,
): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const query = options.query
    ? `?${new URLSearchParams(options.query).toString()}`
    : "";
  const url = `${conn.baseUrl}${path}${query}`;
  const headers: Record<string, string> = {
    Authorization: conn.apiKey,
    Accept: "application/json",
  };
  let body: string | FormData | undefined;
  if (options.form) {
    // Jangan set Content-Type — runtime mengisi boundary multipart.
    body = options.form;
  } else if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers["Content-Type"] = "application/json";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BINDER_TEST_CONNECTION_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: options.method,
      headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try {
        const errBody = (await response.json()) as { msg?: unknown };
        if (typeof errBody.msg === "string" && errBody.msg.trim()) msg = errBody.msg.trim();
      } catch {
        // Respons galat bukan JSON — pakai HTTP status saja.
      }
      throw new PostizHttpError(
        plainPostizError(response.status, msg),
        response.status,
        parseRetryAfter(response),
      );
    }
    try {
      return await response.json();
    } catch {
      return {};
    }
  } catch (error) {
    if (error instanceof PostizHttpError) throw error;
    const timedOut =
      error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new PostizHttpError(
      timedOut
        ? "Waktu habis (15 detik) — Postiz tidak menjawab. Periksa alamat instance dan koneksi."
        : `Tidak bisa menghubungi Postiz — ${error instanceof Error ? error.message : String(error)}.`,
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Bentuk CreatePostDto — dicerminkan 1:1 dari sumber Postiz
 * (libraries/nestjs-libraries/src/dtos/posts/create.post.dto.ts,
 * pin v2.21.6). Untuk type draft, validasi settings per provider
 * DILEWATI (ValidateIf type !== 'draft'), jadi `settings` tidak
 * diisi. `image: []` kosong SAH untuk draft — media ditambahkan
 * nanti (di Postiz, atau lewat langkah attach media).
 */
export function buildCreatePostDto(input: {
  integrationId: string;
  content: string;
  date: string;
  media: { id: string; path?: string }[];
}): Record<string, unknown> {
  return {
    type: "draft",
    shortLink: false,
    date: input.date,
    tags: [],
    posts: [
      {
        integration: { id: input.integrationId },
        value: [
          {
            content: input.content,
            image: input.media.map((item) =>
              item.path ? { id: item.id, path: item.path } : { id: item.id },
            ),
          },
        ],
      },
    ],
  };
}

/** Media yang akan diunggah ke Postiz (bytes + nama + MIME). */
export type PostizMediaInput = {
  bytes: Uint8Array;
  filename: string;
  mime: string;
};

function parseUploadRecord(body: unknown): { id: string; path: string } | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : typeof row.id === "number" ? String(row.id) : null;
  const path = typeof row.path === "string" ? row.path : null;
  if (!id || !path) return null;
  return { id, path };
}

/**
 * Unggah satu media ke Postiz (POST /public/v1/upload).
 * Mengembalikan `{id, path}` — `id` dipakai sebagai MediaDto.id di
 * CreatePostDto. MIME di luar allowlist ditolak sebelum panggilan.
 */
export async function uploadPostizMedia(
  conn: PostizConnection,
  media: PostizMediaInput,
  deps: PostizClientDeps = {},
): Promise<{ id: string; path: string }> {
  if (!POSTIZ_MEDIA_MIME_ALLOWLIST.includes(media.mime)) {
    throw new PostizHttpError(
      `Jenis media tidak diterima Postiz (${media.mime}) — hanya gambar dan video mp4.`,
      400,
    );
  }
  const form = new FormData();
  form.append("file", new File([media.bytes as BlobPart], media.filename, { type: media.mime }));
  const body = await postizRequest(conn, "/public/v1/upload", { method: "POST", form }, deps);
  const record = parseUploadRecord(body);
  if (!record) {
    throw new PostizHttpError("Postiz mengunggah media tapi tidak mengembalikan id media.", null);
  }
  logger.info({ mediaId: record.id }, "binder postiz: media diunggah");
  return record;
}

function extractPostId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const asId = (value: unknown): string | null =>
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : null;
  if (asId(row.id)) return asId(row.id);
  const data = row.data;
  if (data && typeof data === "object" && asId((data as Record<string, unknown>).id)) {
    return asId((data as Record<string, unknown>).id);
  }
  if (Array.isArray(data) && data.length > 0) {
    return asId((data[0] as Record<string, unknown>).id);
  }
  const posts = row.posts;
  if (Array.isArray(posts) && posts.length > 0) {
    return asId((posts[0] as Record<string, unknown>).id);
  }
  return null;
}

/**
 * Buat satu draft di Postiz (POST /public/v1/posts, type draft).
 * Mengembalikan id post Postiz bila terbaca dari respons; null bila
 * Postiz tidak mengembalikan id (draft tetap dibuat — pemanggil
 * mencatatnya jujur, bukan mengarang id).
 */
export async function createPostizDraft(
  conn: PostizConnection,
  input: {
    integrationId: string;
    content: string;
    date: string;
    media: { id: string; path?: string }[];
  },
  deps: PostizClientDeps = {},
): Promise<{ postId: string | null }> {
  const body = await postizRequest(
    conn,
    "/public/v1/posts",
    { method: "POST", json: buildCreatePostDto(input) },
    deps,
  );
  const postId = extractPostId(body);
  logger.info({ postId: postId ?? "tidak-terbaca" }, "binder postiz: draft dibuat");
  return { postId };
}

function parsePostList(body: unknown): PostizPostSummary[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).data)
      ? ((body as Record<string, unknown>).data as unknown[])
      : [];
  const out: PostizPostSummary[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : typeof row.id === "number" ? String(row.id) : null;
    const state =
      typeof row.state === "string"
        ? row.state
        : typeof row.status === "string"
          ? row.status
          : null;
    if (!id || !state) continue;
    const releaseUrl =
      typeof row.releaseURL === "string"
        ? row.releaseURL
        : typeof row.releaseUrl === "string"
          ? row.releaseUrl
          : null;
    const scheduledAt =
      typeof row.scheduledAt === "string"
        ? row.scheduledAt
        : typeof row.date === "string"
          ? row.date
          : null;
    out.push({ id, state, releaseUrl, scheduledAt });
  }
  return out;
}

/**
 * Daftar post Postiz dalam rentang tanggal (GET /public/v1/posts).
 * Postiz WAJIB `startDate` + `endDate` (ISO-8601 UTC).
 */
export async function listPostizPosts(
  conn: PostizConnection,
  range: { startDate: string; endDate: string },
  deps: PostizClientDeps = {},
): Promise<PostizPostSummary[]> {
  const body = await postizRequest(
    conn,
    "/public/v1/posts",
    {
      method: "GET",
      query: { startDate: range.startDate, endDate: range.endDate },
    },
    deps,
  );
  const posts = parsePostList(body);
  logger.info({ checked: posts.length }, "binder postiz: daftar post dibaca");
  return posts;
}

/**
 * Petakan state mentah Postiz ke state BINDER (`postiz_state`).
 * Mengembalikan null bila state tidak dikenal — pemanggil membiarkan
 * state issue apa adanya dan melaporkan post itu di `unknown`
 * (bukan menebak pemetaan).
 */
export function mapPostizStateToBinder(state: string): BinderPostizState | null {
  const value = state.trim().toLowerCase();
  if (value === "draft") return "draft";
  if (value === "scheduled" || value === "schedule") return "terjadwal";
  if (value === "published" || value === "posted" || value === "done") return "tayang";
  if (value === "failed" || value === "error") return "gagal";
  return null;
}

/**
 * Ambil copy yang bisa diposting dari deskripsi issue: teks di dalam
 * blok kode (```) sesudah baris `**Copy:**` (format draf 3C).
 * Mengembalikan null bila penanda atau bloknya tidak ditemukan, atau
 * isinya kosong — pemanggil melewati post itu dengan alasan, bukan
 * mengirim deskripsi mentah (yang berisi arahan visual, sumber, dan
 * catatan internal yang TIDAK boleh diposting).
 */
export function extractPostizContent(description: string | null | undefined): string | null {
  if (!description) return null;
  const marker = description.indexOf("**Copy:**");
  if (marker === -1) return null;
  const after = description.slice(marker + "**Copy:**".length);
  const open = after.indexOf("```");
  if (open === -1) return null;
  const close = after.indexOf("```", open + 3);
  if (close === -1) return null;
  const rawLines = after.slice(open + 3, close).split("\n");
  // Baris pertama boleh berupa penanda bahasa fence (text/md/plain)
  // — buang bila hanya satu token yang dikenal, bukan kalimat copy.
  if (
    rawLines.length > 1 &&
    ["text", "txt", "markdown", "md", "plain"].includes(rawLines[0].trim().toLowerCase())
  ) {
    rawLines.shift();
  }
  const content = rawLines.join("\n").trim();
  return content ? content : null;
}
