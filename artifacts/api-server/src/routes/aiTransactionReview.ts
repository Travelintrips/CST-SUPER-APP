/**
 * AI Transaction Intelligence — Phase 10
 * REST API Routes
 *
 * All endpoints enforce:
 *  - Authentication (internal session)
 *  - Company isolation (resolveCompanyId)
 *  - Typed error responses (toSafeErrorResponse)
 *  - Input validation (Zod)
 *  - No journal posting / auto-approve / reconcile
 *
 * Prefix: /api/ai-transaction
 */

import { Router } from 'express';
import { z } from 'zod/v4';
import { resolveCompanyId } from '../lib/resolveCompany.js';
import { requireAdmin, requireRole } from '../lib/requireAdmin.js';
import {
  analyzeAndCreateReviewCase,
  recordAIReviewerDecision,
  reevaluateAIReviewCase,
  getReviewCaseDetail,
  getObservabilityData,
} from '../lib/ai/transaction-intelligence/aiTransactionPersistenceService.js';
import type { InsertAiReviewAuditEvent } from '@workspace/db';
import {
  aiReviewCaseRepo,
  aiReviewSnapshotRepo,
  aiReviewAuditRepo,
  aiLearningFeedbackRepo,
  aiRuleRecommendationRepo,
} from '../lib/ai/transaction-intelligence/aiReviewRepository.js';
import { AIReviewError, toSafeErrorResponse, sourceUnsupported } from '../lib/ai/transaction-intelligence/aiReviewErrors.js';
import { logger } from '../lib/logger.js';
import type { Request, Response } from 'express';

export const aiTransactionReviewRouter = Router();

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const FINANCE_ROLES = ['admin', 'finance', 'accounting', 'treasury', 'tax', 'payroll'];

async function requireFinanceRole(req: Request, res: Response): Promise<boolean> {
  return requireRole(req, res, FINANCE_ROLES);
}

// ─── Error handler ────────────────────────────────────────────────────────────

function handleError(res: Response, err: unknown): void {
  const { statusCode, body } = toSafeErrorResponse(err);
  logger.error({ err }, '[aiTransactionReview] route error');
  res.status(statusCode).json(body);
}

// ─── Pagination helper ────────────────────────────────────────────────────────

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query['page'] ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query['limit'] ?? '50'), 10) || 50));
  return { page, limit };
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const CreateReviewCaseSchema = z.object({
  transaction: z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    amount: z.number().optional(),
    currency: z.string().optional(),
    direction: z.enum(['DEBIT', 'CREDIT', 'UNKNOWN']).optional(),
    transactionDate: z.string().optional(),
    counterpartyName: z.string().optional(),
    counterpartyAccount: z.string().optional(),
    referenceNumber: z.string().optional(),
    transactionCode: z.string().optional(),
    bankName: z.string().optional(),
  }),
  context: z.object({
    source: z.string().optional(),
    sourceRecordId: z.string().optional(),
  }).optional(),
});

const DecisionSchema = z.object({
  decision: z.enum([
    'APPROVE_RECOMMENDATION',
    'CHANGE_COA',
    'REJECT_RECOMMENDATION',
    'REQUEST_INFORMATION',
    'ESCALATE',
  ]),
  selectedCoaId: z.number().int().positive().optional(),
  selectedCoaCode: z.string().optional(),
  selectedCoaName: z.string().optional(),
  reasonCode: z.string().optional(),
  comments: z.string().max(2000).optional(),
  reviewerConfidence: z.number().min(0).max(1).optional(),
  idempotencyKey: z.string().min(1),
});

const AssignSchema = z.object({
  reviewerId: z.string().min(1),
  reviewerRole: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

const ReevaluateSchema = z.object({
  reason: z.string().min(1).max(1000),
  idempotencyKey: z.string().min(1),
});

const RulePackageReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  idempotencyKey: z.string().min(1),
});

// ─── POST /api/ai-transaction/review-cases ───────────────────────────────────
// Create analysis + review case

