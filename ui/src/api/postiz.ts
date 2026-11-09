// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import type {
  PostizBatchPush,
  PostizBatchPushResult,
  PostizSync,
  PostizSyncResult,
  PostizTestConnection,
  PostizTestConnectionResult,
} from "@paperclipai/shared";
import { api } from "./client";

/**
 * API Postiz per company BINDER — integrasi planner hibrida opsi C
 * (rancangan tahap1/desain-integrasi-postiz-hibrida-2026-11-09.md).
 *
 * Test Connection mengirim kunci sementara sekali pakai di body — kunci
 * TIDAK PERNAH disimpan server, dicatat di log, atau dikembalikan di
 * respons (P1-24). Bila kunci belum ada, jawabannya status
 * 'not_configured' ("belum terhubung"), bukan galat. Aturan yang sama
 * berlaku untuk batch push dan sync: kunci di body dipakai sekali untuk
 * panggilan ke Postiz, lalu dibuang.
 */
export const postizApi = {
  testConnection: (companyId: string, data: PostizTestConnection) =>
    api.post<PostizTestConnectionResult>(
      `/companies/${companyId}/postiz/test-connection`,
      data,
    ),
  batchPush: (companyId: string, data: PostizBatchPush) =>
    api.post<PostizBatchPushResult>(
      `/companies/${companyId}/postiz/batch-push`,
      data,
    ),
  sync: (companyId: string, data: PostizSync) =>
    api.post<PostizSyncResult>(`/companies/${companyId}/postiz/sync`, data),
};
