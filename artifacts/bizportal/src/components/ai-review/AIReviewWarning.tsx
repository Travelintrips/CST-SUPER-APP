/**
 * AIReviewWarning — Phase 12
 * Displays a non-blocking warning banner when a review case is OPEN, HIGH_RISK, or OVERDUE.
 * Does not block workflow — purely informational.
 */
import { AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AIReviewStatus, AIRiskLevel } from '@/lib/ai-review-api';

export interface AIReviewWarningProps {
  status: AIReviewStatus;
  riskLevel?: AIRiskLevel | null;
  isOverdue?: boolean;
  className?: string;
}

const OPEN_STATUSES: AIReviewStatus[] = ['QUEUED', 'ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED', 'ESCALATED'];

export function AIReviewWarning({ status, riskLevel, isOverdue, className }: AIReviewWarningProps) {
  const isOpen = OPEN_STATUSES.includes(status);
  const isHighRisk = riskLevel === 'HIGH' || riskLevel === 'CRITICAL';

  if (!isOpen && !isHighRisk && !isOverdue) return null;

  let message = 'Transaksi ini memiliki AI review yang belum selesai.';
  let Icon = AlertTriangle;
  let colorClass = 'bg-yellow-50 border-yellow-300 text-yellow-800';

  if (isOverdue) {
    message = 'AI review transaksi ini melewati batas waktu SLA.';
    Icon = Clock;
    colorClass = 'bg-red-50 border-red-300 text-red-800';
  } else if (riskLevel === 'CRITICAL') {
    message = 'Transaksi ini terdeteksi memiliki risiko KRITIS oleh AI. Perlu perhatian segera.';
    colorClass = 'bg-red-50 border-red-300 text-red-800';
  } else if (riskLevel === 'HIGH') {
    message = 'Transaksi ini terdeteksi memiliki risiko TINGGI oleh AI.';
    colorClass = 'bg-orange-50 border-orange-300 text-orange-800';
  }

  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', colorClass, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
