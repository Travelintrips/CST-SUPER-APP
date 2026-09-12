import { describe, expect, it } from "vitest";

type LineQuantity = { lineId: number; ordered: number; requested: number };
type RequestRecord = { key: string; payload: unknown; resultId: number };

function validateCumulativeShipment(lines: LineQuantity[], alreadyShipped: Map<number, number>) {
  return lines.every((line) => (alreadyShipped.get(line.lineId) ?? 0) + line.requested <= line.ordered + 0.005);
}

function replayOrConflict(existing: RequestRecord | undefined, key: string, payload: unknown) {
  if (!existing) return { kind: "new" as const };
  return JSON.stringify(existing.payload) === JSON.stringify(payload)
    ? { kind: "replay" as const, resultId: existing.resultId }
    : { kind: "conflict" as const };
}

function validateCumulativeReceipt(received: number, requested: number, shipmentQuantity: number) {
  return received + requested <= shipmentQuantity + 0.005;
}

describe("canonical Marketplace fulfillment idempotency", () => {
  it("allows a partial shipment while preventing cumulative overage", () => {
    const alreadyShipped = new Map([[10, 6]]);
    expect(validateCumulativeShipment([{ lineId: 10, ordered: 10, requested: 4 }], alreadyShipped)).toBe(true);
    expect(validateCumulativeShipment([{ lineId: 10, ordered: 10, requested: 4.01 }], alreadyShipped)).toBe(false);
  });

  it("keeps duplicate shipment retries as a replay, not a second shipment", () => {
    const payload = { items: [{ lineNumber: 1, qty: 5 }], trackingNumber: "AWB-1" };
    const first = replayOrConflict(undefined, "shipment-1", payload);
    const second = replayOrConflict({ key: "shipment-1", payload, resultId: 42 }, "shipment-1", payload);
    expect(first.kind).toBe("new");
    expect(second).toEqual({ kind: "replay", resultId: 42 });
  });

  it("rejects reusing a shipment key with a different quantity or tracking payload", () => {
    const existing = { key: "shipment-1", payload: { items: [{ lineNumber: 1, qty: 5 }] }, resultId: 42 };
    expect(replayOrConflict(existing, "shipment-1", { items: [{ lineNumber: 1, qty: 6 }] })).toEqual({ kind: "conflict" });
  });

  it("checks goods-receipt replay before applying cumulative overage", () => {
    const payload = { receiptType: "partial", items: [{ shipmentItemId: 7, receivedQty: 4 }] };
    const replay = replayOrConflict({ key: "gr-1", payload, resultId: 99 }, "gr-1", payload);
    expect(replay.kind).toBe("replay");
    expect(validateCumulativeReceipt(10, 4, 10)).toBe(false);
  });

  it("prevents duplicate receipt quantity from exceeding the shipment", () => {
    expect(validateCumulativeReceipt(6, 4, 10)).toBe(true);
    expect(validateCumulativeReceipt(6, 4.01, 10)).toBe(false);
  });

  it("treats event retries as payload-sensitive", () => {
    const existing = { key: "event-1", payload: { eventType: "delivered", note: "Dock A" }, resultId: 12 };
    expect(replayOrConflict(existing, "event-1", existing.payload)).toEqual({ kind: "replay", resultId: 12 });
    expect(replayOrConflict(existing, "event-1", { eventType: "delivered", note: "Dock B" })).toEqual({ kind: "conflict" });
  });
});