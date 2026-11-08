// Copyright (c) 2026 Patria A. Wijaya
// SPDX-License-Identifier: MIT

import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { binderTestConnectionSchema, binderUpdateCeoModelSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { updateCeoModel } from "../services/binder-ceo.js";
import { getBinderCeoModelSummary, getBinderFundingSummary } from "../services/binder-hero.js";
import { testBinderModelConnection } from "../services/binder-test-connection.js";

/**
 * Route hero per company BINDER (PRD Bab 6/7; rencana Tahap 3 Fase 3.5).
 *
 * - GET /companies/:companyId/binder/funding-summary — ringkasan dana
 *   BINDER (pool + amplop + ledger) untuk kartu finansial hero.
 * - GET /companies/:companyId/binder/ceo-model — konfigurasi model CEO
 *   (referensi kunci saja, tanpa nilai) untuk kartu model hero.
 * - POST /companies/:companyId/binder/ceo-model — ganti konfigurasi
 *   model CEO (board-only; pergantian tetap hanya di checkpoint).
 * - POST /companies/:companyId/binder/test-connection — Test Connection
 *   model (board-only). Kunci sementara di body dipakai sekali untuk
 *   panggilan uji, lalu dibuang — TIDAK PERNAH disimpan/dicatat/
 *   dikembalikan (P1-24). Bila kunci belum ada, jawabannya status
 *   'not_configured' ("belum terhubung"), bukan galat.
 *
 * TIDAK ADA pemanggilan model live dengan kunci nyata di fase ini —
 * pembuktian live dengan kunci Patria adalah langkah Tahap 6/MacBook.
 */
export function binderHeroRoutes(db: Db): Router {
  const api = Router({ mergeParams: true });

  api.get(
    "/companies/:companyId/binder/funding-summary",
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      await assertCompanyAccess(req, companyId);
      res.json(await getBinderFundingSummary(db, companyId));
    },
  );

  api.get("/companies/:companyId/binder/ceo-model", async (req: Request, res: Response) => {
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(req, companyId);
    res.json(await getBinderCeoModelSummary(db, companyId));
  });

  api.post(
    "/companies/:companyId/binder/ceo-model",
    validate(binderUpdateCeoModelSchema),
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      await assertBoard(req);
      await assertCompanyAccess(req, companyId);
      res.json(await updateCeoModel(db, req.body));
    },
  );

  api.post(
    "/companies/:companyId/binder/test-connection",
    validate(binderTestConnectionSchema),
    async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      await assertBoard(req);
      await assertCompanyAccess(req, companyId);
      res.json(await testBinderModelConnection(req.body));
    },
  );

  return api;
}
