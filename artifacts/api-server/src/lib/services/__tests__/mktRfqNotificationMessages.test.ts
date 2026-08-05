import { describe, it, expect } from "vitest";
import { buildMessage } from "../marketplaceNotificationWorker.js";
import type { NotifQueueRow } from "../marketplaceNotificationQueueService.js";

/**
 * Sprint 1.1 bug-fix regression: WA message text for RFQ quotation events.
 * Before the fix, "mkt_rfq_vendor_selected", "mkt_rfq_approved" and
 * "mkt_rfq_rejected" fell through to the JSON default — no readable message
 * was ever produced, and recipientPhone was always null so the queue row was
 * marked exhausted before a message even mattered. These tests only assert
 * message-building behavior (the enqueue-time phone fix is covered by the
 * route-level payload construction, not unit-testable here without a DB).
 */

function row(overrides: Partial<NotifQueueRow>): NotifQueueRow {
  return {
    id: 1,
    eventType: "mkt_rfq_vendor_selected",
    channel: "whatsapp",
    recipientType: "buyer",
    recipientId: null,
    recipientPhone: "+6281234567890",
    rfqId: 1,
    vendorQuoteId: null,
    purchaseOrderId: null,
    payloadJson: {},
    attemptCount: 0,
    maxAttempts: 5,
    ...overrides,
  };
}

describe("marketplaceNotificationWorker buildMessage — Sprint 1.1", () => {
  it("builds a readable message for mkt_rfq_vendor_selected (admin sent quotation to customer)", () => {
    const msg = buildMessage(
      row({
        eventType: "mkt_rfq_vendor_selected",
        payloadJson: { rfqNumber: "RFQ-0001", vendorName: "PT Vendor Jaya", notes: "Segera ditinjau" },
      }),
    );
    expect(msg).toContain("RFQ-0001");
    expect(msg).toContain("PT Vendor Jaya");
    expect(msg).toContain("Segera ditinjau");
    expect(msg).not.toContain("{"); // never falls through to raw JSON
  });

  it("builds a PO-confirmation message for mkt_rfq_approved when poNumber is present (customer approve)", () => {
    const msg = buildMessage(
      row({
        eventType: "mkt_rfq_approved",
        payloadJson: { rfqNumber: "RFQ-0002", poNumber: "PO-0007", approvedByPortal: true },
      }),
    );
    expect(msg).toContain("RFQ-0002");
    expect(msg).toContain("PO-0007");
    expect(msg).toMatch(/disetujui/i);
  });

  it("builds an approver-approval message for mkt_rfq_approved when poNumber is absent (internal approver flow)", () => {
    const msg = buildMessage(
      row({
        eventType: "mkt_rfq_approved",
        payloadJson: { rfqNumber: "RFQ-0003", approverName: "Budi" },
      }),
    );
    expect(msg).toContain("RFQ-0003");
    expect(msg).toContain("Budi");
    expect(msg).not.toContain("PO Number");
  });

  it("builds a rejection message for mkt_rfq_rejected (customer reject) including the reason", () => {
    const msg = buildMessage(
      row({
        eventType: "mkt_rfq_rejected",
        payloadJson: { rfqNumber: "RFQ-0004", rejectedByPortal: true, rejectionNotes: "Harga terlalu tinggi" },
      }),
    );
    expect(msg).toContain("RFQ-0004");
    expect(msg).toContain("Harga terlalu tinggi");
    expect(msg).toMatch(/ditolak/i);
  });
});
