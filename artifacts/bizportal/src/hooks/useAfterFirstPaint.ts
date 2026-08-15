import { useEffect, useState } from "react";

/**
 * Marks secondary work as ready only after the first screen has had a chance
 * to paint. This keeps auth, company scope, and the first route ahead of
 * background widgets without leaving them permanently disabled.
 */
export function useAfterFirstPaint(delayMs = 400): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!cancelled) setReady(true);
      }, delayMs);
    };

    const frame = window.requestAnimationFrame(schedule);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [delayMs]);

  return ready;
}