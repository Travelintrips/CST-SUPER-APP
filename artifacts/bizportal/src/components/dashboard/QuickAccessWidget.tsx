import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { COMMANDS } from "@/components/CommandPalette";
import { useFavorites } from "@/hooks/useFavorites";
import { cn } from "@/lib/utils";

const FAV_LIMIT = 8;

export function QuickAccessWidget() {
  const { favorites, toggleFavorite } = useFavorites();

  const shown = favorites.slice(0, FAV_LIMIT);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10">
            <Star className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <CardTitle className="text-sm font-semibold">Quick Access</CardTitle>
          {favorites.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">{favorites.length} favorit</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <EmptyState
            icon={<Star className="h-5 w-5 opacity-40" />}
            title="Belum ada halaman favorit"
            description="Tandai halaman dengan bintang untuk akses cepat di sini."
            className="py-10 border-dashed"
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {shown.map((href) => {
              const cmd = COMMANDS.find((c) => c.href === href);
              const Icon = cmd?.icon ?? ExternalLink;
              const title = cmd?.title ?? href;
              const module = cmd?.group ?? "BizPortal";
              return (
                <Link key={href} href={href}>
                  <div
                    className={cn(
                      "group relative flex flex-col gap-1.5 rounded-xl border border-border/60 bg-card p-3 cursor-pointer",
                      "transition-all hover:border-primary/40 hover:bg-accent/50 hover:shadow-sm",
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(href); }}
                        className="mt-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted"
                        title="Hapus dari favorit"
                      >
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      </button>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground leading-tight truncate">{title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{module}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
