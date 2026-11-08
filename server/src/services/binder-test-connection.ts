// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import {
  BINDER_TEST_CONNECTION_TIMEOUT_MS,
  type BinderTestConnection,
  type BinderTestConnectionResult,
  type BinderTestConnectionStatus,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";

/**
 * Test Connection model BINDER (PRD Bab 7; rencana Tahap 3 Fase 3.5;
 * syarat kemudahan ganti model 8 Nov 2026 07:22 WIB — "masukkan API key,
 * konfirmasi, jalan").
 *
 * Satu tempat memasukkan API key per provider + tombol Test Connection +
 * status hasil. Panggilan ke provider bersifat NYATA bila kunci tersedia:
 * GET /v1/models (tanpa biaya inferensi) ke Meta (api.meta.ai) atau
 * Anthropic (api.anthropic.com). Kunci dipakai sekali untuk panggilan
 * uji, lalu dibuang — TIDAK PERNAH disimpan, dicatat di log, atau
 * dikembalikan di respons (P1-24). Bila kunci belum ada, jawabannya
 * adalah status 'not_configured' ("belum terhubung") — keadaan itu
 * jawaban, bukan galat.
 *
 * TIDAK ADA pemanggilan model live dengan kunci nyata di fase ini:
 * verifikasi memakai transport stub yang diinjeksikan di test;
 * pembuktian live dengan kunci Patria adalah langkah Tahap 6/MacBook.
 * Service ini pure terhadap transport (fetch diinjeksikan) dan env
 * (record diinjeksikan) supaya bisa diuji tanpa jaringan dan tanpa
 * kunci nyata.
 */

type TestConnectionDeps = {
  /** Transport HTTP — default fetch global; stub di test. */
  fetchImpl?: typeof fetch;
  /** Lingkungan untuk resolusi '{env:NAMA_VAR}' — default process.env. */
  env?: Record<string, string | undefined>;
};

const PROVIDER_MODELS_ENDPOINT: Record<string, { url: string; label: string }> = {
  meta: { url: "https://api.meta.ai/v1/models", label: "Meta" },
  anthropic: { url: "https://api.anthropic.com/v1/models", label: "Anthropic" },
};

function providerLabel(provider: string): string {
  return PROVIDER_MODELS_ENDPOINT[provider]?.label ?? provider;
}

function resolveApiKeyRef(ref: string, env: Record<string, string | undefined>): string | null {
  const match = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(ref);
  if (!match) return null;
  const value = env[match[1]]?.trim();
  return value ? value : null;
}

function buildHeaders(provider: string, apiKey: string): Record<string, string> {
  if (provider === "anthropic") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
    };
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
}

function plainMessage(
  status: BinderTestConnectionStatus,
  provider: string,
  modelId: string,
  httpStatus: number | null,
  timedOut: boolean,
): string {
  const label = providerLabel(provider);
  if (status === "not_configured") {
    return `Belum ada API key untuk ${label} — masukkan API key, lalu tekan Test Connection.`;
  }
  if (status === "ok") {
    return `Terhubung — ${label} menjawab untuk model ${modelId}.`;
  }
  if (timedOut) {
    return `Waktu habis (15 detik) — ${label} tidak menjawab. Periksa koneksi internet, lalu coba lagi.`;
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return `API key ditolak ${label} — periksa kembali key-nya, lalu coba lagi.`;
  }
  if (httpStatus === 429) {
    return `${label} membatasi permintaan untuk sementara — tunggu sebentar, lalu coba lagi.`;
  }
  if (httpStatus !== null && httpStatus >= 500) {
    return `${label} sedang bermasalah (galat ${httpStatus}) — coba lagi nanti.`;
  }
  if (httpStatus !== null) {
    return `${label} menjawab dengan galat ${httpStatus} — coba lagi; bila terus gagal, periksa key dan koneksi.`;
  }
  return `Tidak bisa menghubungi ${label} — periksa koneksi internet, lalu coba lagi.`;
}

export async function testBinderModelConnection(
  input: BinderTestConnection,
  deps: TestConnectionDeps = {},
): Promise<BinderTestConnectionResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const endpoint = PROVIDER_MODELS_ENDPOINT[input.provider];
  if (!endpoint) {
    throw new Error(`Provider Test Connection tidak dikenal: ${input.provider}`);
  }

  const transientKey = input.apiKey?.trim() ? input.apiKey.trim() : null;
  const apiKey =
    transientKey ?? (input.apiKeyRef ? resolveApiKeyRef(input.apiKeyRef, env) : null);

  const base: Omit<BinderTestConnectionResult, "status" | "message"> = {
    provider: input.provider,
    modelId: input.modelId,
    latencyMs: null,
    httpStatus: null,
  };

  if (!apiKey) {
    const result: BinderTestConnectionResult = {
      ...base,
      status: "not_configured",
      message: plainMessage("not_configured", input.provider, input.modelId, null, false),
    };
    logger.info(
      { provider: input.provider, modelId: input.modelId, status: result.status },
      "binder test-connection: belum ada API key",
    );
    return result;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BINDER_TEST_CONNECTION_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: "GET",
      headers: buildHeaders(input.provider, apiKey),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const httpStatus = response.status;
    const ok = response.ok;
    const status: BinderTestConnectionStatus = ok ? "ok" : "failed";
    const result: BinderTestConnectionResult = {
      ...base,
      status,
      message: plainMessage(status, input.provider, input.modelId, httpStatus, false),
      latencyMs,
      httpStatus,
    };
    logger.info(
      { provider: input.provider, modelId: input.modelId, status, httpStatus, latencyMs },
      "binder test-connection: selesai",
    );
    return result;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const timedOut =
      error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    const result: BinderTestConnectionResult = {
      ...base,
      status: "failed",
      message: plainMessage("failed", input.provider, input.modelId, null, timedOut),
      latencyMs,
      httpStatus: null,
    };
    logger.info(
      { provider: input.provider, modelId: input.modelId, status: "failed", latencyMs, timedOut },
      "binder test-connection: gagal",
    );
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
