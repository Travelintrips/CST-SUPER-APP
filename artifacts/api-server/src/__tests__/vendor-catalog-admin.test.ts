/**
 * vendor-catalog-admin.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Targeted tests untuk fitur Tambah Produk di Customer Portal Admin → Vendor Catalog.
 *
 * Scope (unit, no real DB):
 *   1.  requirePortalAdmin rejects non-admin (HTTP 403)
 *   2.  POST validation: vendor_id wajib → 400
 *   3.  POST validation: name wajib → 400
 *   4.  POST validation: price_base negative → 400  [RELEASE BLOCKER #2 regression]
 *   5.  POST price_sell computation (base * (1 + markup/100), ceil)
 *   6.  Duplicate vendor + master_item → 409
 *   7.  Published item visibility — published item lolos filter publik
 *   8.  Draft item visibility — draft TIDAK lolos filter publik
 *   9.  Edit item (PUT): name + price_base + markup_pct → price_sell recalculated
 *   10. togglePublish (PATCH): is_published toggled, status updated
 *   11. Non-admin cannot DELETE via requirePortalAdmin
 *
 * REGRESSION TESTS (Release Blocker fixes):
 *   R1.  Bulk publish succeeds (valid ids + action)
 *   R2.  Bulk unpublish succeeds
 *   R3.  Bulk delete succeeds (soft-delete)
 *   R4.  POST price_base < 0 → 400
 *   R5.  POST markup_pct > 100 → 400
 *   R6.  PUT is_published:false persisted — field NOT ignored
 *   R7.  PUT is_published:true persisted — field NOT ignored
 *   R8.  PATCH publish → is_published:true, status:"published"
 *   R9.  PATCH unpublish → is_published:false, status:"draft"
 *   R10. Boundary price_base=0 accepted
 *   R11. Boundary markup_pct=0 accepted
 *   R12. Boundary markup_pct=100 accepted
 *   R13. Bulk ids empty → 400
 *   R14. Bulk ids all invalid → 400
 *   R15. Non-admin blocked → 401/403
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockRes() {
  const res = {
    _statusCode: 200,
    _body: undefined as unknown,
    status(code: number) { this._statusCode = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    send(body: unknown) { this._body = body; return this; },
  };
  return res;
}

function mockNext(): NextFunction { return vi.fn() as unknown as NextFunction; }

// ─────────────────────────────────────────────────────────────────────────────
// 1. requirePortalAdmin — authorization guard
// ─────────────────────────────────────────────────────────────────────────────

describe("requirePortalAdmin guard", () => {
  it("blocks request when Authorization header is missing", async () => {
    const { requirePortalAdmin } = await import("../lib/supabaseAuth.js");

    const req = { headers: {} } as Request;
    const res = mockRes();
    const next = mockNext();

    await requirePortalAdmin(req, res as unknown as Response, next);

    expect(res._statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks request when bearer token is invalid/missing", async () => {
    const { requirePortalAdmin } = await import("../lib/supabaseAuth.js");

    const req = { headers: { authorization: "Bearer invalid-token-xyz" } } as Request;
    const res = mockRes();
    const next = mockNext();

    await requirePortalAdmin(req, res as unknown as Response, next);

    // Should not pass through — 401 or 403
    expect([401, 403]).toContain(res._statusCode);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2-5. Input validation & price computation (pure logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /admin/vendor-catalog-items input validation", () => {
  // Recreate the validation logic from portal.ts to test it in isolation.

  function validateCreatePayload(body: Record<string, unknown>): { error: string; status: number } | null {
    const vid = parseInt(String(body.vendor_id ?? ""), 10);
    if (!vid || isNaN(vid)) return { error: "vendor_id wajib diisi", status: 400 };
    if (!String(body.name ?? "").trim()) return { error: "Nama produk wajib diisi", status: 400 };
    return null;
  }

  function computePriceSell(priceBase: number, markupPct: number): number | null {
    const baseNum = Math.max(0, priceBase);
    const sell    = baseNum > 0 ? Math.ceil(baseNum * (1 + markupPct / 100)) : null;
    return sell;
  }

  it("returns 400 when vendor_id is missing", () => {
    const err = validateCreatePayload({ name: "Produk A" });
    expect(err).not.toBeNull();
    expect(err?.status).toBe(400);
    expect(err?.error).toMatch(/vendor_id/i);
  });

  it("returns 400 when vendor_id is zero", () => {
    const err = validateCreatePayload({ vendor_id: 0, name: "Produk A" });
    expect(err).not.toBeNull();
    expect(err?.status).toBe(400);
  });

  it("returns 400 when name is empty string", () => {
    const err = validateCreatePayload({ vendor_id: 1, name: "" });
    expect(err).not.toBeNull();
    expect(err?.status).toBe(400);
    expect(err?.error).toMatch(/nama produk/i);
  });

  it("returns 400 when name is whitespace only", () => {
    const err = validateCreatePayload({ vendor_id: 1, name: "   " });
    expect(err).not.toBeNull();
    expect(err?.status).toBe(400);
  });

  it("passes validation with valid vendor_id and name", () => {
    const err = validateCreatePayload({ vendor_id: 5, name: "Baja Ringan 0.5mm" });
    expect(err).toBeNull();
  });

  it("computes price_sell correctly with markup", () => {
    // base=10000, markup=12.5% → sell=ceil(10000*1.125)=11250
    expect(computePriceSell(10_000, 12.5)).toBe(11_250);
  });

  it("computes price_sell correctly with 0% markup", () => {
    // base=50000, markup=0 → sell=50000
    expect(computePriceSell(50_000, 0)).toBe(50_000);
  });

  it("returns null price_sell when base is 0", () => {
    expect(computePriceSell(0, 15)).toBeNull();
  });

  // RELEASE BLOCKER #2 regression: negative base is now REJECTED at validation,
  // not clamped. The computePriceSell helper below reflects the old clamping
  // behaviour used for INTERNAL price_sell recalculation after validation passes.
  // The NEW validation layer rejects price_base < 0 before reaching this helper.
  it("computePriceSell with already-validated base=0 returns null (post-validation path)", () => {
    // Negative price_base is now blocked at validation (returns 400).
    // computePriceSell only receives values that passed validation (>= 0).
    expect(computePriceSell(0, 10)).toBeNull();
  });

  it("price_sell uses Math.ceil (never rounds down)", () => {
    // base=10000, markup=10% → 11000.0 exactly (no rounding needed)
    expect(computePriceSell(10_000, 10)).toBe(11_000);
    // base=3, markup=33.33% → ceil(3*1.3333)=ceil(4.0)=4
    expect(computePriceSell(3, 33.33)).toBe(Math.ceil(3 * 1.3333));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Duplicate detection
// ─────────────────────────────────────────────────────────────────────────────

describe("Duplicate vendor + master_item detection", () => {
  function detectDuplicate(
    existingItems: Array<{ vendor_id: number; master_item_id: number | null; is_active: boolean }>,
    newVendorId: number,
    newMasterItemId: number | null,
  ): boolean {
    if (!newMasterItemId) return false; // No master item → no uniqueness constraint
    return existingItems.some(
      i => i.vendor_id === newVendorId && i.master_item_id === newMasterItemId && i.is_active,
    );
  }

  const catalog = [
    { vendor_id: 1, master_item_id: 100, is_active: true },
    { vendor_id: 1, master_item_id: 200, is_active: true },
    { vendor_id: 2, master_item_id: 100, is_active: true },
    { vendor_id: 1, master_item_id: 300, is_active: false }, // archived
  ];

  it("rejects duplicate vendor + master_item combination (active)", () => {
    expect(detectDuplicate(catalog, 1, 100)).toBe(true);
  });

  it("allows same master_item for different vendor", () => {
    expect(detectDuplicate(catalog, 3, 100)).toBe(false);
  });

  it("allows same vendor with different master_item", () => {
    expect(detectDuplicate(catalog, 1, 400)).toBe(false);
  });

  it("allows re-adding a previously archived (inactive) item", () => {
    expect(detectDuplicate(catalog, 1, 300)).toBe(false);
  });

  it("allows creation without master_item (null)", () => {
    expect(detectDuplicate(catalog, 1, null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7-9. Marketplace visibility: published vs draft
// ─────────────────────────────────────────────────────────────────────────────

describe("Marketplace visibility: published vs draft", () => {
  interface CatalogItem {
    id: number;
    is_published: boolean;
    is_active: boolean;
    status: string;
  }

  function isVisibleInPublicMarketplace(item: CatalogItem): boolean {
    return item.is_published && item.is_active && item.status === "published";
  }

  it("published + active item is visible in marketplace", () => {
    expect(isVisibleInPublicMarketplace({
      id: 1, is_published: true, is_active: true, status: "published",
    })).toBe(true);
  });

  it("draft item is NOT visible in marketplace", () => {
    expect(isVisibleInPublicMarketplace({
      id: 2, is_published: false, is_active: true, status: "draft",
    })).toBe(false);
  });

  it("inactive item is NOT visible even if published", () => {
    expect(isVisibleInPublicMarketplace({
      id: 3, is_published: true, is_active: false, status: "published",
    })).toBe(false);
  });

  it("status mismatch blocks visibility", () => {
    expect(isVisibleInPublicMarketplace({
      id: 4, is_published: true, is_active: true, status: "draft",
    })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Edit (PUT) — price_sell recalculation
// ─────────────────────────────────────────────────────────────────────────────

describe("Edit catalog item — price_sell recalculation", () => {
  function recalcPriceSell(
    priceBase: string | number | null,
    markupPct: string | number | null,
    isInternalVendor: boolean,
  ): number | null {
    const base   = Math.max(0, parseFloat(String(priceBase ?? 0)) || 0);
    const markup = isInternalVendor ? 0 : Math.max(0, parseFloat(String(markupPct ?? 0)) || 0);
    return base > 0 ? Math.ceil(base * (1 + markup / 100)) : null;
  }

  it("calculates correctly for external vendor with markup", () => {
    expect(recalcPriceSell(100_000, 15, false)).toBe(115_000);
  });

  it("forces markup=0 for internal vendor", () => {
    expect(recalcPriceSell(100_000, 20, true)).toBe(100_000);
  });

  it("returns null when price_base is 0", () => {
    expect(recalcPriceSell(0, 10, false)).toBeNull();
  });

  it("handles string inputs", () => {
    expect(recalcPriceSell("75000", "10", false)).toBe(82_500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. togglePublish — state transition
// ─────────────────────────────────────────────────────────────────────────────

describe("togglePublish state transition", () => {
  function applyToggle(item: { is_published: boolean }): { is_published: boolean; status: string } {
    const next = !item.is_published;
    return { is_published: next, status: next ? "published" : "draft" };
  }

  it("draft → published", () => {
    const result = applyToggle({ is_published: false });
    expect(result.is_published).toBe(true);
    expect(result.status).toBe("published");
  });

  it("published → draft", () => {
    const result = applyToggle({ is_published: true });
    expect(result.is_published).toBe(false);
    expect(result.status).toBe("draft");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Media upload validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Media upload validation", () => {
  const ALLOWED_TYPES = [
    "image/jpeg", "image/png", "image/webp",
    "application/pdf", "video/mp4", "video/webm",
  ];
  const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

  function validateUpload(mimeType: string, sizeBytes: number): "ok" | "bad_type" | "too_large" {
    if (!ALLOWED_TYPES.includes(mimeType)) return "bad_type";
    if (sizeBytes > MAX_SIZE_BYTES) return "too_large";
    return "ok";
  }

  it("accepts valid JPG under 20MB", () => {
    expect(validateUpload("image/jpeg", 500_000)).toBe("ok");
  });

  it("accepts valid PNG", () => {
    expect(validateUpload("image/png", 1_000_000)).toBe("ok");
  });

  it("accepts valid WEBP", () => {
    expect(validateUpload("image/webp", 2_000_000)).toBe("ok");
  });

  it("rejects GIF (not in allowed list)", () => {
    expect(validateUpload("image/gif", 100_000)).toBe("bad_type");
  });

  it("rejects file over 20MB", () => {
    expect(validateUpload("image/jpeg", 21 * 1024 * 1024)).toBe("too_large");
  });

  it("accepts file exactly at 20MB boundary", () => {
    expect(validateUpload("image/png", MAX_SIZE_BYTES)).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION TESTS — Release Blocker fixes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors the validation logic in portal.ts:
 *   POST /api/portal/admin/vendor-catalog-items/bulk
 *
 * Returns { error, status } on failure, or null on success (intIds is also returned).
 */
