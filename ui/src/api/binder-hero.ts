import type {
  BinderHeroCeoModel,
  BinderHeroFundingSummary,
  BinderTestConnection,
  BinderTestConnectionResult,
  BinderUpdateCeoModel,
} from "@paperclipai/shared";
import { api } from "./client";

/**
 * API hero per company BINDER (PRD Bab 6/7; rencana Tahap 3 Fase 3.5).
 *
 * Test Connection mengirim kunci sementara sekali pakai di body — kunci
 * TIDAK PERNAH disimpan server, dicatat di log, atau dikembalikan di
 * respons (P1-24). Bila kunci belum ada, jawabannya status
 * 'not_configured' ("belum terhubung"), bukan galat.
 */
export const binderHeroApi = {
  fundingSummary: (companyId: string) =>
    api.get<BinderHeroFundingSummary>(`/companies/${companyId}/binder/funding-summary`),
  ceoModel: (companyId: string) =>
    api.get<BinderHeroCeoModel>(`/companies/${companyId}/binder/ceo-model`),
  updateCeoModel: (companyId: string, data: BinderUpdateCeoModel) =>
    api.post<unknown>(`/companies/${companyId}/binder/ceo-model`, data),
  testConnection: (companyId: string, data: BinderTestConnection) =>
    api.post<BinderTestConnectionResult>(`/companies/${companyId}/binder/test-connection`, data),
};
