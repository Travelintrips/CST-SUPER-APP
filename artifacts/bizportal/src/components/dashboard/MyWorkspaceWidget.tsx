import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, Clock, Pin, ExternalLink, LayoutGrid } from "lucide-react";
import { COMMANDS, RECENT_KEY, PINNED_KEY, RECENT_TIMES_KEY, readStore } from "@/components/CommandPalette";
import { useFavorites } from "@/hooks/useFavorites";

function relativeTime(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins}m lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}j lalu`;
  return `${Math.floor(hours / 24)}h lalu`;
}

interface MiniItemProps {
  href: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  meta?: string;
}

function MiniItem({ href, title, icon: Icon, meta }: MiniItemProps) {
  return (
    <Link href={href}>
      <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-accent/60 cursor-pointer">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 min-w-0 text-xs font-medium text-foreground truncate">{title}</span>
        {meta && <span className="shrink-0 text-[10px] text-muted-foreground/60 hidden sm:block">{meta}</span>}
      </div>
    </Link>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
  emptyText: string;
}

function WorkspaceSection({ icon, title, count, children, emptyText }: SectionProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 pb-1 border-b border-border/60 mb-1">
        {icon}
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {count > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
        )}
      </div>
      {count === 0 ? (
        <p className="text-[11px] text-muted-foreground/60 py-2 italic">{emptyText}</p>
      ) : (
        children
      )}
    </div>
  );
}

export function MyWorkspaceWidget() {
  const { favorites } = useFavorites();
  const [pinnedHrefs] = useState<string[]>(() => readStore(PINNED_KEY));
  const [recentHrefs] = useState<string[]>(() => readStore(RECENT_KEY));
  const [times] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_TIMES_KEY) ?? "{}"); } catch { return {}; }
  });

  const favItems = favorites.slice(0, 6);
  const pinnedItems = pinnedHrefs.slice(0, 6);
  const recentItems = recentHrefs.filter((h) => !pinnedHrefs.includes(h)).slice(0, 6);

  function resolve(href: string) {
    const cmd = COMMANDS.find((c) => c.href === href);
    return {
      title: cmd?.title ?? href,
      icon: cmd?.icon ?? ExternalLink,
    };
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-500/10">
            <LayoutGrid className="h-3.5 w-3.5 text-purple-500" />
          </div>
          <CardTitle className="text-sm font-semibold">My Workspace</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          <WorkspaceSection
            icon={<Star className="h-3.5 w-3.5 text-amber-500" />}
            title="Favorit"
            count={favItems.length}
            emptyText="Tandai halaman dengan bintang."
          >
            {favItems.map((href) => {
              const { title, icon } = resolve(href);
              return <MiniItem key={href} href={href} title={title} icon={icon} />;
            })}
          </WorkspaceSection>

          <WorkspaceSection
            icon={<Clock className="h-3.5 w-3.5 text-indigo-500" />}
            title="Terakhir Dibuka"
            count={recentItems.length}
            emptyText="Belum ada riwayat."
          >
            {recentItems.map((href) => {
              const { title, icon } = resolve(href);
              return (
                <MiniItem
                  key={href}
                  href={href}
                  title={title}
                  icon={icon}
                  meta={relativeTime(times[href] ?? 0)}
                />
              );
            })}
          </WorkspaceSection>

          <WorkspaceSection
            icon={<Pin className="h-3.5 w-3.5 text-primary fill-primary/30" />}
            title="Disematkan"
            count={pinnedItems.length}
            emptyText="Sematkan halaman dari riwayat."
          >
            {pinnedItems.map((href) => {
              const { title, icon } = resolve(href);
              return <MiniItem key={href} href={href} title={title} icon={icon} />;
            })}
          </WorkspaceSection>
        </div>
      </CardContent>
    </Card>
  );
}
