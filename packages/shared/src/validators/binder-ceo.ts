import { z } from "zod";
import {
  BINDER_CEO_BUDGET_MONTHLY_CENTS,
  BINDER_CEO_CONNECTOR_MATRIX,
  BINDER_CONNECTOR_CLASSES,
  BINDER_CONNECTOR_MODES,
  BINDER_CONNECTOR_READ_CLASSES,
  BINDER_CONNECTOR_SEND_CLASSES,
  BINDER_CONNECTOR_WRITE_CLASSES,
  BINDER_MODEL_FAMILIES,
} from "../constants.js";

/**
 * Validator input API CEO Edison BINDER
 * (PRD Bab 7; rencana Tahap 3 Fase 3.4, poin 5).
 *
 * Aturan yang ditegakkan di sini adalah aturan PRD:
 * - Satu CEO untuk seluruh akun (Edison); nama default 'Edison'.
 * - Model utama Meta Muse Spark 1.3 via opencode_local → fallback Claude
 *   via claude_local; Gemini + Codex NONAKTIF di konfigurasi aktif.
 * - Runtime default sandbox; budget token usulan $20/bulan (pagu owner,
 *   bisa diubah kapan pun).
 * - Matriks konektor: Allowed HANYA untuk baca yang aman; Ask first untuk
 *   semua tulis dan aksi destruktif; Off untuk yang tidak dibutuhkan —
 *   TANPA konektor kirim eksternal (semua kelas kirim WAJIB 'off').
 *
 * Validasi matriks berjalan dua lapis: skema zod di sini (bentuk +
 * kosakata kelas tertutup) dan `validateCeoConnectorMatrix` di service
 * (aturan mode per kelas — kirim harus off, tulis tidak boleh allowed).
 * TIDAK ADA pemanggilan model live di fase ini — registrasi +
 * konfigurasi + smoke test data TEST saja; kunci API tidak pernah
 * dipakai, diminta, atau ditulis (pola placeholder `{env:...}` bila
 * konfigurasi kelak merujuk secret).
 */

/** Satu kelas konektor → satu mode. Kosakata kelas TERTUTUP (fail-closed). */
const binderConnectorModeSchema = z.enum(BINDER_CONNECTOR_MODES);

export const binderConnectorMatrixSchema = z
  .object({
    workspace_read: binderConnectorModeSchema.optional(),
    docs_read: binderConnectorModeSchema.optional(),
    web_read: binderConnectorModeSchema.optional(),
    workspace_write: binderConnectorModeSchema.optional(),
    docs_write: binderConnectorModeSchema.optional(),
    command_run: binderConnectorModeSchema.optional(),
    destructive: binderConnectorModeSchema.optional(),
    email_send: binderConnectorModeSchema.optional(),
    external_message: binderConnectorModeSchema.optional(),
    external_post: binderConnectorModeSchema.optional(),
    outreach_send: binderConnectorModeSchema.optional(),
    external_call: binderConnectorModeSchema.optional(),
  })
  .refine((matrix) => Object.keys(matrix).length > 0, {
    message: "Matriks konektor tidak boleh kosong",
  });

export type BinderConnectorMatrix = z.infer<typeof binderConnectorMatrixSchema>;

/**
 * Referensi kunci provider — HARUS pola `{env:NAMA_VAR}` (pola
 * konfigurasi OpenCode). Nilai kunci ASLI tidak pernah boleh masuk ke
 * sini: regex ini menolak literal apa pun yang bukan referensi env,
 * supaya secret tidak pernah tersimpan di konfigurasi (PRD Bab 7 (d);
 * P1-24). Contoh: '{env:META_API_KEY}'.
 */
export const binderApiKeyRefSchema = z
  .string()
  .regex(/^\{env:[A-Za-z_][A-Za-z0-9_]*\}$/, {
    message: "apiKeyRef harus berupa referensi env '{env:NAMA_VAR}' — bukan nilai kunci",
  })
  .max(256);

