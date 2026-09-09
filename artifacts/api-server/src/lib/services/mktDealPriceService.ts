import { and, eq } from "drizzle-orm";
import {
  db,
  mktRfqsTable,
  mktVendorQuotesTable,
  mktVendorQuoteLinesTable,
} from "@workspace/db";

export interface DealPriceInputLine {
  rfqLineId: number;
  dealUnitPrice: number;
}

export interface SetMarketplaceDealPriceInput {
  rfqId: number;
  quoteId: number;
  lines: DealPriceInputLine[];
  dealNotes?: string | null;
  expectedUpdatedAt?: string | null;
  actorId: string;
}

export interface DealPriceResultLine {
  rfqLineId: number;
  vendorUnitPrice: string;
  vendorSubtotal: string;
  previousDealUnitPrice: string | null;
  previousDealSubtotal: string | null;
  dealUnitPrice: string;
  dealSubtotal: string;
}

export type SetMarketplaceDealPriceResult =
  | {
      ok: true;
      rfqId: number;
      quoteId: number;
      updatedAt: Date;
      lines: DealPriceResultLine[];
      dealTotal: string;
    }
  | {
      ok: false;
      code:
        | "QUOTE_NOT_FOUND"
        | "DEAL_PRICE_LOCKED"
        | "STALE_DEAL_PRICE"
        | "DEAL_PRICE_LINES_REQUIRED"
        | "DEAL_PRICE_LINES_MISMATCH"
        | "INVALID_DEAL_PRICE";
      message: string;
    };

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * Persists the customer-facing negotiated price without mutating vendor cost.
 * The quote and all of its lines are checked inside one transaction so a
 * partial multi-line update cannot become visible.
 */
