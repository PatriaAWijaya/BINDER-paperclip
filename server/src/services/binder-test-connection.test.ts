// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import { testBinderModelConnection } from "./binder-test-connection.js";

/**
 * Test Fase 3.5 — Test Connection model BINDER (PRD Bab 7; syarat
 * kemudahan ganti model 8 Nov 2026 07:22 WIB).
 *
 * Pure unit test dengan transport stub yang diinjeksikan — TIDAK ADA
 * pemanggilan provider nyata, TIDAK ADA kunci nyata. Kunci uji di bawah
 * adalah string karangan ("kunci-test-...") yang tidak berlaku di
 * provider mana pun; dipakai hanya untuk membuktikan alur resolusi
 * dan bahwa kunci TIDAK PERNAH muncul di hasil.
 */

function stubFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((url: string, init?: RequestInit) => Promise.resolve(impl(url, init))) as typeof fetch;
}

function okResponse(): Response {
  return { ok: true, status: 200 } as Response;
}

describe("testBinderModelConnection", () => {
  it("tanpa kunci: status not_configured + pesan bahasa biasa, tanpa panggilan", async () => {
    const fetchImpl = vi.fn(stubFetch(() => okResponse()));
    const result = await testBinderModelConnection(
      { provider: "meta", modelId: "muse-spark-1.3", apiKeyRef: "{env:META_API_KEY}" },
      { fetchImpl, env: {} },
    );
    expect(result.status).toBe("not_configured");
    expect(result.message).toContain("Belum ada API key untuk Meta");
    expect(result.latencyMs).toBeNull();
    expect(result.httpStatus).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("kunci sementara sekali pakai dipakai sebagai Bearer + 200 → ok", async () => {
    let seenAuth: string | undefined;
    let seenUrl: string | undefined;
    const fetchImpl = stubFetch((url, init) => {
      seenUrl = url;
      seenAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
      return okResponse();
    });
    const result = await testBinderModelConnection(
      { provider: "meta", modelId: "muse-spark-1.3", apiKey: "kunci-test-sementara" },
      { fetchImpl, env: { META_API_KEY: "kunci-test-env" } },
    );
    expect(result.status).toBe("ok");
    expect(result.message).toContain("Terhubung");
    expect(result.httpStatus).toBe(200);
    expect(typeof result.latencyMs).toBe("number");
    expect(seenUrl).toBe("https://api.meta.ai/v1/models");
    // Kunci sementara menang atas referensi env.
    expect(seenAuth).toBe("Bearer kunci-test-sementara");
    // Hasil TIDAK PERNAH mengandung nilai kunci.
    expect(JSON.stringify(result)).not.toContain("kunci-test-sementara");
    expect(JSON.stringify(result)).not.toContain("kunci-test-env");
  });

  it("apiKeyRef '{env:...}' diselesaikan dari env server", async () => {
    let seenAuth: string | undefined;
    const fetchImpl = stubFetch((_url, init) => {
      seenAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
      return okResponse();
    });
    const result = await testBinderModelConnection(
      { provider: "meta", modelId: "muse-spark-1.3", apiKeyRef: "{env:META_API_KEY}" },
      { fetchImpl, env: { META_API_KEY: "kunci-test-env" } },
    );
    expect(result.status).toBe("ok");
    expect(seenAuth).toBe("Bearer kunci-test-env");
    expect(JSON.stringify(result)).not.toContain("kunci-test-env");
  });

  it("Anthropic: memakai x-api-key + anthropic-version", async () => {
    let seenHeaders: Record<string, string> | undefined;
    let seenUrl: string | undefined;
    const fetchImpl = stubFetch((url, init) => {
      seenUrl = url;
      seenHeaders = init?.headers as Record<string, string>;
      return okResponse();
    });
    const result = await testBinderModelConnection(
      { provider: "anthropic", modelId: "claude-sonnet-5-5", apiKey: "kunci-test-anthropic" },
      { fetchImpl },
    );
    expect(result.status).toBe("ok");
    expect(seenUrl).toBe("https://api.anthropic.com/v1/models");
    expect(seenHeaders?.["x-api-key"]).toBe("kunci-test-anthropic");
    expect(seenHeaders?.["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.stringify(result)).not.toContain("kunci-test-anthropic");
  });

  it("401 → failed + pesan 'API key ditolak'", async () => {
    const fetchImpl = stubFetch(() => ({ ok: false, status: 401 }) as Response);
    const result = await testBinderModelConnection(
      { provider: "meta", modelId: "muse-spark-1.3", apiKey: "kunci-test-salah" },
      { fetchImpl },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(401);
    expect(result.message).toContain("API key ditolak");
    expect(JSON.stringify(result)).not.toContain("kunci-test-salah");
  });

  it("429 → failed + pesan 'membatasi permintaan'", async () => {
    const fetchImpl = stubFetch(() => ({ ok: false, status: 429 }) as Response);
    const result = await testBinderModelConnection(
      { provider: "anthropic", modelId: "claude-sonnet-5-5", apiKey: "kunci-test" },
      { fetchImpl },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(429);
    expect(result.message).toContain("membatasi permintaan");
  });

  it("5xx → failed + pesan 'sedang bermasalah'", async () => {
    const fetchImpl = stubFetch(() => ({ ok: false, status: 503 }) as Response);
    const result = await testBinderModelConnection(
      { provider: "meta", modelId: "muse-spark-1.3", apiKey: "kunci-test" },
      { fetchImpl },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(503);
    expect(result.message).toContain("sedang bermasalah");
  });

  it("galat jaringan → failed + pesan 'Tidak bisa menghubungi'", async () => {
    const fetchImpl = stubFetch(() => {
      throw new Error("jaringan putus (simulasi test)");
    });
    const result = await testBinderModelConnection(
      { provider: "meta", modelId: "muse-spark-1.3", apiKey: "kunci-test" },
      { fetchImpl },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBeNull();
    expect(result.message).toContain("Tidak bisa menghubungi");
  });

  it("abort/timeout → failed + pesan 'Waktu habis'", async () => {
    const fetchImpl = stubFetch(() => {
      const error = new Error("waktu habis (simulasi test)");
      error.name = "AbortError";
      throw error;
    });
    const result = await testBinderModelConnection(
      { provider: "meta", modelId: "muse-spark-1.3", apiKey: "kunci-test" },
      { fetchImpl },
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Waktu habis");
  });
});
