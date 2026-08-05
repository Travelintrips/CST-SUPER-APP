/**
 * AIReviewBadge — Phase 12
 * Compact status badge for inline display on list rows and detail panels.
 * Read-only — does not trigger any action.
 */
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS, type AIReviewStatus, type AIReviewPriority } from '@/lib/ai-review-api';

export interface AIReviewBadgeProps {
  status: AIReviewStatus;
  priority?: AIReviewPriority;
  showPriority?: boolean;
  size?: 'sm' | 'default';
  className?: string;
}

export function AIReviewBadge({ status, priority, showPriority = false, size = 'default', className }: AIReviewBadgeProps) {
  const statusClass = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-500 border-gray-200';
  const statusLabel = STATUS_LABELS[status] ?? status;

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Badge
        variant="outline"
        className={cn('border font-medium', statusClass, size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5')}
      >
        AI · {statusLabel}
      </Badge>
      {showPriority && priority && (
        <Badge
          variant="outline"
          className={cn('border font-medium', PRIORITY_COLORS[priority], size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5')}
        >
          {PRIORITY_LABELS[priority]}
        </Badge>
      )}
    </span>
  );
}
