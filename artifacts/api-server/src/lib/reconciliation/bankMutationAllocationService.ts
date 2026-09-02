import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  classifyMutationAllocationStatus,
  validateAllocationBatch,
  type BankMutationAllocationStatus,
} from "./bankMutationAllocationRules.js";

export type { BankMutationAllocationStatus } from "./bankMutationAllocationRules.js";

export interface BankMutationAllocationInput {
  invoiceId: number;
  invoiceRef?: string | null;
  amount: number;
  previousAllocationId?: number | null;
}

export interface PreviousMutationAllocation {
  id: number;
  transactionDate: string;
  description: string;
  amount: number;
  companyId: number | null;
  allocatedAmount: number;
  remainingAmount: number;
  allocationStatus: BankMutationAllocationStatus;
  allocations: Array<{
    id: number;
    invoiceId: number;
    invoiceRef: string | null;
    amount: number;
    remainingAmount: number;
    groupId: number | null;
    isLinked: boolean;
  }>;
}

export interface BankMutationAllocationResult {
  mutationId: number;
  allocatedAmount: number;
  remainingAmount: number;
  status: BankMutationAllocationStatus;
  allocationIds: number[];
  lines: Array<{
    allocationId: number;
    invoiceId: number;
    invoiceRef: string;
    amount: number;
    invoiceRemainingAmount: number;
    previousAllocationId: number | null;
  }>;
}

export class BankMutationAllocationError extends Error {
  constructor(
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "BankMutationAllocationError";
  }
}

function asFinitePositive(value: unknown, label: string): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new BankMutationAllocationError(`${label} harus lebih dari 0`);
  }
  return numberValue;
}

function normalizeDate(value: unknown): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BankMutationAllocationError("Tanggal mutasi harus berformat YYYY-MM-DD");
  }
  return date;
}

function parseJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Search is deliberately constrained to the two reviewer-selected fields:
 * exact transaction date and a case-insensitive description/name fragment.
 * No amount, provider, account, or candidate heuristic is used here.
 */
