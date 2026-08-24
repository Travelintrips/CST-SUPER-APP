import { describe, expect, it } from "vitest";

const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

function accepts(current: string | null, incoming: string): boolean {
  return (rank[current ?? ""] ?? 0) <= (rank[incoming] ?? 0);
}

describe("WhatsApp callback state machine", () => {
  it("accepts the forward delivery lifecycle", () => {
    expect(accepts(null, "sent")).toBe(true);
    expect(accepts("sent", "delivered")).toBe(true);
    expect(accepts("delivered", "read")).toBe(true);
  });

  it("keeps duplicate callbacks idempotent", () => {
    expect(accepts("sent", "sent")).toBe(true);
    expect(accepts("delivered", "delivered")).toBe(true);
    expect(accepts("read", "read")).toBe(true);
  });

  it("rejects stale and unknown callback transitions", () => {
    expect(accepts("delivered", "sent")).toBe(false);
    expect(accepts("read", "delivered")).toBe(false);
    expect(accepts("read", "sent")).toBe(false);
    expect(accepts("read", "unknown")).toBe(false);
  });
});