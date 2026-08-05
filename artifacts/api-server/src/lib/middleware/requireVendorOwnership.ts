/**
 * requireVendorOwnership — Express middleware untuk memastikan vendor portal
 * hanya bisa mengakses resource miliknya sendiri.
 *
 * Chain SETELAH requirePortalAuth + requireActiveVendor.
 *
 * Cara kerja:
 *   1. Ambil portalCustomerId dari session (diisi oleh requirePortalAuth)
 *   2. Lookup vendor_profiles.supplier_id via FK (bukan heuristik email/phone)
 *   3. Bandingkan dengan req.params[paramName]
 *   4. Jika tidak cocok → HTTP 403
 *
 * @param paramName — nama URL param yang berisi supplierId (default: "supplierId")
 */

import type { Request, Response, NextFunction } from "express";
import { db, vendorProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { PortalAuthReq } from "../supabaseAuth.js";

export function requireVendorOwnership(paramName = "supplierId") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const customerId = (req as PortalAuthReq).portalCustomerId;
    if (!customerId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const paramRaw = req.params[paramName];
    const resourceSupplierId = parseInt(String(paramRaw ?? ""));
    if (isNaN(resourceSupplierId)) {
      res.status(400).json({ message: `Parameter ${paramName} tidak valid` });
      return;
    }

    try {
      // FK lookup — tidak pakai email/phone matching
      const [vp] = await db
        .select({ supplierId: vendorProfilesTable.supplierId })
        .from(vendorProfilesTable)
        .where(eq(vendorProfilesTable.customerId, customerId))
        .limit(1);

      const ownedSupplierId = vp?.supplierId ?? null;

      if (!ownedSupplierId || ownedSupplierId !== resourceSupplierId) {
        res.status(403).json({
          message: "Akses ditolak: resource ini bukan milik Anda",
        });
        return;
      }

      next();
    } catch {
      res.status(500).json({ message: "Gagal memverifikasi kepemilikan resource" });
    }
  };
}
