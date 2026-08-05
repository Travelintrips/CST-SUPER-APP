import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ElementType } from "react";

export interface FinKpiCardProps {
  title: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  icon: ElementType;
  color: "blue" | "green" | "red" | "amber" | "purple" | "teal" | "cyan";
  href: string;
  loading?: boolean;
  status?: "ok" | "warn" | "danger";
}

const colorMap: Record<string, { icon: string; bg: string; border: string }> = {
  blue:   { icon: "text-blue-400",    bg: "bg-blue-950/40",    border: "border-blue-800/30" },
  green:  { icon: "text-emerald-400", bg: "bg-emerald-950/40", border: "border-emerald-800/30" },
  red:    { icon: "text-rose-400",    bg: "bg-rose-950/40",    border: "border-rose-800/30" },
  amber:  { icon: "text-amber-400",   bg: "bg-amber-950/40",   border: "border-amber-800/30" },
  purple: { icon: "text-purple-400",  bg: "bg-purple-950/40",  border: "border-purple-800/30" },
  teal:   { icon: "text-teal-400",    bg: "bg-teal-950/40",    border: "border-teal-800/30" },
  cyan:   { icon: "text-cyan-400",    bg: "bg-cyan-950/40",    border: "border-cyan-800/30" },
};

export function FinKpiCard({
  title, value, sub, trend, trendLabel, icon: Icon, color, href, loading, status,
}: FinKpiCardProps) {
  const c = colorMap[color] ?? colorMap.blue;
  const statusBorder =
    status === "danger" ? "border-rose-800/60" :
    status === "warn"   ? "border-amber-800/60" : "";

  return (
    <Link href={href}>
      <Card className={`cursor-pointer hover:shadow-lg hover:shadow-black/40 transition-all duration-150 hover:-translate-y-0.5 ${statusBorder}`}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className={`p-2.5 rounded-xl ${c.bg} ${c.border} border`}>
              <Icon className={`h-5 w-5 ${c.icon}`} />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5 opacity-30" />
          </div>
          <p className="text-[11px] font-semibold text-muted-foreground mb-1 uppercase tracking-wider">{title}</p>
          {loading ? (
            <Skeleton className="h-7 w-28 mt-1" />
          ) : (
            <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
            {trend && trend !== "neutral" && trendLabel && (
              <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${trend === "up" ? "text-emerald-400" : "text-rose-400"}`}>
                {trend === "up" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {trendLabel}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
