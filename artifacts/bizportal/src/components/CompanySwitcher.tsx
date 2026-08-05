import { Building2, ChevronDown, Check, Globe, LayoutGrid } from "lucide-react";
import { useCompany, CONSOLIDATED_ID } from "@/contexts/CompanyContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function CompanySwitcher() {
  const { companies, activeCompany, isConsolidated, setActiveCompany, setConsolidatedMode } = useCompany();

  if (companies.length === 0) return null;

  const label = isConsolidated ? "Holding Consolidated" : (activeCompany?.companyName ?? "Pilih Perusahaan");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-w-[240px] justify-between gap-1 border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700 hover:text-white text-xs px-2"
        >
          {isConsolidated
            ? <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-purple-400" />
            : <Building2 className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
          }
          <span className="truncate font-medium">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-68 bg-slate-900 border-slate-700">
        <DropdownMenuLabel className="text-slate-400 text-xs font-normal px-3 py-1.5">
          Pilih Perusahaan Aktif
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-slate-700" />

        <DropdownMenuItem
          onClick={setConsolidatedMode}
          className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-800 focus:bg-slate-800 border-b border-slate-700/50 mb-1"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-purple-600/20 text-purple-400 text-xs font-bold border border-purple-500/30">
            <LayoutGrid className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200">Holding Consolidated</p>
            <p className="text-xs text-slate-500">Laporan gabungan semua perusahaan</p>
          </div>
          {isConsolidated && (
            <Check className="h-4 w-4 text-purple-400 shrink-0" />
          )}
        </DropdownMenuItem>

        {companies.filter((c) => !c.isHolding).map((company) => (
          <DropdownMenuItem
            key={company.id}
            onClick={() => setActiveCompany(company)}
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-800 focus:bg-slate-800"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-600/20 text-indigo-400 text-xs font-bold border border-indigo-500/30">
              {(company.companyCode ?? company.companyName ?? "?").slice(0, 3).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{company.companyName}</p>
              {company.npwp && (
                <p className="text-xs text-slate-500 truncate">NPWP: {company.npwp}</p>
              )}
            </div>
            {!isConsolidated && company.id === activeCompany?.id && (
              <Check className="h-4 w-4 text-indigo-400 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CompanyBadge() {
  const { activeCompany, isConsolidated } = useCompany();
  if (isConsolidated) {
    return (
      <Badge
        variant="outline"
        className="text-xs border-purple-500/40 text-purple-300 bg-purple-500/10 gap-1 h-5"
      >
        <LayoutGrid className="h-3 w-3" />
        CONSOLIDATED
      </Badge>
    );
  }
  if (!activeCompany) return null;
  return (
    <Badge
      variant="outline"
      className="text-xs border-indigo-500/40 text-indigo-300 bg-indigo-500/10 gap-1 h-5"
    >
      <Building2 className="h-3 w-3" />
      {activeCompany.companyCode}
    </Badge>
  );
}
