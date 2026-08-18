/**
 * Bank Allocation & Auto-Matching — Sprint 4 Phase 2 scoring engine.
 *
 * Deterministic weighted scoring (default 100 total):
 *   Amount 40, Reference 25, Invoice 15, Customer 10, Date 5, Company 5
 *
 * This engine ONLY produces recommendations (bank_allocation_matches rows).
 * It NEVER creates a journal entry and NEVER auto-posts. Auto-suggest
 * (score >= threshold) still lands in the "Suggested" tab — finance must
 * confirm before an allocation_header/lines row is even created.
 *
 * P2 fix: fetchAllocationCandidates now filters by company_id in SQL and
 * uses parameterized queries (no sql.raw with user-controlled data).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import { normalizeCompanyId } from "../services/portalCompanyScopeUtils.js";

export type AllocationCandidateType = "invoice" | "advance";

export interface AllocationCandidate {
  id: number;
  type: AllocationCandidateType;
  amount: number;
  date: string;
  ref: string | null;       // invoice/advance number
  name: string | null;      // customer/party name
  company_id: number | null;
}

export interface AllocationMutationInput {
  id: number;
  amount: number;
  transaction_date: string;
  mutation_key: string;
  provider_order_id?: string | null;
  normalized_description?: string | null;
  company_id?: number | null;
}

export interface ScoreWeights {
  weight_amount: number;
  weight_reference: number;
  weight_invoice: number;
  weight_customer: number;
  weight_date: number;
  weight_company: number;
  auto_suggest_threshold: number;
  manual_review_floor: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  weight_amount: 40,
  weight_reference: 25,
  weight_invoice: 15,
  weight_customer: 10,
  weight_date: 5,
  weight_company: 5,
  auto_suggest_threshold: 95,
  manual_review_floor: 50,
};

export interface AllocationScoreBreakdown {
  amount: { matched: boolean; points: number; max: number };
  reference: { matched: boolean; points: number; max: number };
  invoice: { matched: boolean; points: number; max: number };
  customer: { matched: boolean; points: number; max: number };
  date: { matched: boolean; points: number; max: number };
  company: { matched: boolean; points: number; max: number };
}

export interface AllocationScoredMatch {
  candidate: AllocationCandidate;
  score: number;
  breakdown: AllocationScoreBreakdown;
  reason: string[];
}

// ─── Fuzzy name token overlap (same technique as unifiedMatchingEngine) ────────

function nameOverlap(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
  const aTokens = new Set(norm(a).split(/\s+/).filter((t) => t.length > 2));
  const bTokens = norm(b).split(/\s+/).filter((t) => t.length > 2);
  if (!aTokens.size || !bTokens.length) return false;
  const overlap = bTokens.filter((t) => aTokens.has(t)).length;
  const ratio = overlap / Math.max(aTokens.size, bTokens.length);
  return ratio >= 0.4;
}

// ─── Rule weights lookup ────────────────────────────────────────────────────────

export async function getActiveWeights(companyId: number | null): Promise<ScoreWeights> {
  try {
    const rows = await db.execute<any>(sql`
      SELECT weight_amount, weight_reference, weight_invoice, weight_customer,
             weight_date, weight_company, auto_suggest_threshold, manual_review_floor
      FROM bank_allocation_rules
      WHERE is_active = TRUE
        AND (company_id = ${companyId} OR company_id IS NULL)
      ORDER BY company_id DESC NULLS LAST
      LIMIT 1
    `).then((r) => r.rows);
    if (!rows.length) return DEFAULT_WEIGHTS;
    const r = rows[0];
    return {
      weight_amount: Number(r.weight_amount),
      weight_reference: Number(r.weight_reference),
      weight_invoice: Number(r.weight_invoice),
      weight_customer: Number(r.weight_customer),
      weight_date: Number(r.weight_date),
      weight_company: Number(r.weight_company),
      auto_suggest_threshold: Number(r.auto_suggest_threshold),
      manual_review_floor: Number(r.manual_review_floor),
    };
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

// ─── Scoring ────────────────────────────────────────────────────────────────────

export function scoreAllocationCandidate(
  mutation: AllocationMutationInput,
  cand: AllocationCandidate,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): AllocationScoredMatch {
  const reason: string[] = [];

  // 1. Amount — exact match required for points
  const amountMatched = Math.abs(Number(cand.amount) - Number(mutation.amount)) < 0.01;
  const amountPts = amountMatched ? weights.weight_amount : 0;
  if (amountMatched) reason.push(`nominal cocok (+${weights.weight_amount})`);

  // 2. Reference — exact match on provider_order_id vs candidate ref
  //    (covers both "Reference Number" and "Advance Number" per MATCH RULE priority)
  let referenceMatched = false;
  if (cand.ref && mutation.provider_order_id) {
    referenceMatched = cand.ref.toUpperCase().trim() === mutation.provider_order_id.toUpperCase().trim();
  }
  const referencePts = referenceMatched ? weights.weight_reference : 0;
  if (referenceMatched) reason.push(`referensi "${cand.ref}" cocok (+${weights.weight_reference})`);

  // 3. Invoice — only scored for invoice-type candidates, exact doc number match
  let invoiceMatched = false;
  if (cand.type === "invoice" && cand.ref && mutation.provider_order_id) {
    invoiceMatched = cand.ref.toUpperCase().trim() === mutation.provider_order_id.toUpperCase().trim();
  }
  const invoicePts = invoiceMatched ? weights.weight_invoice : 0;
  if (invoiceMatched) reason.push(`nomor invoice cocok (+${weights.weight_invoice})`);

  // 4. Customer — fuzzy token overlap between candidate name and mutation description
  let customerMatched = false;
  if (cand.name && mutation.normalized_description) {
    customerMatched = nameOverlap(cand.name, mutation.normalized_description);
  }
  const customerPts = customerMatched ? weights.weight_customer : 0;
  if (customerMatched) reason.push(`nama customer/vendor cocok (+${weights.weight_customer})`);

  // 5. Date — same day or ±1 day
  const mDate = new Date(mutation.transaction_date).getTime();
  const cDate = new Date(cand.date).getTime();
  const diffDays = Number.isFinite(mDate) && Number.isFinite(cDate)
    ? Math.abs(mDate - cDate) / 86_400_000
    : Infinity;
  const dateMatched = diffDays <= 1;
  const datePts = dateMatched ? weights.weight_date : 0;
  if (dateMatched) reason.push(`tanggal cocok (+${weights.weight_date})`);

  // 6. Company — company_id must match exactly
  const mutationCompanyId = normalizeCompanyId(mutation.company_id);
  const candidateCompanyId = normalizeCompanyId(cand.company_id);
  const companyMatched =
    mutationCompanyId != null &&
    candidateCompanyId != null &&
    mutationCompanyId === candidateCompanyId;
  const companyPts = companyMatched ? weights.weight_company : 0;
  if (companyMatched) reason.push(`entitas/company cocok (+${weights.weight_company})`);

  const score = companyMatched
    ? amountPts + referencePts + invoicePts + customerPts + datePts + companyPts
    : 0;

  return {
    candidate: cand,
    score: Math.round(score * 100) / 100,
    reason,
    breakdown: {
      amount:   { matched: amountMatched,   points: amountPts,   max: weights.weight_amount },
      reference:{ matched: referenceMatched,points: referencePts,max: weights.weight_reference },
      invoice:  { matched: invoiceMatched,  points: invoicePts,  max: weights.weight_invoice },
      customer: { matched: customerMatched, points: customerPts, max: weights.weight_customer },
      date:     { matched: dateMatched,     points: datePts,     max: weights.weight_date },
      company:  { matched: companyMatched,  points: companyPts,  max: weights.weight_company },
    },
  };
}

export function classifyAllocationMatch(
  score: number,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): "auto_suggest" | "manual_review" | "unmatched" {
  if (score >= weights.auto_suggest_threshold) return "auto_suggest";
  if (score >= weights.manual_review_floor) return "manual_review";
  return "unmatched";
}

// ─── Candidate fetch ────────────────────────────────────────────────────────────
// Sources: outstanding cash_advances (customer/vendor advances) and unpaid
// sales_documents invoices. Amount window +/- none required here (we fetch a
// wider date window and let scoring rank), but we still bound the query by a
// generous date range for performance.
//
// P2 fix: company_id is now filtered at the SQL level (not just by scoring
// floor). This closes the cross-company candidate leak: a mutation from company A
// can no longer be matched against an invoice/advance belonging to company B even
// if their reference numbers coincide.
//
// Security: these queries use drizzle parameterized sql`` tagged templates only.
// No sql.raw() is used anywhere in this function.

export async function fetchAllocationCandidates(
  mutation: Pick<AllocationMutationInput, "amount" | "transaction_date" | "company_id">,
): Promise<AllocationCandidate[]> {
  const candidates: AllocationCandidate[] = [];
  const { transaction_date } = mutation;
  const company_id = normalizeCompanyId(mutation.company_id);
  if (company_id == null) {
    logger.warn("[bankAllocationScoring] matching skipped: bank mutation has no valid company_id");
    return candidates;
  }

  // ── Invoice candidates ──────────────────────────────────────────────────────
  try {
    const invoiceRows = await db.execute<any>(sql`
      SELECT sd.id,
             sd.total_amount  AS amount,
             sd.issue_date::text AS date,
             sd.doc_number    AS ref,
             COALESCE(c.name, '') AS name,
             sd.company_id
      FROM   sales_documents sd
      LEFT JOIN customers c ON c.id = sd.customer_id
      WHERE  sd.doc_type = 'invoice'
        AND  COALESCE(sd.status, '') NOT IN ('paid', 'cancelled', 'void')
        AND  sd.issue_date BETWEEN ${transaction_date}::date - 30
                               AND ${transaction_date}::date + 30
         AND sd.company_id = ${company_id}
    `).then((r) => r.rows);

    for (const r of invoiceRows) {
      candidates.push({
        id: Number(r.id),
        type: "invoice",
        amount: Number(r.amount),
        date: String(r.date ?? ""),
        ref: r.ref ?? null,
        name: r.name ?? null,
        company_id: r.company_id != null ? Number(r.company_id) : null,
      });
    }
  } catch (e: any) {
    logger.warn({ err: e.message, type: "invoice" }, "[bankAllocationScoring] fetchAllocationCandidates: invoice source skipped");
  }

  // ── Advance candidates ──────────────────────────────────────────────────────
  try {
    const advanceRows = await db.execute<any>(sql`
      SELECT ca.id,
             ca.amount,
             ca.created_at::date::text AS date,
             ca.advance_number AS ref,
             COALESCE(ca.party_name, '') AS name,
             ca.company_id
      FROM   cash_advances ca
      WHERE  COALESCE(ca.lifecycle_status, '') IN ('outstanding', 'partially_settled', 'disbursed', 'approved')
        AND  ca.created_at::date BETWEEN ${transaction_date}::date - 30
                                     AND ${transaction_date}::date + 30
         AND ca.company_id = ${company_id}
    `).then((r) => r.rows);

    for (const r of advanceRows) {
      candidates.push({
        id: Number(r.id),
        type: "advance",
        amount: Number(r.amount),
        date: String(r.date ?? ""),
        ref: r.ref ?? null,
        name: r.name ?? null,
        company_id: r.company_id != null ? Number(r.company_id) : null,
      });
    }
  } catch (e: any) {
    logger.warn({ err: e.message, type: "advance" }, "[bankAllocationScoring] fetchAllocationCandidates: advance source skipped");
  }

  return candidates;
}
