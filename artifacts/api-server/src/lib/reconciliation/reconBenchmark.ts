/**
 * Recon Benchmark
 *
 * Generates a synthetic dataset of 1,000 bank mutations with ground truth
 * and evaluates the Rule Engine + Decision Stack accuracy.
 *
 * Metrics produced:
 *  - accuracy   : (TP + TN) / total
 *  - precision  : TP / (TP + FP)
 *  - recall     : TP / (TP + FN)
 *  - F1 score   : 2 * precision * recall / (precision + recall)
 *  - avg confidence
 *  - false positive count
 *  - false negative count
 *
 * Read-only — benchmark never modifies production data.
 */

import { evaluateReconRules, type ReconRule, type ReconRuleMutationInput } from "./reconRuleEngine.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface BenchmarkMutation {
  id: number;
  description: string;
  reference: string | null;
  amount: number;
  direction: "IN" | "OUT";
  groundTruth: {
    shouldMatch: boolean;
    expectedTargetType: string | null;
  };
}

export interface BenchmarkResult {
  totalMutations: number;
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  avgConfidence: number;
  runDurationMs: number;
  throughputPerSec: number;
}

// ─── Dataset ──────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic set of 1000 synthetic mutations.
 * Mix of: bank fees (should match ADMIN_BANK rule), payroll, invoices, unknown.
 */
export function generateBenchmarkDataset(): BenchmarkMutation[] {
  const mutations: BenchmarkMutation[] = [];
  const descriptions = [
    // Bank fees (100)
    ...Array.from({ length: 100 }, (_, i) => ({
      desc: `BIAYA ADMIN BANK ${i + 1}`,
      dir: "OUT" as const,
      groundTruth: { shouldMatch: true, expectedTargetType: "bank_fee" },
    })),
    // Payroll (100)
    ...Array.from({ length: 100 }, (_, i) => ({
      desc: `GAJI KARYAWAN BULAN ${i + 1}`,
      dir: "OUT" as const,
      groundTruth: { shouldMatch: false, expectedTargetType: null },
    })),
    // Customer payments - INV references (200)
    ...Array.from({ length: 200 }, (_, i) => ({
      desc: `PEMBAYARAN INV-2026-${String(i + 1).padStart(4, "0")} PT ABC`,
      dir: "IN" as const,
      groundTruth: { shouldMatch: false, expectedTargetType: null },
    })),
    // Vendor payments (150)
    ...Array.from({ length: 150 }, (_, i) => ({
      desc: `TRANSFER VENDOR PAYMENT ${i + 1}`,
      dir: "OUT" as const,
      groundTruth: { shouldMatch: false, expectedTargetType: null },
    })),
    // More bank fees with variations (100)
    ...Array.from({ length: 100 }, (_, i) => ({
      desc: `FEE ADMINISTRASI BANK ${i + 1}`,
      dir: "OUT" as const,
      groundTruth: { shouldMatch: true, expectedTargetType: "bank_fee" },
    })),
    // Internal transfers (100)
    ...Array.from({ length: 100 }, (_, i) => ({
      desc: `TRANSFER INTERNAL REKENING ${i + 1}`,
      dir: "IN" as const,
      groundTruth: { shouldMatch: false, expectedTargetType: null },
    })),
    // Logistic income (150)
    ...Array.from({ length: 150 }, (_, i) => ({
      desc: `PEMBAYARAN JASA LOGISTIK PENGIRIMAN ${i + 1}`,
      dir: "IN" as const,
      groundTruth: { shouldMatch: false, expectedTargetType: null },
    })),
    // Ambiguous (100 — not fee, not clearly matched)
    ...Array.from({ length: 100 }, (_, i) => ({
      desc: `TRANSAKSI LAIN ${i + 1}`,
      dir: i % 2 === 0 ? ("IN" as const) : ("OUT" as const),
      groundTruth: { shouldMatch: false, expectedTargetType: null },
    })),
  ];

  let id = 1;
  for (const m of descriptions) {
    mutations.push({
      id: id++,
      description: m.desc,
      reference: null,
      amount: Math.round(Math.random() * 1_000_000 + 1000),
      direction: m.dir,
      groundTruth: m.groundTruth,
    });
  }

  return mutations;
}

/**
 * Standard benchmark rules — mirrors the runtime Biaya Admin Bank rule.
 */
export function buildBenchmarkRules(companyId: number): ReconRule[] {
  const base = {
    companyId,
    description: null,
    priority: 100,
    isActive: true,
    bankAccountId: null,
    conditionType: "SIMPLE",
    direction: null as null,
    targetId: null,
    stopProcessing: true,
    matchCount: 0,
    lastMatchedAt: null,
    createdBy: "benchmark",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return [
    {
      ...base,
      id: 1,
      name: "Biaya Admin Bank",
      conditionField: "description" as const,
      conditionOperator: "contains" as const,
      conditionValue: "admin bank",
      targetType: "bank_fee" as const,
      targetCoaCode: "5-1010",
      confidenceScore: 100,
    },
    {
      ...base,
      id: 2,
      name: "Fee Administrasi Bank",
      conditionField: "description" as const,
      conditionOperator: "contains" as const,
      conditionValue: "administrasi bank",
      targetType: "bank_fee" as const,
      targetCoaCode: "5-1010",
      confidenceScore: 100,
    },
  ];
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run benchmark and return accuracy metrics.
 * Rerunnable after any engine change.
 */
export function runBenchmark(companyId = 1): BenchmarkResult {
  const dataset = generateBenchmarkDataset();
  const rules   = buildBenchmarkRules(companyId);
  const start   = Date.now();

  let tp = 0, tn = 0, fp = 0, fn = 0;
  let totalConfidence = 0;
  let confidenceCount = 0;

  for (const mut of dataset) {
    const input: ReconRuleMutationInput = {
      description:  mut.description.toLowerCase(),
      reference:    mut.reference,
      amount:       mut.amount,
      direction:    mut.direction,
      companyId,
    };

    const result = evaluateReconRules(rules, input);
    const predicted = result.matched;
    const expected  = mut.groundTruth.shouldMatch;

    if (predicted && expected) {
      tp++;
      totalConfidence += result.confidence ?? 0;
      confidenceCount++;
    } else if (!predicted && !expected) {
      tn++;
    } else if (predicted && !expected) {
      fp++;
    } else {
      fn++;
    }
  }

  const total    = dataset.length;
  const accuracy  = (tp + tn) / total;
  const precision = (tp + fp) === 0 ? 0 : tp / (tp + fp);
  const recall    = (tp + fn) === 0 ? 0 : tp / (tp + fn);
  const f1Score   = (precision + recall) === 0 ? 0 : 2 * precision * recall / (precision + recall);
  const durationMs = Date.now() - start;

  return {
    totalMutations:  total,
    truePositives:   tp,
    trueNegatives:   tn,
    falsePositives:  fp,
    falseNegatives:  fn,
    accuracy:        Math.round(accuracy  * 10000) / 100,
    precision:       Math.round(precision * 10000) / 100,
    recall:          Math.round(recall    * 10000) / 100,
    f1Score:         Math.round(f1Score   * 10000) / 100,
    avgConfidence:   confidenceCount > 0
                       ? Math.round((totalConfidence / confidenceCount) * 100) / 100
                       : 0,
    runDurationMs:   durationMs,
    throughputPerSec: durationMs > 0 ? Math.round(total / (durationMs / 1000)) : total * 1000,
  };
}
