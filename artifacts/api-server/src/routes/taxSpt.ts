/**
 * taxSpt.ts — Coretax Submission Layer & SPT Builder API
 *
 * Endpoint:
 *   GET  /api/tax/spt-builder/periods          — list periode + summary
 *   GET  /api/tax/spt-builder/draft             — build draft SPT (real-time)
 *   POST /api/tax/spt-builder/draft/save        — simpan draft ke DB
 *   GET  /api/tax/spt-builder/drafts            — list saved drafts
 *   GET  /api/tax/spt-builder/drafts/:id        — get saved draft detail
 *   PUT  /api/tax/spt-builder/drafts/:id/status — update status draft
 *   DELETE /api/tax/spt-builder/drafts/:id      — delete draft (non-submitted)
 *   GET  /api/tax/spt-builder/export/csv        — export CSV Coretax (PPN/PPh23/PPh21/WHT)
 *   GET  /api/tax/spt-builder/export/xml        — export XML PPN (future-ready)
 *   GET  /api/tax/spt-builder/reconcile         — rekonsiliasi cepat per periode
 */

import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { buildSptDraft, listSptPeriods } from "../lib/taxSptBuilderService.js";
import {
  exportPpnCsv,
  exportPph23Csv,
  exportPph21Csv,
  exportWhtCsv,
  exportPpnXml,
  fetchCompanyProfile,
} from "../lib/taxCoretaxFormatter.js";
import {
  bootMigrateSptDrafts,
  ensureUniqueConstraint,
  saveSptDraft,
  listSptDrafts,
  getSptDraft,
  updateSptDraftStatus,
  deleteSptDraft,
  type SptDraftType,
  type SptDraftStatus,
} from "../lib/taxSptDraftRepository.js";
import { runTaxReconciliation } from "../lib/taxReconciliationService.js";
import { guardTaxPeriodFromRequest } from "../lib/taxPeriodGuard.js";
import { logTaxActivity, extractActorFromReq as extractTaxActor } from "../lib/taxAuditService.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Boot migration ─────────────────────────────────────────────────────────────

let migrated = false;
async function ensureMigrated() {
  if (!migrated) {
    await bootMigrateSptDrafts();
    await ensureUniqueConstraint();
    migrated = true;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getCompanyId(req: Request): number | null {
  const cid = req.query["companyId"] ?? req.body?.companyId;
  const n = parseInt(String(cid ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function currentYear(): string {
  return new Date().getFullYear().toString();
}

// ── GET /company-profile — ambil NPWP & nama perusahaan dari DB ────────────────

router.get("/company-profile", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  try {
    const profile = await fetchCompanyProfile(companyId);
    const npwpMissing = !profile.npwp || profile.npwp === "000000000000000";
    res.json({
      npwp: profile.npwp,
      name: profile.name,
      npwp_missing: npwpMissing,
      npwp_digits: profile.npwp?.replace(/\D/g, "").length ?? 0,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[taxSpt] Gagal ambil company profile");
    res.status(500).json({ error: "Gagal mengambil profil perusahaan" });
  }
});

// ── GET /periods — list SPT periods with summary ───────────────────────────────

router.get("/periods", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const year = String(req.query["year"] ?? currentYear());

  try {
    const periods = await listSptPeriods(companyId, year);
    res.json({ year, periods });
  } catch (err: any) {
    logger.error({ err: err.message }, "[taxSpt] Gagal list periods");
    res.status(500).json({ error: "Gagal mengambil daftar periode SPT" });
  }
});

// ── GET /draft — build draft SPT real-time (tidak disimpan) ────────────────────

router.get("/draft", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const period = String(req.query["period"] ?? "");
  if (!period.match(/^\d{4}-\d{2}$/)) {
    res.status(400).json({ error: "period harus format YYYY-MM" });
    return;
  }

  try {
    const draft = await buildSptDraft(companyId, period);
    res.json(draft);
  } catch (err: any) {
    logger.error({ err: err.message, companyId, period }, "[taxSpt] Build draft gagal");
    res.status(500).json({ error: "Gagal membangun draft SPT" });
  }
});

// ── POST /draft/save — simpan draft ke DB ──────────────────────────────────────

router.post("/draft/save", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  await ensureMigrated();

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const { period, type = "ALL", notes } = req.body ?? {};
  if (!period?.match(/^\d{4}-\d{2}$/)) {
    res.status(400).json({ error: "period harus format YYYY-MM" });
    return;
  }

  const validTypes: SptDraftType[] = ["PPN", "PPh21", "PPh23", "PPh15", "PPh4", "ALL"];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `type harus salah satu dari: ${validTypes.join(", ")}` });
    return;
  }

  // ── FASE 4 C5: Period lock guard ──────────────────────────────────────────
  if (!await guardTaxPeriodFromRequest(companyId, period, res)) return;

  try {
    const draft = await buildSptDraft(companyId, period);
    const id = await saveSptDraft({ companyId, period, type, draft, notes });
    res.json({ id, period, type, message: "Draft SPT berhasil disimpan" });
  } catch (err: any) {
    logger.error({ err: err.message }, "[taxSpt] Simpan draft gagal");
    res.status(500).json({ error: "Gagal menyimpan draft SPT" });
  }
});

