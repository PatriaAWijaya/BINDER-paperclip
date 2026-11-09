// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import {
  BINDER_TEST_CONNECTION_TIMEOUT_MS,
  type PostizIntegrationSummary,
  type PostizTestConnection,
  type PostizTestConnectionResult,
  type PostizTestConnectionStatus,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";

/**
 * Test Connection Postiz BINDER — integrasi planner hibrida opsi C
 * (rancangan tahap1/desain-integrasi-postiz-hibrida-2026-11-09.md;
 * aturan hosting umum Patria 9 Nov 2026: self-hosted dulu, cloud
 * siap lewat konfigurasi base URL).
 *
 * Satu tempat memasukkan API key Postiz + tombol Uji koneksi + status
 * hasil. Panggilan ke Postiz bersifat NYATA bila kunci tersedia:
 * GET {baseUrl}/public/v1/integrations (tanpa biaya, hanya membaca
 * daftar channel). Kunci dipakai sekali untuk panggilan uji, lalu
 * dibuang — TIDAK PERNAH disimpan, dicatat di log, atau dikembalikan
 * di respons (P1-24). Bila kunci belum ada, jawabannya status
 * 'not_configured' ("belum terhubung") — keadaan itu jawaban, bukan
 * galat.
 *
 * BENTUK HEADER — TERKONFIRMASI 9 Nov 2026 (Fase B): bentuk mentah
 * `Authorization: <key>` benar — middleware Postiz sendiri
 * (public.auth.middleware.ts:16-20, dikutip di referensi API yang
 * dipin ke postiz-app v2.21.6) membaca header mentah tanpa awalan
 * Bearer, dan menulis `Bearer <key>` justru gagal code review di
 * sana. Pesan 401 di bawah tetap menyebut Bearer sebagai fallback
 * darurat bila sebuah instance menolak key yang benar.
 *
 * TIDAK ADA instance Postiz live di fase ini: verifikasi memakai
 * transport stub yang diinjeksikan di test; pembuktian live dengan
 * instance self-hosted + kunci Patria adalah langkah Fase C.
 * Service ini pure terhadap transport (fetch diinjeksikan) dan env
 * (record diinjeksikan) supaya bisa diuji tanpa jaringan dan tanpa
 * kunci nyata.
 */

type PostizTestConnectionDeps = {
  /** Transport HTTP — default fetch global; stub di test. */
  fetchImpl?: typeof fetch;
  /** Lingkungan untuk resolusi '{env:NAMA_VAR}' — default process.env. */
  env?: Record<string, string | undefined>;
};

export function resolveApiKeyRef(ref: string, env: Record<string, string | undefined>): string | null {
  const match = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(ref);
  if (!match) return null;
  const value = env[match[1]]?.trim();
  return value ? value : null;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function parseIntegrations(body: unknown): PostizIntegrationSummary[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).data)
      ? ((body as Record<string, unknown>).data as unknown[])
      : [];
  const out: PostizIntegrationSummary[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : typeof row.id === "number" ? String(row.id) : null;
    const name = typeof row.name === "string" ? row.name : null;
    const provider =
      typeof row.identifier === "string"
        ? row.identifier
        : typeof row.provider === "string"
          ? row.provider
          : typeof row.type === "string"
            ? row.type
            : null;
    if (id && name) out.push({ id, name, provider });
  }
  return out;
}

function plainMessage(
  status: PostizTestConnectionStatus,
  httpStatus: number | null,
  timedOut: boolean,
  integrationCount: number | null,
): string {
  if (status === "not_configured") {
    return "Belum ada API key Postiz — masukkan API key, lalu tekan Uji koneksi.";
  }
  if (status === "ok") {
    if (integrationCount === null) return "Terhubung — Postiz menjawab.";
    if (integrationCount === 0) {
      return "Terhubung — Postiz menjawab, tapi belum ada channel yang terhubung. Sambungkan dulu channel Instagram di Postiz.";
    }
    return `Terhubung — Postiz menjawab dengan ${integrationCount} channel.`;
  }
  if (timedOut) {
    return "Waktu habis (15 detik) — Postiz tidak menjawab. Periksa alamat instance dan koneksi, lalu coba lagi.";
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return "API key ditolak Postiz — periksa kembali key-nya, lalu coba lagi. Bila key sudah benar, coba bentuk header Bearer (lihat catatan di kode).";
  }
  if (httpStatus === 404) {
    return "Alamat Postiz tidak ditemukan (404) — periksa base URL instance-nya, lalu coba lagi.";
  }
  if (httpStatus !== null && httpStatus >= 500) {
    return `Postiz sedang bermasalah (galat ${httpStatus}) — coba lagi nanti.`;
  }
  if (httpStatus !== null) {
    return `Postiz menjawab dengan galat ${httpStatus} — coba lagi; bila terus gagal, periksa base URL dan key.`;
  }
  return "Tidak bisa menghubungi Postiz — periksa alamat instance dan koneksi, lalu coba lagi.";
}

export async function testBinderPostizConnection(
  input: PostizTestConnection,
  deps: PostizTestConnectionDeps = {},
): Promise<PostizTestConnectionResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const baseUrl = normalizeBaseUrl(input.baseUrl);

  const transientKey = input.apiKey?.trim() ? input.apiKey.trim() : null;
  const apiKey =
    transientKey ?? (input.apiKeyRef ? resolveApiKeyRef(input.apiKeyRef, env) : null);

  const base: Omit<PostizTestConnectionResult, "status" | "message"> = {
    latencyMs: null,
    httpStatus: null,
    integrations: null,
  };

  if (!apiKey) {
    const result: PostizTestConnectionResult = {
      ...base,
      status: "not_configured",
      message: plainMessage("not_configured", null, false, null),
    };
    logger.info({ status: result.status }, "binder postiz test-connection: belum ada API key");
    return result;
  }

  const url = `${baseUrl}/public/v1/integrations`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BINDER_TEST_CONNECTION_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const httpStatus = response.status;
    if (!response.ok) {
      const result: PostizTestConnectionResult = {
        ...base,
        status: "failed",
        message: plainMessage("failed", httpStatus, false, null),
        latencyMs,
        httpStatus,
      };
      logger.info({ status: "failed", httpStatus, latencyMs }, "binder postiz test-connection: gagal");
      return result;
    }
    let integrations: PostizIntegrationSummary[] = [];
    try {
      integrations = parseIntegrations(await response.json());
    } catch {
      integrations = [];
    }
    const result: PostizTestConnectionResult = {
      ...base,
      status: "ok",
      message: plainMessage("ok", httpStatus, false, integrations.length),
      latencyMs,
      httpStatus,
      integrations,
    };
    logger.info(
      { status: "ok", httpStatus, latencyMs, integrationCount: integrations.length },
      "binder postiz test-connection: selesai",
    );
    return result;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const timedOut =
      error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    const result: PostizTestConnectionResult = {
      ...base,
      status: "failed",
      message: plainMessage("failed", null, timedOut, null),
      latencyMs,
      httpStatus: null,
    };
    logger.info({ status: "failed", latencyMs, timedOut }, "binder postiz test-connection: gagal");
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
