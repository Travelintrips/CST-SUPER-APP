import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type TestResponse = {
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function makeRequest(key?: string): Record<string, unknown> {
  return {
    headers: key ? { "x-idempotency-key": key } : {},
    method: "POST",
    path: "/approve",
    params: { id: "42" },
    query: {},
    body: { companyId: 1 },
  };
}

function makeResponse(): TestResponse {
  const response = {
    status: vi.fn(),
    setHeader: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.setHeader.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

describe("financial idempotency storage lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockReset();
  });

  it("keeps the no-key compatibility path independent of storage readiness", async () => {
    vi.resetModules();
    const { createIdempotencyMiddleware } = await import("../lib/financial/idempotency.js");
    const middleware = createIdempotencyMiddleware("bank-reconciliation:approve");
    const response = makeResponse();
    const next = vi.fn();

    await middleware(makeRequest() as never, response as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns a diagnosable 503 before startup migration instead of running request-time DDL", async () => {
    vi.resetModules();
    const { createIdempotencyMiddleware } = await import("../lib/financial/idempotency.js");
    const middleware = createIdempotencyMiddleware("bank-reconciliation:approve");
    const response = makeResponse();
    const next = vi.fn();

    await middleware(makeRequest("approval-key") as never, response as never, next);

    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "3");
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      error: "IDEMPOTENCY_STORAGE_UNAVAILABLE",
      code: "IDEMPOTENCY_STORAGE_UNAVAILABLE",
      retryable: true,
      message: "Idempotency storage belum tersedia; request tidak dijalankan. Coba lagi.",
    });
    expect(next).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("initializes storage during startup and uses only DML on the keyed request path", async () => {
    vi.resetModules();
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ idempotency_key: "approval-key" }] });

    const {
      createIdempotencyMiddleware,
      runIdempotencyStorageMigration,
    } = await import("../lib/financial/idempotency.js");

    await runIdempotencyStorageMigration();
    expect(mockExecute).toHaveBeenCalledTimes(3);

    const response = makeResponse();
    const next = vi.fn();
    const middleware = createIdempotencyMiddleware("bank-reconciliation:approve");
    await middleware(makeRequest("approval-key") as never, response as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledTimes(4);
    expect(response.status).not.toHaveBeenCalled();
  });

  it("keeps keyed requests fail-closed when startup storage migration fails", async () => {
    vi.resetModules();
    mockExecute.mockRejectedValueOnce(new Error("pool timeout"));

    const {
      createIdempotencyMiddleware,
      runIdempotencyStorageMigration,
    } = await import("../lib/financial/idempotency.js");

    await expect(runIdempotencyStorageMigration()).rejects.toThrow("pool timeout");

    mockExecute.mockClear();
    const response = makeResponse();
    const next = vi.fn();
    const middleware = createIdempotencyMiddleware("bank-reconciliation:approve");
    await middleware(makeRequest("approval-key") as never, response as never, next);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "IDEMPOTENCY_STORAGE_UNAVAILABLE",
      retryable: true,
    }));
    expect(next).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});