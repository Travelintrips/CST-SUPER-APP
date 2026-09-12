/**
 * AI Transaction Intelligence — Phase 10
 * Repository Layer
 *
 * 6 repository classes for the AI review case lifecycle.
 * All queries enforce company isolation — no cross-company leakage.
 * Snapshots and audit events are append-only (no update/delete methods).
 * All DB errors are caught and re-thrown as typed AIReviewError.
 */

import { db } from '@workspace/db';
import {
  aiReviewCasesTable,
  aiReviewSnapshotsTable,
  aiReviewerDecisionsTable,
  aiReviewAuditEventsTable,
  aiLearningFeedbackTable,
  aiRuleRecommendationPackagesTable,
  type AiReviewCase,
  type InsertAiReviewCase,
  type AiReviewSnapshot,
  type InsertAiReviewSnapshot,
  type AiReviewerDecision,
  type InsertAiReviewerDecision,
  type AiReviewAuditEvent,
  type InsertAiReviewAuditEvent,
  type AiLearningFeedback,
  type InsertAiLearningFeedback,
  type AiRuleRecommendationPackage,
  type InsertAiRuleRecommendationPackage,
} from '@workspace/db';
import { eq, and, desc, asc, gte, lte, inArray, sql, count, type SQL } from 'drizzle-orm';
import { logger } from '../../logger.js';
import { databaseError } from './aiReviewErrors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface QueueFilters {
  status?: string | string[];
  queue?: string;
  priority?: string;
  reviewerId?: string;
  transactionId?: string;
  riskLevel?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

// ─── Repository 1: AIReviewCaseRepository ────────────────────────────────────

export interface IAIReviewCaseRepository {
  findById(id: number, companyId: number): Promise<AiReviewCase | null>;
  findByIdempotencyKey(companyId: number, key: string): Promise<AiReviewCase | null>;
  create(data: InsertAiReviewCase, tx?: DbTransaction): Promise<AiReviewCase>;
  updateStatus(id: number, companyId: number, status: string, updatedAt: Date, closedAt?: Date | null, tx?: DbTransaction): Promise<void>;
  assignReviewer(id: number, companyId: number, reviewerId: string, reviewerRole: string, assignedAt: Date, tx?: DbTransaction): Promise<void>;
  findQueue(companyId: number, filters: QueueFilters): Promise<{ items: AiReviewCase[]; total: number }>;
  findByTransaction(companyId: number, transactionId: string): Promise<AiReviewCase[]>;
  findBySource(companyId: number, source: string, sourceRecordId: string): Promise<AiReviewCase[]>;
  countByStatus(companyId: number): Promise<Record<string, number>>;
  findRecentAuditEvents(companyId: number, limit?: number): Promise<AiReviewAuditEvent[]>;
}

class AIReviewCaseRepositoryImpl implements IAIReviewCaseRepository {
  async findById(id: number, companyId: number): Promise<AiReviewCase | null> {
    try {
      const rows = await db
        .select()
        .from(aiReviewCasesTable)
        .where(and(eq(aiReviewCasesTable.id, id), eq(aiReviewCasesTable.companyId, companyId)))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      logger.error({ err, id, companyId }, '[aiReviewCaseRepo] findById failed');
      throw databaseError(err);
    }
  }

  async findByIdempotencyKey(companyId: number, key: string): Promise<AiReviewCase | null> {
    try {
      const rows = await db
        .select()
        .from(aiReviewCasesTable)
        .where(and(eq(aiReviewCasesTable.companyId, companyId), eq(aiReviewCasesTable.idempotencyKey, key)))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      logger.error({ err, companyId, key }, '[aiReviewCaseRepo] findByIdempotencyKey failed');
      throw databaseError(err);
    }
  }