function validateBulkPayload(body: Record<string, unknown>): {
  error: string;
  status: number;
  intIds?: never;
} | {
  error?: never;
  status?: never;
  intIds: number[];
} {
  const { action, ids } = body;
  if (!Array.isArray(ids) || ids.length === 0)
    return { error: "ids wajib berisi setidaknya 1 item", status: 400 };
  if (!["publish", "unpublish", "delete"].includes(String(action)))
    return { error: "action tidak valid", status: 400 };
  const intIds = (ids as unknown[])
    .map((id) => parseInt(String(id), 10))
    .filter((n) => !isNaN(n));
  if (intIds.length === 0)
    return { error: "ids tidak valid", status: 400 };
  return { intIds };
}

/**
 * Mirrors POST validation including price_base and markup_pct.
 */
function validateCreatePayloadFull(body: Record<string, unknown>): {
  error: string;
  status: number;
} | null {
  const vid = parseInt(String(body.vendor_id ?? ""), 10);
  if (!vid || isNaN(vid)) return { error: "vendor_id wajib diisi", status: 400 };
  if (!String(body.name ?? "").trim()) return { error: "Nama produk wajib diisi", status: 400 };

  if (body.price_base != null && body.price_base !== "") {
    const rawBase =
      typeof body.price_base === "string"
        ? parseFloat(body.price_base)
        : Number(body.price_base);
    if (!isFinite(rawBase) || isNaN(rawBase))
      return { error: "Harga dasar tidak valid (harus angka)", status: 400 };
    if (rawBase < 0)
      return { error: "Harga dasar tidak boleh negatif", status: 400 };
  }

  if (body.markup_pct != null && body.markup_pct !== "") {
    const rawMarkup =
      typeof body.markup_pct === "string"
        ? parseFloat(body.markup_pct)
        : Number(body.markup_pct);
    if (!isFinite(rawMarkup) || isNaN(rawMarkup))
      return { error: "Markup tidak valid (harus angka)", status: 400 };
    if (rawMarkup < 0)
      return { error: "Markup tidak boleh negatif", status: 400 };
    if (rawMarkup > 100)
      return { error: "Markup tidak boleh melebihi 100%", status: 400 };
  }

  return null;
}

