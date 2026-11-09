// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  approvals,
  binderApprovedActions,
  binderGateDecisions,
  companies,
  createDb,
  issues,
  projects,
  type Db,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { reconcileBinderLedger } from "./binder-funding.js";
import {
  issueApprovedAction,
  registerAgentModel,
  requestApprovedAction,
} from "./binder-task-flow.js";
import { pushBinderPostizBatch, syncBinderPostizStatus } from "./binder-postiz-batch.js";

/**
 * Test Fase B — batch push Postiz BINDER lewat Gate + sync status.
 * Semua data berlabel TEST (company/project/issue dibuat per test dan
 * hanya hidup di database test ini); tidak ada data dummy aplikasi.
 * Transport Postiz adalah fetch tiruan yang diinjeksikan — TIDAK ADA
 * panggilan live, TIDAK ADA publish.
 */

const TEST_NOTE = "TEST — hanya untuk pengujian otomatis";
const OWNER_USER_ID = "owner-test";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("batch push Postiz BINDER", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let companyId: string;
  let projectId: string;
  let ceoId: string;
  let pilotIssueId: string;
  let postIssueIds: string[];

  function randomName(prefix: string) {
    return `${prefix} TEST ${Math.random().toString(36).slice(2, 8)}`;
  }

  function postDescription(copy: string): string {
    return [
      "### Post TEST",
      "**Format:** Carousel 4 slide",
      "",
      "**Copy:**",
      "```",
      copy,
      "```",
      "",
      "**Arahan visual:**",
      "- Slide 1: foto langit pagi (internal, jangan diposting)",
      "**Sumber (internal):** IRENA (jangan diposting)",
    ].join("\n");
  }

  async function createPostIssue(title: string, dueDate: string, copy: string | null) {
    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        projectId,
        title: `${title} ${TEST_NOTE}`,
        description: copy === null ? "### Post TEST\n\nTanpa blok copy." : postDescription(copy),
        dueDate: new Date(dueDate),
        status: "backlog",
      })
      .returning();
    return issue;
  }

  /** Pengajuan batch oleh CEO + vonis owner + penerbitan id (alur nyata). */
  async function issueBatchAction(allowedIssueIds: string[]) {
    const approval = await requestApprovedAction(db, {
      companyId,
      requestedByAgentId: ceoId,
      actionKind: "external_post",
      issueId: pilotIssueId,
      projectId,
      payload: { postIssueIds: allowedIssueIds },
    });
    await db
      .update(approvals)
      .set({ status: "approved", decidedByUserId: OWNER_USER_ID, decidedAt: new Date() })
      .where(eq(approvals.id, approval.id));
    const { action } = await issueApprovedAction(db, { companyId, approvalId: approval.id });
    return action;
  }

  async function readIssuePostiz(issueId: string) {
    const [row] = await db
      .select({
        postizPostId: issues.postizPostId,
        postizState: issues.postizState,
        postizPushedAt: issues.postizPushedAt,
        status: issues.status,
      })
      .from(issues)
      .where(eq(issues.id, issueId));
    return row;
  }

  async function readActionStatus(actionId: string) {
    const [row] = await db
      .select({ status: binderApprovedActions.status })
      .from(binderApprovedActions)
      .where(eq(binderApprovedActions.id, actionId));
    return row?.status ?? null;
  }

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

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("binder-postiz-batch-");
    db = createDb(database.connectionString);
  }, 180_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  }, 60_000);

  beforeEach(async () => {
    // CEO BINDER adalah singleton SE-AKUN (getCeo menolak bila ada >1
    // agen role 'ceo' di database test ini) — turunkan dulu CEO test
    // sebelumnya ke 'general' sebelum mendaftarkan CEO test ini.
    await db.update(agents).set({ role: "general" }).where(eq(agents.role, "ceo"));
    const [company] = await db
      .insert(companies)
      .values({
        name: randomName("Binder Postiz Batch"),
        issuePrefix: `BPB${Math.floor(Math.random() * 1_000_000)}`,
      })
      .returning();
    companyId = company.id;
    const [project] = await db
      .insert(projects)
      .values({ companyId, name: `Proyek TEST ${TEST_NOTE}` })
      .returning();
    projectId = project.id;
    const [ceo] = await db
      .insert(agents)
      .values({ companyId, name: `CEO ${TEST_NOTE}`, role: "ceo" })
      .returning();
    ceoId = ceo.id;
    // getCeo memuat juga model CEO (loadCeoView) — daftarkan modelnya.
    await registerAgentModel(db, {
      companyId,
      agentId: ceo.id,
      modelFamily: "meta",
      modelId: "muse-spark-1.3",
    });
    const [pilot] = await db
      .insert(issues)
      .values({ companyId, projectId, title: `Task pilot TEST ${TEST_NOTE}`, status: "backlog" })
      .returning();
    pilotIssueId = pilot.id;
    const post1 = await createPostIssue(
      "[9 Nov 2026] Post satu",
      "2026-11-09T02:00:00.000Z",
      "Copy post satu.\n\nIkuti #EnergiSurga.",
    );
    const post2 = await createPostIssue(
      "[11 Nov 2026] Post dua",
      "2026-11-11T02:00:00.000Z",
      "Copy post dua.\n\nIkuti #EnergiSurga.",
    );
    postIssueIds = [post1.id, post2.id];
  });

  const BASE_INPUT = {
    integrationId: "int-1",
    baseUrl: "http://localhost:5000",
    apiKey: "kunci-test",
  };

  it("menolak batch tanpa approved_action_id yang valid, tanpa satu pun panggilan Postiz", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse({ id: "pz-1" }));
    await expect(
      pushBinderPostizBatch(
        db,
        {
          companyId,
          approvedActionId: "00000000-0000-0000-0000-000000000000",
          issueIds: postIssueIds,
          ...BASE_INPUT,
        },
        { fetchImpl },
      ),
    ).rejects.toThrow("approved_action_id tidak berlaku");
    expect(calls).toHaveLength(0);
  });

  it("menolak issue di luar cakupan persetujuan owner, tanpa panggilan Postiz", async () => {
    const action = await issueBatchAction([postIssueIds[0]]);
    const { fetchImpl, calls } = stubFetch(() => jsonResponse({ id: "pz-1" }));
    await expect(
      pushBinderPostizBatch(
        db,
        {
          companyId,
          approvedActionId: action.id,
          issueIds: postIssueIds,
          ...BASE_INPUT,
        },
        { fetchImpl },
      ),
    ).rejects.toThrow("di luar cakupan persetujuan owner");
    expect(calls).toHaveLength(0);
    expect(await readActionStatus(action.id)).toBe("issued");
  });

  it("happy path: dua draft dibuat, id disimpan, ledger tidak berubah, id habis", async () => {
    const action = await issueBatchAction(postIssueIds);
    let created = 0;
    const { fetchImpl, calls } = stubFetch((url, init) => {
      expect(url).toBe("http://localhost:5000/public/v1/posts");
      const body = JSON.parse(String(init?.body)) as {
        posts: Array<{ value: Array<{ content: string }> }>;
      };
      created += 1;
      expect(body.posts[0].value[0].content).toContain("Copy post");
      return jsonResponse({ id: `pz-${created}` }, 201);
    });
    const result = await pushBinderPostizBatch(
      db,
      { companyId, approvedActionId: action.id, issueIds: postIssueIds, ...BASE_INPUT },
      { fetchImpl },
    );
    expect(result.error).toBeNull();
    expect(result.rateLimited).toBe(false);
    expect(result.pushed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.alreadyPushed).toBe(0);
    expect(result.transportRef).toBe("postiz-batch:pushed=2,skipped=0,already=0");
    expect(calls).toHaveLength(2);
    // Header mentah (tanpa Bearer) di tiap panggilan.
    for (const call of calls) {
      expect((call.init?.headers as Record<string, string>).Authorization).toBe("kunci-test");
    }
    const first = await readIssuePostiz(postIssueIds[0]);
    expect(first.postizPostId).toBe("pz-1");
    expect(first.postizState).toBe("draft");
    expect(first.postizPushedAt).not.toBeNull();
    expect(first.status).toBe("backlog");
    const second = await readIssuePostiz(postIssueIds[1]);
    expect(second.postizPostId).toBe("pz-2");
    expect(second.postizState).toBe("draft");
    expect(await readActionStatus(action.id)).toBe("used");
    // Ledger TIDAK berubah: push bukan pengeluaran.
    const ledger = await reconcileBinderLedger(db, companyId);
    expect(ledger.balanced).toBe(true);
    expect(ledger.entryCount).toBe(0);
    expect(Number(ledger.differenceCents)).toBe(0);
    // Keputusan Gate tercatat (allowed) untuk task pilot.
    const decisions = await db
      .select({ decision: binderGateDecisions.decision })
      .from(binderGateDecisions)
      .where(
        and(
          eq(binderGateDecisions.companyId, companyId),
          eq(binderGateDecisions.issueId, pilotIssueId),
        ),
      );
    expect(decisions.some((row) => row.decision === "allowed")).toBe(true);
  });

  it("melewati post tanpa blok copy tanpa panggilan untuk post itu", async () => {
    const noCopy = await createPostIssue("[13 Nov 2026] Tanpa copy", "2026-11-13T02:00:00.000Z", null);
    const allIds = [...postIssueIds, noCopy.id];
    const action = await issueBatchAction(allIds);
    let created = 0;
    const { fetchImpl, calls } = stubFetch(() => {
      created += 1;
      return jsonResponse({ id: `pz-${created}` }, 201);
    });
    const result = await pushBinderPostizBatch(
      db,
      { companyId, approvedActionId: action.id, issueIds: allIds, ...BASE_INPUT },
      { fetchImpl },
    );
    expect(result.error).toBeNull();
    expect(result.pushed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(calls).toHaveLength(2);
    const skipped = result.results.find((item) => item.issueId === noCopy.id);
    expect(skipped?.outcome).toBe("skipped");
    expect(skipped?.reason).toContain("Copy tidak ditemukan");
    const noCopyRow = await readIssuePostiz(noCopy.id);
    expect(noCopyRow.postizPostId).toBeNull();
  });

  it("429 di post kedua: berhenti, post pertama tahan, id TIDAK habis; retry berhasil", async () => {
    const action = await issueBatchAction(postIssueIds);
    let attempts = 0;
    const { fetchImpl, calls } = stubFetch(() => {
      attempts += 1;
      if (attempts === 2) {
        return jsonResponse({ msg: "Too many requests" }, 429, { "retry-after": "60" });
      }
      return jsonResponse({ id: `pz-${attempts}` }, 201);
    });
    const first = await pushBinderPostizBatch(
      db,
      { companyId, approvedActionId: action.id, issueIds: postIssueIds, ...BASE_INPUT },
      { fetchImpl },
    );
    expect(first.error).toContain("membatasi laju (429)");
    expect(first.rateLimited).toBe(true);
    expect(first.pushed).toBe(1);
    expect(first.transportRef).toBeNull();
    expect(calls).toHaveLength(2);
    // Post pertama tahan (durable) meski batch berhenti.
    expect((await readIssuePostiz(postIssueIds[0])).postizPostId).toBe("pz-1");
    expect((await readIssuePostiz(postIssueIds[1])).postizPostId).toBeNull();
    // Id TIDAK dihabiskan — retry dengan id yang sama diizinkan.
    expect(await readActionStatus(action.id)).toBe("issued");

    const retry = await pushBinderPostizBatch(
      db,
      { companyId, approvedActionId: action.id, issueIds: postIssueIds, ...BASE_INPUT },
      { fetchImpl },
    );
    expect(retry.error).toBeNull();
    expect(retry.pushed).toBe(1);
    expect(retry.alreadyPushed).toBe(1);
    expect((await readIssuePostiz(postIssueIds[1])).postizPostId).toBe("pz-3");
    expect(await readActionStatus(action.id)).toBe("used");
  });

  it("upload media sebelum create bila media dipasok", async () => {
    const action = await issueBatchAction([postIssueIds[0]]);
    const seen: string[] = [];
    const { fetchImpl } = stubFetch((url, init) => {
      seen.push(url);
      if (url.endsWith("/public/v1/upload")) {
        const form = init?.body as FormData;
        expect((form.get("file") as File).name).toBe("hero.png");
        return jsonResponse({ id: "media-5", path: "uploads/media-5.png" });
      }
      const body = JSON.parse(String(init?.body)) as {
        posts: Array<{ value: Array<{ image: Array<{ id: string }> }> }>;
      };
      expect(body.posts[0].value[0].image).toEqual([
        { id: "media-5", path: "uploads/media-5.png" },
      ]);
      return jsonResponse({ id: "pz-1" }, 201);
    });
    const result = await pushBinderPostizBatch(
      db,
      {
        companyId,
        approvedActionId: action.id,
        issueIds: [postIssueIds[0]],
        ...BASE_INPUT,
        mediaByIssueId: {
          [postIssueIds[0]]: {
            bytes: new Uint8Array([137, 80, 78, 71]),
            filename: "hero.png",
            mime: "image/png",
          },
        },
      },
      { fetchImpl },
    );
    expect(result.error).toBeNull();
    expect(result.pushed).toBe(1);
    expect(result.results[0].mediaMissing).toBe(false);
    expect(seen[0]).toBe("http://localhost:5000/public/v1/upload");
    expect(seen[1]).toBe("http://localhost:5000/public/v1/posts");
  });

  it("sync memperbarui state dari Postiz; state tak dikenal dilaporkan; status issue tetap", async () => {
    await db
      .update(issues)
      .set({ postizPostId: "pz-1", postizState: "draft" })
      .where(eq(issues.id, postIssueIds[0]));
    await db
      .update(issues)
      .set({ postizPostId: "pz-2", postizState: "draft" })
      .where(eq(issues.id, postIssueIds[1]));
    const { fetchImpl, calls } = stubFetch((url) => {
      expect(url).toContain("/public/v1/posts?startDate=");
      return jsonResponse([
        { id: "pz-1", state: "scheduled", releaseURL: null },
        { id: "pz-2", state: "mystery-state", releaseURL: null },
        { id: "pz-lain", state: "published", releaseURL: "https://postiz.example/p/1" },
      ]);
    });
    const result = await syncBinderPostizStatus(
      db,
      {
        companyId,
        startDate: "2026-11-09T00:00:00.000Z",
        endDate: "2027-01-27T00:00:00.000Z",
        ...BASE_INPUT,
      },
      { fetchImpl },
    );
    expect(calls).toHaveLength(1);
    expect(result.checked).toBe(3);
    expect(result.updated).toBe(1);
    expect(result.changes).toEqual([
      {
        issueId: postIssueIds[0],
        postizPostId: "pz-1",
        previousState: "draft",
        nextState: "terjadwal",
      },
    ]);
    expect(result.unknown).toEqual([{ postizPostId: "pz-2", state: "mystery-state" }]);
    expect((await readIssuePostiz(postIssueIds[0])).postizState).toBe("terjadwal");
    expect((await readIssuePostiz(postIssueIds[1])).postizState).toBe("draft");
    // Status issue BINDER tidak diubah otomatis oleh sync.
    expect((await readIssuePostiz(postIssueIds[0])).status).toBe("backlog");
  });

  it("batch dan sync tanpa kunci ditolak sebelum panggilan apa pun", async () => {
    const action = await issueBatchAction(postIssueIds);
    const { fetchImpl, calls } = stubFetch(() => jsonResponse({ id: "pz-1" }));
    await expect(
      pushBinderPostizBatch(
        db,
        {
          companyId,
          approvedActionId: action.id,
          issueIds: postIssueIds,
          integrationId: "int-1",
          baseUrl: "http://localhost:5000",
        },
        { fetchImpl },
      ),
    ).rejects.toThrow("Belum ada API key Postiz");
    await expect(
      syncBinderPostizStatus(
        db,
        {
          companyId,
          baseUrl: "http://localhost:5000",
          startDate: "2026-11-09T00:00:00.000Z",
          endDate: "2027-01-27T00:00:00.000Z",
        },
        { fetchImpl },
      ),
    ).rejects.toThrow("Belum ada API key Postiz");
    expect(calls).toHaveLength(0);
  });
});
