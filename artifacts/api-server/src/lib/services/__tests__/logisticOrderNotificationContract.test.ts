import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  logisticOrdersTable: {},
  customerOrderLinksTable: {},
}));
vi.mock("../../auditTrail.js", () => ({ logOrderStatusChange: vi.fn() }));
vi.mock("../../auditLog.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../../logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import {
  CUSTOMER_NOTIFY_STATUS_SET,
  LOGISTIC_ORDER_VALID_TRANSITIONS,
  isTransitionAllowed,
} from "../logisticOrderStatusService.js";
import { CUSTOMER_WA_MESSAGES } from "../../logisticStatusConstants.js";

describe("customer logistic order notification contract", () => {
  const customerLifecycle = [
    "Order Received",
    "Admin Review",
    "Product RFQ Sent",
    "Product Quote Received",
    "Product Vendor Selected",
    "Customer Product Approval",
    "Shipment Selection Pending",
    "Ready for Pickup",
    "RFQ Sent",
    "Quote Received",
    "Customer Approval",
    "Vendor Confirmed",
    "In Progress",
    "Pickup",
    "In Transit",
    "Arrived",
    "Delivered",
    "POD Uploaded",
    "Invoice Issued",
    "Payment Received",
    "Completed",
  ] as const;

  it("has one customer template and transition notification mapping per lifecycle event", () => {
    for (const status of customerLifecycle) {
      expect(CUSTOMER_WA_MESSAGES[status], status).toBeTypeOf("function");
      expect(CUSTOMER_NOTIFY_STATUS_SET.has(status), status).toBe(true);
    }
  });

  it("keeps the normal shipment sequence and blocks direct delivery from ready", () => {
    expect(isTransitionAllowed("Ready for Pickup", "Pickup")).toBe(true);
    expect(isTransitionAllowed("Ready for Pickup", "Delivered")).toBe(false);
    expect(isTransitionAllowed("Pickup", "In Transit")).toBe(true);
    expect(isTransitionAllowed("In Transit", "Arrived")).toBe(true);
    expect(isTransitionAllowed("Arrived", "Delivered")).toBe(true);
  });

  it("keeps terminal states terminal", () => {
    expect(LOGISTIC_ORDER_VALID_TRANSITIONS.Completed).toEqual([]);
    expect(LOGISTIC_ORDER_VALID_TRANSITIONS.Cancelled).toEqual([]);
    expect(isTransitionAllowed("Completed", "Invoice Issued")).toBe(false);
    expect(isTransitionAllowed("Cancelled", "Order Received")).toBe(false);
  });

  it("renders tracking links only when a URL is supplied", () => {
    const withUrl = CUSTOMER_WA_MESSAGES["Delivered"]("LOG-TEST", "https://example.test/order-track/token");
    const withoutUrl = CUSTOMER_WA_MESSAGES["Delivered"]("LOG-TEST");
    expect(withUrl).toContain("https://example.test/order-track/token");
    expect(withoutUrl).not.toContain("undefined");
  });
});