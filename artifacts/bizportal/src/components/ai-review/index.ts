/**
 * Barrel exports for AI Review shared components.
 *
 * Import from here, not from individual files, to keep import paths stable:
 *   import { ConfidenceBar, SlaChip } from "@/components/ai-review";
 */

export { ConfidenceBar } from "./ConfidenceBar";
export { FieldRow } from "./FieldRow";
export { SlaChip, SlaIndicator } from "./SlaChip";
export { CoaSelector } from "./CoaSelector";
export {
  AiReviewPermissionGuard,
  AdminOnlyGuard,
  AI_REVIEW_ROLES,
  AI_REVIEW_ADMIN_ROLES,
} from "./AiReviewPermissionGuard";
export type { AiReviewRole } from "./AiReviewPermissionGuard";

// ── Phase 12: Cross-link shared components + source panel ─────────────────────
export { AIReviewSourcePanel } from "./AIReviewSourcePanel";
export type { AIReviewSourcePanelProps } from "./AIReviewSourcePanel";
export { AIReviewBadge } from "./AIReviewBadge";
export type { AIReviewBadgeProps } from "./AIReviewBadge";
export { AIReviewWarning } from "./AIReviewWarning";
export type { AIReviewWarningProps } from "./AIReviewWarning";
export { AIReviewLink } from "./AIReviewLink";
export type { AIReviewLinkProps } from "./AIReviewLink";
export { AIRecommendationPanel } from "./AIRecommendationPanel";
export type { AIRecommendationPanelProps } from "./AIRecommendationPanel";
export { AIReviewStatusCard } from "./AIReviewStatusCard";
export type { AIReviewStatusCardProps } from "./AIReviewStatusCard";
export { AIReviewCompactSummary } from "./AIReviewCompactSummary";
export type { AIReviewCompactSummaryProps } from "./AIReviewCompactSummary";
