// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  companies,
  createDb,
  type Db,
} from "@paperclipai/db";
import { BINDER_CEO_CONNECTOR_MATRIX } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import {
  assertCeoExcludedFromQcPool,
  getCeo,
  registerCeo,
  updateCeoBudget,
  updateCeoConnectorMatrix,
  updateCeoModel,
  validateCeoConnectorMatrix,
} from "./binder-ceo.js";
import { listQcRoster, registerQcReviewer } from "./binder-task-flow.js";

/**
 * Test Fase 3.4 — hire CEO Edison (PRD Bab 7; Rencana Tahap 3 poin 5).
 * Semua data berlabel TEST (company dibuat per test dan hanya hidup di
 * database test ini); tidak ada data dummy aplikasi; tidak ada
 * pemanggilan model live — registrasi + konfigurasi saja.
 * CEO adalah singleton tingkat akun: antar test dibersihkan lewat
 * afterEach (hapus baris `agents` role 'ceo' — activity log tidak
 * merujuk agen, jadi aman).
 */

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("hire CEO Edison BINDER", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let companyId: string;

  function randomName(prefix: string) {
    return `${prefix} TEST ${Math.random().toString(36).slice(2, 8)}`;
  }

  async function createCompany(prefix: string) {
    const [company] = await db
      .insert(companies)
      .values({
        name: randomName(prefix),
        issuePrefix: `CEO${Math.floor(Math.random() * 1_000_000)}`,
      })
      .returning();
    return company.id;
  }

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("binder-ceo-");
    db = createDb(database.connectionString);
  }, 180_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
  }, 60_000);

  beforeEach(async () => {
    companyId = await createCompany("Binder CEO");
  });

  afterEach(async () => {
    await db.delete(agents).where(eq(agents.role, "ceo"));
  });

  it("mendaftarkan Edison dengan konfigurasi PRD (Meta → Claude, sandbox, $20, matriks tanpa kirim)", async () => {
    const registered = await registerCeo(db, { companyId });
    const { agent, model, connectorMatrix } = registered;
    expect(agent.name).toBe("Edison");
    expect(agent.role).toBe("ceo");
    expect(agent.title).toBe("CEO/Orchestrator");
    expect(agent.adapterType).toBe("opencode_local");
    expect((agent.adapterConfig as Record<string, unknown>)["model"]).toBe("meta/muse-spark-1.3");
    const binder = (agent.adapterConfig as Record<string, Record<string, unknown>>)["binder"];
    expect(binder["primary"]).toEqual({
      modelFamily: "meta",
      modelId: "muse-spark-1.3",
      provider: "opencode_local",
      apiKeyRef: "{env:META_API_KEY}",
    });
    expect(binder["fallback"]).toEqual({
      modelFamily: "anthropic",
      modelId: "claude-sonnet-5-5",
      provider: "claude_local",
      apiKeyRef: "{env:ANTHROPIC_API_KEY}",
    });
    expect(
      (agent.runtimeConfig as Record<string, Record<string, unknown>>)["binder"][
        "runtimeDefault"
      ],
    ).toBe("sandbox");
    expect(agent.budgetMonthlyCents).toBe(2000);
    // CEO tidak membuat agen Paperclip langsung (hire lewat alur owner).
    expect((agent.permissions as Record<string, unknown>)["canCreateAgents"]).toBe(false);
    expect(model.modelFamily).toBe("meta");
    expect(model.modelId).toBe("muse-spark-1.3");
    expect(model.provider).toBe("opencode_local");
    expect(connectorMatrix).toEqual(BINDER_CEO_CONNECTOR_MATRIX);
    expect(connectorMatrix.workspace_read).toBe("allowed");
    expect(connectorMatrix.destructive).toBe("ask_first");
    for (const send of ["email_send", "external_message", "external_post", "outreach_send", "external_call"]) {
      expect(connectorMatrix[send as keyof typeof connectorMatrix]).toBe("off");
    }
    const readBack = await getCeo(db);
    expect(readBack.agent.id).toBe(agent.id);
    expect(readBack.connectorMatrix).toEqual(BINDER_CEO_CONNECTOR_MATRIX);
  });

  it("getCeo sebelum terdaftar ditolak", async () => {
    await expect(getCeo(db)).rejects.toThrow(/belum terdaftar/i);
  });

  it("daftar ulang konfigurasi sama → idempotent (satu baris CEO)", async () => {
    const first = await registerCeo(db, { companyId });
    const second = await registerCeo(db, { companyId });
    expect(second.agent.id).toBe(first.agent.id);
    const rows = await db.select({ id: agents.id }).from(agents).where(eq(agents.role, "ceo"));
    expect(rows).toHaveLength(1);
  });

  it("daftar ulang konfigurasi berbeda → conflict (ubah lewat update)", async () => {
    await registerCeo(db, { companyId });
    await expect(
      registerCeo(db, { companyId, budgetMonthlyCents: 3000 }),
    ).rejects.toThrow(/konfigurasi berbeda/i);
  });

  it("CEO kedua di company lain → conflict (satu CEO untuk seluruh akun)", async () => {
    await registerCeo(db, { companyId });
    const otherCompanyId = await createCompany("Binder CEO lain");
    await expect(registerCeo(db, { companyId: otherCompanyId })).rejects.toThrow(/satu CEO/i);
  });

  it("nama bukan Edison dan runtime bukan sandbox → ditolak; model BUKAN hardcode — ganti model = ganti konfigurasi", async () => {
    await expect(registerCeo(db, { companyId, name: "Boss" })).rejects.toThrow(/Edison/);
    await expect(
      registerCeo(db, { companyId, runtimeDefault: "desktop" }),
    ).rejects.toThrow(/sandbox/i);
    // Keputusan 07:22 WIB: model disimpan sebagai konfigurasi yang bisa
    // diganti — registrasi dengan model utama lain DITERIMA (default
    // Meta → Claude hanya nilai awal, bukan nilai yang dikunci di kode).
    const custom = await registerCeo(db, {
      companyId,
      primaryModel: { modelFamily: "anthropic", modelId: "claude-sonnet-4-5", provider: "claude_local" },
    });
    expect(custom.agent.adapterType).toBe("claude_local");
    // Adapter non-OpenCode memakai id model polos (format provider/model
    // hanya milik opencode_local — lihat deriveAdapterModel).
    expect((custom.agent.adapterConfig as Record<string, unknown>)["model"]).toBe(
      "claude-sonnet-4-5",
    );
    expect(custom.model.modelFamily).toBe("anthropic");
    expect(custom.model.modelId).toBe("claude-sonnet-4-5");
    const readBack = await getCeo(db);
    expect(readBack.agent.adapterType).toBe("claude_local");
  });

  it("apiKeyRef: referensi env tersimpan; nilai kunci literal ditolak (bukan referensi)", async () => {
    const registered = await registerCeo(db, { companyId });
    const binder = (registered.agent.adapterConfig as Record<string, Record<string, unknown>>)[
      "binder"
    ];
    expect((binder["primary"] as Record<string, unknown>)["apiKeyRef"]).toBe("{env:META_API_KEY}");
    expect((binder["fallback"] as Record<string, unknown>)["apiKeyRef"]).toBe(
      "{env:ANTHROPIC_API_KEY}",
    );
    // Nilai kunci literal — walau hanya di test — ditolak polanya.
    await expect(
      updateCeoModel(db, {
        companyId,
        primaryModel: {
          modelFamily: "meta",
          modelId: "muse-spark-1.3",
          provider: "opencode_local",
          apiKeyRef: "sk-ant-palsu-untuk-test",
        },
      }),
    ).rejects.toThrow(/referensi env/i);
    const unchanged = await getCeo(db);
    expect(
      (
        (unchanged.agent.adapterConfig as Record<string, Record<string, unknown>>)["binder"][
          "primary"
        ] as Record<string, unknown>
      )["apiKeyRef"],
    ).toBe("{env:META_API_KEY}");
  });

  it("updateCeoModel: ganti model utama + fallback — baris agen dan baris model ikut berubah atomik", async () => {
    const { agent } = await registerCeo(db, { companyId });
    const updated = await updateCeoModel(db, {
      companyId,
      primaryModel: {
        modelFamily: "anthropic",
        modelId: "claude-sonnet-4-5",
        provider: "claude_local",
        apiKeyRef: "{env:ANTHROPIC_API_KEY}",
      },
      fallbackModel: {
        modelFamily: "meta",
        modelId: "muse-spark-1.3",
        provider: "opencode_local",
        apiKeyRef: "{env:META_API_KEY}",
      },
    });
    expect(updated.agent.id).toBe(agent.id);
    expect(updated.agent.adapterType).toBe("claude_local");
    expect((updated.agent.adapterConfig as Record<string, unknown>)["model"]).toBe(
      "claude-sonnet-4-5",
    );
    expect(updated.model.modelFamily).toBe("anthropic");
    expect(updated.model.modelId).toBe("claude-sonnet-4-5");
    const binder = (updated.agent.adapterConfig as Record<string, Record<string, unknown>>)[
      "binder"
    ];
    expect((binder["fallback"] as Record<string, unknown>)["modelFamily"]).toBe("meta");
    // Daftar ulang sesudah ganti model → idempotent dengan konfigurasi baru.
    const reread = await registerCeo(db, {
      companyId,
      primaryModel: {
        modelFamily: "anthropic",
        modelId: "claude-sonnet-4-5",
        provider: "claude_local",
        apiKeyRef: "{env:ANTHROPIC_API_KEY}",
      },
      fallbackModel: {
        modelFamily: "meta",
        modelId: "muse-spark-1.3",
        provider: "opencode_local",
        apiKeyRef: "{env:META_API_KEY}",
      },
    });
    expect(reread.agent.id).toBe(agent.id);
  });

  it("validasi matriks: kirim allowed/ask_first, tulis allowed, kelas tak dikenal → ditolak; kosong → off semua", () => {
    expect(() =>
      validateCeoConnectorMatrix({ email_send: "allowed" }),
    ).toThrow(/kirim eksternal/i);
    expect(() =>
      validateCeoConnectorMatrix({ external_call: "ask_first" }),
    ).toThrow(/kirim eksternal/i);
    expect(() =>
      validateCeoConnectorMatrix({ workspace_write: "allowed" }),
    ).toThrow(/tidak boleh 'allowed'/i);
    expect(() =>
      validateCeoConnectorMatrix({ kirim_surat: "off" }),
    ).toThrow(/tidak dikenal/i);
    expect(() =>
      validateCeoConnectorMatrix({ workspace_read: "maybe" }),
    ).toThrow(/tidak dikenal/i);
    const sparse = validateCeoConnectorMatrix({ workspace_read: "allowed" });
    expect(sparse.workspace_read).toBe("allowed");
    expect(sparse.email_send).toBe("off");
    expect(sparse.workspace_write).toBe("off");
    expect(validateCeoConnectorMatrix(BINDER_CEO_CONNECTOR_MATRIX)).toEqual(
      BINDER_CEO_CONNECTOR_MATRIX,
    );
    expect(() => validateCeoConnectorMatrix("bukan-objek")).toThrow(/harus berupa objek/i);
  });

  it("matriks dengan kirim allowed ditolak saat registrasi", async () => {
    await expect(
      registerCeo(db, { companyId, connectorMatrix: { outreach_send: "allowed" } }),
    ).rejects.toThrow(/kirim eksternal/i);
    await expect(getCeo(db)).rejects.toThrow(/belum terdaftar/i);
  });

  it("QC: CEO tidak boleh masuk pool; pengecualian terbukti dari sisi registrasi", async () => {
    const { agent } = await registerCeo(db, { companyId });
    await expect(
      registerQcReviewer(db, { companyId, agentId: agent.id }),
    ).rejects.toThrow(/CEO tidak boleh/i);
    const proof = await assertCeoExcludedFromQcPool(db, companyId);
    expect(proof.excluded).toBe(true);
    expect(proof.ceoAgentId).toBe(agent.id);
    expect(proof.rosterSize).toBe(0);
    const roster = await listQcRoster(db, companyId);
    expect(roster.some((member) => member.agentId === agent.id)).toBe(false);
  });

  it("update budget: $20 → $30; tercatat di getCeo", async () => {
    const { agent } = await registerCeo(db, { companyId });
    const updated = await updateCeoBudget(db, { companyId, budgetMonthlyCents: 3000 });
    expect(updated.id).toBe(agent.id);
    expect(updated.budgetMonthlyCents).toBe(3000);
    expect((await getCeo(db)).agent.budgetMonthlyCents).toBe(3000);
  });

  it("update matriks: valid tersimpan; kirim allowed ditolak dan matriks lama bertahan", async () => {
    await registerCeo(db, { companyId });
    const updated = await updateCeoConnectorMatrix(db, {
      companyId,
      connectorMatrix: { ...BINDER_CEO_CONNECTOR_MATRIX, web_read: "off" },
    });
    expect(
      (updated.permissions as Record<string, Record<string, string>>)["binderConnectorMatrix"][
        "web_read"
      ],
    ).toBe("off");
    await expect(
      updateCeoConnectorMatrix(db, {
        companyId,
        connectorMatrix: { ...BINDER_CEO_CONNECTOR_MATRIX, email_send: "allowed" },
      }),
    ).rejects.toThrow(/kirim eksternal/i);
    const readBack = await getCeo(db);
    expect(readBack.connectorMatrix.web_read).toBe("off");
    expect(readBack.connectorMatrix.email_send).toBe("off");
  });
});
