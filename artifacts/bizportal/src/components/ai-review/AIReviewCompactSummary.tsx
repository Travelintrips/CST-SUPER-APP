/**
 * AIReviewCompactSummary — Phase 12
 * Minimal single-row inline summary: badge + confidence + risk + link.
 * Designed for embedding in table rows, sidebars, and card footers.
 * Read-only — no journal posting, no state change.
 */
import { cn } from '@/lib/utils';
import { Brain } from 'lucide-react';
import { AIReviewBadge } from './AIReviewBadge';
import { AIReviewLink } from './AIReviewLink';
import { confidencePct } from '@/lib/ai-review-api';
import type { AIReviewStatus, AIRiskLevel, AIReviewPriority } from '@/lib/ai-review-api';

export interface AIReviewCompactSummaryProps {
  reviewCaseId: string | number;
  status: AIReviewStatus;
  priority?: AIReviewPriority;
  confidence?: number | null;
  anomalyRisk?: AIRiskLevel | null;
  requiresManualReview?: boolean | null;
  source?: string | null;
  sourceRecordId?: string | null;
  className?: string;
}

const RISK_BADGE: Record<string, string> = {
  CRITICAL: 'text-red-700 bg-red-50',
  HIGH: 'text-orange-700 bg-orange-50',
  MEDIUM: 'text-yellow-700 bg-yellow-50',
  LOW: 'text-green-700 bg-green-50',
};

export function AIReviewCompactSummary({
  reviewCaseId,
  status,
  priority,
  confidence,
  anomalyRisk,
  requiresManualReview,
  className,
}: AIReviewCompactSummaryProps) {
  const confNum = typeof confidence === 'number' ? confidence : null;
  const riskClass = anomalyRisk ? RISK_BADGE[anomalyRisk] : undefined;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Brain className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
      <AIReviewBadge status={status} priority={priority} size="sm" />
      {confNum !== null && (
        <span className="text-[10px] text-muted-foreground">{confidencePct(confNum)}%</span>
      )}
      {anomalyRisk && anomalyRisk !== 'NONE' && riskClass && (
        <span className={cn('rounded px-1 py-0.5 text-[10px] font-medium', riskClass)}>
          {anomalyRisk}
        </span>
      )}
      {requiresManualReview && (
        <span className="text-[10px] text-orange-600">⚠ Manual</span>
      )}
      <AIReviewLink reviewCaseId={reviewCaseId} variant="text" label="AI Review" />
    </div>
  );
}
