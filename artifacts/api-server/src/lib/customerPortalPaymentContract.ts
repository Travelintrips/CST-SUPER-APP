export function customerPortalPaymentCorrelation(paymentId: number): string {
  return `customer_portal:payment:${paymentId}:payment_confirmed`;
}