  async create(data: InsertAiReviewCase, tx?: DbTransaction): Promise<AiReviewCase> {
    const executor = tx ?? db;
    try {
      const rows = await executor
        .insert(aiReviewCasesTable)
        .values(data)
        .returning();
      if (!rows[0]) throw new Error('Insert returned no rows');
      return rows[0];
    } catch (err) {
      logger.error({ err }, '[aiReviewCaseRepo] create failed');
      throw databaseError(err);
    }
  }

  async updateStatus(
    id: number,
    companyId: number,
    status: string,
    updatedAt: Date,
    closedAt?: Date | null,
    tx?: DbTransaction,
  ): Promise<void> {
    const executor = tx ?? db;
    try {
      const updateData: Partial<InsertAiReviewCase> = {
        status: status as InsertAiReviewCase['status'],
        updatedAt,
      };
      if (closedAt !== undefined) {
        updateData.closedAt = closedAt ?? undefined;
      }
      await executor
        .update(aiReviewCasesTable)
        .set(updateData)
        .where(and(eq(aiReviewCasesTable.id, id), eq(aiReviewCasesTable.companyId, companyId)));
    } catch (err) {
      logger.error({ err, id, companyId, status }, '[aiReviewCaseRepo] updateStatus failed');
      throw databaseError(err);
    }
  }

  async assignReviewer(
    id: number,
    companyId: number,
    reviewerId: string,
    reviewerRole: string,
    assignedAt: Date,
    tx?: DbTransaction,
  ): Promise<void> {
    const executor = tx ?? db;
    try {
      await executor
        .update(aiReviewCasesTable)
        .set({
          assignedReviewerId: reviewerId,
          assignedReviewerRole: reviewerRole,
          assignedAt,
          status: 'ASSIGNED',
          updatedAt: assignedAt,
        })
        .where(and(eq(aiReviewCasesTable.id, id), eq(aiReviewCasesTable.companyId, companyId)));
    } catch (err) {
      logger.error({ err, id, companyId, reviewerId }, '[aiReviewCaseRepo] assignReviewer failed');
      throw databaseError(err);
    }
  }

  async findQueue(companyId: number, filters: QueueFilters): Promise<{ items: AiReviewCase[]; total: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const offset = (page - 1) * limit;

    try {
      const conditions: SQL<unknown>[] = [eq(aiReviewCasesTable.companyId, companyId)];

      if (filters.status) {
        if (Array.isArray(filters.status)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          conditions.push(inArray(aiReviewCasesTable.status as any, filters.status as string[]));
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          conditions.push(eq(aiReviewCasesTable.status as any, filters.status as string));
        }
      }
      if (filters.queue) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conditions.push(eq(aiReviewCasesTable.queue as any, filters.queue as string));
      }
      if (filters.priority) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conditions.push(eq(aiReviewCasesTable.priority as any, filters.priority as InsertAiReviewCase['priority']));
      }
      if (filters.reviewerId) {
        conditions.push(eq(aiReviewCasesTable.assignedReviewerId, filters.reviewerId));
      }
      if (filters.transactionId) {
        conditions.push(eq(aiReviewCasesTable.transactionId, filters.transactionId));
      }
      if (filters.riskLevel) {
        conditions.push(eq(aiReviewCasesTable.anomalyRisk, filters.riskLevel));
      }
      if (filters.dateFrom) {
        conditions.push(gte(aiReviewCasesTable.createdAt, filters.dateFrom));
      }
      if (filters.dateTo) {
        conditions.push(lte(aiReviewCasesTable.createdAt, filters.dateTo));
      }

      const whereClause = and(...conditions);

      const [itemsResult, countResult] = await Promise.all([
        db.select().from(aiReviewCasesTable).where(whereClause).orderBy(desc(aiReviewCasesTable.createdAt)).limit(limit).offset(offset),
        db.select({ total: count() }).from(aiReviewCasesTable).where(whereClause),
      ]);

