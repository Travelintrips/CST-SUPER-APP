/**
 * Multi Invoice Matching Engine — Batch 3 Phase 1
 *
 * Finds the best combination of invoices whose total matches a given
 * transfer amount, using scalable algorithms instead of brute-force:
 *
 *   ≤ 40 candidates → Meet-in-the-Middle  (O(n · 2^(n/2)))
 *   > 40 candidates → Branch and Bound    (O(pruned tree))
 *
 * Max input: 100 invoice candidates (as specified).
 *
 * Match types:
 *   EXACT       — combination sum == transfer amount (within tolerance)
 *   PARTIAL     — best partial combination where sum <= transfer (underpayment)
 *   OVERPAYMENT — smallest overpayment combination
 */

import type { ConfidenceReason } from "./reconDecisionStack.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MultiInvoiceCandidate {
  invoiceId: number;
  invoiceRef: string;
  amount: number;
  dueDate?: string | null;
  customerName?: string | null;
  companyId?: number | null;
}

export interface InvoiceAllocationItem {
  invoiceId: number;
  invoiceRef: string;
  amount: number;
  /** Weight of this invoice's contribution as a pct of transfer amount (0-100) */
  weight: number;
}

export interface MultiInvoiceMatchResult {
  matchType: "EXACT" | "PARTIAL" | "OVERPAYMENT" | "NO_MATCH";
  invoices: InvoiceAllocationItem[];
  totalAllocated: number;
  remaining: number;
  confidence: number;
  explanation: ConfidenceReason[];
  algorithmUsed: "BRANCH_AND_BOUND" | "MEET_IN_THE_MIDDLE" | "GREEDY";
  candidatesEvaluated: number;
}

export interface MultiInvoiceMatchOptions {
  /** Max candidate invoices — default 100 */
  maxCandidates?: number;
  /** Tolerance fraction for "close enough" match — default 0.001 (0.1%) */
  toleranceFraction?: number;
  /** If true, also return PARTIAL match when no EXACT is found */
  allowPartial?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CANDIDATES = 100;
const DEFAULT_TOLERANCE_FRACTION = 0.001; // 0.1% of transfer amount
const MEET_IN_MIDDLE_THRESHOLD = 40;       // switch algorithm above this count

// ─── Helper: cents-based integer arithmetic to avoid float rounding ───────────

function toCents(n: number): bigint {
  return BigInt(Math.round(n * 100));
}

function fromCents(n: bigint): number {
  return Number(n) / 100;
}

// ─── Meet-in-the-Middle ───────────────────────────────────────────────────────
// Splits the array in half, enumerates all 2^(n/2) subset sums for each half,
// then for each sum in the left half, binary-searches for the complement in
// the right half. Returns the index mask of the best matching subset.

function meetInTheMiddle(
  amounts: bigint[],
  target: bigint,
  toleranceCents: bigint,
): number[] | null {
  const n = amounts.length;
  const half1 = Math.floor(n / 2);
  const half2 = n - half1;

  // Build all subset sums for the right half
  const rightCount = 1 << half2;
  const rightSums: Array<{ sum: bigint; mask: number }> = [];
  for (let mask = 0; mask < rightCount; mask++) {
    let s = 0n;
    for (let i = 0; i < half2; i++) {
      if (mask & (1 << i)) s += amounts[half1 + i];
    }
    rightSums.push({ sum: s, mask });
  }
  rightSums.sort((a, b) => (a.sum < b.sum ? -1 : a.sum > b.sum ? 1 : 0));

  const leftCount = 1 << half1;
  let bestDiff = BigInt("9999999999999");
  let bestLeft = -1;
  let bestRight = -1;

  for (let lMask = 0; lMask < leftCount; lMask++) {
    let lSum = 0n;
    for (let i = 0; i < half1; i++) {
      if (lMask & (1 << i)) lSum += amounts[i];
    }
    const needed = target - lSum;
    if (needed < -toleranceCents) continue; // overshoot too much

    // Binary search for closest sum in rightSums
    let lo = 0;
    let hi = rightSums.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rightSums[mid].sum < needed) lo = mid + 1;
      else hi = mid - 1;
    }
    for (const idx of [lo - 1, lo]) {
      if (idx < 0 || idx >= rightSums.length) continue;
      const diff = needed - rightSums[idx].sum;
      const absDiff = diff < 0n ? -diff : diff;
      if (absDiff < bestDiff) {
        bestDiff = absDiff;
        bestLeft = lMask;
        bestRight = rightSums[idx].mask;
      }
    }
  }

  if (bestLeft < 0 || bestDiff > toleranceCents) return null;

  const indices: number[] = [];
  for (let i = 0; i < half1; i++) {
    if (bestLeft & (1 << i)) indices.push(i);
  }
  for (let i = 0; i < half2; i++) {
    if (bestRight & (1 << i)) indices.push(half1 + i);
  }
  return indices;
}

