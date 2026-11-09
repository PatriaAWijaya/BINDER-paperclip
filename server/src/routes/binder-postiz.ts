// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { postizBatchPushSchema, postizSyncSchema, postizTestConnectionSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { pushBinderPostizBatch, syncBinderPostizStatus } from "../services/binder-postiz-batch.js";
import { testBinderPostizConnection } from "../services/binder-postiz-test-connection.js";

/**
 * Route Postiz per company BINDER — integrasi planner hibrida opsi C
 * (rancangan tahap1/desain-integrasi-postiz-hibrida-2026-11-09.md).
 *
 * - POST /companies/:companyId/postiz/test-connection — Test Connection
 *   Postiz (board-only). Kunci sementara di body dipakai sekali untuk
 *   panggilan uji, lalu dibuang — TIDAK PERNAH disimpan/dicatat/
 *   dikembalikan (P1-24). Bila kunci belum ada, jawabannya status
 *   'not_configured' ("belum terhubung"), bukan galat.
 * - POST /companies/:companyId/postiz/batch-push — Kirim satu batch
 *   issue ke Postiz sebagai DRAFT (board-only). WAJIB
 *   `approved_action_id` yang sudah diterbitkan owner untuk batch
 *   itu; Gate menolak tanpa id, dengan id yang sudah dipakai, atau
 *   dengan issue di luar cakupan persetujuan. Berhenti di tengah
 *   (transport/429) → hasil parsial + galat, id TIDAK dihabiskan.
 * - POST /companies/:companyId/postiz/sync — Sinkronkan status post
 *   Postiz ke issue BINDER (board-only). HANYA MEMBACA (tanpa Gate
 *   id); status issue BINDER tidak diubah otomatis.
 *
 * TIDAK ADA instance Postiz live di Fase B — pembuktian live dengan
 * instance self-hosted + kunci Patria adalah langkah Fase C.
 */
export function binderPostizRoutes(
  db: Db,
  deps: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Router {
  const api = Router({ mergeParams: true });

  api.post(
    "/companies/:companyId/postiz/test-connection",
    validate(postizTestConnectionSchema),
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      await assertBoard(req);
      await assertCompanyAccess(req, companyId);
      res.json(await testBinderPostizConnection(req.body));
    },
  );

  api.post(
    "/companies/:companyId/postiz/batch-push",
    validate(postizBatchPushSchema),
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      await assertBoard(req);
      await assertCompanyAccess(req, companyId);
      const result = await pushBinderPostizBatch(db, { companyId, ...req.body }, deps);
      if (result.error) {
        res.status(result.rateLimited ? 429 : 502).json(result);
        return;
      }
      res.json(result);
    },
  );

  api.post(
    "/companies/:companyId/postiz/sync",
    validate(postizSyncSchema),
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      await assertBoard(req);
      await assertCompanyAccess(req, companyId);
      res.json(await syncBinderPostizStatus(db, { companyId, ...req.body }, deps));
    },
  );

  return api;
}
