/**
 * Tipe ringkasan hero per company + Test Connection model BINDER
 * (PRD Bab 6/7; rencana Tahap 3 Fase 3.5).
 *
 * Uang tampil memakai sen utuh (number) agar `formatCents` UI bisa
 * langsung memakainya; nilai eksak tetap hidup di ledger kanonik
 * (numeric(24,7)) dan `ledgerDifferenceCents` di bawah memakai string
 * desimal eksak ("0.0000000" = seimbang persis, P1-21).
 */

/** Status hasil Test Connection model. */
export type BinderTestConnectionStatus = "ok" | "failed" | "not_configured";

export interface BinderTestConnectionResult {
  provider: string;
  modelId: string;
  status: BinderTestConnectionStatus;
  /** Pesan bahasa biasa untuk user — tanpa detail teknis mentah. */
  message: string;
  /** Durasi panggilan provider (ms); null bila tidak ada panggilan. */
  latencyMs: number | null;
  /** HTTP status provider bila ada; null bila tidak ada panggilan. */
  httpStatus: number | null;
}

/** Ringkasan dana BINDER untuk hero (pool + amplop + ledger). */
export interface BinderHeroFundingSummary {
  companyId: string;
  pool: {
    /** Saldo pool (sen utuh, untuk tampil). */
    balanceCents: number;
    /** Pagu top-up bulanan (sen utuh). */
    monthlyTopUpCents: number;
    /** Level peringatan pool: 0 / 70 / 90. */
    level: 0 | 70 | 90;
    exhausted: boolean;
  } | null;
  envelopes: Array<{
    id: string;
    /** Tugas pemilik amplop; null bila amplop tidak terikat tugas. */
    issueId: string | null;
    status: string;
    /** Jumlah amplop (sen utuh, untuk tampil). */
    amountCents: number;
    /** Sudah terpakai (sen utuh, untuk tampil). */
    spentCents: number;
    /** Sisa amplop (sen utuh, untuk tampil). */
    remainingCents: number;
    level: 0 | 70 | 90;
  }>;
  /** True bila saldo pool == kredit non-memo − debit non-memo. */
  ledgerBalanced: boolean;
  /** Selisih rekonsiliasi (string desimal eksak); "0.0000000" = seimbang. */
  ledgerDifferenceCents: string;
}

/** Konfigurasi model CEO untuk hero (referensi kunci saja, tanpa nilai). */
export interface BinderHeroCeoModel {
  registered: boolean;
  /** Company tempat CEO terdaftar; null bila belum terdaftar. */
  companyId: string | null;
  primary: {
    modelFamily: string;
    modelId: string;
    provider: string;
    /** Referensi kunci pola '{env:NAMA_VAR}' — bukan nilai kunci. */
    apiKeyRef: string;
  } | null;
  fallback: {
    modelFamily: string;
    modelId: string;
    provider: string;
    apiKeyRef: string;
  } | null;
  runtimeDefault: string | null;
  /** Budget token bulanan CEO (sen utuh). */
  budgetMonthlyCents: number | null;
}
