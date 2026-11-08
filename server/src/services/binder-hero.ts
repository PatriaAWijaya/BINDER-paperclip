// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import type { Db } from "@paperclipai/db";
import type { BinderHeroCeoModel, BinderHeroFundingSummary } from "@paperclipai/shared";
import { getCeoModelConfig } from "./binder-ceo.js";
import {
  getBinderFundingWarnings,
  getBinderPool,
  reconcileBinderLedger,
} from "./binder-funding.js";

/**
 * Data hero per company BINDER (PRD Bab 6/7; rencana Tahap 3 Fase 3.5).
 *
 * Hero menggabungkan dashboard kerja + dashboard finansial + progres
 * scrum dalam SATU halaman (PRD v1.16). Service ini hanya menyediakan
 * bagian finansial BINDER (pool + amplop + ledger) dan konfigurasi
 * model CEO; bagian kerja/scrum dibaca UI lewat API Paperclip yang
 * sudah ada (`dashboardApi.summary`, `goalsApi`, `issuesApi`) — jangan
 * duplikasi. Uang tampil memakai sen utuh (number) agar `formatCents`
 * UI bisa langsung memakainya; nilai eksak tetap di ledger kanonik.
 */

/**
 * Ringkasan dana BINDER satu company: saldo pool + peringatan 70/90 +
 * amplop hidup + status rekonsiliasi ledger. Bila pool belum ada,
 * `pool` null (keadaan kosong, bukan galat) dan ledger tetap
 * direkonsiliasi (seimbang bila tidak ada entri).
 */
export async function getBinderFundingSummary(
  db: Db,
  companyId: string,
): Promise<BinderHeroFundingSummary> {
  const pool = await getBinderPool(db, companyId);
  const warnings = await getBinderFundingWarnings(db, companyId);
  const reconciliation = await reconcileBinderLedger(db, companyId);
  return {
    companyId,
    pool: pool
      ? {
          balanceCents: Number(pool.balanceCents),
          monthlyTopUpCents: pool.monthlyTopUpCents,
          level: warnings.pool?.level ?? 0,
          exhausted: warnings.pool?.exhausted ?? false,
        }
      : null,
    envelopes: warnings.envelopes.map((envelope) => ({
      id: envelope.id,
      issueId: envelope.issueId,
      status: envelope.status,
      amountCents: Number(envelope.amountCents),
      spentCents: Number(envelope.spentCents),
      remainingCents: Number(envelope.remainingCents),
      level: envelope.level,
    })),
    ledgerBalanced: reconciliation.balanced,
    ledgerDifferenceCents: reconciliation.differenceCents,
  };
}

/**
 * Konfigurasi model CEO untuk hero: terdaftar + model utama/fallback +
 * runtime + budget. Bila CEO belum terdaftar — atau terdaftar di
 * company lain (satu CEO per akun; kehadiran per-company tambahan di
 * Tahap 6) — jawabannya `registered: false` tanpa membocorkan data
 * company lain (P0-2: data tidak lintas company).
 */
export async function getBinderCeoModelSummary(
  db: Db,
  companyId: string,
): Promise<BinderHeroCeoModel> {
  const unregistered: BinderHeroCeoModel = {
    registered: false,
    companyId: null,
    primary: null,
    fallback: null,
    runtimeDefault: null,
    budgetMonthlyCents: null,
  };
  const config = await getCeoModelConfig(db);
  if (!config || config.companyId !== companyId) return unregistered;
  return {
    registered: true,
    companyId: config.companyId,
    primary: config.primary,
    fallback: config.fallback,
    runtimeDefault: config.runtimeDefault,
    budgetMonthlyCents: config.budgetMonthlyCents,
  };
}
