import { and, eq } from "drizzle-orm";
import {
  agents,
  binderAgentModels,
  binderQcRoster,
  type Db,
} from "@paperclipai/db";
import {
  BINDER_CEO_BUDGET_MONTHLY_CENTS,
  BINDER_CEO_CONNECTOR_MATRIX,
  BINDER_CEO_FALLBACK_ADAPTER_TYPE,
  BINDER_CEO_FALLBACK_API_KEY_REF,
  BINDER_CEO_FALLBACK_MODEL_FAMILY,
  BINDER_CEO_FALLBACK_MODEL_ID,
  BINDER_CEO_NAME,
  BINDER_CEO_PRIMARY_ADAPTER_TYPE,
  BINDER_CEO_PRIMARY_API_KEY_REF,
  BINDER_CEO_PRIMARY_MODEL_FAMILY,
  BINDER_CEO_PRIMARY_MODEL_ID,
  BINDER_CEO_ROLE,
  BINDER_CEO_RUNTIME_DEFAULT,
  BINDER_CEO_TITLE,
  BINDER_CONNECTOR_CLASSES,
  BINDER_CONNECTOR_MODES,
  BINDER_CONNECTOR_SEND_CLASSES,
  BINDER_CONNECTOR_WRITE_CLASSES,
  type BinderConnectorClass,
  type BinderConnectorMode,
  type BinderModelFamily,
  type BinderRegisterCeo,
  type BinderUpdateCeoBudget,
  type BinderUpdateCeoMatrix,
  type BinderUpdateCeoModel,
} from "@paperclipai/shared";
import { badRequest, conflict, notFound } from "../errors.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";
import { withOperationAccountingTransaction } from "./accounting-transaction.js";
import { lockBudgetAdmissionControls } from "./budget-admission-controls.js";
import { withBudgetSpan } from "./budget-tracing.js";
import {
  listQcRoster,
  registerAgentModelInTransaction,
} from "./binder-task-flow.js";
import { normalizeRuntimeConfigForNewAgent } from "../lib/agent-records.js";

/**
 * Hire CEO Edison BINDER (PRD Bab 7; rencana Tahap 3 Fase 3.4, poin 5).
 *
 * Satu owner, satu CEO (Edison) untuk seluruh akun — CEO melayani semua
 * company, bukan satu CEO per company. Registrasi memakai domain agen
 * Paperclip yang sudah ada (`agents` + `binder_agent_models`), diperluas
 * dengan konfigurasi BINDER di `adapterConfig` / `runtimeConfig` /
 * `permissions` / `metadata` — TIDAK ada tabel baru (tanpa migrasi).
 *
 * Yang dicatat saat registrasi:
 * - Model utama default Meta Muse Spark 1.3 via opencode_local → fallback
 *   default Claude via claude_local (diputuskan Patria 7 Nov 2026 09:39 WIB;
 *   Gemini + Codex NONAKTIF). Nilai-nilai ini adalah DEFAULT konfigurasi,
 *   BUKAN hardcode: provider / model / kunci-sebagai-referensi disimpan
 *   sebagai data dan diganti lewat `registerCeo` / `updateCeoModel` —
 *   ganti model = ganti konfigurasi, bukan ganti kode (DIPUTUSKAN Patria
 *   8 Nov 2026 07:22 WIB, syarat kebergunaan aplikasi; PRD v1.44 Bab 7;
 *   pergantian tetap hanya di checkpoint atas vonis owner).
 *   Kunci API tidak pernah disimpan sebagai nilai — hanya referensi env
 *   pola `{env:NAMA_VAR}`; nilai kunci milik user, dipasang user sendiri,
 *   tidak tercatat di log/artefak (P1-24).
 * - Runtime default sandbox; desktop hanya untuk verifikasi visual
 *   strategi bila perlu (bukan default).
 * - Budget token usulan $20/bulan (pagu owner, bisa diubah kapan pun).
 * - Matriks konektor: Allowed HANYA baca yang aman; Ask first untuk
 *   semua tulis/destruktif; Off untuk yang tidak dibutuhkan — TANPA
 *   konektor kirim eksternal (semua kelas kirim WAJIB 'off').
 * - CEO DIKECUALIKAN dari pool QC (P0-1): `registerQcReviewer` menolak
 *   role 'ceo' dan `assignQcReviewer` menyaringnya (Fase 3.3) —
 *   `assertCeoExcludedFromQcPool` membuktikan pengecualian itu dari
 *   sisi registrasi.
 *
 * BATASAN (dicatat, bukan disembunyikan): baris `agents` Paperclip
 * company-scoped (`company_id` NOT NULL), sementara CEO BINDER adalah
 * agen tingkat akun. Sampai company kedua dibuat (Tahap 6), CEO
 * terdaftar di SATU company — company pertama (di test: company TEST).
 * Kehadiran CEO per-company tambahan + penegakan singleton di level DB
 * (partial unique index) adalah pekerjaan Tahap 6 / audit Fase 3.6;
 * fase ini menegakkannya di level service (satu CEO di seluruh akun).
 * TIDAK ADA pemanggilan model live di fase ini — registrasi +
 * konfigurasi + smoke test data TEST saja; kunci API tidak pernah
 * dipakai, diminta, atau ditulis.
 * - `canCreateAgents: false` (fail-closed): hire agen di BINDER SELALU
 *   lewat alur yang disetujui owner (Rencana Tahap 3A) — CEO tidak boleh
 *   membuat agen Paperclip langsung dan melewati approval owner.
 *   `canCreateSkills: true` mengikuti default agen standar Paperclip.
 */