// ── GET /drafts — list saved drafts ───────────────────────────────────────────

router.get("/drafts", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  await ensureMigrated();

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const year = String(req.query["year"] ?? "");

  try {
    const drafts = await listSptDrafts(companyId, year || undefined);
    res.json({ drafts });
  } catch (err: any) {
    logger.error({ err: err.message }, "[taxSpt] List drafts gagal");
    res.status(500).json({ error: "Gagal mengambil daftar draft SPT" });
  }
});

// ── GET /drafts/:id — get saved draft detail ──────────────────────────────────

router.get("/drafts/:id", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  await ensureMigrated();

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id tidak valid" }); return; }

  try {
    const draft = await getSptDraft(id, companyId);
    if (!draft) { res.status(404).json({ error: "Draft tidak ditemukan" }); return; }
    res.json(draft);
  } catch (err: any) {
    logger.error({ err: err.message }, "[taxSpt] Get draft gagal");
    res.status(500).json({ error: "Gagal mengambil draft SPT" });
  }
});

// ── PUT /drafts/:id/status — update status draft ──────────────────────────────

router.put("/drafts/:id/status", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  await ensureMigrated();

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id tidak valid" }); return; }

  const { status } = req.body ?? {};
  const validStatuses: SptDraftStatus[] = ["draft", "validated", "exported", "submitted"];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: `status harus: ${validStatuses.join(", ")}` });
    return;
  }

  try {
    // ── FASE 4 C5: Period lock guard — ambil period dari draft ────────────────
    const existingDraft = await getSptDraft(id, companyId);
    if (!existingDraft) { res.status(404).json({ error: "Draft tidak ditemukan" }); return; }
    if (!await guardTaxPeriodFromRequest(companyId, (existingDraft as any).period, res)) return;

    const updated = await updateSptDraftStatus(id, companyId, status);
    if (!updated) { res.status(404).json({ error: "Draft tidak ditemukan" }); return; }
    res.json({ id, status, message: "Status draft diperbarui" });
  } catch (err: any) {
    logger.error({ err: err.message }, "[taxSpt] Update status gagal");
    res.status(500).json({ error: "Gagal memperbarui status draft" });
  }
});

// ── DELETE /drafts/:id ─────────────────────────────────────────────────────────

router.delete("/drafts/:id", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  await ensureMigrated();

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "id tidak valid" }); return; }

  try {
    // ── FASE 4 C5: Period lock guard — ambil period dari draft ────────────────
    const draftToDelete = await getSptDraft(id, companyId);
    if (!draftToDelete) { res.status(404).json({ error: "Draft tidak ditemukan" }); return; }
    if (!await guardTaxPeriodFromRequest(companyId, (draftToDelete as any).period, res)) return;

    const actor = extractTaxActor(req);
    const deleted = await deleteSptDraft(id, companyId);
    if (!deleted) {
      res.status(400).json({ error: "Draft tidak ditemukan atau status sudah submitted" });
      return;
    }

    // ── FASE 4 T009: Audit log DELETE ─────────────────────────────────────────
    logTaxActivity({
      companyId,
      entityType: "tax_spt_draft",
      entityId: id,
      action: "DELETE",
      before: { id, period: (draftToDelete as any).period, status: (draftToDelete as any).status },
      after: null,
      performedBy: actor.performedBy,
      ipAddress: actor.ipAddress,
    }).catch(() => {});

    res.json({ id, message: "Draft SPT dihapus" });
  } catch (err: any) {
    logger.error({ err: err.message }, "[taxSpt] Delete draft gagal");
    res.status(500).json({ error: "Gagal menghapus draft SPT" });
  }
});

// ── GET /export/csv — export CSV Coretax ──────────────────────────────────────

