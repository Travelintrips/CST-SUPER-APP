import { describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import fs from "node:fs/promises";
import path from "node:path";

    const result = buildInvoiceTaxReview({
      forcedReviewReason: "Nominal PPh bentrok dengan nilai PPN.",
    });

    const extractedInvoice = {
      vendor_name: "Sport Center",
      vendor_tax_id: null,
      invoice_number: "SC-2026-07",
      invoice_date: "2026-07-31",
      due_date: null,
      currency: "IDR",
      subtotal: 28553506,
      tax: 3140886,
      tax_type: "PPN",
      discount: null,
      shipping_cost: null,
      total_amount: 31694392,
      line_items: [
        { description: "Pendapatan Konsesi", quantity: 1, unit_price: 17575740, total: 17575740, tax: null, coa_hint: "sewa" },
        { description: "Pemakaian Listrik", quantity: 1, unit_price: 12168704, total: 12168704, tax: null, coa_hint: "utilitas" },
        { description: "Pemakaian Air", quantity: 1, unit_price: 1949948, total: 1949948, tax: null, coa_hint: "utilitas" },
      ],
      invoice_breakdown: {
        components: [
          {
            component: "concession",
            label: "Pendapatan Konsesi",
            dpp: 15834000,
            ppn: 1741740,
            gross: 17575740,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
          {
            component: "electricity",
            label: "Pemakaian Listrik",
            dpp: 10962796,
            ppn: 1205908,
            gross: 12168704,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
          {
            component: "water",
            label: "Pemakaian Air",
            dpp: 1756710,
            ppn: 193238,
            gross: 1949948,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
        ],
        // This is the regression shape from the screenshot: PPN was copied
        // into the aggregate PPh amount even though every component is zero.
        withholding_tax: {
          type: "PPh 23",
          rate: 0,
          amount: 1741740,
          base_amount: null,
          evidence: null,
        },
        totals: {
          dpp: 28553506,
          ppn: 3140886,
          gross: 31694392,
          withholding_tax_amount: 1741740,
          payable_amount: 0,
        },
      },
      withholding_tax_type: "PPh 23",
      tax_object: null,
      withholding_amount: 1741740,
      payment_status_hint: "UNPAID",
      raw_confidence: 0.94,
      flags: [],
    };
    expect(result.required).toBe(true);
    expect(result.withholding_tax_type).toBe("PPh 23");
    expect(result.withholding_amount).toBe(1741740);
  });

  it("forces manual review when the PPh amount was cleared as suspicious evidence", () => {
    const result = buildInvoiceTaxReview({
      forcedReviewReason: "Nominal PPh bentrok dengan nilai PPN.",
    });

    const extractedInvoice = {
      vendor_name: "Sport Center",
      vendor_tax_id: null,
      invoice_number: "SC-2026-07",
      invoice_date: "2026-07-31",
      due_date: null,
      currency: "IDR",
      subtotal: 28553506,
      tax: 3140886,
      tax_type: "PPN",
      discount: null,
      shipping_cost: null,
      total_amount: 31694392,
      line_items: [
        { description: "Pendapatan Konsesi", quantity: 1, unit_price: 17575740, total: 17575740, tax: null, coa_hint: "sewa" },
        { description: "Pemakaian Listrik", quantity: 1, unit_price: 12168704, total: 12168704, tax: null, coa_hint: "utilitas" },
        { description: "Pemakaian Air", quantity: 1, unit_price: 1949948, total: 1949948, tax: null, coa_hint: "utilitas" },
      ],
      invoice_breakdown: {
        components: [
          {
            component: "concession",
            label: "Pendapatan Konsesi",
            dpp: 15834000,
            ppn: 1741740,
            gross: 17575740,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
          {
            component: "electricity",
            label: "Pemakaian Listrik",
            dpp: 10962796,
            ppn: 1205908,
            gross: 12168704,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
          {
            component: "water",
            label: "Pemakaian Air",
            dpp: 1756710,
            ppn: 193238,
            gross: 1949948,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
        ],
        // This is the regression shape from the screenshot: PPN was copied
        // into the aggregate PPh amount even though every component is zero.
        withholding_tax: {
          type: "PPh 23",
          rate: 0,
          amount: 1741740,
          base_amount: null,
          evidence: null,
        },
        totals: {
          dpp: 28553506,
          ppn: 3140886,
          gross: 31694392,
          withholding_tax_amount: 1741740,
          payable_amount: 0,
        },
      },
      withholding_tax_type: "PPh 23",
      tax_object: null,
      withholding_amount: 1741740,
      payment_status_hint: "UNPAID",
      raw_confidence: 0.94,
      flags: [],
    };
    expect(result.required).toBe(true);
    expect(result.withholding_tax_type).toBe("PPh 23");
    expect(result.withholding_amount).toBe(1741740);
  });

  it("forces manual review when the PPh amount was cleared as suspicious evidence", () => {
    const result = buildInvoiceTaxReview({
      forcedReviewReason: "Nominal PPh bentrok dengan nilai PPN.",
    });

    const extractedInvoice = {
      vendor_name: "Sport Center",
      vendor_tax_id: null,
      invoice_number: "SC-2026-07",
      invoice_date: "2026-07-31",
      due_date: null,
      currency: "IDR",
      subtotal: 28553506,
      tax: 3140886,
      tax_type: "PPN",
      discount: null,
      shipping_cost: null,
      total_amount: 31694392,
      line_items: [
        { description: "Pendapatan Konsesi", quantity: 1, unit_price: 17575740, total: 17575740, tax: null, coa_hint: "sewa" },
        { description: "Pemakaian Listrik", quantity: 1, unit_price: 12168704, total: 12168704, tax: null, coa_hint: "utilitas" },
        { description: "Pemakaian Air", quantity: 1, unit_price: 1949948, total: 1949948, tax: null, coa_hint: "utilitas" },
      ],
      invoice_breakdown: {
        components: [
          {
            component: "concession",
            label: "Pendapatan Konsesi",
            dpp: 15834000,
            ppn: 1741740,
            gross: 17575740,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
          {
            component: "electricity",
            label: "Pemakaian Listrik",
            dpp: 10962796,
            ppn: 1205908,
            gross: 12168704,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
          {
            component: "water",
            label: "Pemakaian Air",
            dpp: 1756710,
            ppn: 193238,
            gross: 1949948,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
        ],
        // This is the regression shape from the screenshot: PPN was copied
        // into the aggregate PPh amount even though every component is zero.
        withholding_tax: {
          type: "PPh 23",
          rate: 0,
          amount: 1741740,
          base_amount: null,
          evidence: null,
        },
        totals: {
          dpp: 28553506,
          ppn: 3140886,
          gross: 31694392,
          withholding_tax_amount: 1741740,
          payable_amount: 0,
        },
      },
      withholding_tax_type: "PPh 23",
      tax_object: null,
      withholding_amount: 1741740,
      payment_status_hint: "UNPAID",
      raw_confidence: 0.94,
      flags: [],
    };
    expect(result.required).toBe(true);
    expect(result.withholding_tax_type).toBe("PPh 23");
    expect(result.withholding_amount).toBe(1741740);
  });

  it("forces manual review when the PPh amount was cleared as suspicious evidence", () => {
    const result = buildInvoiceTaxReview({
      forcedReviewReason: "Nominal PPh bentrok dengan nilai PPN.",
    });

    const extractedInvoice = {
      vendor_name: "Sport Center",
      vendor_tax_id: null,
      invoice_number: "SC-2026-07",
      invoice_date: "2026-07-31",
      due_date: null,
      currency: "IDR",
      subtotal: 28553506,
      tax: 3140886,
      tax_type: "PPN",
      discount: null,
      shipping_cost: null,
      total_amount: 31694392,
      line_items: [
        { description: "Pendapatan Konsesi", quantity: 1, unit_price: 17575740, total: 17575740, tax: null, coa_hint: "sewa" },
        { description: "Pemakaian Listrik", quantity: 1, unit_price: 12168704, total: 12168704, tax: null, coa_hint: "utilitas" },
        { description: "Pemakaian Air", quantity: 1, unit_price: 1949948, total: 1949948, tax: null, coa_hint: "utilitas" },
      ],
      invoice_breakdown: {
        components: [
          {
            component: "concession",
            label: "Pendapatan Konsesi",
            dpp: 15834000,
            ppn: 1741740,
            gross: 17575740,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
          {
            component: "electricity",
            label: "Pemakaian Listrik",
            dpp: 10962796,
            ppn: 1205908,
            gross: 12168704,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
          {
            component: "water",
            label: "Pemakaian Air",
            dpp: 1756710,
            ppn: 193238,
            gross: 1949948,
            withholding_tax_amount: 0,
            withholding_tax_rate: 0,
            payable_amount: 0,
          },
        ],
        // This is the regression shape from the screenshot: PPN was copied
        // into the aggregate PPh amount even though every component is zero.
        withholding_tax: {
          type: "PPh 23",
          rate: 0,
          amount: 1741740,
          base_amount: null,
          evidence: null,
        },
        totals: {
          dpp: 28553506,
          ppn: 3140886,
          gross: 31694392,
          withholding_tax_amount: 1741740,
          payable_amount: 0,
        },
      },
      withholding_tax_type: "PPh 23",
      tax_object: null,
      withholding_amount: 1741740,
      payment_status_hint: "UNPAID",
      raw_confidence: 0.94,
      flags: [],
    };
    expect(imageMessage.image_url.url).toBe(
      `data:image/png;base64,${fixture.toString("base64")}`,
    );

    expect(response.body.data.invoice_breakdown.withholding_tax.amount).toBeNull();
    expect(response.body.data.invoice_breakdown.totals.withholding_tax_amount).toBeNull();
    expect(response.body.data.withholding_amount).toBeNull();
    expect(response.body.data.invoice_breakdown.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ppn: 1741740, withholding_tax_amount: 0 }),
      ]),
    );
    expect(response.body.data.flags).toContain(
      "AUTO-CLEARED: nominal PPh sama dengan nilai PPN komponen sementara seluruh PPh komponen nol; wajib review manual.",
    );
    expect(response.body.tax_review.required).toBe(true);
    expect(response.body.tax_review.status).toBe("required");
    expect(response.body.tax_review.reasons).toEqual(
      expect.arrayContaining([
        "Nilai PPh belum terbaca dengan pasti.",
        "Nominal PPh bentrok dengan nilai PPN pada breakdown dan dikosongkan untuk mencegah salah posting.",
      ]),
    );
  });
});

const mockOpenAi = vi.hoisted(() => ({
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
}));

    const fixture = await fs.readFile(fixturePath);

    const imageMessage = mockOpenAi.chat.completions.create.mock.calls[0][0]
      .messages[1].content
      .find((part: { type?: string }) => part.type === "image_url");

  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();

    const response = await supertest(app)
      .post("/api/invoice-ocr/extract")
      .attach("file", fixture, {
        filename: "sport-center-ppn.png",
        contentType: "image/png",
      });

    const fixturePath = path.resolve(
      process.cwd(),
      "../../attached_assets/image_1788614557477.png",
    );

    const app = express();
