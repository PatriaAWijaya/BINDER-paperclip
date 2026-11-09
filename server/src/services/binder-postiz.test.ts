// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  buildCreatePostDto,
  createPostizDraft,
  extractPostizContent,
  listPostizPosts,
  mapPostizStateToBinder,
  resolvePostizConnection,
  uploadPostizMedia,
  PostizHttpError,
} from "./binder-postiz.js";

/**
 * Test Fase B — klien HTTP Postiz BINDER (tanpa jaringan, tanpa kunci
 * nyata: semua transport adalah fetch tiruan yang diinjeksikan).
 * Bentuk CreatePostDto dicerminkan 1:1 dari sumber Postiz (pin
 * v2.21.6); header Authorization MENTAH (tanpa Bearer) dikonfirmasi
 * dari middleware Postiz sendiri.
 */

type FetchCall = { url: string; init: RequestInit | undefined };

function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const CONN = { baseUrl: "http://localhost:5000", apiKey: "kunci-test" };

describe("klien HTTP Postiz BINDER", () => {
  it("buildCreatePostDto memakai bentuk persis CreatePostDto (draft)", () => {
    const dto = buildCreatePostDto({
      integrationId: "int-1",
      content: "Hari ini COP31 dimulai.",
      date: "2026-11-09T02:00:00.000Z",
      media: [],
    });
    expect(dto).toEqual({
      type: "draft",
      shortLink: false,
      date: "2026-11-09T02:00:00.000Z",
      tags: [],
      posts: [
        {
          integration: { id: "int-1" },
          value: [{ content: "Hari ini COP31 dimulai.", image: [] }],
        },
      ],
    });
  });

  it("buildCreatePostDto menaruh media yang diunggah di image[]", () => {
    const dto = buildCreatePostDto({
      integrationId: "int-1",
      content: "Copy.",
      date: "2026-11-09T02:00:00.000Z",
      media: [{ id: "media-7", path: "uploads/media-7.png" }],
    });
    const posts = dto.posts as Array<{ value: Array<{ image: unknown[] }> }>;
    expect(posts[0].value[0].image).toEqual([{ id: "media-7", path: "uploads/media-7.png" }]);
  });

  it("extractPostizContent mengambil blok copy sesudah **Copy:**", () => {
    const description = [
      "### Post 1 — Senin, 9 Nov 2026 — Peluncuran",
      "**Format:** Carousel 5 slide",
      "",
      "**Copy:**",
      "```",
      "Hari ini COP31 dimulai di Antalya, Turki.",
      "",
      "Ikuti #EnergiSurga.",
      "```",
      "",
      "**Arahan visual:**",
      "- Slide 1: foto langit pagi di atas atap masjid",
      "**Sumber (internal):** IRENA (jangan diposting)",
    ].join("\n");
    expect(extractPostizContent(description)).toBe(
      "Hari ini COP31 dimulai di Antalya, Turki.\n\nIkuti #EnergiSurga.",
    );
  });

  it("extractPostizContent mengembalikan null bila tidak ada blok copy", () => {
    expect(extractPostizContent("### Post 1\n\nTanpa blok copy.")).toBeNull();
    expect(extractPostizContent("**Copy:**\n\n```\n   \n```")).toBeNull();
    expect(extractPostizContent(null)).toBeNull();
  });

  it("mapPostizStateToBinder memetakan state yang dikenal, null bila tidak dikenal", () => {
    expect(mapPostizStateToBinder("draft")).toBe("draft");
    expect(mapPostizStateToBinder("scheduled")).toBe("terjadwal");
    expect(mapPostizStateToBinder("published")).toBe("tayang");
    expect(mapPostizStateToBinder("failed")).toBe("gagal");
    expect(mapPostizStateToBinder("Scheduled")).toBe("terjadwal");
    expect(mapPostizStateToBinder("mystery-state")).toBeNull();
  });

  it("resolvePostizConnection mengutamakan kunci transient, lalu referensi env", () => {
    expect(
      resolvePostizConnection(
        { baseUrl: "http://localhost:5000/", apiKey: "  kunci-a  " },
        { POSTIZ_API_KEY: "kunci-env" },
      ),
    ).toEqual({ baseUrl: "http://localhost:5000", apiKey: "kunci-a" });
    expect(
      resolvePostizConnection(
        { baseUrl: "http://localhost:5000", apiKeyRef: "{env:POSTIZ_API_KEY}" },
        { POSTIZ_API_KEY: "kunci-env" },
      ),
    ).toEqual({ baseUrl: "http://localhost:5000", apiKey: "kunci-env" });
    expect(
      resolvePostizConnection({ baseUrl: "http://localhost:5000", apiKeyRef: "{env:POSTIZ_API_KEY}" }, {}),
    ).toEqual({ baseUrl: "http://localhost:5000", apiKey: null });
  });

  it("uploadPostizMedia memakai FormData field file + header mentah", async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      jsonResponse({ id: "media-9", path: "uploads/media-9.png", name: "hero.png" }),
    );
    const record = await uploadPostizMedia(
      CONN,
      { bytes: new Uint8Array([137, 80, 78, 71]), filename: "hero.png", mime: "image/png" },
      { fetchImpl },
    );
    expect(record).toEqual({ id: "media-9", path: "uploads/media-9.png" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:5000/public/v1/upload");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("kunci-test");
    const form = calls[0].init?.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("hero.png");
    expect(file.type).toBe("image/png");
  });

  it("uploadPostizMedia menolak MIME di luar allowlist tanpa panggilan", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse({}));
    await expect(
      uploadPostizMedia(
        CONN,
        { bytes: new Uint8Array([1, 2, 3]), filename: "dok.pdf", mime: "application/pdf" },
        { fetchImpl },
      ),
    ).rejects.toThrow("Jenis media tidak diterima Postiz");
    expect(calls).toHaveLength(0);
  });

  it("createPostizDraft mengirim DTO draft + header mentah, membaca id respons", async () => {
    const { fetchImpl, calls } = stubFetch((url) => {
      expect(url).toBe("http://localhost:5000/public/v1/posts");
      return jsonResponse({ id: "pz-1" }, 201);
    });
    const result = await createPostizDraft(
      CONN,
      {
        integrationId: "int-1",
        content: "Hari ini COP31 dimulai.",
        date: "2026-11-09T02:00:00.000Z",
        media: [],
      },
      { fetchImpl },
    );
    expect(result).toEqual({ postId: "pz-1" });
    expect(calls).toHaveLength(1);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("kunci-test");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body.type).toBe("draft");
    const posts = body.posts as Array<{ integration: { id: string }; value: Array<{ content: string }> }>;
    expect(posts[0].integration.id).toBe("int-1");
    expect(posts[0].value[0].content).toBe("Hari ini COP31 dimulai.");
  });

  it("createPostizDraft membaca id dari bentuk data.{id} dan mengembalikan null bila tanpa id", async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse({ data: { id: "pz-2" } }));
    await expect(
      createPostizDraft(
        CONN,
        { integrationId: "int-1", content: "Copy.", date: "2026-11-09T02:00:00.000Z", media: [] },
        { fetchImpl },
      ),
    ).resolves.toEqual({ postId: "pz-2" });

    const noId = stubFetch(() => jsonResponse({ ok: true }));
    await expect(
      createPostizDraft(
        CONN,
        { integrationId: "int-1", content: "Copy.", date: "2026-11-09T02:00:00.000Z", media: [] },
        { fetchImpl: noId.fetchImpl },
      ),
    ).resolves.toEqual({ postId: null });
  });

  it("createPostizDraft memetakan 401 sebagai auth dan 429 sebagai rate limit", async () => {
    const auth = stubFetch(() => jsonResponse({ msg: "Invalid API key" }, 401));
    await expect(
      createPostizDraft(
        CONN,
        { integrationId: "int-1", content: "Copy.", date: "2026-11-09T02:00:00.000Z", media: [] },
        { fetchImpl: auth.fetchImpl },
      ),
    ).rejects.toMatchObject({ name: "PostizHttpError", status: 401 });
    try {
      await createPostizDraft(
        CONN,
        { integrationId: "int-1", content: "Copy.", date: "2026-11-09T02:00:00.000Z", media: [] },
        { fetchImpl: auth.fetchImpl },
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PostizHttpError);
      expect((error as PostizHttpError).isAuth).toBe(true);
    }

    const limited = stubFetch(() =>
      jsonResponse({ msg: "Too many requests" }, 429, { "retry-after": "120" }),
    );
    try {
      await createPostizDraft(
        CONN,
        { integrationId: "int-1", content: "Copy.", date: "2026-11-09T02:00:00.000Z", media: [] },
        { fetchImpl: limited.fetchImpl },
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PostizHttpError);
      const httpError = error as PostizHttpError;
      expect(httpError.isRateLimited).toBe(true);
      expect(httpError.retryAfterSeconds).toBe(120);
    }
  });

  it("listPostizPosts memakai startDate+endDate dan memparse daftar + releaseURL", async () => {
    const { fetchImpl, calls } = stubFetch((url) => {
      expect(url).toContain("startDate=2026-11-09T00%3A00%3A00.000Z");
      expect(url).toContain("endDate=2027-01-27T00%3A00%3A00.000Z");
      return jsonResponse({
        data: [
          { id: "pz-1", state: "scheduled", releaseURL: null, date: "2026-11-09T02:00:00.000Z" },
          { id: "pz-2", state: "draft", releaseUrl: null },
          { state: "draft" },
        ],
      });
    });
    const posts = await listPostizPosts(
      CONN,
      { startDate: "2026-11-09T00:00:00.000Z", endDate: "2027-01-27T00:00:00.000Z" },
      { fetchImpl },
    );
    expect(calls).toHaveLength(1);
    expect(posts).toEqual([
      { id: "pz-1", state: "scheduled", releaseUrl: null, scheduledAt: "2026-11-09T02:00:00.000Z" },
      { id: "pz-2", state: "draft", releaseUrl: null, scheduledAt: null },
    ]);
  });
});
