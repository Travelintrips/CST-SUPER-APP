/**
 * AIReviewStatusCard — Phase 12
 * Full-width status summary card with badge, link, warning, and recommendation.
 * Composes AIReviewBadge + AIReviewWarning + AIReviewLink + AIRecommendationPanel.
 * Read-only — does not post journals or change workflow state.
 */
import { cn } from '@/lib/utils';
import { Brain } from 'lucide-react';
import { AIReviewBadge } from './AIReviewBadge';
import { AIReviewWarning } from './AIReviewWarning';
import { AIReviewLink } from './AIReviewLink';
import { AIRecommendationPanel } from './AIRecommendationPanel';
import type { AIReviewStatus, AIRiskLevel, AIReviewPriority } from '@/lib/ai-review-api';

export interface AIReviewStatusCardProps {
  reviewCaseId: string | number;
  status: AIReviewStatus;
  queue?: string;
  priority?: AIReviewPriority;
  confidence?: number | null;
  anomalyRisk?: AIRiskLevel | null;
  requiresManualReview?: boolean | null;
  source?: string | null;
  sourceRecordId?: string | null;
  detectedIntent?: string | null;
  recommendedCoaCode?: string | null;
  recommendedCoaName?: string | null;
  isOverdue?: boolean;
  showRecommendation?: boolean;
  className?: string;
}

export function AIReviewStatusCard({
  reviewCaseId,
  status,
  queue,
  priority,
  confidence,
  anomalyRisk,
  requiresManualReview,
  source,
  sourceRecordId,
  detectedIntent,
  recommendedCoaCode,
  recommendedCoaName,
  isOverdue,
  showRecommendation = false,
  className,
}: AIReviewStatusCardProps) {
  return (
    <div className={cn('rounded-lg border bg-card p-4 space-y-3', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-indigo-600 shrink-0" />
          <span className="text-sm font-semibold text-foreground">AI Review</span>
        </div>
        <AIReviewBadge status={status} priority={priority} showPriority />
      </div>

      <AIReviewWarning status={status} riskLevel={anomalyRisk} isOverdue={isOverdue} />

      {showRecommendation && (
        <AIRecommendationPanel
          reviewCaseId={reviewCaseId}
          status={status}
          queue={queue}
          priority={priority}
          confidence={confidence}
          anomalyRisk={anomalyRisk}
          requiresManualReview={requiresManualReview}
          source={source}
          sourceRecordId={sourceRecordId}
          detectedIntent={detectedIntent}
          recommendedCoaCode={recommendedCoaCode}
          recommendedCoaName={recommendedCoaName}
        />
      )}

      <div className="flex justify-end">
        <AIReviewLink reviewCaseId={reviewCaseId} />
      </div>
    </div>
  );
}
