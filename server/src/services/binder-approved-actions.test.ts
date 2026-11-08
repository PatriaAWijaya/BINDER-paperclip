// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  approvals,
  binderApprovedActions,
  companies,
  createDb,
  issueApprovals,
  issueComments,
  issues,
  projects,
  type Db,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import {
  getApprovedAction,
  issueApprovedAction,
  markApprovedActionUsed,
  requestApprovedAction,
  revokeApprovedAction,
  validateApprovedAction,
} from "./binder-task-flow.js";

/**
 * Test Fase 3.3 — approved_action_id (P1-11).
 * Semua data berlabel TEST (company/project/issue dibuat per test dan hanya
 * hidup di database embedded test ini); tidak ada data dummy aplikasi.
 * Migrasi 0444 teraplikasi oleh helper embedded Postgres — bila migrasi
 * gagal, seluruh file ini gagal (bukti migrasi teraplikasi).
 */

const TEST_NOTE = "TEST — hanya untuk pengujian otomatis";
const OWNER_USER_ID = "owner-test";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("approved_action_id BINDER", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let companyId: string;
  let projectId: string;
  let makerId: string;
  let issueId: string;

  function randomName(prefix: string) {
    return `${prefix} TEST ${Math.random().toString(36).slice(2, 8)}`;
  }

  async function approveRow(approvalId: string) {
    await db
      .update(approvals)
      .set({ status: "approved", decidedByUserId: OWNER_USER_ID, decidedAt: new Date() })
      .where(eq(approvals.id, approvalId));
  }

  async function requestPostAction() {
    return requestApprovedAction(db, {
      companyId,
      actionKind: "external_post",
      projectId,
      issueId,
      requestedByAgentId: makerId,
      payload: { draftId: "draft-1", channel: "instagram" },
    });
  }

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("binder-approved-actions-");
    db = createDb(database.connectionString);
  }, 180_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  }, 60_000);

  beforeEach(async () => {
    const [company] = await db
      .insert(companies)
      .values({
        name: randomName("Binder Approved Action"),
        issuePrefix: `BAA${Math.floor(Math.random() * 1_000_000)}`,
      })
      .returning();
    companyId = company.id;
    const [project] = await db
      .insert(projects)
      .values({ companyId, name: `Proyek TEST ${TEST_NOTE}` })
      .returning();
    projectId = project.id;
    const [maker] = await db
      .insert(agents)
      .values({ companyId, name: `Maker ${TEST_NOTE}`, role: "general" })
      .returning();
    makerId = maker.id;
    const [issue] = await db
      .insert(issues)
      .values({ companyId, projectId, title: `Tugas uji ${TEST_NOTE}` })
      .returning();
    issueId = issue.id;
  });

  it("request: membuat approval pending tipe binder_approved_action + tautan task + transkrip", async () => {
    const approval = await requestPostAction();
    expect(approval.type).toBe("binder_approved_action");
    expect(approval.status).toBe("pending");
    const payload = approval.payload as Record<string, unknown>;
    expect(payload["actionKind"]).toBe("external_post");
    expect(payload["draftId"]).toBe("draft-1");
    expect(payload["projectId"]).toBe(projectId);
    expect(payload["issueId"]).toBe(issueId);
    const [link] = await db
      .select()
      .from(issueApprovals)
      .where(eq(issueApprovals.approvalId, approval.id));
    expect(link.issueId).toBe(issueId);
    const comments = await db
      .select({ body: issueComments.body })
      .from(issueComments)
      .where(eq(issueComments.issueId, issueId));
    expect(comments.some((row) => row.body.includes("Pengajuan aksi eksternal (external_post)"))).toBe(true);
  });

  it("request: agen tidak dikenal dan task tidak dikenal ditolak", async () => {
    await expect(
      requestApprovedAction(db, {
        companyId,
        actionKind: "external_post",
        requestedByAgentId: "00000000-0000-0000-0000-000000000000",
        payload: {},
      }),
    ).rejects.toThrow(/Requesting agent not found/i);
    await expect(
      requestApprovedAction(db, {
        companyId,
        actionKind: "external_post",
        issueId: "00000000-0000-0000-0000-000000000000",
        requestedByAgentId: makerId,
        payload: {},
      }),
    ).rejects.toThrow(/Task not found/i);
  });

  it("issue: sebelum vonis owner ditolak; sesudah approved menerbitkan id; idempotent", async () => {
    const approval = await requestPostAction();
    await expect(
      issueApprovedAction(db, { companyId, approvalId: approval.id }),
    ).rejects.toThrow(/belum 'approved'/i);
    await approveRow(approval.id);
    const first = await issueApprovedAction(db, { companyId, approvalId: approval.id });
    expect(first.reused).toBe(false);
    expect(first.action.status).toBe("issued");
    expect(first.action.actionKind).toBe("external_post");
    expect(first.action.decidedByUserId).toBe(OWNER_USER_ID);
    const second = await issueApprovedAction(db, { companyId, approvalId: approval.id });
    expect(second.reused).toBe(true);
    expect(second.action.id).toBe(first.action.id);
    const rows = await db
      .select()
      .from(binderApprovedActions)
      .where(eq(binderApprovedActions.approvalId, approval.id));
    expect(rows).toHaveLength(1);
    const validated = await validateApprovedAction(db, companyId, first.action.id);
    expect(validated.valid).toBe(true);
    expect(validated.action?.id).toBe(first.action.id);
  });

  it("issue: approval bertipe lain dan approval tanpa identitas owner ditolak", async () => {
    const [other] = await db
      .insert(approvals)
      .values({
        companyId,
        type: "test",
        status: "approved",
        requestedByAgentId: makerId,
        decidedByUserId: OWNER_USER_ID,
        payload: {},
      })
      .returning();
    await expect(
      issueApprovedAction(db, { companyId, approvalId: other.id }),
    ).rejects.toThrow(/bukan binder_approved_action/i);
    const [noOwner] = await db
      .insert(approvals)
      .values({
        companyId,
        type: "binder_approved_action",
        status: "approved",
        requestedByAgentId: makerId,
        payload: { actionKind: "external_post" },
      })
      .returning();
    await expect(
      issueApprovedAction(db, { companyId, approvalId: noOwner.id }),
    ).rejects.toThrow(/identitas owner/i);
  });

  it("validate + pakai + cabut: sekali pakai; revoked dan company lain tidak valid", async () => {
    const approval = await requestPostAction();
    await approveRow(approval.id);
    const { action } = await issueApprovedAction(db, { companyId, approvalId: approval.id });
    expect((await getApprovedAction(db, companyId, action.id))?.status).toBe("issued");
    const used = await markApprovedActionUsed(db, { companyId, approvedActionId: action.id });
    expect(used.status).toBe("used");
    expect(used.usedAt).not.toBeNull();
    const afterUse = await validateApprovedAction(db, companyId, action.id);
    expect(afterUse.valid).toBe(false);
    expect(afterUse.reason).toMatch(/berstatus used/i);
    await expect(
      markApprovedActionUsed(db, { companyId, approvedActionId: action.id }),
    ).rejects.toThrow(/berstatus used/i);
    await expect(
      revokeApprovedAction(db, {
        companyId,
        approvedActionId: action.id,
        revokedByUserId: OWNER_USER_ID,
      }),
    ).rejects.toThrow(/berstatus issued/i);
    // Company lain tidak bisa memakai id ini.
    const [otherCompany] = await db
      .insert(companies)
      .values({
        name: randomName("Binder Other Company"),
        issuePrefix: `BOC${Math.floor(Math.random() * 1_000_000)}`,
      })
      .returning();
    const crossCompany = await validateApprovedAction(
      db,
      otherCompany.id,
      action.id,
    );
    expect(crossCompany.valid).toBe(false);
    expect(crossCompany.reason).toMatch(/tidak ditemukan/i);
    // Revoke pada action kedua yang masih issued.
    const approval2 = await requestPostAction();
    await approveRow(approval2.id);
    const issued2 = await issueApprovedAction(db, { companyId, approvalId: approval2.id });
    const revoked = await revokeApprovedAction(db, {
      companyId,
      approvedActionId: issued2.action.id,
      revokedByUserId: OWNER_USER_ID,
    });
    expect(revoked.status).toBe("revoked");
    const afterRevoke = await validateApprovedAction(db, companyId, issued2.action.id);
    expect(afterRevoke.valid).toBe(false);
    expect(afterRevoke.reason).toMatch(/berstatus revoked/i);
    await expect(
      revokeApprovedAction(db, {
        companyId,
        approvedActionId: issued2.action.id,
        revokedByUserId: OWNER_USER_ID,
      }),
    ).rejects.toThrow(/berstatus issued/i);
  });

  it("validate: id tidak dikenal dan id kedaluwarsa tidak valid", async () => {
    const unknown = await validateApprovedAction(
      db,
      companyId,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(unknown.valid).toBe(false);
    expect(unknown.reason).toMatch(/tidak ditemukan/i);
    const approval = await requestPostAction();
    await approveRow(approval.id);
    const past = new Date(Date.now() - 60_000).toISOString();
    const { action } = await issueApprovedAction(db, {
      companyId,
      approvalId: approval.id,
      expiresAt: past,
    });
    const expired = await validateApprovedAction(db, companyId, action.id);
    expect(expired.valid).toBe(false);
    expect(expired.reason).toMatch(/kedaluwarsa/i);
    await expect(
      markApprovedActionUsed(db, { companyId, approvedActionId: action.id }),
    ).rejects.toThrow(/kedaluwarsa/i);
  });

  it("rantai penuh: request → vonis owner → issue → validate → pakai", async () => {
    const approval = await requestApprovedAction(db, {
      companyId,
      actionKind: "external_message",
      projectId,
      issueId,
      requestedByAgentId: makerId,
      payload: { channel: "threads", draftId: "draft-2" },
    });
    await approveRow(approval.id);
    const { action, reused } = await issueApprovedAction(db, {
      companyId,
      approvalId: approval.id,
    });
    expect(reused).toBe(false);
    expect(action.actionKind).toBe("external_message");
    expect((await validateApprovedAction(db, companyId, action.id)).valid).toBe(true);
    const used = await markApprovedActionUsed(db, { companyId, approvedActionId: action.id });
    expect(used.status).toBe("used");
    const comments = await db
      .select({ body: issueComments.body })
      .from(issueComments)
      .where(eq(issueComments.issueId, issueId));
    expect(comments.some((row) => row.body.includes("approved_action_id diterbitkan"))).toBe(true);
  });
});
