import { useState, useEffect, useRef } from "react";

export interface CodeCheckState {
  checking: boolean;
  taken: boolean | null;
}

export function useCodeCheck(
  checkUrl: string | null,
  code: string,
  debounceMs = 400,
): CodeCheckState {
  const [checking, setChecking] = useState(false);
  const [taken, setTaken] = useState<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!checkUrl || !code.trim()) {
      setChecking(false);
      setTaken(null);
      return;
    }

    setChecking(true);
    timerRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(checkUrl, {
          credentials: "include",
          signal: ctrl.signal,
        });
        if (!res.ok) { setTaken(null); return; }
        const data = (await res.json()) as { taken: boolean };
        setTaken(data.taken);
      } catch {
        setTaken(null);
      } finally {
        setChecking(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [checkUrl, code, debounceMs]);

  return { checking, taken };
}
