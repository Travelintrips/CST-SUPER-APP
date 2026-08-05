import { useState, useCallback } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Pin, PinOff, ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { COMMANDS, RECENT_KEY, PINNED_KEY, RECENT_TIMES_KEY, readStore } from "@/components/CommandPalette";
import { cn } from "@/lib/utils";

function relativeTime(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "baru saja";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}j lalu`;
  const days = Math.floor(hours / 24);
  return `${days}h lalu`;
}

function readTimes(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(RECENT_TIMES_KEY) ?? "{}"); } catch { return {}; }
}

function writePinned(hrefs: string[]) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify(hrefs)); } catch {}
}

export function RecentPagesWidget() {
  const [recentHrefs, setRecentHrefs] = useState<string[]>(() => readStore(RECENT_KEY));
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>(() => readStore(PINNED_KEY));
  const [times] = useState<Record<string, number>>(readTimes);

  const togglePin = useCallback((href: string) => {
    setPinnedHrefs((prev) => {
      const next = prev.includes(href)
        ? prev.filter((h) => h !== href)
        : [...prev, href];
      writePinned(next);
      return next;
    });
  }, []);

  const removeRecent = useCallback((href: string) => {
    setRecentHrefs((prev) => {
      const next = prev.filter((h) => h !== href);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/10">
            <Clock className="h-3.5 w-3.5 text-indigo-500" />
          </div>
          <CardTitle className="text-sm font-semibold">Recently Opened</CardTitle>
          {recentHrefs.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">{recentHrefs.length} halaman</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {recentHrefs.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-5 w-5 opacity-40" />}
            title="Belum ada riwayat halaman"
            description="Halaman yang kamu buka akan muncul di sini."
            className="py-10 border-dashed"
          />
        ) : (
          <div className="divide-y divide-border/60">
            {recentHrefs.map((href) => {
              const cmd = COMMANDS.find((c) => c.href === href);
              const Icon = cmd?.icon ?? ExternalLink;
              const title = cmd?.title ?? href;
              const module = cmd?.group ?? "BizPortal";
              const isPinned = pinnedHrefs.includes(href);
              const ts = times[href] ?? 0;
              return (
                <div key={href} className="group flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <Link href={href} className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate leading-snug hover:underline">{title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{module}</p>
                  </Link>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70 hidden sm:block">
                    {relativeTime(ts)}
                  </span>
                  <button
                    onClick={() => togglePin(href)}
                    className={cn(
                      "shrink-0 rounded p-1 transition-all hover:bg-muted",
                      isPinned
                        ? "opacity-100 text-primary"
                        : "opacity-0 group-hover:opacity-100 text-muted-foreground",
                    )}
                    title={isPinned ? "Lepas sematan" : "Sematkan halaman"}
                  >
                    {isPinned
                      ? <Pin className="h-3 w-3 fill-primary/30" />
                      : <Pin className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => removeRecent(href)}
                    className="shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted text-muted-foreground"
                    title="Hapus dari riwayat"
                  >
                    <span className="text-[10px] leading-none">✕</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
