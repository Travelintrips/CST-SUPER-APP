const CHUNK_RELOAD_KEY = "bizportal:chunk-reload-path";

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk \S+ failed|chunkloaderror)/i.test(
    message,
  );
}

export function installChunkLoadRecovery(): () => void {
  const clearRecoveryMarker = () => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  };

  const handlePreloadError = (event: Event) => {
    event.preventDefault();

    try {
      const path = window.location.pathname;
      if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === path) return;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, path);
    } catch {
      // A reload is still the safest recovery when storage is unavailable.
    }

    window.location.reload();
  };

  window.addEventListener("vite:preloadError", handlePreloadError);
  const markerTimer = window.setTimeout(clearRecoveryMarker, 10_000);

  return () => {
    window.removeEventListener("vite:preloadError", handlePreloadError);
    window.clearTimeout(markerTimer);
  };
}
