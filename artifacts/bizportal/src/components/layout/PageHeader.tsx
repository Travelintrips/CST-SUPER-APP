import { ReactNode } from "react";
import { useLocation } from "wouter";
import { Pin, ChevronRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePinnedPages } from "@/hooks/usePinnedPages";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode;
  favoriteEnabled?: boolean;
  className?: string;
  onBack?: () => void;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  favoriteEnabled = false,
  className,
  onBack,
}: PageHeaderProps) {
  const [location, navigate] = useLocation();
  const { isPinned, togglePin } = usePinnedPages();

  const pinned = favoriteEnabled ? isPinned(location) : false;

  return (
    <div className={cn("mb-6", className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={11} className="text-muted-foreground/40" />}
              {crumb.href ? (
                <button
                  onClick={() => navigate(crumb.href!)}
                  className="hover:text-foreground transition-colors"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className={i === breadcrumb.length - 1 ? "text-foreground" : ""}>
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Kembali"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight leading-none truncate">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground leading-snug">
                {description}
              </p>
            )}
          </div>
          {favoriteEnabled && (
            <button
              onClick={() => togglePin(location)}
              title={pinned ? "Hapus dari favorit" : "Tambah ke favorit"}
              aria-label={pinned ? "Hapus dari favorit" : "Tambah ke favorit"}
              className={cn(
                "shrink-0 rounded-md p-1.5 transition-colors",
                pinned
                  ? "text-primary hover:text-primary/80"
                  : "text-muted-foreground/40 hover:text-muted-foreground",
              )}
            >
              <Pin size={14} className={pinned ? "fill-primary/30" : undefined} />
            </button>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
