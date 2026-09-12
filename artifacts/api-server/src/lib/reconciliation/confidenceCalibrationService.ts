/**
 * Confidence Calibration Service — Batch 3 Phase 6
 *
 * Records match outcomes per confidence band and computes calibration error.
 *
 * Calibration bands (10-point buckets):
 *   0–9, 10–19, 20–29, …, 90–99, 100
 *
 * For each band we track:
 *   - predictedCount  : how many matches the engine predicted at that confidence
 *   - correctCount    : how many were confirmed correct
 *   - actualAccuracy  : correctCount / predictedCount * 100
 *
 * Calibration error = |predictedAccuracy − actualAccuracy|
 *
 * Endpoint: GET /confidence-report
 */

import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { db as DrizzleDb } from "@workspace/db";

// Lazy DB loader — engine is pure (no DB connection on import)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
async function getDb() {
  if (!_db) { _db = (await import("@workspace/db")).db; }
  return _db as typeof DrizzleDb;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalibrationBand {
  bandLabel: string;
  bandMin: number;
  bandMax: number;
  predictedCount: number;
  correctCount: number;
  incorrectCount: number;
  predictedAccuracy: number;   // midpoint of the band (e.g. 95 for 90–99)
  actualAccuracy: number;      // correctCount / predictedCount * 100
  calibrationError: number;    // |predictedAccuracy − actualAccuracy|
}

export interface ConfidenceReport {
  companyId: number;
  bands: CalibrationBand[];
  overallAccuracy: number;
  overallCalibrationError: number;
  totalPredictions: number;
  totalCorrect: number;
  generatedAt: string;
}

// ─── Band helpers ─────────────────────────────────────────────────────────────

function bandFor(confidence: number): { min: number; max: number } {
  const min = Math.min(90, Math.floor(confidence / 10) * 10);
  const max = min === 90 ? 100 : min + 9;
  return { min, max };
}

function bandMidpoint(min: number, max: number): number {
  return (min + max) / 2;
}

// ─── Record outcome ───────────────────────────────────────────────────────────

export async function recordMatchOutcome(params: {
  companyId: number;
  predictedConfidence: number;
  wasCorrect: boolean;
}): Promise<void> {
  const { companyId, predictedConfidence, wasCorrect } = params;
  const confidence = Math.max(0, Math.min(100, Math.round(predictedConfidence)));
  const { min, max } = bandFor(confidence);

  const correctDelta = wasCorrect ? 1 : 0;
  const incorrectDelta = wasCorrect ? 0 : 1;
  const db = await getDb();
  try {
    // Upsert: increment counters, recompute actual_accuracy
    await db.execute(sql.raw(`
      INSERT INTO confidence_statistics
        (company_id, band_min, band_max, total_count, correct_count, incorrect_count,
         actual_accuracy, last_event_at)
      VALUES
        (${companyId}, ${min}, ${max}, 1, ${correctDelta}, ${incorrectDelta},
         ${correctDelta * 100}, NOW())
      ON CONFLICT (company_id, band_min) DO UPDATE
        SET total_count     = confidence_statistics.total_count + 1,
            correct_count   = confidence_statistics.correct_count + ${correctDelta},
            incorrect_count = confidence_statistics.incorrect_count + ${incorrectDelta},
            actual_accuracy = CASE
              WHEN confidence_statistics.total_count + 1 > 0
              THEN (confidence_statistics.correct_count + ${correctDelta})::NUMERIC
                   / (confidence_statistics.total_count + 1) * 100
              ELSE 0
            END,
            last_event_at   = NOW(),
            updated_at      = NOW()
    `));
  } catch (e: any) {
    logger.warn({ err: e.message, companyId, confidence }, "[confidenceCalibration] recordMatchOutcome failed (non-fatal)");
  }
}

// ─── Build calibration report ─────────────────────────────────────────────────

export async function getCalibrationReport(companyId: number): Promise<ConfidenceReport> {
  const generatedAt = new Date().toISOString();
  const db = await getDb();
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT band_min, band_max, total_count, correct_count, incorrect_count, actual_accuracy
      FROM confidence_statistics
      WHERE company_id = ${companyId}
      ORDER BY band_min ASC
    `));

    const bands: CalibrationBand[] = (rows as any[]).map(r => {
      const min = Number(r.band_min);
      const max = Number(r.band_max);
      const predicted = bandMidpoint(min, max);
      const actual = Number(r.actual_accuracy ?? 0);
      return {
        bandLabel: `${min}–${max}`,
        bandMin: min,
        bandMax: max,
        predictedCount: Number(r.total_count ?? 0),
        correctCount: Number(r.correct_count ?? 0),
        incorrectCount: Number(r.incorrect_count ?? 0),
        predictedAccuracy: predicted,
        actualAccuracy: Number(actual.toFixed(2)),
        calibrationError: Number(Math.abs(predicted - actual).toFixed(2)),
      };
    });

    const totalPredictions = bands.reduce((s, b) => s + b.predictedCount, 0);
    const totalCorrect = bands.reduce((s, b) => s + b.correctCount, 0);
    const overallAccuracy = totalPredictions > 0
      ? Number((totalCorrect / totalPredictions * 100).toFixed(2))
      : 0;
    const overallCalibrationError = bands.length > 0
      ? Number((bands.reduce((s, b) => s + b.calibrationError, 0) / bands.length).toFixed(2))
      : 0;

    return { companyId, bands, overallAccuracy, overallCalibrationError, totalPredictions, totalCorrect, generatedAt };
  } catch (e: any) {
    logger.warn({ err: e.message, companyId }, "[confidenceCalibration] getCalibrationReport failed");
    return { companyId, bands: [], overallAccuracy: 0, overallCalibrationError: 0, totalPredictions: 0, totalCorrect: 0, generatedAt };
  }
}

// ─── Seed calibration from existing audit data ────────────────────────────────
// One-shot backfill: reads bank_reconciliation_audit for MATCH_APPROVED events
// and builds initial statistics. Skips rows already counted.

export async function seedCalibrationFromAudit(companyId: number): Promise<number> {
  let seeded = 0;
  const db = await getDb();
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT
        bra.mutation_id,
        (bra.meta->>'confidence')::INTEGER AS confidence,
        CASE WHEN bm.status IN ('approved','posted') THEN TRUE ELSE FALSE END AS was_correct
      FROM bank_reconciliation_audit bra
      JOIN bank_mutations bm ON bm.id = bra.mutation_id
      WHERE bra.action = 'MATCH_APPROVED'
        AND bm.company_id = ${companyId}
        AND (bra.meta->>'confidence') IS NOT NULL
      ORDER BY bra.id ASC
    `)).catch(() => ({ rows: [] as unknown[] }));

    for (const r of rows as any[]) {
      const confidence = Number(r.confidence ?? 0);
      const wasCorrect = Boolean(r.was_correct);
      await recordMatchOutcome({ companyId, predictedConfidence: confidence, wasCorrect });
      seeded++;
    }
  } catch (e: any) {
    logger.warn({ err: e.message, companyId }, "[confidenceCalibration] seedCalibrationFromAudit failed");
  }
  return seeded;
}