aiTransactionReviewRouter.post('/review-cases', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);
  const parsed = CreateReviewCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.issues } });
    return;
  }

  try {
    const user = req.user as { id: string } | undefined;
    const result = await analyzeAndCreateReviewCase({
      companyId,
      transaction: {
        ...parsed.data.transaction,
        transactionDate: parsed.data.transaction.transactionDate
          ? new Date(parsed.data.transaction.transactionDate)
          : undefined,
      },
      context: parsed.data.context,
      requestedBy: user?.id ?? 'system',
    });

    const statusCode = result.existing ? 200 : 201;
    res.status(statusCode).json({ ok: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /api/ai-transaction/review-cases ────────────────────────────────────

aiTransactionReviewRouter.get('/review-cases', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);
  const { page, limit } = parsePagination(req.query as Record<string, unknown>);

  try {
    const filters = {
      status: req.query['status'] as string | undefined,
      queue: req.query['queue'] as string | undefined,
      priority: req.query['priority'] as string | undefined,
      reviewerId: req.query['reviewerId'] as string | undefined,
      transactionId: req.query['transactionId'] as string | undefined,
      riskLevel: req.query['riskLevel'] as string | undefined,
      dateFrom: req.query['dateFrom'] ? new Date(String(req.query['dateFrom'])) : undefined,
      dateTo: req.query['dateTo'] ? new Date(String(req.query['dateTo'])) : undefined,
      page,
      limit,
    };

    const result = await aiReviewCaseRepo.findQueue(companyId, filters);
    res.json({ ok: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /api/ai-transaction/review-cases/:id ────────────────────────────────

aiTransactionReviewRouter.get('/review-cases/:id', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);
  const id = parseInt(String(req.params['id'] ?? ''), 10);
  if (isNaN(id)) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid id' } });
    return;
  }

  try {
    const detail = await getReviewCaseDetail(id, companyId);
    res.json({ ok: true, data: detail });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /api/ai-transaction/review-cases/:id/snapshots ──────────────────────

aiTransactionReviewRouter.get('/review-cases/:id/snapshots', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);
  const id = parseInt(String(req.params['id'] ?? ''), 10);
  if (isNaN(id)) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid id' } });
    return;
  }

  try {
    const snapshots = await aiReviewSnapshotRepo.listVersions(id, companyId);
    res.json({ ok: true, data: snapshots });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /api/ai-transaction/review-cases/:id/audit ──────────────────────────

aiTransactionReviewRouter.get('/review-cases/:id/audit', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);
  const id = parseInt(String(req.params['id'] ?? ''), 10);
  if (isNaN(id)) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid id' } });
    return;
  }

  try {
    const events = await aiReviewAuditRepo.listByReviewCase(id, companyId);
    res.json({ ok: true, data: events });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /api/ai-transaction/review-cases/:id/assign ────────────────────────

aiTransactionReviewRouter.post('/review-cases/:id/assign', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);
  const id = parseInt(String(req.params['id'] ?? ''), 10);
  if (isNaN(id)) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid id' } });
    return;
  }

  const parsed = AssignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.issues } });
    return;
  }

  try {
    const reviewCase = await aiReviewCaseRepo.findById(id, companyId);
    if (!reviewCase) {
      res.status(404).json({ ok: false, error: { code: 'AI_REVIEW_CASE_NOT_FOUND', message: 'Review case not found' } });
      return;
    }

    const now = new Date();
    await aiReviewCaseRepo.assignReviewer(id, companyId, parsed.data.reviewerId, parsed.data.reviewerRole, now);
    await aiReviewAuditRepo.append({
      reviewCaseId: id,
      companyId,
      eventType: 'ASSIGNED',
      actorType: 'SYSTEM',
      actorId: (req.user as { id: string } | undefined)?.id ?? null,
      previousStatus: reviewCase.status as 'QUEUED',
      newStatus: 'ASSIGNED',
      reason: 'Reviewer assigned',
      metadataJson: { reviewerId: parsed.data.reviewerId, reviewerRole: parsed.data.reviewerRole } as Record<string, unknown>,
      occurredAt: now,
      createdAt: now,
    });

    res.json({ ok: true, data: { assigned: true } });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /api/ai-transaction/review-cases/:id/start-review ──────────────────

aiTransactionReviewRouter.post('/review-cases/:id/start-review', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);
  const id = parseInt(String(req.params['id'] ?? ''), 10);
  if (isNaN(id)) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid id' } });
    return;
  }

  try {
    const reviewCase = await aiReviewCaseRepo.findById(id, companyId);
    if (!reviewCase) {
      res.status(404).json({ ok: false, error: { code: 'AI_REVIEW_CASE_NOT_FOUND', message: 'Review case not found' } });
      return;
    }

    const now = new Date();
    await aiReviewCaseRepo.updateStatus(id, companyId, 'IN_REVIEW', now, null);
    await aiReviewAuditRepo.append({
      reviewCaseId: id,
      companyId,
      eventType: 'REVIEW_STARTED',
      actorType: 'REVIEWER',
      actorId: (req.user as { id: string } | undefined)?.id ?? null,
      previousStatus: reviewCase.status as 'ASSIGNED',
      newStatus: 'IN_REVIEW',
      reason: null,
      metadataJson: null,
      occurredAt: now,
      createdAt: now,
    });

    res.json({ ok: true, data: { status: 'IN_REVIEW' } });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /api/ai-transaction/review-cases/:id/decision ──────────────────────

aiTransactionReviewRouter.post('/review-cases/:id/decision', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);
  const id = parseInt(String(req.params['id'] ?? ''), 10);
  if (isNaN(id)) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid id' } });
    return;
  }

  const parsed = DecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.issues } });
    return;
  }

  try {
    const user = req.user as { id: string; role?: string } | undefined;
    const result = await recordAIReviewerDecision({
      reviewCaseId: id,
      companyId,
      reviewerId: user?.id ?? 'unknown',
      reviewerRole: user?.role ?? 'unknown',
      ...parsed.data,
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /api/ai-transaction/review-cases/:id/reevaluate ────────────────────

aiTransactionReviewRouter.post('/review-cases/:id/reevaluate', async (req: Request, res: Response) => {
  // Re-evaluation requires admin or finance manager
  if (!(await requireAdmin(req, res))) return;

  const companyId = resolveCompanyId(req);
  const id = parseInt(String(req.params['id'] ?? ''), 10);
  if (isNaN(id)) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid id' } });
    return;
  }

  const parsed = ReevaluateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.issues } });
    return;
  }

  try {
    const user = req.user as { id: string } | undefined;
    const result = await reevaluateAIReviewCase({
      reviewCaseId: id,
      companyId,
      requestedBy: user?.id ?? 'admin',
      reason: parsed.data.reason,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /api/ai-transaction/observability ───────────────────────────────────

aiTransactionReviewRouter.get('/observability', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);

  try {
    const data = await getObservabilityData(companyId);
    res.json({ ok: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /api/ai-transaction/learning-feedback ───────────────────────────────

aiTransactionReviewRouter.get('/learning-feedback', async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const companyId = resolveCompanyId(req);
  const limit = Math.min(500, parseInt(String(req.query['limit'] ?? '100'), 10) || 100);

  try {
    const items = await aiLearningFeedbackRepo.findPending(companyId, limit);
    res.json({ ok: true, data: items });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── GET /api/ai-transaction/rule-packages ────────────────────────────────────

aiTransactionReviewRouter.get('/rule-packages', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);

  try {
    const items = await aiRuleRecommendationRepo.listPending(companyId);
    res.json({ ok: true, data: items });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /api/ai-transaction/rule-packages/:id/review ───────────────────────
// APPROVE or REJECT a rule package. Does NOT apply the rules.

aiTransactionReviewRouter.post('/rule-packages/:id/review', async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const companyId = resolveCompanyId(req);
  const id = parseInt(String(req.params['id'] ?? ''), 10);
  if (isNaN(id)) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid id' } });
    return;
  }

  const parsed = RulePackageReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.issues } });
    return;
  }

  try {
    const pkg = await aiRuleRecommendationRepo.findById(id, companyId);
    if (!pkg) {
      res.status(404).json({ ok: false, error: { code: 'AI_REVIEW_CASE_NOT_FOUND', message: 'Rule package not found' } });
      return;
    }

    const user = req.user as { id: string } | undefined;
    const now = new Date();
    await aiRuleRecommendationRepo.updateReviewStatus(id, companyId, parsed.data.status, user?.id ?? 'admin', now);

    res.json({ ok: true, data: { id, status: parsed.data.status, reviewedAt: now.toISOString() } });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Phase 12: Source cross-link endpoints ────────────────────────────────────

/**
 * Supported source types for cross-linking.
 * Mirrors the source values stored in ai_review_cases.source column.
 */
const SUPPORTED_SOURCES = new Set([
  'BANK_MUTATION',
  'BANK_RECONCILIATION',
  'TREASURY',
  'ACCOUNTING_ENTRY',
  'EXPENSE',
  'CASH_ADVANCE',
  'VENDOR_PAYMENT',
  'CUSTOMER_PAYMENT',
  'INVOICE',
  'SALES_DOCUMENT',
  'PURCHASE',
  'LOGISTIC_ORDER',
  'SPORT_PAYMENT',
  'PPJK',
  'EXPECTED_CASH_FLOW',
  // also accept lowercase/legacy values that analyzeAndCreateReviewCase uses internally
  'bank_mutation',
  'bank_reconciliation',
  'treasury',
  'accounting_entry',
  'expense',
  'cash_advance',
  'vendor_payment',
  'customer_payment',
  'invoice',
  'sales_document',
  'purchase',
  'logistic_order',
  'sport_payment',
  'ppjk',
  'expected_cash_flow',
]);

// ─── GET /api/ai-transaction/review-cases/by-source ──────────────────────────
// Query: ?source=BANK_RECONCILIATION&sourceRecordId=123
// Returns: { ok, data: { exists, reviewCase: ... | null } }

aiTransactionReviewRouter.get('/review-cases/by-source', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);
  const source = String(req.query['source'] ?? '').trim();
  const sourceRecordId = String(req.query['sourceRecordId'] ?? '').trim();

  if (!source || !sourceRecordId) {
    res.status(400).json({
      ok: false,
      error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'source and sourceRecordId query params are required' },
    });
    return;
  }

  if (!SUPPORTED_SOURCES.has(source)) {
    const { statusCode, body } = toSafeErrorResponse(sourceUnsupported(source));
    res.status(statusCode).json(body);
    return;
  }

  try {
    const cases = await aiReviewCaseRepo.findBySource(companyId, source, sourceRecordId);
    const reviewCase = cases[0] ?? null;
    res.json({ ok: true, data: { exists: !!reviewCase, reviewCase } });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── POST /api/ai-transaction/review-cases/from-source ───────────────────────
// Idempotent: if a case for this (source, sourceRecordId) already exists, returns it.
// Body: { source, sourceRecordId, transaction: TransactionInput, idempotencyKey? }

const FromSourceSchema = z.object({
  source: z.string().min(1),
  sourceRecordId: z.string().min(1),
  transaction: z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    amount: z.number().optional(),
    currency: z.string().optional(),
    direction: z.enum(['DEBIT', 'CREDIT', 'UNKNOWN']).optional(),
    transactionDate: z.string().optional(),
    counterpartyName: z.string().optional(),
    counterpartyAccount: z.string().optional(),
    referenceNumber: z.string().optional(),
    transactionCode: z.string().optional(),
    bankName: z.string().optional(),
  }),
});

aiTransactionReviewRouter.post('/review-cases/from-source', async (req: Request, res: Response) => {
  if (!(await requireFinanceRole(req, res))) return;

  const companyId = resolveCompanyId(req);

  const parsed = FromSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: { code: 'AI_REVIEW_VALIDATION_ERROR', message: 'Invalid body', details: parsed.data },
    });
    return;
  }

  const { source, sourceRecordId, transaction } = parsed.data;

  if (!SUPPORTED_SOURCES.has(source)) {
    const { statusCode, body } = toSafeErrorResponse(sourceUnsupported(source));
    res.status(statusCode).json(body);
    return;
  }

  try {
    // Idempotency: return existing case if already created for this source entity
    const existing = await aiReviewCaseRepo.findBySource(companyId, source, sourceRecordId);
    if (existing.length > 0) {
      logger.info({ companyId, source, sourceRecordId, caseId: existing[0]!.id }, '[Phase12] from-source idempotent hit');
      return res.json({
        ok: true,
        data: { created: false, reviewCase: existing[0] },
      });
    }

    // Delegate to Phase 10 service — never bypass pipeline
    const user = req.user as { id: string } | undefined;
    const result = await analyzeAndCreateReviewCase({
      companyId,
      transaction,
      context: { source, sourceRecordId },
      requestedBy: user?.id ?? 'system',
    });

    logger.info({ companyId, source, sourceRecordId, caseId: result.reviewCase.id }, '[Phase12] from-source created');

    // Phase 12 audit: SOURCE_LINKED — append-only, additive event
    try {
      const now = new Date();
      await aiReviewAuditRepo.append({
        reviewCaseId: result.reviewCase.id,
        companyId,
        eventType: 'SOURCE_LINKED' as InsertAiReviewAuditEvent['eventType'],
        actorType: 'USER',
        actorId: user?.id ?? 'system',
        previousStatus: null,
        newStatus: result.reviewCase.status ?? 'QUEUED',
        reason: `Cross-linked from ${source} record ${sourceRecordId}`,
        metadataJson: { source, sourceRecordId } as Record<string, unknown>,
        occurredAt: now,
        createdAt: now,
      });
    } catch (auditErr) {
      // Audit failure is non-fatal — case was already created
      logger.warn({ auditErr, companyId }, '[Phase12] SOURCE_LINKED audit append failed (non-fatal)');
    }

    // Return minimal payload (full detail available via GET /review-cases/:id)
    res.status(201).json({
      ok: true,
      data: {
        created: true,
        reviewCaseId: result.reviewCase.id,
        idempotencyKey: result.reviewCase.idempotencyKey,
        status: result.reviewCase.status,
        queue: result.reviewCase.queue,
        priority: result.reviewCase.priority,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});
