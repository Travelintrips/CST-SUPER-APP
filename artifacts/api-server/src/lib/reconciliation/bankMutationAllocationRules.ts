export type BankMutationAllocationStatus =
  | "UNMATCHED"
  | "PARTIALLY_MATCHED"
  | "FULLY_MATCHED";

export interface AllocationBatchLine {
  invoiceId: number;
  amount: number;
  previousAllocationId?: number | null;
}

export function classifyMutationAllocationStatus(
  mutationAmount: number,
  allocatedAmount: number,
): BankMutationAllocationStatus {
  const amountCents = Math.round(Math.max(0, mutationAmount) * 100);
  const allocatedCents = Math.round(Math.max(0, allocatedAmount) * 100);
  if (allocatedCents <= 0) return "UNMATCHED";
  if (allocatedCents + 1 < amountCents) return "PARTIALLY_MATCHED";
  return "FULLY_MATCHED";
}

export function validateAllocationBatch(
  mutationAmount: number,
  existingAllocatedAmount: number,
  lines: AllocationBatchLine[],
): void {
  if (!Number.isFinite(mutationAmount) || mutationAmount <= 0) {
    throw new Error("Nominal mutasi tidak valid");
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("Minimal satu allocation diperlukan");
  }
  const invoiceIds = new Set<number>();
  for (const line of lines) {
    if (!Number.isInteger(line.invoiceId) || line.invoiceId <= 0) {
      throw new Error("invoiceId tidak valid");
    }
    if (invoiceIds.has(line.invoiceId)) {
      throw new Error("Invoice duplikat dalam satu batch allocation");
    }
    invoiceIds.add(line.invoiceId);
    if (!Number.isFinite(line.amount) || line.amount <= 0) {
      throw new Error("Nominal allocation tidak valid");
    }
  }
  const requested = lines.reduce((sum, line) => sum + line.amount, 0);
  if (requested > Math.max(0, mutationAmount - existingAllocatedAmount) + 0.01) {
    throw new Error("Allocation melebihi sisa mutasi");
  }
}