// ─── Branch and Bound ─────────────────────────────────────────────────────────
// Classic subset-sum B&B.  Invoices are pre-sorted descending by amount.
// Upper bound at any node = current sum + sum of all remaining items.
// A branch is pruned if:
//   - Upper bound < target - tolerance  (cannot reach target)
//   - current sum > target + tolerance  (already exceeded)

interface BnBState {
  bestDiff: bigint;
  bestIndices: number[];
  nodesVisited: number;
}

// Safety limit: prevents the synchronous BnB recursion from blocking the
// Node.js event loop for too long on adversarial or random inputs.
// When the limit is hit, BnB returns null and the caller falls back to GREEDY.
// 500 000 nodes takes < 50 ms in practice (no heap allocation per node).
const BNB_MAX_NODES = 500_000;

function branchAndBound(
  amounts: bigint[],        // sorted DESC
  target: bigint,
  toleranceCents: bigint,
): number[] | null {
  const n = amounts.length;
  const suffixSums = new Array<bigint>(n + 1).fill(0n);
  for (let i = n - 1; i >= 0; i--) {
    suffixSums[i] = suffixSums[i + 1] + amounts[i];
  }

  const state: BnBState = { bestDiff: BigInt("9999999999999"), bestIndices: [], nodesVisited: 0 };
  // Reuse a single mutable array and snapshot only when a new best is found
  // (backtracking: push before recurse, pop after — zero per-node heap allocation).
  const chosen: number[] = [];

  function bnb(idx: number, current: bigint): void {
    if (state.nodesVisited >= BNB_MAX_NODES) return;
    state.nodesVisited++;

    const diff = target - current;
    const absDiff = diff < 0n ? -diff : diff;
    if (absDiff < state.bestDiff) {
      state.bestDiff = absDiff;
      // Snapshot only here — O(depth) copy, not O(nodes) copies
      state.bestIndices = chosen.slice();
    }
    if (idx >= n) return;

    // Upper bound pruning
    const upperBound = current + suffixSums[idx];
    if (upperBound < target - toleranceCents) return; // can't reach target
    if (current > target + toleranceCents) return;    // already over

    // Include amounts[idx] — backtrack on return
    chosen.push(idx);
    bnb(idx + 1, current + amounts[idx]);
    chosen.pop();
    // Exclude amounts[idx]
    bnb(idx + 1, current);
  }

  bnb(0, 0n);

  if (state.nodesVisited >= BNB_MAX_NODES || state.bestDiff > toleranceCents) return null;
  return state.bestIndices;
}

// ─── Greedy fallback ──────────────────────────────────────────────────────────
// Sorted descending — greedily pick invoices until we hit or exceed target.

