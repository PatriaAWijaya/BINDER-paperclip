// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { postizTestConnectionSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
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
 *
 * TIDAK ADA instance Postiz live di fase ini — pembuktian live dengan
 * instance self-hosted + kunci Patria adalah langkah Fase C.
 */
export function binderPostizRoutes(db: Db): Router {
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

  return api;
}