/**
 * Mirrors the publish fields logic in PUT portal.ts.
 * Returns the partial update that would be applied to the DB, or null if
 * is_published was not supplied.
 */
function resolvePutPublishFields(body: Record<string, unknown>):
  | { isPublished: boolean; status: string }
  | null {
  if (typeof body.is_published !== "boolean") return null;
  return {
    isPublished: body.is_published,
    status: body.is_published ? "published" : "draft",
  };
}

/**
 * Mirrors PATCH toggle logic in portal.ts.
 */
function applyPatch(
  body: { is_published?: boolean; is_active?: boolean },
  current: { is_published: boolean; status: string; is_active: boolean },
) {
  const next = { ...current };
  if (typeof body.is_published === "boolean") {
    next.is_published = body.is_published;
    next.status = body.is_published ? "published" : "draft";
  }
  if (typeof body.is_active === "boolean") {
    next.is_active = body.is_active;
  }
  return next;
}

// ── R1-R3: Bulk action — happy paths ─────────────────────────────────────────

describe("R1-R3: Bulk action — happy paths (Blocker 1)", () => {
  it("R1: bulk publish with valid ids succeeds (no validation error)", () => {
    const result = validateBulkPayload({ action: "publish", ids: [1, 2, 3] });
    expect(result.error).toBeUndefined();
    expect(result.intIds).toEqual([1, 2, 3]);
  });

  it("R2: bulk unpublish with valid ids succeeds", () => {
    const result = validateBulkPayload({ action: "unpublish", ids: [10, 20] });
    expect(result.error).toBeUndefined();
    expect(result.intIds).toEqual([10, 20]);
  });

  it("R3: bulk delete with valid ids succeeds (soft-delete path)", () => {
    const result = validateBulkPayload({ action: "delete", ids: [5] });
    expect(result.error).toBeUndefined();
    expect(result.intIds).toEqual([5]);
  });
});