export type BinderCeoRegistration = {
  agent: typeof agents.$inferSelect;
  model: typeof binderAgentModels.$inferSelect;
  connectorMatrix: Record<BinderConnectorClass, BinderConnectorMode>;
};

type CeoModelConfig = {
  modelFamily: string;
  modelId: string;
  provider: string;
  apiKeyRef: string;
};

type CeoConfig = {
  primary: CeoModelConfig;
  fallback: CeoModelConfig;
  runtimeDefault: string;
  budgetMonthlyCents: number;
  connectorMatrix: Record<BinderConnectorClass, BinderConnectorMode>;
};

/**
 * Pola referensi kunci: `{env:NAMA_VAR}` — sama seperti placeholder
 * `apiKey` konfigurasi OpenCode. Literal apa pun yang bukan referensi
 * env ditolak, supaya nilai kunci tidak pernah tersimpan (P1-24).
 */
const API_KEY_REF_PATTERN = /^\{env:[A-Za-z_][A-Za-z0-9_]*\}$/;

function assertApiKeyRef(ref: unknown, label: string): string {
  if (typeof ref !== "string" || !API_KEY_REF_PATTERN.test(ref)) {
    throw badRequest(
      `${label} harus berupa referensi env '{env:NAMA_VAR}' — bukan nilai kunci`,
    );
  }
  return ref;
}

/**
 * Nilai `model` untuk `adapterConfig` Paperclip dari model utama:
 * adapter opencode_local memakai format provider/model OpenCode
 * ('meta/muse-spark-1.3'); adapter lain memakai id model polos.
 * Aturan turunan ini milik adapter, bukan keputusan BINDER — bila
 * adapter baru ditambahkan, turunannya ditambahkan di sini.
 */
function deriveAdapterModel(primary: CeoModelConfig): string {
  if (primary.provider === BINDER_CEO_PRIMARY_ADAPTER_TYPE) {
    return `${primary.modelFamily}/${primary.modelId}`;
  }
  return primary.modelId;
}

/**
 * Validasi + normalisasi matriks konektor (pure — bisa diuji tanpa DB).
 * Aturan mode per kelas (PRD Bab 7; Rencana Tahap 3 poin 5):
 * - kelas kirim eksternal WAJIB 'off';
 * - kelas tulis/destruktif TIDAK BOLEH 'allowed' (ask_first atau off);
 * - hanya kelas baca yang boleh 'allowed'.
 * Kelas yang tidak disebut di input dinormalisasi ke 'off' (fail-closed);
 * kelas tak dikenal ditolak (kosakata tertutup).
 */
