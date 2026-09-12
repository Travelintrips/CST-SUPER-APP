/**
 * AIReviewLink — Phase 12
 * A navigation link from a source entity page → AI review detail page.
 * Hidden when reviewCaseId is absent or unknown.
 */
import { Link } from 'wouter';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAIReviewDetailRoute } from '@/lib/aiSourceRoute';
import { cn } from '@/lib/utils';

export interface AIReviewLinkProps {
  reviewCaseId: string | number | undefined | null;
  label?: string;
  variant?: 'button' | 'text';
  className?: string;
}

export function AIReviewLink({ reviewCaseId, label = 'Lihat AI Review', variant = 'button', className }: AIReviewLinkProps) {
  if (!reviewCaseId) return null;

  const href = getAIReviewDetailRoute(String(reviewCaseId));

  if (variant === 'text') {
    return (
      <Link href={href}>
        <span className={cn('inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 underline cursor-pointer', className)}>
          <ExternalLink className="h-3 w-3" />
          {label}
        </span>
      </Link>
    );
  }

  return (
    <Link href={href}>
      <Button variant="outline" size="sm" className={cn('gap-1 text-xs', className)}>
        <ExternalLink className="h-3 w-3" />
        {label}
      </Button>
    </Link>
  );
}
