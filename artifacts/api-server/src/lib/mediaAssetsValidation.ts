/**
 * Shared validation for vendor_catalog_items.media_assets JSONB payloads.
 *
 * Connects the free-form media_assets gallery (photos/videos/PDFs) to the
 * standard document-type checklist stored in vendor_catalog_items.documents
 * (key/label pairs backed by product_document_types, e.g. coo/phyto/invoice/
 * packing_list). An asset may optionally carry a `documentKey` that must
 * match one of documents[].key — this is what lets a PDF upload "fill in"
 * one of the standard document slots instead of only appearing as a
 * generic extra attachment.
 */

const DOC_TYPES = new Set(["pdf", "document", "certificate", "brochure"]);
const VALID_VISIBILITY = new Set(["public", "private", "internal"]);

export type MediaAssetValidationResult =
  | { ok: true; clean: Array<Record<string, unknown>> }
  | { ok: false; message: string };

function extractDocumentKeys(documents: unknown): Set<string> {
  const keys = new Set<string>();
  if (Array.isArray(documents)) {
    for (const d of documents as Array<Record<string, unknown>>) {
      if (d && typeof d === "object" && typeof d.key === "string" && d.key.trim()) {
        keys.add(d.key.trim());
      }
    }
  }
  return keys;
}

/**
 * Validates and normalizes a proposed media_assets array before it is
 * persisted. `documents` is the item's current vendor_catalog_items.documents
 * value (used to validate documentKey references).
 */
export function validateMediaAssetsPayload(
  mediaAssets: unknown[],
  documents: unknown,
): MediaAssetValidationResult {
  const validKeys = extractDocumentKeys(documents);

  const items = (mediaAssets as unknown[])
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null && typeof (a as any).url === "string");

  for (const a of items) {
    if (a.visibility != null && !VALID_VISIBILITY.has(String(a.visibility))) {
      return { ok: false, message: `visibility tidak valid: ${String(a.visibility)}` };
    }
    if (a.documentKey != null) {
      const key = String(a.documentKey).trim();
      if (!key) continue;
      const type = String(a.type ?? "");
      if (!DOC_TYPES.has(type)) {
        return { ok: false, message: `documentKey hanya boleh dipasang pada dokumen (pdf/document/certificate/brochure), bukan tipe "${type}"` };
      }
      if (a.mimeType != null && a.mimeType !== "application/pdf" && !DOC_TYPES.has(type)) {
        return { ok: false, message: `Tipe file tidak diizinkan untuk dokumen standar: ${String(a.mimeType)}` };
      }
      if (!validKeys.has(key)) {
        // documentKey references a slot that no longer exists in this item's
        // documents array (e.g. the slot was removed after the file was
        // uploaded). Strip the orphaned key so the file becomes a generic
        // attachment rather than blocking the whole save.
        delete a.documentKey;
      }
    }
  }

  // Enforce one active file per documentKey — replace, not duplicate.
  // If the same documentKey appears more than once, keep only the last one
  // (the most recently added/replaced), matching "upload ulang = replace".
  const lastIndexForKey = new Map<string, number>();
  items.forEach((a, i) => {
    const key = a.documentKey != null ? String(a.documentKey).trim() : "";
    if (key) lastIndexForKey.set(key, i);
  });

  const deduped = items.filter((a, i) => {
    const key = a.documentKey != null ? String(a.documentKey).trim() : "";
    if (!key) return true;
    return lastIndexForKey.get(key) === i;
  });

  const clean = deduped.map((a, i) => ({
    ...a,
    sortOrder: typeof a.sortOrder === "number" ? a.sortOrder : i,
  }));

  return { ok: true, clean };
}
