/**
 * Tipe koneksi Postiz BINDER — integrasi planner hibrida opsi C
 * (rancangan tahap1/desain-integrasi-postiz-hibrida-2026-11-09.md;
 * aturan hosting umum Patria 9 Nov 2026: self-hosted dulu, cloud
 * siap lewat konfigurasi base URL).
 *
 * Postiz berlisensi AGPL-3.0: TIDAK ADA kode/SDK/CLI Postiz yang
 * di-bundle ke BINDER — hanya panggilan HTTP ke public API-nya
 * (pola yang sama seperti CanCut). Kunci API TIDAK PERNAH disimpan
 * di BINDER; dipakai sekali untuk uji (transient) atau dirujuk
 * sebagai '{env:POSTIZ_API_KEY}' (PRD Bab 7 (d); P1-24).
 */

/** Status hasil Test Connection Postiz. */
export type PostizTestConnectionStatus = "ok" | "failed" | "not_configured";

/** Satu channel Postiz yang terhubung (mis. Instagram). */
export interface PostizIntegrationSummary {
  id: string;
  /** Nama channel seperti yang tampil di Postiz. */
  name: string;
  /** Identifier provider Postiz (mis. "instagram"). */
  provider: string | null;
}

export interface PostizTestConnectionResult {
  status: PostizTestConnectionStatus;
  /** Pesan bahasa biasa untuk user — tanpa detail teknis mentah. */
  message: string;
  /** Durasi panggilan Postiz (ms); null bila tidak ada panggilan. */
  latencyMs: number | null;
  /** HTTP status Postiz bila ada; null bila tidak ada panggilan. */
  httpStatus: number | null;
  /** Channel yang terhubung (bukti live); null bila tidak ada panggilan. */
  integrations: PostizIntegrationSummary[] | null;
}