export function validateCeoConnectorMatrix(
  input: unknown,
): Record<BinderConnectorClass, BinderConnectorMode> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw badRequest("Matriks konektor CEO harus berupa objek kelas → mode");
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(BINDER_CONNECTOR_CLASSES as readonly string[]).includes(key)) {
      throw badRequest(`Kelas konektor tidak dikenal: ${key}`);
    }
  }
  const normalized = {} as Record<BinderConnectorClass, BinderConnectorMode>;
  for (const klass of BINDER_CONNECTOR_CLASSES) {
    const mode = record[klass];
    if (mode === undefined) {
      normalized[klass] = "off";
      continue;
    }
    if (typeof mode !== "string" || !(BINDER_CONNECTOR_MODES as readonly string[]).includes(mode)) {
      throw badRequest(`Mode konektor tidak dikenal untuk ${klass}: ${String(mode)}`);
    }
    normalized[klass] = mode as BinderConnectorMode;
  }
  for (const klass of BINDER_CONNECTOR_SEND_CLASSES) {
    if (normalized[klass] !== "off") {
      throw badRequest(
        `Kelas kirim eksternal ${klass} harus 'off' — CEO tanpa konektor kirim eksternal`,
      );
    }
  }
  for (const klass of BINDER_CONNECTOR_WRITE_CLASSES) {
    if (normalized[klass] === "allowed") {
      throw badRequest(
        `Kelas tulis ${klass} tidak boleh 'allowed' — tulis dan aksi destruktif wajib 'ask_first'`,
      );
    }
  }
  return normalized;
}

/** Konfigurasi CEO yang diminta — default PRD bila tidak disebut. */
function resolveCeoConfig(input: BinderRegisterCeo): CeoConfig {
  // Default zod tidak berlaku bila service dipanggil langsung (bukan lewat
  // parse skema) — nama di-default-kan di sini, bukan diabaikan.
  const name = input.name ?? BINDER_CEO_NAME;
  if (name !== BINDER_CEO_NAME) {
    throw badRequest(`Nama CEO BINDER adalah '${BINDER_CEO_NAME}'`);
  }
  // Model adalah KONFIGURASI yang bisa diganti (keputusan 07:22 WIB):
  // yang ditegakkan di sini hanya bentuk + referensi kunci, bukan nilai
  // tertentu. Default = keputusan model aktif Patria (Meta → Claude).
  const primary: CeoModelConfig = {
    modelFamily: input.primaryModel?.modelFamily ?? BINDER_CEO_PRIMARY_MODEL_FAMILY,
    modelId: input.primaryModel?.modelId ?? BINDER_CEO_PRIMARY_MODEL_ID,
    provider: input.primaryModel?.provider ?? BINDER_CEO_PRIMARY_ADAPTER_TYPE,
    apiKeyRef: assertApiKeyRef(
      input.primaryModel?.apiKeyRef ?? BINDER_CEO_PRIMARY_API_KEY_REF,
      "apiKeyRef model utama",
    ),
  };
  const fallback: CeoModelConfig = {
    modelFamily: input.fallbackModel?.modelFamily ?? BINDER_CEO_FALLBACK_MODEL_FAMILY,
    modelId: input.fallbackModel?.modelId ?? BINDER_CEO_FALLBACK_MODEL_ID,
    provider: input.fallbackModel?.provider ?? BINDER_CEO_FALLBACK_ADAPTER_TYPE,
    apiKeyRef: assertApiKeyRef(
      input.fallbackModel?.apiKeyRef ?? BINDER_CEO_FALLBACK_API_KEY_REF,
      "apiKeyRef fallback",
    ),
  };
  const runtimeDefault = input.runtimeDefault ?? BINDER_CEO_RUNTIME_DEFAULT;
  if (runtimeDefault !== BINDER_CEO_RUNTIME_DEFAULT) {
    throw badRequest("Runtime default CEO adalah sandbox");
  }
  return {
    primary,
    fallback,
    runtimeDefault,
    budgetMonthlyCents: input.budgetMonthlyCents ?? BINDER_CEO_BUDGET_MONTHLY_CENTS,
    connectorMatrix: validateCeoConnectorMatrix(
      input.connectorMatrix ?? BINDER_CEO_CONNECTOR_MATRIX,
    ),
  };
}

