export const MAX_ALLOCATION_ATTEMPTS = 200;

export function isSafeFixturePayment(references) {
  return Array.isArray(references) && references.length === 0;
}