export async function setMarketplaceDealPrice(
  input: SetMarketplaceDealPriceInput,
): Promise<SetMarketplaceDealPriceResult> {
  if (!input.lines.length) {
    return { ok: false, code: "DEAL_PRICE_LINES_REQUIRED", message: "Minimal satu harga deal wajib diisi" };
  }

  if (input.lines.some((line) => !Number.isFinite(line.dealUnitPrice) || line.dealUnitPrice <= 0)) {
    return { ok: false, code: "INVALID_DEAL_PRICE", message: "Harga deal harus lebih besar dari nol" };
  }

  try {
    return await db.transaction(async (tx: any) => {
      const [quote] = await tx
        .select({
          quoteId: mktVendorQuotesTable.id,
          rfqId: mktVendorQuotesTable.rfqId,
          quoteStatus: mktVendorQuotesTable.status,
          quoteUpdatedAt: mktVendorQuotesTable.updatedAt,
          rfqStatus: mktRfqsTable.status,
        })
        .from(mktVendorQuotesTable)
        .innerJoin(mktRfqsTable, eq(mktRfqsTable.id, mktVendorQuotesTable.rfqId))
        .where(and(
          eq(mktVendorQuotesTable.id, input.quoteId),
          eq(mktVendorQuotesTable.rfqId, input.rfqId),
        ))
        .for("update")
        .limit(1);

      if (!quote) {
        return { ok: false as const, code: "QUOTE_NOT_FOUND" as const, message: "Vendor quote tidak ditemukan untuk RFQ ini" };
      }

      if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(quote.quoteUpdatedAt).getTime()) {
        return { ok: false as const, code: "STALE_DEAL_PRICE" as const, message: "Quote sudah berubah. Muat ulang sebelum menyimpan harga deal." };
      }

      if (
        ["customer_review", "awarded", "cancelled", "expired"].includes(String(quote.rfqStatus)) ||
        !["submitted", "selected"].includes(String(quote.quoteStatus))
      ) {
        return { ok: false as const, code: "DEAL_PRICE_LOCKED" as const, message: "Harga deal sudah terkunci pada status RFQ/quote saat ini" };
      }

      const quoteLines = await tx
        .select({
          rfqLineId: mktVendorQuoteLinesTable.rfqLineId,
          offeredUnitPrice: mktVendorQuoteLinesTable.offeredUnitPrice,
          offeredQty: mktVendorQuoteLinesTable.offeredQty,
          subtotal: mktVendorQuoteLinesTable.subtotal,
          negotiatedUnitPrice: mktVendorQuoteLinesTable.negotiatedUnitPrice,
          negotiatedSubtotal: mktVendorQuoteLinesTable.negotiatedSubtotal,
        })
        .from(mktVendorQuoteLinesTable)
        .where(eq(mktVendorQuoteLinesTable.quoteId, input.quoteId));

      const inputByLine = new Map<number, DealPriceInputLine>();
      for (const line of input.lines) {
        if (inputByLine.has(line.rfqLineId)) {
          return { ok: false as const, code: "DEAL_PRICE_LINES_MISMATCH" as const, message: "RFQ line tidak boleh duplikat" };
        }
        inputByLine.set(line.rfqLineId, line);
      }

      if (
        quoteLines.length === 0 ||
        quoteLines.length !== inputByLine.size ||
        quoteLines.some((line: any) => !inputByLine.has(line.rfqLineId))
      ) {
        return { ok: false as const, code: "DEAL_PRICE_LINES_MISMATCH" as const, message: "Semua line vendor quote wajib memiliki harga deal" };
      }

      const updatedAt = new Date(
        Math.max(
          Date.now(),
          new Date(quote.quoteUpdatedAt).getTime() + 1,
        ),
      );
      const [updatedQuote] = await tx
        .update(mktVendorQuotesTable)
        .set({
          negotiatedBy: input.actorId,
          negotiatedAt: updatedAt,
          negotiatedNotes: input.dealNotes?.trim() || null,
          updatedAt,
        })
        .where(and(
          eq(mktVendorQuotesTable.id, input.quoteId),
        ))
        .returning({ quoteId: mktVendorQuotesTable.id });

      if (!updatedQuote) {
        return {
          ok: false as const,
          code: "STALE_DEAL_PRICE" as const,
          message: "Quote sudah berubah. Muat ulang sebelum menyimpan harga deal.",
        };
      }

      const resultLines: DealPriceResultLine[] = [];
      let dealTotal = 0;

      for (const line of quoteLines as Array<{
        rfqLineId: number;
        offeredUnitPrice: string;
        offeredQty: string;
        subtotal: string;
          negotiatedUnitPrice: string | null;
          negotiatedSubtotal: string | null;
      }>) {
        const inputLine = inputByLine.get(line.rfqLineId)!;
        const dealSubtotal = Number(line.offeredQty) * inputLine.dealUnitPrice;
        const dealSubtotalValue = money(dealSubtotal);
        await tx
          .update(mktVendorQuoteLinesTable)
          .set({
            negotiatedUnitPrice: money(inputLine.dealUnitPrice),
            negotiatedSubtotal: dealSubtotalValue,
            updatedAt,
          })
          .where(and(
            eq(mktVendorQuoteLinesTable.quoteId, input.quoteId),
            eq(mktVendorQuoteLinesTable.rfqLineId, line.rfqLineId),
          ));

        dealTotal += Number(dealSubtotalValue);
        resultLines.push({
          rfqLineId: line.rfqLineId,
          vendorUnitPrice: line.offeredUnitPrice,
          vendorSubtotal: line.subtotal,
          dealUnitPrice: money(inputLine.dealUnitPrice),
          dealSubtotal: dealSubtotalValue,
          previousDealUnitPrice: line.negotiatedUnitPrice ?? null,
          previousDealSubtotal: line.negotiatedSubtotal ?? null,
        });
      }

      return {
        ok: true as const,
        rfqId: input.rfqId,
        quoteId: input.quoteId,
        updatedAt,
        lines: resultLines,
        dealTotal: money(dealTotal),
      };
    });
  } catch (error) {
    throw error;
  }
}