      return {
        items: itemsResult,
        total: Number(countResult[0]?.total ?? 0),
      };
    } catch (err) {
      logger.error({ err, companyId, filters }, '[aiReviewCaseRepo] findQueue failed');
      throw databaseError(err);
    }
  }

  async findByTransaction(companyId: number, transactionId: string): Promise<AiReviewCase[]> {
    try {
      return db
        .select()
        .from(aiReviewCasesTable)
        .where(and(eq(aiReviewCasesTable.companyId, companyId), eq(aiReviewCasesTable.transactionId, transactionId)))
        .orderBy(desc(aiReviewCasesTable.createdAt));
    } catch (err) {
      logger.error({ err, companyId, transactionId }, '[aiReviewCaseRepo] findByTransaction failed');
      throw databaseError(err);
    }
  }

  async findBySource(companyId: number, source: string, sourceRecordId: string): Promise<AiReviewCase[]> {
    try {
      return db
        .select()
        .from(aiReviewCasesTable)
        .where(
          and(
            eq(aiReviewCasesTable.companyId, companyId),
            eq(aiReviewCasesTable.source, source),
            eq(aiReviewCasesTable.sourceRecordId, sourceRecordId),
          ),
        )
        .orderBy(desc(aiReviewCasesTable.createdAt));
    } catch (err) {
      logger.error({ err, companyId, source, sourceRecordId }, '[aiReviewCaseRepo] findBySource failed');
      throw databaseError(err);
    }
  }

  async countByStatus(companyId: number): Promise<Record<string, number>> {
    try {
      const rows = await db
        .select({ status: aiReviewCasesTable.status, total: count() })
        .from(aiReviewCasesTable)
        .where(eq(aiReviewCasesTable.companyId, companyId))
        .groupBy(aiReviewCasesTable.status);
      const result: Record<string, number> = {};
      for (const row of rows) {
        result[row.status] = Number(row.total);
      }
      return result;
    } catch (err) {
      logger.error({ err, companyId }, '[aiReviewCaseRepo] countByStatus failed');
      throw databaseError(err);
    }
  }

  async findRecentAuditEvents(companyId: number, limit = 50): Promise<AiReviewAuditEvent[]> {
    try {
      const rows = await db
        .select()
        .from(aiReviewAuditEventsTable)
        .where(eq(aiReviewAuditEventsTable.companyId, companyId))
        .orderBy(desc(aiReviewAuditEventsTable.createdAt))
        .limit(limit);
      return rows;
    } catch (err) {
      logger.error({ err, companyId }, '[aiReviewCaseRepo] findRecentAuditEvents failed');
      throw databaseError(err);
    }
  }
}

export const aiReviewCaseRepo: IAIReviewCaseRepository = new AIReviewCaseRepositoryImpl();

// ─── Repository 2: AIReviewSnapshotRepository ────────────────────────────────

export interface IAIReviewSnapshotRepository {
  create(data: InsertAiReviewSnapshot, tx?: DbTransaction): Promise<AiReviewSnapshot>;
  findLatestByReviewCase(reviewCaseId: number, companyId: number): Promise<AiReviewSnapshot | null>;
  findByVersion(reviewCaseId: number, companyId: number, version: number): Promise<AiReviewSnapshot | null>;
  listVersions(reviewCaseId: number, companyId: number): Promise<AiReviewSnapshot[]>;
  getNextVersion(reviewCaseId: number): Promise<number>;
}

class AIReviewSnapshotRepositoryImpl implements IAIReviewSnapshotRepository {
  async create(data: InsertAiReviewSnapshot, tx?: DbTransaction): Promise<AiReviewSnapshot> {
    const executor = tx ?? db;
    try {
      const rows = await executor.insert(aiReviewSnapshotsTable).values(data).returning();
      if (!rows[0]) throw new Error('Insert returned no rows');
      return rows[0];
    } catch (err) {
      logger.error({ err }, '[aiReviewSnapshotRepo] create failed');
      throw databaseError(err);
    }
  }

