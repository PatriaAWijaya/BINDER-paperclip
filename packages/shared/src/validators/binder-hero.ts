import { z } from "zod";
import { BINDER_TEST_CONNECTION_PROVIDERS } from "../constants.js";
import { binderApiKeyRefSchema } from "./binder-ceo.js";

/**
 * Validator input API hero BINDER — Test Connection model
 * (PRD Bab 7; rencana Tahap 3 Fase 3.5; syarat kemudahan ganti model
 * 8 Nov 2026 07:22 WIB).
 *
 * `apiKey` di body BERSIFAT SEMENTARA (transient): dipakai sekali untuk
 * panggilan uji ke provider, lalu dibuang — TIDAK PERNAH disimpan,
 * dicatat di log, atau dikembalikan di respons (P1-24). Bila tidak ada
 * apiKey, pakai `apiKeyRef` '{env:NAMA_VAR}' yang sudah terpasang di
 * server; bila keduanya tidak ada → status 'not_configured'
 * ("belum terhubung"), bukan error mentah. Minimal satu dari keduanya
 * wajib diisi — validasi ini menolak body kosong, bukan menolak
 * keadaan belum terhubung (keadaan itu jawaban, bukan galat).
 */
export const binderTestConnectionSchema = z
  .object({
    provider: z.enum(BINDER_TEST_CONNECTION_PROVIDERS),
    modelId: z.string().min(1).max(256),
    /** Kunci sementara sekali pakai — TIDAK PERNAH disimpan. */
    apiKey: z.string().min(1).max(4096).optional(),
    /** Referensi kunci yang sudah terpasang di server. */
    apiKeyRef: binderApiKeyRefSchema.optional(),
  })
  .refine((input) => input.apiKey !== undefined || input.apiKeyRef !== undefined, {
    message: "apiKey atau apiKeyRef wajib diisi",
  });

export type BinderTestConnection = z.infer<typeof binderTestConnectionSchema>;