/** Model dari input update — wajib lengkap bila disebut (bentuk + ref kunci). */
function resolveCeoModelUpdate(
  input: { modelFamily: string; modelId: string; provider: string; apiKeyRef?: string },
  defaultRef: string,
  label: string,
): CeoModelConfig {
  if (!input.modelFamily || !input.modelId || !input.provider) {
    throw badRequest(`${label} wajib berisi modelFamily, modelId, dan provider`);
  }
  return {
    modelFamily: input.modelFamily,
    modelId: input.modelId,
    provider: input.provider,
    apiKeyRef: assertApiKeyRef(input.apiKeyRef ?? defaultRef, `apiKeyRef ${label}`),
  };
}

/** Baca konfigurasi BINDER dari baris `agents` yang tersimpan. */
function readCeoConfig(agent: typeof agents.$inferSelect): CeoConfig {
  const adapterConfig = (agent.adapterConfig ?? {}) as Record<string, unknown>;
  const binder = (adapterConfig["binder"] ?? {}) as Record<string, unknown>;
  const storedPrimary = (binder["primary"] ?? {}) as Record<string, unknown>;
  const storedFallback = (binder["fallback"] ?? {}) as Record<string, unknown>;
  const primary: CeoModelConfig = {
    modelFamily: String(storedPrimary["modelFamily"] ?? ""),
    modelId: String(storedPrimary["modelId"] ?? ""),
    provider: String(storedPrimary["provider"] ?? ""),
    apiKeyRef: String(storedPrimary["apiKeyRef"] ?? ""),
  };
  const fallback: CeoModelConfig = {
    modelFamily: String(storedFallback["modelFamily"] ?? ""),
    modelId: String(storedFallback["modelId"] ?? ""),
    provider: String(storedFallback["provider"] ?? ""),
    apiKeyRef: String(storedFallback["apiKeyRef"] ?? ""),
  };
  const runtimeConfig = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
  const runtimeBinder = (runtimeConfig["binder"] ?? {}) as Record<string, unknown>;
  const permissions = (agent.permissions ?? {}) as Record<string, unknown>;
  return {
    primary,
    fallback,
    runtimeDefault: String(runtimeBinder["runtimeDefault"] ?? ""),
    budgetMonthlyCents: agent.budgetMonthlyCents,
    connectorMatrix: validateCeoConnectorMatrix(
      permissions["binderConnectorMatrix"] ?? {},
    ),
  };
}

