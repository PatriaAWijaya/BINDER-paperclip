// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import { testBinderPostizConnection } from "./binder-postiz-test-connection.js";

/**
 * Test Fase A Postiz — Test Connection Postiz BINDER (integrasi
 * planner hibrida opsi C; aturan hosting umum Patria 9 Nov 2026:
 * self-hosted dulu, cloud siap lewat konfigurasi base URL).
 *
 * Pure unit test dengan transport stub yang diinjeksikan — TIDAK ADA
 * pemanggilan Postiz nyata, TIDAK ADA kunci nyata. Kunci uji di bawah
 * adalah string karangan ("kunci-test-...") yang tidak berlaku di
 * instance mana pun; dipakai hanya untuk membuktikan alur resolusi
 * dan bahwa kunci TIDAK PERNAH muncul di hasil.
 */

function stubFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((url: string, init?: RequestInit) => Promise.resolve(impl(url, init))) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("testBinderPostizConnection", () => {
  it("tanpa kunci: status not_configured + pesan bahasa biasa, tanpa panggilan", async () => {
    const fetchImpl = vi.fn(stubFetch(() => jsonResponse(200, [])));
    const result = await testBinderPostizConnection(
      { baseUrl: "http://localhost:5000", apiKeyRef: "{env:POSTIZ_API_KEY}" },
      { fetchImpl, env: {} },
    );
    expect(result.status).toBe("not_configured");
    expect(result.message).toContain("Belum ada API key Postiz");
    expect(result.latencyMs).toBeNull();
    expect(result.httpStatus).toBeNull();
    expect(result.integrations).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("kunci sementara dipakai sebagai Authorization mentah; 200 + daftar channel → ok", async () => {
    let seenAuth: string | undefined;
    let seenUrl: string | undefined;
    const fetchImpl = stubFetch((url, init) => {
      seenUrl = url;
      seenAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
      return jsonResponse(200, [
        { id: "int-1", name: "Saleem IG", identifier: "instagram" },
        { id: "int-2", name: "Saleem FB", identifier: "facebook" },
      ]);
    });
    const result = await testBinderPostizConnection(
      { baseUrl: "http://localhost:5000/", apiKey: "kunci-test-sementara" },
      { fetchImpl, env: { POSTIZ_API_KEY: "kunci-test-env" } },
    );
    expect(result.status).toBe("ok");
    expect(result.message).toContain("Terhubung");
    expect(result.message).toContain("2 channel");
    expect(result.httpStatus).toBe(200);
    expect(typeof result.latencyMs).toBe("number");
    expect(seenUrl).toBe("http://localhost:5000/public/v1/integrations");
    // Kunci sementara menang atas referensi env; bentuk header mentah.
    expect(seenAuth).toBe("kunci-test-sementara");
    expect(result.integrations).toEqual([
      { id: "int-1", name: "Saleem IG", provider: "instagram" },
      { id: "int-2", name: "Saleem FB", provider: "facebook" },
    ]);
    // Kunci TIDAK PERNAH muncul di hasil.
    expect(JSON.stringify(result)).not.toContain("kunci-test-sementara");
  });

  it("referensi env {env:POSTIZ_API_KEY} dipakai bila tanpa kunci sementara", async () => {
    let seenAuth: string | undefined;
    const fetchImpl = stubFetch((_url, init) => {
      seenAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
      return jsonResponse(200, { data: [{ id: "int-9", name: "Kanal Uji", provider: "instagram" }] });
    });
    const result = await testBinderPostizConnection(
      { baseUrl: "https://api.postiz.com", apiKeyRef: "{env:POSTIZ_API_KEY}" },
      { fetchImpl, env: { POSTIZ_API_KEY: "kunci-test-env" } },
    );
    expect(result.status).toBe("ok");
    expect(seenAuth).toBe("kunci-test-env");
    expect(result.integrations).toEqual([{ id: "int-9", name: "Kanal Uji", provider: "instagram" }]);
    expect(JSON.stringify(result)).not.toContain("kunci-test-env");
  });

  it("200 tanpa channel → ok dengan pesan 'belum ada channel'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(200, []));
    const result = await testBinderPostizConnection(
      { baseUrl: "http://localhost:5000", apiKey: "kunci-test-sementara" },
      { fetchImpl, env: {} },
    );
    expect(result.status).toBe("ok");
    expect(result.message).toContain("belum ada channel");
    expect(result.integrations).toEqual([]);
  });

  it("401 → failed dengan pesan 'API key ditolak'", async () => {
    const fetchImpl = stubFetch(() => jsonResponse(401, { message: "Unauthorized" }));
    const result = await testBinderPostizConnection(
      { baseUrl: "http://localhost:5000", apiKey: "kunci-test-salah" },
      { fetchImpl, env: {} },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(401);
    expect(result.message).toContain("API key ditolak Postiz");
    expect(result.integrations).toBeNull();
  });

  it("jaringan putus → failed dengan pesan bahasa biasa, tanpa status HTTP", async () => {
    const fetchImpl = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const result = await testBinderPostizConnection(
      { baseUrl: "http://localhost:5000", apiKey: "kunci-test-sementara" },
      { fetchImpl, env: {} },
    );
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBeNull();
    expect(result.message).toContain("Tidak bisa menghubungi Postiz");
  });
});
