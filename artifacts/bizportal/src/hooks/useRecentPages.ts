import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export interface RecentPage {
  href: string;
  title: string;
  ts: number;
}

const RECENTS_KEY = "bizportal_recents_v1";
const MAX = 10;

function load(): RecentPage[] {
  try {
    const s = localStorage.getItem(RECENTS_KEY);
    if (s) return JSON.parse(s) as RecentPage[];
  } catch {}
  return [];
}

function save(pages: RecentPage[]) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(pages)); } catch {}
}

export function useRecentPages() {
  const [recents, setRecents] = useState<RecentPage[]>(load);
  const [location] = useLocation();

  const addRecent = (href: string, title: string) => {
    setRecents(prev => {
      const filtered = prev.filter(p => p.href !== href);
      const next = [{ href, title, ts: Date.now() }, ...filtered].slice(0, MAX);
      save(next);
      return next;
    });
  };

  return { recents, addRecent, location };
}