/** Model agen (utama / fallback) — family + id + adapter Paperclip. */
export const binderCeoModelSchema = z.object({
  modelFamily: z.enum(BINDER_MODEL_FAMILIES),
  modelId: z.string().min(1).max(256),
  /** Adapter Paperclip, mis. 'opencode_local' / 'claude_local'. */
  provider: z.string().min(1).max(256),
  /** Referensi kunci provider — pola '{env:NAMA_VAR}', bukan nilai kunci. */
  apiKeyRef: binderApiKeyRefSchema.optional(),
});

export type BinderCeoModel = z.infer<typeof binderCeoModelSchema>;

export const binderRegisterCeoSchema = z.object({
  companyId: z.string().guid(),
  /** Nama CEO — default 'Edison' (PRD Bab 7); nama lain ditolak. Default
   * diterapkan service (`input.name ?? BINDER_CEO_NAME`), bukan `.default()`
   * zod — supaya tipe input service membolehkan nama dihilangkan. */
  name: z.string().min(1).max(256).optional(),
  /** Model utama — default Meta Muse Spark 1.3 via opencode_local. */
  primaryModel: binderCeoModelSchema.optional(),
  /** Fallback — default Claude via claude_local. */
  fallbackModel: binderCeoModelSchema.optional(),
  /** Runtime default — default 'sandbox'. */
  runtimeDefault: z.string().min(1).max(128).optional(),
  /** Budget token bulanan (sen) — default $20 (2000 sen). */
  budgetMonthlyCents: z.number().int().min(0).max(2_147_483_647).optional(),
  /** Matriks konektor — default BINDER_CEO_CONNECTOR_MATRIX. */
  connectorMatrix: binderConnectorMatrixSchema.optional(),
  /** Owner (user) yang mendaftarkan — untuk audit, dicatat di createdBy. */
  registeredByUserId: z.string().min(1).max(256).optional(),
});

export type BinderRegisterCeo = z.infer<typeof binderRegisterCeoSchema>;

export const binderUpdateCeoBudgetSchema = z.object({
  companyId: z.string().guid(),
  /** Budget token bulanan baru (sen) — pagu owner, bisa diubah kapan pun. */
  budgetMonthlyCents: z.number().int().min(0).max(2_147_483_647),
});

export type BinderUpdateCeoBudget = z.infer<typeof binderUpdateCeoBudgetSchema>;

export const binderUpdateCeoMatrixSchema = z.object({
  companyId: z.string().guid(),
  connectorMatrix: binderConnectorMatrixSchema,
});

export type BinderUpdateCeoMatrix = z.infer<typeof binderUpdateCeoMatrixSchema>;

/**
 * Ganti konfigurasi model CEO (utama dan/atau fallback) — ganti
 * konfigurasi, bukan ganti kode (DIPUTUSKAN Patria 8 Nov 2026 07:22 WIB;
 * pergantian tetap hanya di checkpoint atas vonis owner — fungsi ini
 * mekanismenya, bukan izinnya). Minimal satu model wajib diisi.
 */
export const binderUpdateCeoModelSchema = z
  .object({
    companyId: z.string().guid(),
    primaryModel: binderCeoModelSchema.optional(),
    fallbackModel: binderCeoModelSchema.optional(),
  })
  .refine((input) => input.primaryModel !== undefined || input.fallbackModel !== undefined, {
    message: "primaryModel atau fallbackModel wajib diisi",
  });

export type BinderUpdateCeoModel = z.infer<typeof binderUpdateCeoModelSchema>;

/** Konstanta CEO diekspor ulang agar service/UI membaca satu sumber. */
export {
  BINDER_CEO_BUDGET_MONTHLY_CENTS,
  BINDER_CEO_CONNECTOR_MATRIX,
  BINDER_CONNECTOR_CLASSES,
  BINDER_CONNECTOR_MODES,
  BINDER_CONNECTOR_READ_CLASSES,
  BINDER_CONNECTOR_SEND_CLASSES,
  BINDER_CONNECTOR_WRITE_CLASSES,
};