router.get("/export/csv", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const period = String(req.query["period"] ?? "");
  if (!period.match(/^\d{4}-\d{2}$/)) {
    res.status(400).json({ error: "period harus format YYYY-MM" });
    return;
  }

  const taxType = String(req.query["taxType"] ?? "PPN").toUpperCase();
  // npwp & nama bisa override lewat query param, fallback ke DB company profile
  const npwpOverride = String(req.query["npwp"] ?? "");
  const namaOverride = String(req.query["nama"] ?? "");

  // ── FASE 4 C5: Period lock guard ──────────────────────────────────────────
  if (!await guardTaxPeriodFromRequest(companyId, period, res)) return;

  try {
    const [draft, profile] = await Promise.all([
      buildSptDraft(companyId, period),
      fetchCompanyProfile(companyId),
    ]);

    // ── FASE 4 C6: Blok export jika NPWP Perusahaan belum diatur ─────────────
    const effectiveNpwp = npwpOverride || profile.npwp || "";
    if (!effectiveNpwp || effectiveNpwp === "000000000000000") {
      res.status(400).json({
        error: "NPWP Perusahaan belum diatur. Isi NPWP di Company Settings > NPWP sebelum export ke Coretax.",
        code: "NPWP_PERUSAHAAN_MISSING",
      });
      return;
    }

    const opts = {
      npwpPerusahaan: effectiveNpwp,
      namaPerusahaan: namaOverride || profile.name || undefined,
    };

    let result;
    if (taxType === "PPH23" || taxType === "PPH_23" || taxType === "23") {
      result = exportPph23Csv(draft, opts);
    } else if (taxType === "PPH21" || taxType === "PPH_21" || taxType === "21") {
      result = exportPph21Csv(draft, opts);
    } else if (taxType === "WHT" || taxType === "PPH_ALL") {
      result = exportWhtCsv(draft, opts);
    } else {
      result = exportPpnCsv(draft, opts);
    }

    const filename = `SPT-${result.type}-${period}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(result.csv);

    // Update status ke exported jika ada saved draft
    const drafts = await listSptDrafts(companyId, period.slice(0, 4));
    const match = drafts.find((d) => d.period === period);
    if (match && match.status === "validated") {
      await updateSptDraftStatus(match.id, companyId, "exported");
    }

    // ── FASE 4 T009: Audit log SPT export ─────────────────────────────────────
    const exportActor = extractTaxActor(req);
    logTaxActivity({
      companyId,
      entityType: "tax_spt_draft",
      entityId: match?.id ?? period,
      action: "SPT_EXPORT",
      after: { period, taxType, rowCount: result.row_count, totalDpp: result.total_dpp, totalPajak: result.total_pajak },
      performedBy: exportActor.performedBy,
      ipAddress: exportActor.ipAddress,
    }).catch(() => {});
  } catch (err: any) {
    logger.error({ err: err.message, companyId, period }, "[taxSpt] Export CSV gagal");
    res.status(500).json({ error: "Gagal export CSV" });
  }
});

// ── GET /export/xml — export XML PPN (future-ready) ───────────────────────────

router.get("/export/xml", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const period = String(req.query["period"] ?? "");
  if (!period.match(/^\d{4}-\d{2}$/)) {
    res.status(400).json({ error: "period harus format YYYY-MM" });
    return;
  }

  const npwpOverride = String(req.query["npwp"] ?? "");
  const namaOverride = String(req.query["nama"] ?? "");

  try {
    const [draft, profile] = await Promise.all([
      buildSptDraft(companyId, period),
      fetchCompanyProfile(companyId),
    ]);

    // ── FASE 4 C6: Blok export XML jika NPWP Perusahaan belum diatur ──────────
    const effectiveNpwpXml = npwpOverride || profile.npwp || "";
    if (!effectiveNpwpXml || effectiveNpwpXml === "000000000000000") {
      res.status(400).json({
        error: "NPWP Perusahaan belum diatur. Isi NPWP di Company Settings > NPWP sebelum export ke Coretax.",
        code: "NPWP_PERUSAHAAN_MISSING",
      });
      return;
    }

    const xml   = exportPpnXml(draft, {
      npwpPerusahaan: effectiveNpwpXml,
      namaPerusahaan: namaOverride || profile.name || undefined,
    });

    const filename = `SPT-PPN-${period}.xml`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err: any) {
    logger.error({ err: err.message, companyId, period }, "[taxSpt] Export XML gagal");
    res.status(500).json({ error: "Gagal export XML" });
  }
});

// ── GET /reconcile — rekonsiliasi cepat per periode ───────────────────────────

router.get("/reconcile", async (req: Request, res: Response): Promise<void> => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const companyId = getCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId diperlukan" }); return; }

  const period = String(req.query["period"] ?? "");
  if (!period.match(/^\d{4}-\d{2}$/)) {
    res.status(400).json({ error: "period harus format YYYY-MM" });
    return;
  }

  try {
    const result = await runTaxReconciliation(companyId, period);

    // Mapping ke format {status, missing_in_gl, missing_in_tax} yang diminta
    const missingInGl = result.gaps.filter((g) => g.issue === "ORPHANED_TT");
    const missingInTax = result.gaps.filter((g) => g.issue === "ORPHANED_GL");
    const amountMismatches = result.gaps.filter((g) => g.issue.startsWith("AMOUNT_MISMATCH"));

    res.json({
      status: result.is_balanced ? "OK" : "MISMATCH",
      period,
      checked_at: result.checked_at,
      is_balanced: result.is_balanced,
      missing_in_gl: missingInGl,
      missing_in_tax: missingInTax,
      amount_mismatches: amountMismatches,
      summary: result.summary,
      total_gaps: result.gaps.length,
    });
  } catch (err: any) {
    logger.error({ err: err.message, companyId, period }, "[taxSpt] Rekonsiliasi gagal");
    res.status(500).json({ error: "Gagal rekonsiliasi pajak" });
  }
});

export default router;