function configsEqual(a: CeoConfig, b: CeoConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function loadCeoView(
  tx: Db,
  agent: typeof agents.$inferSelect,
): Promise<BinderCeoRegistration> {
  const [model] = await tx
    .select()
    .from(binderAgentModels)
    .where(
      and(
        eq(binderAgentModels.companyId, agent.companyId),
        eq(binderAgentModels.agentId, agent.id),
      ),
    );
  if (!model) throw notFound("Model CEO belum terdaftar");
  const permissions = (agent.permissions ?? {}) as Record<string, unknown>;
  return {
    agent,
    model,
    connectorMatrix: validateCeoConnectorMatrix(permissions["binderConnectorMatrix"] ?? {}),
  };
}

async function noteBinderActivity(
  tx: Db,
  publications: ActivityPublication[],
  input: {
    companyId: string;
    action: string;
    entityType: string;
    entityId: string;
    details: Record<string, unknown>;
  },
): Promise<void> {
  await logActivity(
    tx,
    {
      companyId: input.companyId,
      actorType: "system",
      actorId: "binder-ceo",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      details: input.details,
    },
    publications,
  );
}

/**
 * Daftarkan CEO Edison — satu-satunya agen awal BINDER.
 * Idempotent: daftar ulang dengan konfigurasi yang SAMA di company yang
 * sama mengembalikan registrasi yang sudah ada; konfigurasi berbeda →
 * conflict (ubah lewat update, bukan daftar ulang); company lain →
 * conflict (satu CEO untuk seluruh akun).
 */
export async function registerCeo(
  db: Db,
  input: BinderRegisterCeo,
): Promise<BinderCeoRegistration> {
  const config = resolveCeoConfig(input);
  return withBudgetSpan("binder.ceo.register", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const existing = await tx
        .select()
        .from(agents)
        .where(eq(agents.role, BINDER_CEO_ROLE))
        .orderBy(agents.createdAt);
      if (existing.length > 0) {
        const first = existing[0];
        if (first.companyId !== input.companyId) {
          throw conflict(
            "CEO BINDER sudah terdaftar di company lain — satu CEO (Edison) untuk seluruh akun",
          );
        }
        if (!configsEqual(readCeoConfig(first), config)) {
          throw conflict(
            "CEO sudah terdaftar dengan konfigurasi berbeda — ubah lewat updateCeoBudget / updateCeoConnectorMatrix, bukan daftar ulang",
          );
        }
        return loadCeoView(tx, first);
      }
      const now = new Date();
      const [agent] = await tx
        .insert(agents)
        .values({
          companyId: input.companyId,
          name: BINDER_CEO_NAME,
          role: BINDER_CEO_ROLE,
          title: BINDER_CEO_TITLE,
          adapterType: config.primary.provider,
          adapterConfig: {
            model: deriveAdapterModel(config.primary),
            binder: { primary: config.primary, fallback: config.fallback },
          },
          runtimeConfig: normalizeRuntimeConfigForNewAgent({
            binder: {
              runtimeDefault: config.runtimeDefault,
              desktop: "visual-verification-only",
            },
          }),
          budgetMonthlyCents: config.budgetMonthlyCents,
          permissions: {
            canCreateAgents: false,
            canCreateSkills: true,
            binderConnectorMatrix: config.connectorMatrix,
          },
          metadata: {
            binder: {
              ceo: true,
              registeredAt: now.toISOString(),
              primaryModelId: config.primary.modelId,
              fallbackModelId: config.fallback.modelId,
            },
          },
          status: "idle",
          createdByUserId: input.registeredByUserId ?? null,
        })
        .returning();
      const model = await registerAgentModelInTransaction(tx, {
        companyId: input.companyId,
        agentId: agent.id,
        modelFamily: config.primary.modelFamily as BinderModelFamily,
        modelId: config.primary.modelId,
        provider: config.primary.provider,
      });
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.ceo.registered",
        entityType: "agent",
        entityId: agent.id,
        details: {
          name: BINDER_CEO_NAME,
          primaryModelId: config.primary.modelId,
          primaryProvider: config.primary.provider,
          fallbackModelId: config.fallback.modelId,
          fallbackProvider: config.fallback.provider,
          runtimeDefault: config.runtimeDefault,
          budgetMonthlyCents: config.budgetMonthlyCents,
        },
      });
      return { agent, model, connectorMatrix: config.connectorMatrix };
    }),
  );
}

/** Baca CEO BINDER (satu-satunya baris `agents` role 'ceo' di seluruh akun). */
/**
 * Konfigurasi model CEO untuk hero (rencana Tahap 3 Fase 3.5) — null bila
 * CEO belum terdaftar (keadaan kosong, bukan galat). Hanya referensi
 * kunci ('{env:...}'), tanpa nilai kunci (P1-24).
 */
