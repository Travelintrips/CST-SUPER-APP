/**
 * Canonical Posting Engine — composition root (Tahap 3).
 *
 * Modules should import `getPostingEngine()` and call `.post()` instead of
 * writing raw `INSERT INTO accounting_entries` or calling `postEntry()`
 * directly. See docs/canonical-posting-engine/02-design.md.
 */

import { CanonicalPostingEngine } from "./CanonicalPostingEngine.js";

let _engine: CanonicalPostingEngine | null = null;

export function getPostingEngine(): CanonicalPostingEngine {
  if (!_engine) {
    _engine = new CanonicalPostingEngine();
  }
  return _engine;
}

export type { PostingRequest, PostingResult, PostingErrorCode, TaxLine } from "./types.js";
export { PostingValidationError } from "./types.js";