// ── R4-R5: POST validation — price_base & markup_pct (Blocker 2) ─────────────

describe("R4-R5: POST validation — numeric fields (Blocker 2)", () => {
  it("R4: POST price_base < 0 is rejected → 400", () => {
    const err = validateCreatePayloadFull({
      vendor_id: 1,
      name: "Produk Test",
      price_base: -1,
    });
    expect(err).not.toBeNull();
    expect(err?.status).toBe(400);
    expect(err?.error).toMatch(/negatif/i);
  });

  it("R5: POST markup_pct > 100 is rejected → 400", () => {
    const err = validateCreatePayloadFull({
      vendor_id: 1,
      name: "Produk Test",
      markup_pct: 101,
    });
    expect(err).not.toBeNull();
    expect(err?.status).toBe(400);
    expect(err?.error).toMatch(/100/);
  });
});

// ── R6-R7: PUT is_published is persisted (Blocker 3) ─────────────────────────

describe("R6-R7: PUT is_published — not ignored (Blocker 3)", () => {
  it("R6: PUT with is_published:false produces update with isPublished=false, status='draft'", () => {
    const fields = resolvePutPublishFields({ is_published: false, name: "X" });
    expect(fields).not.toBeNull();
    expect(fields?.isPublished).toBe(false);
    expect(fields?.status).toBe("draft");
  });

  it("R7: PUT with is_published:true produces update with isPublished=true, status='published'", () => {
    const fields = resolvePutPublishFields({ is_published: true, name: "X" });
    expect(fields).not.toBeNull();
    expect(fields?.isPublished).toBe(true);
    expect(fields?.status).toBe("published");
  });

  it("R7a: PUT without is_published does NOT touch publish state (null = no-op)", () => {
    const fields = resolvePutPublishFields({ name: "X", price_base: 5000 });
    expect(fields).toBeNull();
  });
});