export async function searchPreviousMutationAllocations(params: {
  currentMutationId: number;
  companyId: number;
  transactionDate: string;
  description: string;
}): Promise<PreviousMutationAllocation[]> {
  const transactionDate = normalizeDate(params.transactionDate);
  const description = String(params.description ?? "").trim();
  if (!description) {
    throw new BankMutationAllocationError("Deskripsi/nama pengirim wajib diisi");
  }

  const rows = await db.execute<any>(sql`
    SELECT
      bm.id,
      bm.transaction_date::text AS transaction_date,
      bm.description,
      bm.amount,
      bm.company_id,
      COALESCE(SUM(pa.allocated_amount) FILTER (WHERE pa.is_active = TRUE), 0) AS allocated_amount,
      GREATEST(
        bm.amount - COALESCE(SUM(pa.allocated_amount) FILTER (WHERE pa.is_active = TRUE), 0),
        0
      ) AS remaining_amount,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', pa.id,
            'invoiceId', pa.invoice_id,
            'invoiceRef', pa.invoice_ref,
            'amount', pa.allocated_amount,
            'remainingAmount', GREATEST(
              COALESCE(sd.total_amount, 0) - (
                SELECT COALESCE(SUM(invoice_alloc.allocated_amount), 0)
                FROM payment_allocations invoice_alloc
                WHERE invoice_alloc.invoice_id = pa.invoice_id
                  AND invoice_alloc.company_id = pa.company_id
                  AND invoice_alloc.is_active = TRUE
              ),
              0
            ),
            'groupId', pa.group_id,
            'isLinked', EXISTS (
              SELECT 1
              FROM payment_allocations linked
              WHERE linked.source_allocation_id = pa.id
                AND linked.is_active = TRUE
            )
          )
          ORDER BY pa.allocation_sequence, pa.id
        ) FILTER (WHERE pa.id IS NOT NULL AND pa.is_active = TRUE),
        '[]'::jsonb
      ) AS allocations
    FROM bank_mutations bm
    LEFT JOIN payment_allocations pa
      ON pa.mutation_id = bm.id
     AND pa.company_id = bm.company_id
     AND pa.is_active = TRUE
    LEFT JOIN sales_documents sd ON sd.id = pa.invoice_id
    WHERE bm.id <> ${params.currentMutationId}
      AND bm.company_id = ${params.companyId}
       AND bm.transaction_date::text = ${transactionDate}
      AND (
        bm.description ILIKE ${`%${description}%`}
        OR bm.normalized_description ILIKE ${`%${description}%`}
      )
    GROUP BY bm.id
    HAVING COALESCE(SUM(pa.allocated_amount) FILTER (WHERE pa.is_active = TRUE), 0) > 0
    ORDER BY bm.transaction_date DESC, bm.id DESC
    LIMIT 100
  `).then((result) => result.rows);

  return rows.map((row: any) => {
    const amount = Number(row.amount ?? 0);
    const allocatedAmount = Number(row.allocated_amount ?? 0);
    const allocations = parseJsonArray(row.allocations).map((allocation: any) => ({
      id: Number(allocation.id),
      invoiceId: Number(allocation.invoiceId),
      invoiceRef: allocation.invoiceRef != null ? String(allocation.invoiceRef) : null,
      amount: Number(allocation.amount ?? 0),
      remainingAmount: Number(allocation.remainingAmount ?? 0),
      groupId: allocation.groupId != null ? Number(allocation.groupId) : null,
      isLinked: Boolean(allocation.isLinked),
    }));

    return {
      id: Number(row.id),
      transactionDate: String(row.transaction_date ?? ""),
      description: String(row.description ?? ""),
      amount,
      companyId: row.company_id != null ? Number(row.company_id) : null,
      allocatedAmount,
      remainingAmount: Math.max(0, Number(row.remaining_amount ?? amount - allocatedAmount)),
      allocationStatus: classifyMutationAllocationStatus(amount, allocatedAmount),
      allocations,
    };
  });
}

/**
 * Add one or more new edges from a bank mutation to invoices. Existing
 * payment_allocations remain immutable; a link to an old allocation is stored
 * on the new edge as source_allocation_id, preserving the original mutation
 * lineage without counting the old payment twice.
 */
