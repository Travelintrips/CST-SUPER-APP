import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  markStartupSubstepCompleted,
  markStartupSubstepFailed,
  markStartupSubstepStarting,
} from "../lib/startupReadinessState.js";

vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async () => ({ rows: [{ ok: 1 }] })),
  },
}));

vi.mock("../lib/mailer.js", () => ({
  checkSmtpConnection: vi.fn(async () => ({
    status: "ok",
    latencyMs: 1,
  })),
}));

vi.mock("../lib/accountingMigration.js", () => ({
  checkSequenceDesync: vi.fn(async () => []),
}));

let app: express.Express;

beforeAll(async () => {
  const { default: healthRouter } = await import("../routes/health.js");
  app = express();
  app.use("/api", healthRouter);
});

describe("Vendor Invoice capture production health contract", () => {
  it("does not report healthy while the capture schema is pending", async () => {
    markStartupSubstepStarting("vendor_invoice_capture_schema_v1");

    const response = await request(app).get("/api/healthz");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("degraded");
    expect(response.body.criticalSchemas.vendorInvoiceCapture).toBe("running");
  });

  it("reports an error when the capture schema repair fails", async () => {
    markStartupSubstepFailed(
      "vendor_invoice_capture_schema_v1",
      new Error("capture schema incomplete"),
    );

    const response = await request(app).get("/api/healthz");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("error");
    expect(response.body.criticalSchemas.vendorInvoiceCapture).toBe("failed");
  });

  it("can report healthy only after the capture schema repair completes", async () => {
    markStartupSubstepCompleted("vendor_invoice_capture_schema_v1");

    const response = await request(app).get("/api/healthz");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.criticalSchemas.vendorInvoiceCapture).toBe("completed");
  });
});