export async function getCeoModelConfig(db: Db): Promise<{
  companyId: string;
  primary: { modelFamily: string; modelId: string; provider: string; apiKeyRef: string };
  fallback: { modelFamily: string; modelId: string; provider: string; apiKeyRef: string };
  runtimeDefault: string;
  budgetMonthlyCents: number;
} | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.role, BINDER_CEO_ROLE))
    .orderBy(agents.createdAt);
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw conflict("Lebih dari satu CEO terdaftar — melanggar aturan satu CEO per akun");
  }
  const config = readCeoConfig(rows[0]);
  return {
    companyId: rows[0].companyId,
    primary: config.primary,
    fallback: config.fallback,
    runtimeDefault: config.runtimeDefault,
    budgetMonthlyCents: config.budgetMonthlyCents,
  };
}

export async function getCeo(db: Db): Promise<BinderCeoRegistration> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.role, BINDER_CEO_ROLE))
    .orderBy(agents.createdAt);
  if (rows.length === 0) throw notFound("CEO BINDER belum terdaftar");
  if (rows.length > 1) {
    throw conflict("Lebih dari satu CEO terdaftar — melanggar aturan satu CEO per akun");
  }
  return loadCeoView(db, rows[0]);
}

/**
 * Ubah budget token bulanan CEO (sen) — pagu owner, bisa diubah kapan pun
 * atas alasan strategis (PRD Bab 14). CEO harus terdaftar di company ini.
 */
export async function updateCeoBudget(
  db: Db,
  input: BinderUpdateCeoBudget,
): Promise<typeof agents.$inferSelect> {
  return withBudgetSpan("binder.ceo.update_budget", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const [agent] = await tx
        .select()
        .from(agents)
        .where(
          and(eq(agents.role, BINDER_CEO_ROLE), eq(agents.companyId, input.companyId)),
        );
      if (!agent) throw notFound("CEO BINDER tidak terdaftar di company ini");
      const [updated] = await tx
        .update(agents)
        .set({ budgetMonthlyCents: input.budgetMonthlyCents, updatedAt: new Date() })
        .where(eq(agents.id, agent.id))
        .returning();
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.ceo.budget_updated",
        entityType: "agent",
        entityId: agent.id,
        details: {
          budgetMonthlyCents: input.budgetMonthlyCents,
          previousBudgetMonthlyCents: agent.budgetMonthlyCents,
        },
      });
      return updated;
    }),
  );
}

/** Ubah matriks konektor CEO — matriks baru wajib lolos validasi 3P-mode. */
export async function updateCeoConnectorMatrix(
  db: Db,
  input: BinderUpdateCeoMatrix,
): Promise<typeof agents.$inferSelect> {
  const normalized = validateCeoConnectorMatrix(input.connectorMatrix);
  return withBudgetSpan("binder.ceo.update_matrix", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const [agent] = await tx
        .select()
        .from(agents)
        .where(
          and(eq(agents.role, BINDER_CEO_ROLE), eq(agents.companyId, input.companyId)),
        );
      if (!agent) throw notFound("CEO BINDER tidak terdaftar di company ini");
      const permissions = {
        ...((agent.permissions ?? {}) as Record<string, unknown>),
        binderConnectorMatrix: normalized,
      };
      const [updated] = await tx
        .update(agents)
        .set({ permissions, updatedAt: new Date() })
        .where(eq(agents.id, agent.id))
        .returning();
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.ceo.matrix_updated",
        entityType: "agent",
        entityId: agent.id,
        details: { connectorMatrix: normalized },
      });
      return updated;
    }),
  );
}

/**
 * Ganti konfigurasi model CEO (utama dan/atau fallback) — ganti
 * konfigurasi, bukan ganti kode (keputusan 07:22 WIB). Pergantian tetap
 * hanya di checkpoint atas vonis owner — fungsi ini mekanismenya, bukan
 * izinnya. Yang diubah atomik dalam satu transaksi: baris `agents`
 * (adapterType + adapterConfig.binder + adapterConfig.model) DAN baris
 * `binder_agent_models` (family model utama — yang dipakai aturan QC
 * beda family), supaya keduanya tidak pernah berbeda.
 */
