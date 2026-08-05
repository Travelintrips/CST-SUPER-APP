/**
 * AIReviewSourcePanel — Phase 12
 * Drop-in panel for any source module page.
 * Fetches AI review status for a specific source entity and displays:
 *   - AIReviewCompactSummary (when case exists)
 *   - Warning (when OPEN/HIGH_RISK/OVERDUE)
 *   - "Lihat AI Review" link (when case exists)
 *   - "Buat AI Review" button (explicit user action only — NOT auto-created on render)
 *
 * Constraints:
 *   - Never auto-creates a case on mount.
 *   - Never posts journals, reconciles, or changes financial state.
 *   - Company context comes from backend session, not props.
 *   - sourceRecordId and source must be stable strings (not reactive/random).
 */
import { useState } from 'react';
import { Brain, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AIReviewCompactSummary } from './AIReviewCompactSummary';
import { AIReviewStatusCard } from './AIReviewStatusCard';
import { AIReviewWarning } from './AIReviewWarning';
import { useAIReviewBySource, useCreateAIReviewFromSource } from '@/hooks/useAiReview';
import { cn } from '@/lib/utils';

export interface AIReviewSourcePanelProps {
  source: string;
  sourceRecordId: string;
  /** Transaction snapshot for creating a new case via explicit user action */
  transactionSnapshot?: {
    id: string;
    description: string;
    amount?: number;
    currency?: string;
    direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
    transactionDate?: string;
    counterpartyName?: string;
    referenceNumber?: string;
    transactionCode?: string;
    bankName?: string;
  };
  /** 'compact' = single line summary, 'card' = full status card */
  variant?: 'compact' | 'card';
  className?: string;
}

export function AIReviewSourcePanel({
  source,
  sourceRecordId,
  transactionSnapshot,
  variant = 'compact',
  className,
}: AIReviewSourcePanelProps) {
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, error } = useAIReviewBySource(source, sourceRecordId);
  const createMutation = useCreateAIReviewFromSource();

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Memuat AI Review…</span>
      </div>
    );
  }

  // Error or backend unavailable — silent degradation
  if (error || !data) return null;

  const reviewCase = data.reviewCase;

  // Case exists
  if (reviewCase) {
    const status = reviewCase.status as import('@/lib/ai-review-api').AIReviewStatus;
    const slaInfo = reviewCase.sla;

    if (variant === 'card') {
      return (
        <AIReviewStatusCard
          reviewCaseId={reviewCase.id}
          status={status}
          queue={reviewCase.queue}
          priority={reviewCase.priority}
          confidence={reviewCase.coaConfidence ?? reviewCase.intentConfidence}
          anomalyRisk={reviewCase.riskLevel}
          requiresManualReview={reviewCase.manualReviewFlag}
          source={source}
          sourceRecordId={sourceRecordId}
          detectedIntent={reviewCase.detectedIntent}
          recommendedCoaCode={reviewCase.recommendedCoaCode}
          recommendedCoaName={reviewCase.recommendedCoaName}
          isOverdue={slaInfo?.isOverdue}
          showRecommendation
          className={className}
        />
      );
    }

    return (
      <div className={cn('space-y-1', className)}>
        <AIReviewWarning
          status={status}
          riskLevel={reviewCase.riskLevel}
          isOverdue={slaInfo?.isOverdue}
        />
        <AIReviewCompactSummary
          reviewCaseId={reviewCase.id}
          status={status}
          priority={reviewCase.priority}
          confidence={reviewCase.coaConfidence ?? reviewCase.intentConfidence}
          anomalyRisk={reviewCase.riskLevel}
          requiresManualReview={reviewCase.manualReviewFlag}
          source={source}
          sourceRecordId={sourceRecordId}
        />
      </div>
    );
  }

  // No case exists — show create button only when transactionSnapshot is provided
  // and user explicitly clicks — NEVER auto-create
  if (!transactionSnapshot) {
    return (
      <div className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
        <Brain className="h-3 w-3" />
        <span>Tidak ada AI Review</span>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Brain className="h-3 w-3" />
        <span>Belum ada AI Review</span>
      </div>
      {!showCreate && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px] gap-1"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-3 w-3" />
          Buat AI Review
        </Button>
      )}
      {showCreate && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px] gap-1"
          disabled={createMutation.isPending}
          onClick={() => {
            createMutation.mutate({
              source,
              sourceRecordId,
              transaction: transactionSnapshot,
            });
            setShowCreate(false);
          }}
        >
          {createMutation.isPending ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Membuat…</>
          ) : (
            <><Plus className="h-3 w-3" /> Konfirmasi Buat</>
          )}
        </Button>
      )}
    </div>
  );
}