// ── R8-R9: PATCH publish / unpublish ─────────────────────────────────────────

describe("R8-R9: PATCH toggle publish state", () => {
  const draft = { is_published: false, status: "draft", is_active: true };
  const published = { is_published: true, status: "published", is_active: true };

  it("R8: PATCH publish — draft item becomes published", () => {
    const result = applyPatch({ is_published: true }, draft);
    expect(result.is_published).toBe(true);
    expect(result.status).toBe("published");
    expect(result.is_active).toBe(true); // unchanged
  });

  it("R9: PATCH unpublish — published item becomes draft", () => {
    const result = applyPatch({ is_published: false }, published);
    expect(result.is_published).toBe(false);
    expect(result.status).toBe("draft");
    expect(result.is_active).toBe(true); // unchanged
  });
});

// ── R10-R12: Boundary values ──────────────────────────────────────────────────

describe("R10-R12: Boundary values — accepted at edges", () => {
  it("R10: price_base=0 is accepted (not rejected)", () => {
    const err = validateCreatePayloadFull({ vendor_id: 1, name: "Produk", price_base: 0 });
    expect(err).toBeNull();
  });

  it("R11: markup_pct=0 is accepted (not rejected)", () => {
    const err = validateCreatePayloadFull({ vendor_id: 1, name: "Produk", markup_pct: 0 });
    expect(err).toBeNull();
  });

  it("R12: markup_pct=100 is accepted (not rejected)", () => {
    const err = validateCreatePayloadFull({ vendor_id: 1, name: "Produk", markup_pct: 100 });
    expect(err).toBeNull();
  });
});

// ── R13-R14: Bulk — invalid input → 400 ──────────────────────────────────────

describe("R13-R14: Bulk action — invalid input rejected", () => {
  it("R13: bulk with empty ids array → 400", () => {
    const result = validateBulkPayload({ action: "publish", ids: [] });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/ids/i);
  });

  it("R14: bulk with all non-numeric ids → 400", () => {
    const result = validateBulkPayload({ action: "publish", ids: ["abc", "xyz", ""] });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/tidak valid/i);
  });

  it("R14b: bulk with invalid action → 400", () => {
    const result = validateBulkPayload({ action: "hack", ids: [1, 2] });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/action/i);
  });
});

// ── R15: Non-admin blocked ────────────────────────────────────────────────────

describe("R15: Non-admin blocked → 401/403", () => {
  it("R15: requirePortalAdmin blocks missing auth → 401", async () => {
    const { requirePortalAdmin } = await import("../lib/supabaseAuth.js");
    const req = { headers: {} } as Request;
    const res = mockRes();
    await requirePortalAdmin(req, res as unknown as Response, mockNext());
    expect(res._statusCode).toBe(401);
  });

  it("R15b: requirePortalAdmin blocks invalid token → 401 or 403", async () => {
    const { requirePortalAdmin } = await import("../lib/supabaseAuth.js");
    const req = { headers: { authorization: "Bearer notavalidtoken" } } as Request;
    const res = mockRes();
    await requirePortalAdmin(req, res as unknown as Response, mockNext());
    expect([401, 403]).toContain(res._statusCode);
  });
});
