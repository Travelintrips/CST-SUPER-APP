import { describe, expect, it } from "vitest";
import { availableActions, getActionTarget } from "../routes/portalAdminServiceOps.js";

describe("Customer Portal service operations policy", () => {
  it("only exposes transitions that are valid for the canonical current status", () => {
    expect(getActionTarget("service-request", "approve", "submitted")).toEqual({
      nextStatus: "approved_for_rfq",
      allowedFrom: ["submitted", "need_review", "need_more_data"],
    });
    expect(getActionTarget("service-request", "approve", "completed")).toBeNull();
    expect(availableActions("service-request", "submitted")).toEqual([
      "approve",
      "request_revision",
      "reject",
      "contact",
    ]);
  });

  it("does not manufacture actions for unsupported sources or statuses", () => {
    expect(getActionTarget("marketplace-po", "approve", "pending")).toBeNull();
    expect(availableActions("marketplace-po", "pending")).toEqual(["contact"]);
    expect(availableActions("unknown-service", "submitted")).toEqual([]);
  });
});