function greedyMatch(amounts: bigint[], target: bigint): number[] {
  const indices: number[] = [];
  let sum = 0n;
  for (let i = 0; i < amounts.length; i++) {
    if (sum + amounts[i] <= target) {
      indices.push(i);
      sum += amounts[i];
    }
    if (sum === target) break;
  }
  return indices;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function findBestMultiInvoiceMatch(
  mutationAmount: number,
  candidates: MultiInvoiceCandidate[],
  options?: MultiInvoiceMatchOptions,
): MultiInvoiceMatchResult {
  const maxCand = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const tolFrac = options?.toleranceFraction ?? DEFAULT_TOLERANCE_FRACTION;
  const allowPartial = options?.allowPartial ?? true;

  // Cap at maxCandidates — sort by amount DESC first so pruning is most effective
  const pool = candidates.slice(0, maxCand).sort((a, b) => b.amount - a.amount);

  if (!pool.length) {
    return emptyResult("NO_MATCH");
  }

  const targetCents  = toCents(mutationAmount);
  const toleranceCents = BigInt(Math.ceil(Number(targetCents) * tolFrac));
  const amounts = pool.map(c => toCents(c.amount));

  // Choose algorithm
  let indices: number[] | null = null;
  let algorithmUsed: MultiInvoiceMatchResult["algorithmUsed"] = "BRANCH_AND_BOUND";

  if (pool.length <= MEET_IN_MIDDLE_THRESHOLD) {
    algorithmUsed = "MEET_IN_THE_MIDDLE";
    indices = meetInTheMiddle(amounts, targetCents, toleranceCents);
  } else {
    algorithmUsed = "BRANCH_AND_BOUND";
    indices = branchAndBound(amounts, targetCents, toleranceCents);
  }

  // Fallback: greedy partial
  if (!indices) {
    if (!allowPartial) return emptyResult("NO_MATCH");
    algorithmUsed = "GREEDY";
    indices = greedyMatch(amounts, targetCents);
    if (!indices.length) return emptyResult("NO_MATCH");
  }

  const chosen = indices.map(i => pool[i]);
  const totalAllocatedCents = indices.reduce((s, i) => s + amounts[i], 0n);
  const totalAllocated = fromCents(totalAllocatedCents);
  const remainingCents = targetCents - totalAllocatedCents;
  const remaining = fromCents(remainingCents < 0n ? -remainingCents : remainingCents);

  // Classify match type
  const absDiffCents = remainingCents < 0n ? -remainingCents : remainingCents;
  let matchType: MultiInvoiceMatchResult["matchType"];
  if (absDiffCents <= toleranceCents) {
    matchType = "EXACT";
  } else if (remainingCents > 0n) {
    matchType = "PARTIAL";
  } else {
    matchType = "OVERPAYMENT";
  }

  // Confidence scoring
  let confidence = 0;
  const explanation: ConfidenceReason[] = [];

  // Base: number of invoices found
  if (matchType === "EXACT") {
    confidence += 60;
    explanation.push({ code: "EXACT_SUM", label: "Jumlah invoice tepat sama dengan transfer", score: 60 });
  } else if (matchType === "PARTIAL") {
    const ratio = totalAllocated / mutationAmount;
    const pts = Math.round(60 * ratio);
    confidence += pts;
    explanation.push({ code: "PARTIAL_SUM", label: `Alokasi parsial ${(ratio * 100).toFixed(1)}% dari transfer`, score: pts });
  } else {
    confidence += 40;
    explanation.push({ code: "OVERPAYMENT", label: "Jumlah invoice melebihi transfer (kelebihan bayar)", score: 40 });
  }

  // Bonus: single invoice vs multi (multi is harder to fake)
  if (chosen.length > 1) {
    confidence += 15;
    explanation.push({ code: "MULTI_INVOICE_COMBO", label: `Kombinasi ${chosen.length} invoice ditemukan`, score: 15 });
  } else {
    confidence += 10;
    explanation.push({ code: "SINGLE_INVOICE", label: "Invoice tunggal cocok", score: 10 });
  }

  // Bonus: all invoices are from same customer
  const uniqueCustomers = new Set(chosen.map(c => c.customerName ?? "").filter(Boolean));
  if (uniqueCustomers.size === 1 && chosen.length > 1) {
    confidence += 10;
    explanation.push({ code: "SAME_CUSTOMER", label: "Semua invoice dari customer yang sama", score: 10 });
  }

  // Penalty: overpayment / underpayment
  if (matchType === "PARTIAL") {
    confidence -= 5;
    explanation.push({ code: "UNDERPAYMENT_PENALTY", label: "Pengurangan: pembayaran kurang dari total invoice", score: -5 });
  }
  if (matchType === "OVERPAYMENT") {
    confidence -= 10;
    explanation.push({ code: "OVERPAYMENT_PENALTY", label: "Pengurangan: pembayaran melebihi total invoice", score: -10 });
  }

  confidence = Math.max(0, Math.min(100, confidence));

  // Build invoice items with weight
  const invoiceItems: InvoiceAllocationItem[] = chosen.map(c => ({
    invoiceId: c.invoiceId,
    invoiceRef: c.invoiceRef,
    amount: c.amount,
    weight: totalAllocated > 0 ? Math.round((c.amount / totalAllocated) * 1000) / 10 : 0,
  }));

  return {
    matchType,
    invoices: invoiceItems,
    totalAllocated,
    remaining: matchType === "PARTIAL" ? mutationAmount - totalAllocated : remaining,
    confidence,
    explanation,
    algorithmUsed,
    candidatesEvaluated: pool.length,
  };
}

function emptyResult(matchType: MultiInvoiceMatchResult["matchType"]): MultiInvoiceMatchResult {
  return {
    matchType,
    invoices: [],
    totalAllocated: 0,
    remaining: 0,
    confidence: 0,
    explanation: [],
    algorithmUsed: "GREEDY",
    candidatesEvaluated: 0,
  };
}