export async function updateCeoModel(
  db: Db,
  input: BinderUpdateCeoModel,
): Promise<BinderCeoRegistration> {
  const nextPrimary = input.primaryModel
    ? resolveCeoModelUpdate(input.primaryModel, BINDER_CEO_PRIMARY_API_KEY_REF, "model utama")
    : null;
  const nextFallback = input.fallbackModel
    ? resolveCeoModelUpdate(input.fallbackModel, BINDER_CEO_FALLBACK_API_KEY_REF, "fallback")
    : null;
  return withBudgetSpan("binder.ceo.update_model", () =>
    withOperationAccountingTransaction(db, input.companyId, async (tx, publications) => {
      await lockBudgetAdmissionControls(tx, input.companyId);
      const [agent] = await tx
        .select()
        .from(agents)
        .where(
          and(eq(agents.role, BINDER_CEO_ROLE), eq(agents.companyId, input.companyId)),
        );
      if (!agent) throw notFound("CEO BINDER tidak terdaftar di company ini");
      const current = readCeoConfig(agent);
      const primary = nextPrimary ?? current.primary;
      const fallback = nextFallback ?? current.fallback;
      const adapterConfig = {
        ...((agent.adapterConfig ?? {}) as Record<string, unknown>),
        model: deriveAdapterModel(primary),
        binder: { primary, fallback },
      };
      const [updated] = await tx
        .update(agents)
        .set({ adapterType: primary.provider, adapterConfig, updatedAt: new Date() })
        .where(eq(agents.id, agent.id))
        .returning();
      const model = await registerAgentModelInTransaction(tx, {
        companyId: input.companyId,
        agentId: agent.id,
        modelFamily: primary.modelFamily as BinderModelFamily,
        modelId: primary.modelId,
        provider: primary.provider,
      });
      await noteBinderActivity(tx, publications, {
        companyId: input.companyId,
        action: "binder.ceo.model_updated",
        entityType: "agent",
        entityId: agent.id,
        details: {
          primaryModelId: primary.modelId,
          primaryProvider: primary.provider,
          fallbackModelId: fallback.modelId,
          fallbackProvider: fallback.provider,
        },
      });
      const permissions = (updated.permissions ?? {}) as Record<string, unknown>;
      return {
        agent: updated,
        model,
        connectorMatrix: validateCeoConnectorMatrix(
          permissions["binderConnectorMatrix"] ?? {},
        ),
      };
    }),
  );
}

/**
 * Bukti pengecualian CEO dari pool QC (P0-1) untuk satu company:
 * CEO tidak boleh ada di `binder_qc_roster` (pendaftaran ditolak
 * `registerQcReviewer`) dan tidak boleh muncul di `listQcRoster`
 * (penunjukan menyaring role 'ceo'). Bila CEO ditemukan di roster —
 * yang seharusnya mustahil — lempar conflict (pelanggaran P0-1).
 * Bila CEO terdaftar di company lain / belum terdaftar, company ini
 * tetap terbukti bersih (tidak ada baris CEO yang bisa masuk roster).
 */
export async function assertCeoExcludedFromQcPool(
  db: Db,
  companyId: string,
): Promise<{ excluded: boolean; ceoAgentId: string | null; rosterSize: number }> {
  const [ceo] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.role, BINDER_CEO_ROLE), eq(agents.companyId, companyId)));
  const roster = await listQcRoster(db, companyId);
  if (ceo) {
    const [inRoster] = await db
      .select({ id: binderQcRoster.id })
      .from(binderQcRoster)
      .where(
        and(
          eq(binderQcRoster.companyId, companyId),
          eq(binderQcRoster.agentId, ceo.id),
        ),
      );
    if (inRoster || roster.some((member) => member.agentId === ceo.id)) {
      throw conflict("CEO ditemukan di pool QC — pelanggaran P0-1");
    }
    return { excluded: true, ceoAgentId: ceo.id, rosterSize: roster.length };
  }
  return { excluded: true, ceoAgentId: null, rosterSize: roster.length };
}
