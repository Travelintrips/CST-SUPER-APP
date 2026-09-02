import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "@/lib/chunkLoadRecovery";

describe("chunk load recovery", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://example.com/assets/page-old.js",
    "Error loading dynamically imported module",
    "Loading chunk 42 failed",
    "ChunkLoadError",
  ])("recognizes stale deployment chunk errors: %s", (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it("does not classify ordinary application errors as stale chunks", () => {
    expect(isChunkLoadError(new Error("Request failed with status 500"))).toBe(false);
  });
});