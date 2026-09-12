import { useState, useCallback, useEffect } from "react";

export const PINNED_KEY = "bizportal:pinned-pages";

const LEGACY_KEYS = ["bizportal_pins_v1", "bizportal_fav_v1"];

const CHANGE_EVENT = "bizportal:pins-changed";

function read(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function write(pins: string[]) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(pins));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: pins }));
  } catch {}
}

function migrate(): string[] {
  const canonical = read();
  const merged = [...canonical];

  for (const legacyKey of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(legacyKey);
      if (!raw) continue;
      const old = JSON.parse(raw) as string[];
      for (const href of old) {
        if (!merged.includes(href)) merged.push(href);
      }
      localStorage.removeItem(legacyKey);
    } catch {}
  }

  if (merged.length !== canonical.length || merged.some((h, i) => h !== canonical[i])) {
    write(merged);
  }

  return merged;
}

export function usePinnedPages() {
  const [pins, setPinsState] = useState<string[]>(() => migrate());

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string[]>).detail;
      setPinsState(detail ?? read());
    };

    const storageHandler = (e: StorageEvent) => {
      if (e.key === PINNED_KEY) {
        setPinsState(read());
      }
    };

    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);

  const setPins = useCallback((next: string[]) => {
    const deduped = [...new Set(next)];
    write(deduped);
    setPinsState(deduped);
  }, []);

  const isPinned = useCallback(
    (href: string) => pins.includes(href),
    [pins],
  );

  const togglePin = useCallback((href: string) => {
    setPinsState((prev) => {
      const next = prev.includes(href)
        ? prev.filter((h) => h !== href)
        : [...new Set([...prev, href])];
      write(next);
      return next;
    });
  }, []);

  const addPin = useCallback((href: string) => {
    setPinsState((prev) => {
      if (prev.includes(href)) return prev;
      const next = [...prev, href];
      write(next);
      return next;
    });
  }, []);

  const removePin = useCallback((href: string) => {
    setPinsState((prev) => {
      const next = prev.filter((h) => h !== href);
      write(next);
      return next;
    });
  }, []);

  return { pins, isPinned, togglePin, addPin, removePin, setPins };
}
