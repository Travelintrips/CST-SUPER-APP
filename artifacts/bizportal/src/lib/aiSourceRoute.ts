/**
 * AI Review Source Route Resolver — Phase 12
 *
 * Centralised mapping from (source, sourceRecordId) → frontend route.
 * Never crashes on unknown source — returns null, callers hide the button.
 */

export type AIReviewSource =
  | 'BANK_MUTATION'
  | 'BANK_RECONCILIATION'
  | 'TREASURY'
  | 'ACCOUNTING_ENTRY'
  | 'EXPENSE'
  | 'CASH_ADVANCE'
  | 'VENDOR_PAYMENT'
  | 'CUSTOMER_PAYMENT'
  | 'INVOICE'
  | 'SALES_DOCUMENT'
  | 'PURCHASE'
  | 'LOGISTIC_ORDER'
  | 'SPORT_PAYMENT'
  | 'PPJK'
  | 'EXPECTED_CASH_FLOW';

/**
 * Resolve the source module's frontend route from a source type + record ID.
 * Returns null for unknown sources — callers should hide navigation, not crash.
 */
export function resolveAISourceRoute(source: string, sourceRecordId: string): string | null {
  switch (source) {
    case 'BANK_MUTATION':
      return '/accounting/bank-reconciliation';
    case 'BANK_RECONCILIATION':
      return '/accounting/bank-reconciliation';
    case 'TREASURY':
      return '/accounting/bank-disbursements';
    case 'ACCOUNTING_ENTRY':
      return `/accounting/entries`;
    case 'EXPENSE':
      return '/expense';
    case 'CASH_ADVANCE':
      return '/expense';
    case 'VENDOR_PAYMENT':
      return '/accounting/bank-disbursements';
    case 'CUSTOMER_PAYMENT':
      return '/accounting/bank-receipts';
    case 'INVOICE':
      return '/accounting/entries';
    case 'SALES_DOCUMENT':
      return `/sales/documents/${encodeURIComponent(sourceRecordId)}`;
    case 'PURCHASE':
      return `/purchase/documents/${encodeURIComponent(sourceRecordId)}`;
    case 'LOGISTIC_ORDER':
      return `/logistics/portal-orders/${encodeURIComponent(sourceRecordId)}`;
    case 'SPORT_PAYMENT':
      return '/sport-center/bookings';
    case 'PPJK':
      return '/logistics/ppjk';
    case 'EXPECTED_CASH_FLOW':
      return '/accounting/cash-flow-forecast';
    default:
      return null;
  }
}

/** Route to a specific AI review case detail page. */
export function getAIReviewDetailRoute(reviewCaseId: string | number): string {
  return `/ai/review/${reviewCaseId}`;
}

/** Human-readable label for a source type. */
export function getAISourceLabel(source: string): string {
  const labels: Record<string, string> = {
    BANK_MUTATION: 'Mutasi Bank',
    BANK_RECONCILIATION: 'Rekonsiliasi Bank',
    TREASURY: 'Kas & Bank',
    ACCOUNTING_ENTRY: 'Jurnal',
    EXPENSE: 'Beban',
    CASH_ADVANCE: 'Dana Talangan',
    VENDOR_PAYMENT: 'Bayar Vendor',
    CUSTOMER_PAYMENT: 'Bayar Customer',
    INVOICE: 'Invoice',
    SALES_DOCUMENT: 'Dokumen Jual',
    PURCHASE: 'Pembelian',
    LOGISTIC_ORDER: 'Order Logistik',
    SPORT_PAYMENT: 'Bayar Sport',
    PPJK: 'PPJK',
    EXPECTED_CASH_FLOW: 'Arus Kas',
  };
  return labels[source] ?? source;
}