export async function allocateBankMutation(params: {
  mutationId: number;
  companyId: number;
  allocations: BankMutationAllocationInput[];
  actor: string;
  requestedGroupId?: number | null;
}): Promise<BankMutationAllocationResult> {
  if (!Number.isInteger(params.mutationId) || params.mutationId <= 0) {
    throw new BankMutationAllocationError("mutationId tidak valid");
  }
  if (!Number.isInteger(params.companyId) || params.companyId <= 0) {
    throw new BankMutationAllocationError("companyId tidak valid");
  }
  if (!Array.isArray(params.allocations) || params.allocations.length === 0) {
    throw new BankMutationAllocationError("Minimal satu allocation diperlukan");
  }

  const normalizedAllocations = params.allocations.map((line, index) => {
    const invoiceId = Number(line.invoiceId);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new BankMutationAllocationError(`Allocation line ${index + 1}: invoiceId tidak valid`);
    }
    return {
      invoiceId,
      invoiceRef: line.invoiceRef != null ? String(line.invoiceRef) : null,
      amount: asFinitePositive(line.amount, `Allocation line ${index + 1}: amount`),
      previousAllocationId:
        line.previousAllocationId == null ? null : Number(line.previousAllocationId),
    };
  });

  for (const line of normalizedAllocations) {
    if (
      line.previousAllocationId != null
      && (!Number.isInteger(line.previousAllocationId) || line.previousAllocationId <= 0)
    ) {
      throw new BankMutationAllocationError("previousAllocationId tidak valid");
    }
  }

  return db.transaction(async (tx) => {
    const mutationRows = await tx.execute<any>(sql`
      SELECT id, amount, company_id, transaction_date, bank_account_id
      FROM bank_mutations
      WHERE id = ${params.mutationId}
      FOR UPDATE
    `).then((result) => result.rows);
    const mutation = mutationRows[0];
    if (!mutation) throw new BankMutationAllocationError("Mutasi bank tidak ditemukan", 404);
    if (Number(mutation.company_id) !== params.companyId) {
      throw new BankMutationAllocationError("Akses ditolak", 403);
    }

    const mutationAmount = Number(mutation.amount ?? 0);
    const existingMutationAllocationRows = await tx.execute<any>(sql`
      SELECT COALESCE(SUM(allocated_amount), 0) AS allocated_amount
      FROM payment_allocations
      WHERE mutation_id = ${params.mutationId}
        AND company_id = ${params.companyId}
        AND is_active = TRUE
    `).then((result) => result.rows);
    const existingMutationAllocated = Number(
      existingMutationAllocationRows[0]?.allocated_amount ?? 0,
    );
    const requestedAmount = normalizedAllocations.reduce((sum, line) => sum + line.amount, 0);
    const currentRemaining = Math.max(0, mutationAmount - existingMutationAllocated);
    try {
      validateAllocationBatch(mutationAmount, existingMutationAllocated, normalizedAllocations);
    } catch (error: any) {
      throw new BankMutationAllocationError(
        error.message.includes("Allocation melebihi")
          ? `Total allocation (${requestedAmount.toLocaleString("id-ID")}) melebihi sisa mutasi (${currentRemaining.toLocaleString("id-ID")})`
          : error.message,
      );
    }

    const previousAllocations = new Map<number, any>();
    for (const line of normalizedAllocations) {
      if (line.previousAllocationId == null) continue;
      const previousRows = await tx.execute<any>(sql`
        SELECT
          pa.id, pa.invoice_id, pa.group_id, pa.company_id, pa.mutation_id,
          pa.allocated_amount, pa.is_active
        FROM payment_allocations pa
        WHERE pa.id = ${line.previousAllocationId}
        FOR UPDATE
      `).then((result) => result.rows);
      const previous = previousRows[0];
      if (!previous || !previous.is_active) {
        throw new BankMutationAllocationError(
          `Allocation sebelumnya #${line.previousAllocationId} tidak ditemukan atau sudah tidak aktif`,
          409,
        );
      }
      if (Number(previous.company_id) !== params.companyId) {
        throw new BankMutationAllocationError("Allocation sebelumnya bukan milik perusahaan aktif", 403);
      }
      if (Number(previous.mutation_id) === params.mutationId) {
        throw new BankMutationAllocationError("Mutasi tidak boleh mengaitkan allocation miliknya sendiri");
      }
      if (Number(previous.invoice_id) !== line.invoiceId) {
        throw new BankMutationAllocationError(
          "Allocation sebelumnya harus berasal dari invoice yang sama dengan allocation baru",
        );
      }

      const alreadyLinked = await tx.execute<any>(sql`
        SELECT id
        FROM payment_allocations
        WHERE source_allocation_id = ${line.previousAllocationId}
          AND is_active = TRUE
        LIMIT 1
        FOR UPDATE
      `).then((result) => result.rows);
      if (alreadyLinked.length > 0) {
        throw new BankMutationAllocationError(
          `Allocation sebelumnya #${line.previousAllocationId} sudah pernah digunakan`,
          409,
        );
      }
      previousAllocations.set(line.previousAllocationId, previous);
    }

    const invoiceRows = new Map<number, any>();
    for (const line of normalizedAllocations) {
      const invoiceRowsForLine = await tx.execute<any>(sql`
        SELECT id, doc_number, total_amount, company_id
        FROM sales_documents
        WHERE id = ${line.invoiceId}
          AND company_id = ${params.companyId}
          AND doc_type = 'invoice'
        FOR UPDATE
      `).then((result) => result.rows);
      const invoice = invoiceRowsForLine[0];
      if (!invoice) {
        throw new BankMutationAllocationError(
          `Invoice #${line.invoiceId} tidak ditemukan untuk perusahaan aktif`,
          404,
        );
      }
      invoiceRows.set(line.invoiceId, invoice);
    }

    const allocationIds: number[] = [];
    const resultLines: BankMutationAllocationResult["lines"] = [];
    const groupAllocatedAmounts = new Map<number, number>();
    let createdGroupId: number | null = null;
    const batchGroupType = normalizedAllocations.length > 1 ? "MULTI_INVOICE" : "SPLIT_PAYMENT";

    if (params.requestedGroupId != null) {
      const requestedGroupRows = await tx.execute<any>(sql`
        SELECT id, company_id
        FROM payment_matching_groups
        WHERE id = ${params.requestedGroupId}
          AND company_id = ${params.companyId}
          AND status = 'active'
        FOR UPDATE
      `).then((result) => result.rows);
      if (!requestedGroupRows.length) {
        throw new BankMutationAllocationError("payment matching group tidak ditemukan", 404);
      }
      createdGroupId = Number(params.requestedGroupId);
    }

    for (const line of normalizedAllocations) {
      const invoice = invoiceRows.get(line.invoiceId);
      const invoiceAmount = Number(invoice.total_amount ?? 0);
      const priorTotalRows = await tx.execute<any>(sql`
        SELECT COALESCE(SUM(allocated_amount), 0) AS allocated_amount
        FROM payment_allocations
        WHERE invoice_id = ${line.invoiceId}
          AND company_id = ${params.companyId}
          AND is_active = TRUE
      `).then((result) => result.rows);
      const priorInvoiceAllocated = Number(priorTotalRows[0]?.allocated_amount ?? 0);
      const invoiceRemaining = Math.max(0, invoiceAmount - priorInvoiceAllocated);
      if (line.amount > invoiceRemaining + 0.01) {
        throw new BankMutationAllocationError(
          `Allocation invoice ${invoice.doc_number ?? `#${line.invoiceId}`} (${line.amount.toLocaleString("id-ID")}) melebihi outstanding (${invoiceRemaining.toLocaleString("id-ID")})`,
        );
      }

      const previous = line.previousAllocationId == null
        ? null
        : previousAllocations.get(line.previousAllocationId);
      let groupId = previous?.group_id != null ? Number(previous.group_id) : createdGroupId;

      if (groupId == null && normalizedAllocations.length > 1) {
        if (createdGroupId == null) {
          const totalInvoiceAmount = normalizedAllocations.reduce(
            (sum, allocation) => sum + Number(invoiceRows.get(allocation.invoiceId)?.total_amount ?? 0),
            0,
          );
          const groupRows = await tx.execute<{ id: number }>(sql`
            INSERT INTO payment_matching_groups
              (company_id, group_type, matching_type, total_mutation_amount,
               total_invoice_amount, total_allocated, remaining_amount,
               confidence, algorithm_used, status, created_by)
            VALUES
              (${params.companyId}, ${batchGroupType}, ${batchGroupType},
               ${requestedAmount}, ${totalInvoiceAmount}, ${requestedAmount},
               ${Math.max(0, totalInvoiceAmount - requestedAmount)},
               0, 'MANUAL_BANK_ALLOCATION', 'active', ${params.actor})
            RETURNING id
          `).then((result) => result.rows);
          createdGroupId = groupRows[0]?.id != null ? Number(groupRows[0].id) : null;
        }
        groupId = createdGroupId;
      }
      if (groupId != null) {
        groupAllocatedAmounts.set(
          groupId,
          (groupAllocatedAmounts.get(groupId) ?? 0) + line.amount,
        );
      }

      const sequenceRows = await tx.execute<any>(sql`
        SELECT COALESCE(MAX(allocation_sequence), 0) AS max_sequence
        FROM payment_allocations
        WHERE invoice_id = ${line.invoiceId}
          AND company_id = ${params.companyId}
          AND is_active = TRUE
      `).then((result) => result.rows);
      const sequence = Number(sequenceRows[0]?.max_sequence ?? 0) + 1;
      const remainingAfter = Math.max(0, invoiceRemaining - line.amount);

      const allocationRows = await tx.execute<{ id: number }>(sql`
        INSERT INTO payment_allocations
          (group_id, company_id, invoice_id, invoice_ref, mutation_id,
           allocated_amount, remaining_amount, allocation_sequence, strategy,
           is_active, source_allocation_id)
        VALUES
          (${groupId}, ${params.companyId}, ${line.invoiceId},
           ${line.invoiceRef ?? invoice.doc_number ?? null}, ${params.mutationId},
           ${line.amount}, ${remainingAfter}, ${sequence}, 'MANUAL',
           TRUE, ${line.previousAllocationId ?? null})
        RETURNING id
      `).then((result) => result.rows);
      const allocationId = allocationRows[0]?.id;
      if (allocationId == null) {
        throw new Error("Gagal menyimpan allocation");
      }
      allocationIds.push(Number(allocationId));
      resultLines.push({
        allocationId: Number(allocationId),
        invoiceId: line.invoiceId,
        invoiceRef: String(line.invoiceRef ?? invoice.doc_number ?? `#${line.invoiceId}`),
        amount: line.amount,
        invoiceRemainingAmount: remainingAfter,
        previousAllocationId: line.previousAllocationId,
      });

      await tx.execute(sql`
        INSERT INTO allocation_history
          (allocation_id, group_id, company_id, event_type, actor, meta)
        VALUES
          (${allocationId}, ${groupId}, ${params.companyId}, 'BANK_MUTATION_ALLOCATION_CREATED',
           ${params.actor},
           ${JSON.stringify({
             mutationId: params.mutationId,
             invoiceId: line.invoiceId,
             amount: line.amount,
             previousAllocationId: line.previousAllocationId,
             sourceMutationId: previous?.mutation_id ?? null,
             batchGroupType,
           })})
      `);
    }

    for (const [groupId, groupAmount] of groupAllocatedAmounts) {
      await tx.execute(sql`
        UPDATE payment_matching_groups
        SET total_mutation_amount = total_mutation_amount + ${groupAmount},
            total_allocated = total_allocated + ${groupAmount},
            remaining_amount = GREATEST(0, total_invoice_amount - (total_allocated + ${groupAmount})),
            updated_at = NOW()
        WHERE id = ${groupId}
          AND company_id = ${params.companyId}
      `);
    }

    const totalAllocated = existingMutationAllocated + requestedAmount;
    const status = classifyMutationAllocationStatus(mutationAmount, totalAllocated);
    const matchingType = normalizedAllocations.length > 1 ? "MULTI_INVOICE" : "SPLIT_PAYMENT";
    await tx.execute(sql`
      UPDATE bank_mutations
      SET matching_type = ${matchingType},
          matching_group_id = ${createdGroupId ?? Array.from(groupAllocatedAmounts.keys())[0] ?? null},
          reconciliation_status = ${status},
          status = CASE WHEN status = 'unmatched' THEN 'matched' ELSE status END,
          updated_at = NOW()
      WHERE id = ${params.mutationId}
    `);

    await tx.execute(sql`
      INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
      VALUES
        (${params.mutationId}, 'MULTI_ALLOCATION_CREATED', ${params.actor},
         ${JSON.stringify({
           allocationIds,
           requestedAmount,
           totalAllocated,
           remainingAmount: Math.max(0, mutationAmount - totalAllocated),
           status,
           previousAllocationIds: normalizedAllocations
             .map((line) => line.previousAllocationId)
             .filter((id): id is number => id != null),
         })})
    `).catch(() => {});

    return {
      mutationId: params.mutationId,
      allocatedAmount: totalAllocated,
      remainingAmount: Math.max(0, mutationAmount - totalAllocated),
      status,
      allocationIds,
      lines: resultLines,
    };
  });
}