/**
 * AIRecommendationPanel — Phase 12
 * Displays AI recommendation details: intent, COA candidate, confidence, anomaly risk.
 * Read-only — does not post journals or change state.
 */
import { cn } from '@/lib/utils';
import { confidencePct, confidenceLabel } from '@/lib/ai-review-api';
import type { AIReviewStatus, AIRiskLevel, AIReviewPriority } from '@/lib/ai-review-api';
import { ConfidenceBar } from './ConfidenceBar';

export interface AIRecommendationPanelProps {
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
  className?: string;
}

const RISK_COLOR: Record<string, string> = {
  CRITICAL: 'text-red-700',
  HIGH: 'text-orange-600',
  MEDIUM: 'text-yellow-700',
  LOW: 'text-green-700',
  NONE: 'text-gray-500',
};

export function AIRecommendationPanel({
  status,
  queue,
  priority,
  confidence,
  anomalyRisk,
  requiresManualReview,
  detectedIntent,
  recommendedCoaCode,
  recommendedCoaName,
  className,
}: AIRecommendationPanelProps) {
  const confNum = typeof confidence === 'number' ? confidence : null;

  return (
    <div className={cn('rounded-md border border-indigo-100 bg-indigo-50/50 p-3 text-sm space-y-1.5', className)}>
      <p className="font-semibold text-indigo-800 text-xs uppercase tracking-wide mb-1">Rekomendasi AI</p>

      {detectedIntent && (
        <div className="flex justify-between">
          <span className="text-muted-foreground text-xs">Intent terdeteksi</span>
          <span className="text-xs font-medium">{detectedIntent.replace(/_/g, ' ')}</span>
        </div>
      )}

      {(recommendedCoaCode || recommendedCoaName) && (
        <div className="flex justify-between">
          <span className="text-muted-foreground text-xs">COA rekomendasi</span>
          <span className="text-xs font-medium">{recommendedCoaCode ? `${recommendedCoaCode} · ` : ''}{recommendedCoaName}</span>
        </div>
      )}

      {confNum !== null && (
        <div className="space-y-0.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Confidence</span>
            <span className="font-medium">{confidencePct(confNum)}% — {confidenceLabel(confNum)}</span>
          </div>
          <ConfidenceBar value={confNum} />
        </div>
      )}

      {anomalyRisk && anomalyRisk !== 'NONE' && (
        <div className="flex justify-between">
          <span className="text-muted-foreground text-xs">Risiko anomali</span>
          <span className={cn('text-xs font-semibold', RISK_COLOR[anomalyRisk] ?? 'text-gray-700')}>{anomalyRisk}</span>
        </div>
      )}

      {requiresManualReview && (
        <p className="text-[11px] text-orange-700 mt-1">⚠ Memerlukan tinjauan manual</p>
      )}

      {status && (
        <div className="flex justify-between border-t border-indigo-100 pt-1.5 mt-1.5">
          <span className="text-muted-foreground text-xs">Status review</span>
          <span className="text-xs font-medium">{status}</span>
        </div>
      )}

      {queue && (
        <div className="flex justify-between">
          <span className="text-muted-foreground text-xs">Antrean</span>
          <span className="text-xs">{queue.replace(/_/g, ' ')}</span>
        </div>
      )}

      {priority && (
        <div className="flex justify-between">
          <span className="text-muted-foreground text-xs">Prioritas</span>
          <span className="text-xs">{priority}</span>
        </div>
      )}
    </div>
  );
}
