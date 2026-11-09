import { z } from "zod";
import { binderApiKeyRefSchema } from "./binder-ceo.js";

/**
 * Validator input API Postiz BINDER — Test Connection
 * (rancangan tahap1/desain-integrasi-postiz-hibrida-2026-11-09.md).
 *
 * `baseUrl` = alamat instance Postiz: self-hosted
 * (mis. 'http://localhost:5000') atau Cloud
 * ('https://api.postiz.com'). Aturan hosting umum Patria 9 Nov 2026:
 * self-hosted dulu; cloud cukup ganti base URL, tanpa ubah kode.
 *
 * `apiKey` di body BERSIFAT SEMENTARA (transient): dipakai sekali untuk
 * panggilan uji ke Postiz, lalu dibuang — TIDAK PERNAH disimpan,
 * dicatat di log, atau dikembalikan di respons (P1-24). Bila tidak ada
 * apiKey, pakai `apiKeyRef` '{env:POSTIZ_API_KEY}' yang sudah terpasang
 * di server; bila keduanya tidak ada → status 'not_configured'
 * ("belum terhubung"), bukan error mentah. Minimal satu dari keduanya
 * wajib diisi — validasi ini menolak body kosong, bukan menolak
 * keadaan belum terhubung (keadaan itu jawaban, bukan galat).
 */
export const postizTestConnectionSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      }, { message: "baseUrl harus alamat http(s) yang valid" }),
    /** Kunci sementara sekali pakai — TIDAK PERNAH disimpan. */
    apiKey: z.string().trim().min(1).max(512).optional(),
    /** Referensi kunci yang sudah terpasang di server. */
    apiKeyRef: binderApiKeyRefSchema.optional(),
  })
  .refine((input) => input.apiKey !== undefined || input.apiKeyRef !== undefined, {
    message: "apiKey atau apiKeyRef wajib diisi",
  });

export type PostizTestConnection = z.infer<typeof postizTestConnectionSchema>;

/**
 * Validator batch push Postiz (Fase B) — kirim satu batch issue ke
 * Postiz sebagai draft, lewat Gate dengan `approved_action_id` yang
 * sudah diterbitkan owner. `integrationId` = id channel Postiz
 * (mis. Instagram Saleem) dari hasil Test Connection. `issueIds`
 * WAJIB subset dari `payload.postIssueIds` di approved action —
 * dicek di layanan, bukan hanya di skema.
 */
export const postizBatchPushSchema = z
  .object({
    approvedActionId: z.string().uuid({ message: "approvedActionId harus UUID yang valid" }),
    issueIds: z
      .array(z.string().uuid({ message: "issueId harus UUID yang valid" }))
      .min(1, { message: "minimal satu issue" })
      .max(30, { message: "maksimal 30 issue per batch" }),
    integrationId: z.string().trim().min(1).max(256),
    baseUrl: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      }, { message: "baseUrl harus alamat http(s) yang valid" }),
    apiKey: z.string().trim().min(1).max(512).optional(),
    apiKeyRef: binderApiKeyRefSchema.optional(),
  })
  .refine((input) => input.apiKey !== undefined || input.apiKeyRef !== undefined, {
    message: "apiKey atau apiKeyRef wajib diisi",
  });

export type PostizBatchPush = z.infer<typeof postizBatchPushSchema>;

/**
 * Validator sync status Postiz (Fase B) — baca status post Postiz
 * dalam rentang tanggal, lalu perbarui `postiz_state` issue BINDER
 * yang cocok. Sync hanya MEMBACA (tanpa Gate id, sekelas Test
 * Connection) dan TIDAK mengubah status issue BINDER. GET /posts
 * Postiz WAJIB `startDate` + `endDate` (ISO-8601 UTC).
 */
export const postizSyncSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      }, { message: "baseUrl harus alamat http(s) yang valid" }),
    apiKey: z.string().trim().min(1).max(512).optional(),
    apiKeyRef: binderApiKeyRefSchema.optional(),
    startDate: z.string().trim().min(1).max(64).refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "startDate harus tanggal ISO 8601 yang valid",
    }),
    endDate: z.string().trim().min(1).max(64).refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "endDate harus tanggal ISO 8601 yang valid",
    }),
  })
  .refine((input) => input.apiKey !== undefined || input.apiKeyRef !== undefined, {
    message: "apiKey atau apiKeyRef wajib diisi",
  })
  .refine((input) => Date.parse(input.endDate) > Date.parse(input.startDate), {
    message: "endDate harus sesudah startDate",
  });

export type PostizSync = z.infer<typeof postizSyncSchema>;
