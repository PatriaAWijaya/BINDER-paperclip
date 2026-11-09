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
