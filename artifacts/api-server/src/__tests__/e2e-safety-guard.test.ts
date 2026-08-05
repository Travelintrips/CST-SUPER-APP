/**
 * Regression tests for the public e2eSafetyGuard contract.
 *
 * These tests intentionally configure every outbound channel explicitly.
 * The production guard must remain fail-closed when a channel is live.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { IRouter, Request, Response } from "express";

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function mockRouter() {
  const handlers: Record<string, (req: Request, res: Response) => void> = {};
  return {
    get(path: string, handler: (req: Request, res: Response) => void) {
      handlers[path] = handler;
    },
    _dispatch(path: string, req: Partial<Request>, res: Partial<Response>) {
      const handler = handlers[path];
      if (!handler) throw new Error(`No handler for ${path}`);
      handler(req as Request, res as Response);
    },
  };
}

function mockRes() {
  const calls: { status?: number; body?: unknown }[] = [];
  let statusCode = 200;
  const res = {
    status(status: number) {
      statusCode = status;
      return res;
    },
    json(body: unknown) {
      calls.push({ status: statusCode, body });
      return res;
    },
    _calls: calls,
  };
  return res;
}

const SAFE_OUTBOUND_ENV = {
  MOCK_WHATSAPP: "true",
  MOCK_EMAIL: "true",
  MOCK_PAYMENT: "true",
  MOCK_STORAGE: "true",
};

describe("e2eSafetyGuard public API", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "E2E_TEST_MODE",
      "SAFE_DEV_TEST_MODE",
      "MOCK_WHATSAPP",
      "DISABLE_WHATSAPP",
      "MOCK_EMAIL",
      "DISABLE_EMAIL",
      "MOCK_PAYMENT",
      "USE_PAYMENT_SANDBOX",
      "MOCK_WEBHOOKS",
      "DISABLE_WEBHOOKS",
      "KEEP_WORKERS",
      "DISABLE_WORKERS",
      "MOCK_STORAGE",
      "USE_TEST_STORAGE",
      "FONNTE_TOKEN",
      "SMTP_PASS",
      "PAYLABS_PRIVATE_KEY",
    ]) {
      originalEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    setEnv(originalEnv);
    vi.resetModules();
  });

  it("isE2EMode reflects either supported environment flag", async () => {
    setEnv({ E2E_TEST_MODE: undefined, SAFE_DEV_TEST_MODE: undefined });
    let guard = await import("../lib/e2eSafetyGuard.js");
    expect(guard.isE2EMode()).toBe(false);

    setEnv({ E2E_TEST_MODE: "true" });
    expect(guard.isE2EMode()).toBe(true);

    vi.resetModules();
    setEnv({ E2E_TEST_MODE: undefined, SAFE_DEV_TEST_MODE: "true" });
    guard = await import("../lib/e2eSafetyGuard.js");
    expect(guard.isE2EMode()).toBe(true);
  });

  it("getE2ESafetyStatus reports safe configured outbound channels", async () => {
    setEnv({
      E2E_TEST_MODE: "true",
      SAFE_DEV_TEST_MODE: undefined,
      ...SAFE_OUTBOUND_ENV,
    });
    const guard = await import("../lib/e2eSafetyGuard.js");

    expect(() => guard.assertE2ESafetyOrDie()).not.toThrow();
    const status = guard.getE2ESafetyStatus();
    expect(status.e2eMode).toBe(true);
    expect(status.whatsapp).toBe("mocked");
    expect(status.email).toBe("mocked");
    expect(status.payment).toBe("mocked");
    expect(status.webhooks).toBe("disabled");
    expect(status.workers).toBe("disabled");
    expect(status.storage).toBe("test-only");
    expect(status.issues).toEqual([]);
    expect(JSON.stringify(status)).not.toMatch(/postgresql:\/\//);
  });

  it("fails closed when a configured outbound channel remains live", async () => {
    setEnv({
      E2E_TEST_MODE: "true",
      SAFE_DEV_TEST_MODE: undefined,
      FONNTE_TOKEN: "test-token",
      MOCK_EMAIL: "true",
      MOCK_PAYMENT: "true",
      MOCK_STORAGE: "true",
    });
    const guard = await import("../lib/e2eSafetyGuard.js");

    expect(() => guard.assertE2ESafetyOrDie()).toThrow(/outbound channel/i);
  });

  it("getE2ESafetyStatus exposes a safe non-E2E status", async () => {
    setEnv({ E2E_TEST_MODE: undefined, SAFE_DEV_TEST_MODE: undefined });
    const guard = await import("../lib/e2eSafetyGuard.js");

    const status = guard.getE2ESafetyStatus();
    expect(status.e2eMode).toBe(false);
    expect(status.issues).toEqual([]);
    expect(status.webhooks).toBe("live");
  });

  it("registerE2ESafetyEndpoint returns 404 outside E2E mode", async () => {
    setEnv({ E2E_TEST_MODE: undefined, SAFE_DEV_TEST_MODE: undefined });
    const guard = await import("../lib/e2eSafetyGuard.js");
    const router = mockRouter() as unknown as IRouter;
    guard.registerE2ESafetyEndpoint(router);
    const res = mockRes();

    (router as unknown as { _dispatch: Function })._dispatch(
      "/api/health/e2e-safety",
      {},
      res,
    );
    expect(res._calls[0]?.status).toBe(404);
  });

  it("registerE2ESafetyEndpoint returns the public status in safe E2E mode", async () => {
    setEnv({
      E2E_TEST_MODE: "true",
      SAFE_DEV_TEST_MODE: undefined,
      ...SAFE_OUTBOUND_ENV,
    });
    const guard = await import("../lib/e2eSafetyGuard.js");
    const router = mockRouter() as unknown as IRouter;
    guard.registerE2ESafetyEndpoint(router);
    const res = mockRes();

    (router as unknown as { _dispatch: Function })._dispatch(
      "/api/health/e2e-safety",
      {},
      res,
    );
    expect(res._calls[0]?.status).toBe(200);
    expect((res._calls[0]?.body as { e2eMode: boolean }).e2eMode).toBe(true);
  });
});

describe("safeDev — isSafeDevTestMode / externalIntegrationsDisabled", () => {
  afterEach(() => {
    delete process.env.SAFE_DEV_TEST_MODE;
    vi.resetModules();
  });

  it("mirrors SAFE_DEV_TEST_MODE only when it is true", async () => {
    delete process.env.SAFE_DEV_TEST_MODE;
    let safeDev = await import("../lib/safeDev.js");
    expect(safeDev.isSafeDevTestMode()).toBe(false);

    vi.resetModules();
    process.env.SAFE_DEV_TEST_MODE = "true";
    safeDev = await import("../lib/safeDev.js");
    expect(safeDev.isSafeDevTestMode()).toBe(true);
    expect(safeDev.externalIntegrationsDisabled()).toBe(true);
  });
});