/**
 * Phase 2 — Bank Description Normalizer: Simulation API
 *
 * Routes:
 *   POST /api/bank-recon/normalize          — normalize one description
 *   POST /api/bank-recon/normalize/batch    — normalize up to 100 at once
 *
 * Input/Output contract: see NormalizationResult in bankDescriptionNormalizer.ts
 *
 * Auth: requireAdmin (same as the rest of bank-reconciliation)
 * These endpoints are read-only (no DB writes).
 */

import { Router } from "express";
import { z } from "zod/v4";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import {
  normalizeDescription,
  normalizeDescriptions,
  type NormalizationResult,
} from "../lib/bankDescriptionNormalizer.js";

export const bankDescriptionNormalizerRouter = Router();

bankDescriptionNormalizerRouter.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Input schemas ─────────────────────────────────────────────────────────────

const SingleNormalizeSchema = z.object({
  description: z.string().min(1, "description wajib diisi"),
  amount:      z.number().optional(),
  direction:   z.enum(["IN", "OUT"]).optional(),
});

const BatchNormalizeSchema = z.object({
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        amount:      z.number().optional(),
        direction:   z.enum(["IN", "OUT"]).optional(),
        ref:         z.string().optional(),
      }),
    )
    .min(1)
    .max(100, "Maksimal 100 item per batch"),
});

// ─── POST /api/bank-recon/normalize ──────────────────────────────────────────
/**
 * Normalize a single bank mutation description.
 *
 * Request body:
 *   { description: string, amount?: number, direction?: "IN" | "OUT" }
 *
 * Response:
 *   { input: {...}, result: NormalizationResult }
 */
bankDescriptionNormalizerRouter.post("/normalize", async (req, res) => {
  try {
    const parsed = SingleNormalizeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Input tidak valid",
        details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const { description, amount, direction } = parsed.data;
    const result: NormalizationResult = normalizeDescription(description);

    logger.debug({ description: description.slice(0, 80), category: result.category }, "[normalize] single");

    return res.json({
      input: { description, amount, direction },
      result,
    });
  } catch (err) {
    logger.error({ err }, "[POST /normalize] unexpected error");
    return res.status(500).json({ error: "Gagal melakukan normalisasi" });
  }
});

// ─── POST /api/bank-recon/normalize/batch ─────────────────────────────────────
/**
 * Normalize up to 100 descriptions in one request.
 *
 * Request body:
 *   { items: Array<{ description: string, amount?: number, direction?: string, ref?: string }> }
 *
 * Response:
 *   { count: number, results: Array<{ input, result: NormalizationResult }> }
 */
bankDescriptionNormalizerRouter.post("/normalize/batch", async (req, res) => {
  try {
    const parsed = BatchNormalizeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Input tidak valid",
        details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const { items } = parsed.data;
    const descriptions = items.map(i => i.description);
    const normResults  = normalizeDescriptions(descriptions);

    const results = items.map((item, idx) => ({
      input: item,
      result: normResults[idx],
    }));

    logger.debug({ count: items.length }, "[normalize] batch");

    return res.json({ count: results.length, results });
  } catch (err) {
    logger.error({ err }, "[POST /normalize/batch] unexpected error");
    return res.status(500).json({ error: "Gagal melakukan normalisasi batch" });
  }
});