  async findLatestByReviewCase(reviewCaseId: number, companyId: number): Promise<AiReviewSnapshot | null> {
    try {
      const rows = await db
        .select()
        .from(aiReviewSnapshotsTable)
        .where(and(eq(aiReviewSnapshotsTable.reviewCaseId, reviewCaseId), eq(aiReviewSnapshotsTable.companyId, companyId)))
        .orderBy(desc(aiReviewSnapshotsTable.snapshotVersion))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      logger.error({ err, reviewCaseId }, '[aiReviewSnapshotRepo] findLatestByReviewCase failed');
      throw databaseError(err);
    }
  }

  async findByVersion(reviewCaseId: number, companyId: number, version: number): Promise<AiReviewSnapshot | null> {
    try {
      const rows = await db
        .select()
        .from(aiReviewSnapshotsTable)
        .where(
          and(
            eq(aiReviewSnapshotsTable.reviewCaseId, reviewCaseId),
            eq(aiReviewSnapshotsTable.companyId, companyId),
            eq(aiReviewSnapshotsTable.snapshotVersion, version),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      logger.error({ err, reviewCaseId, version }, '[aiReviewSnapshotRepo] findByVersion failed');
      throw databaseError(err);
    }
  }

  async listVersions(reviewCaseId: number, companyId: number): Promise<AiReviewSnapshot[]> {
    try {
      return db
        .select()
        .from(aiReviewSnapshotsTable)
        .where(and(eq(aiReviewSnapshotsTable.reviewCaseId, reviewCaseId), eq(aiReviewSnapshotsTable.companyId, companyId)))
        .orderBy(asc(aiReviewSnapshotsTable.snapshotVersion));
    } catch (err) {
      logger.error({ err, reviewCaseId }, '[aiReviewSnapshotRepo] listVersions failed');
      throw databaseError(err);
    }
  }

  async getNextVersion(reviewCaseId: number): Promise<number> {
    try {
      const rows = await db
        .select({ maxVersion: sql<number>`COALESCE(MAX(${aiReviewSnapshotsTable.snapshotVersion}), 0)` })
        .from(aiReviewSnapshotsTable)
        .where(eq(aiReviewSnapshotsTable.reviewCaseId, reviewCaseId));
      return Number(rows[0]?.maxVersion ?? 0) + 1;
    } catch (err) {
      logger.error({ err, reviewCaseId }, '[aiReviewSnapshotRepo] getNextVersion failed');
      throw databaseError(err);
    }
  }
}

export const aiReviewSnapshotRepo: IAIReviewSnapshotRepository = new AIReviewSnapshotRepositoryImpl();

// ─── Repository 3: AIReviewerDecisionRepository ──────────────────────────────

export interface IAIReviewerDecisionRepository {
  create(data: InsertAiReviewerDecision, tx?: DbTransaction): Promise<AiReviewerDecision>;
  findByIdempotencyKey(companyId: number, key: string): Promise<AiReviewerDecision | null>;
  listByReviewCase(reviewCaseId: number, companyId: number): Promise<AiReviewerDecision[]>;
}

class AIReviewerDecisionRepositoryImpl implements IAIReviewerDecisionRepository {
  async create(data: InsertAiReviewerDecision, tx?: DbTransaction): Promise<AiReviewerDecision> {
    const executor = tx ?? db;
    try {
      const rows = await executor.insert(aiReviewerDecisionsTable).values(data).returning();
      if (!rows[0]) throw new Error('Insert returned no rows');
      return rows[0];
    } catch (err) {
      logger.error({ err }, '[aiReviewerDecisionRepo] create failed');
      throw databaseError(err);
    }
  }

  async findByIdempotencyKey(companyId: number, key: string): Promise<AiReviewerDecision | null> {
    try {
      const rows = await db
        .select()
        .from(aiReviewerDecisionsTable)
        .where(and(eq(aiReviewerDecisionsTable.companyId, companyId), eq(aiReviewerDecisionsTable.idempotencyKey, key)))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      logger.error({ err, companyId, key }, '[aiReviewerDecisionRepo] findByIdempotencyKey failed');
      throw databaseError(err);
    }
  }

  async listByReviewCase(reviewCaseId: number, companyId: number): Promise<AiReviewerDecision[]> {
    try {
      return db
        .select()
        .from(aiReviewerDecisionsTable)
        .where(and(eq(aiReviewerDecisionsTable.reviewCaseId, reviewCaseId), eq(aiReviewerDecisionsTable.companyId, companyId)))
        .orderBy(desc(aiReviewerDecisionsTable.createdAt));
    } catch (err) {
      logger.error({ err, reviewCaseId }, '[aiReviewerDecisionRepo] listByReviewCase failed');
      throw databaseError(err);
    }
  }
}

export const aiReviewerDecisionRepo: IAIReviewerDecisionRepository = new AIReviewerDecisionRepositoryImpl();

// ─── Repository 4: AIReviewAuditRepository ───────────────────────────────────

export interface IAIReviewAuditRepository {
  append(data: InsertAiReviewAuditEvent, tx?: DbTransaction): Promise<AiReviewAuditEvent>;
  listByReviewCase(reviewCaseId: number, companyId: number): Promise<AiReviewAuditEvent[]>;
}

class AIReviewAuditRepositoryImpl implements IAIReviewAuditRepository {
  async append(data: InsertAiReviewAuditEvent, tx?: DbTransaction): Promise<AiReviewAuditEvent> {
    const executor = tx ?? db;
    try {
      const rows = await executor.insert(aiReviewAuditEventsTable).values(data).returning();
      if (!rows[0]) throw new Error('Insert returned no rows');
      return rows[0];
    } catch (err) {
      logger.error({ err }, '[aiReviewAuditRepo] append failed');
      throw databaseError(err);
    }
  }

  async listByReviewCase(reviewCaseId: number, companyId: number): Promise<AiReviewAuditEvent[]> {
    try {
      return db
        .select()
        .from(aiReviewAuditEventsTable)
        .where(and(eq(aiReviewAuditEventsTable.reviewCaseId, reviewCaseId), eq(aiReviewAuditEventsTable.companyId, companyId)))
        .orderBy(asc(aiReviewAuditEventsTable.occurredAt));
    } catch (err) {
      logger.error({ err, reviewCaseId }, '[aiReviewAuditRepo] listByReviewCase failed');
      throw databaseError(err);
    }
  }
}

export const aiReviewAuditRepo: IAIReviewAuditRepository = new AIReviewAuditRepositoryImpl();

// ─── Repository 5: AILearningFeedbackRepository ──────────────────────────────

export interface IAILearningFeedbackRepository {
  create(data: InsertAiLearningFeedback, tx?: DbTransaction): Promise<AiLearningFeedback>;
  findPending(companyId: number, limit?: number): Promise<AiLearningFeedback[]>;
  markProcessed(id: number, companyId: number): Promise<void>;
}

class AILearningFeedbackRepositoryImpl implements IAILearningFeedbackRepository {
  async create(data: InsertAiLearningFeedback, tx?: DbTransaction): Promise<AiLearningFeedback> {
    const executor = tx ?? db;
    try {
      const rows = await executor.insert(aiLearningFeedbackTable).values(data).returning();
      if (!rows[0]) throw new Error('Insert returned no rows');
      return rows[0];
    } catch (err) {
      logger.error({ err }, '[aiLearningFeedbackRepo] create failed');
      throw databaseError(err);
    }
  }

  async findPending(companyId: number, limit = 100): Promise<AiLearningFeedback[]> {
    try {
      return db
        .select()
        .from(aiLearningFeedbackTable)
        .where(and(eq(aiLearningFeedbackTable.companyId, companyId), eq(aiLearningFeedbackTable.status, 'PENDING')))
        .orderBy(asc(aiLearningFeedbackTable.createdAt))
        .limit(Math.min(500, limit));
    } catch (err) {
      logger.error({ err, companyId }, '[aiLearningFeedbackRepo] findPending failed');
      throw databaseError(err);
    }
  }

  async markProcessed(id: number, companyId: number): Promise<void> {
    try {
      await db
        .update(aiLearningFeedbackTable)
        .set({ status: 'PROCESSED', processedAt: new Date() })
        .where(and(eq(aiLearningFeedbackTable.id, id), eq(aiLearningFeedbackTable.companyId, companyId)));
    } catch (err) {
      logger.error({ err, id }, '[aiLearningFeedbackRepo] markProcessed failed');
      throw databaseError(err);
    }
  }
}

export const aiLearningFeedbackRepo: IAILearningFeedbackRepository = new AILearningFeedbackRepositoryImpl();

// ─── Repository 6: AIRuleRecommendationRepository ────────────────────────────

export interface IAIRuleRecommendationRepository {
  createPackage(data: InsertAiRuleRecommendationPackage, tx?: DbTransaction): Promise<AiRuleRecommendationPackage>;
  findById(id: number, companyId: number): Promise<AiRuleRecommendationPackage | null>;
  listPending(companyId: number): Promise<AiRuleRecommendationPackage[]>;
  updateReviewStatus(id: number, companyId: number, status: string, reviewedBy: string, reviewedAt: Date): Promise<void>;
}

class AIRuleRecommendationRepositoryImpl implements IAIRuleRecommendationRepository {
  async createPackage(data: InsertAiRuleRecommendationPackage, tx?: DbTransaction): Promise<AiRuleRecommendationPackage> {
    const executor = tx ?? db;
    try {
      const rows = await executor.insert(aiRuleRecommendationPackagesTable).values(data).returning();
      if (!rows[0]) throw new Error('Insert returned no rows');
      return rows[0];
    } catch (err) {
      logger.error({ err }, '[aiRuleRecommendationRepo] createPackage failed');
      throw databaseError(err);
    }
  }

  async findById(id: number, companyId: number): Promise<AiRuleRecommendationPackage | null> {
    try {
      const rows = await db
        .select()
        .from(aiRuleRecommendationPackagesTable)
        .where(and(eq(aiRuleRecommendationPackagesTable.id, id), eq(aiRuleRecommendationPackagesTable.companyId, companyId)))
        .limit(1);
      return rows[0] ?? null;
    } catch (err) {
      logger.error({ err, id }, '[aiRuleRecommendationRepo] findById failed');
      throw databaseError(err);
    }
  }

  async listPending(companyId: number): Promise<AiRuleRecommendationPackage[]> {
    try {
      return db
        .select()
        .from(aiRuleRecommendationPackagesTable)
        .where(and(eq(aiRuleRecommendationPackagesTable.companyId, companyId), eq(aiRuleRecommendationPackagesTable.status, 'PENDING_REVIEW')))
        .orderBy(desc(aiRuleRecommendationPackagesTable.createdAt));
    } catch (err) {
      logger.error({ err, companyId }, '[aiRuleRecommendationRepo] listPending failed');
      throw databaseError(err);
    }
  }

  async updateReviewStatus(id: number, companyId: number, status: string, reviewedBy: string, reviewedAt: Date): Promise<void> {
    try {
      await db
        .update(aiRuleRecommendationPackagesTable)
        .set({
          status: status as InsertAiRuleRecommendationPackage['status'],
          reviewedBy,
          reviewedAt,
        })
        .where(and(eq(aiRuleRecommendationPackagesTable.id, id), eq(aiRuleRecommendationPackagesTable.companyId, companyId)));
    } catch (err) {
      logger.error({ err, id, status }, '[aiRuleRecommendationRepo] updateReviewStatus failed');
      throw databaseError(err);
    }
  }
}

export const aiRuleRecommendationRepo: IAIRuleRecommendationRepository = new AIRuleRecommendationRepositoryImpl();
