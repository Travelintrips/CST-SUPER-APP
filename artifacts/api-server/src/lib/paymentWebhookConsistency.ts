/**
 * Returns true only for the first transition into the paid state.
 * Repeated provider callbacks must not create another accounting posting.
 */
export function isNewPaidTransition(currentStatus: string, nextStatus: string): boolean {
  return nextStatus === "paid" && currentStatus !== "paid";
}