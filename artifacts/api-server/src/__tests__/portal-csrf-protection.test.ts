import { afterEach, describe, expect, it, vi } from "vitest";
import { portalCsrfProtection } from "../middlewares/portalCsrfProtection.js";

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    cookies: { sid: "internal-session" },
    headers: {},
    socket: { remoteAddress: "10.0.0.10" },
    ip: "10.0.0.10",
    ...overrides,
  } as any;
}

function response() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as any;
}

describe("portal CSRF origin boundary", () => {
  const originalDeployment = process.env.REPLIT_DEPLOYMENT;
  const originalDevDomain = process.env.REPLIT_DEV_DOMAIN;

  afterEach(() => {
    if (originalDeployment === undefined) delete process.env.REPLIT_DEPLOYMENT;
    else process.env.REPLIT_DEPLOYMENT = originalDeployment;
    if (originalDevDomain === undefined) delete process.env.REPLIT_DEV_DOMAIN;
    else process.env.REPLIT_DEV_DOMAIN = originalDevDomain;
  });

  it("fails closed for cookie mutations with no origin in production", () => {
    process.env.REPLIT_DEPLOYMENT = "1";
    const res = response();
    const next = vi.fn();

    portalCsrfProtection(request(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows an explicitly configured portal origin", () => {
    process.env.REPLIT_DEPLOYMENT = "1";
    const res = response();
    const next = vi.fn();

    portalCsrfProtection(request({
      headers: { origin: "https://bizportal.cstlogistic.co.id" },
    }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not block bearer/public mutations that carry no session cookie", () => {
    process.env.REPLIT_DEPLOYMENT = "1";
    const res = response();
    const next = vi.fn();

    portalCsrfProtection(request({ cookies: {} }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});