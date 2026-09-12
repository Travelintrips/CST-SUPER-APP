/**
 * Vendor Completion Score Dashboard
 * Route: /purchase/vendor-completion
 *
 * Lists all vendors with their data completion scores,
 * color-coded by overall percentage, with drill-down to vendor detail.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckSquare, Search, ArrowRight, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface CompletionBreakdown {
  score: number;
  weight: number;
}

interface VendorCompletion {
  supplierId: number;
  supplierName: string;
  overall: number;
  breakdown: Record<string, CompletionBreakdown>;
}

interface SupplierRow {
  id: number;
  name: string;
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-500";
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-emerald-50 border-emerald-200";
  if (score >= 50) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function ScoreIcon({ score }: { score: number }) {
  if (score >= 80) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (score >= 50) return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

const BREAKDOWN_LABELS: Record<string, string> = {
  companyProfile: "Profil",
  supplierData:   "Data",
  gallery:        "Gallery",
  specification:  "Spec",
  documents:      "Dokumen",
  hsCode:         "HS Code",
  description:    "Deskripsi",
};

export default function VendorCompletionPage() {
  const [, setLocation] = useLocation();
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [completions, setCompletions] = useState<Map<number, VendorCompletion>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "score">("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Load all suppliers
  useEffect(() => {
    fetch("/api/trading/suppliers?limit=200", { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((data: any[]) => {
        const rows = data.map((s: any) => ({ id: s.id, name: s.name }));
        setSuppliers(rows);
        // Kick off completion fetch for first 30
        const first30 = rows.slice(0, 30);
        setLoadingIds(new Set(first30.map((r) => r.id)));
        Promise.allSettled(
          first30.map((s) =>
            fetch(`/api/trading/suppliers/${s.id}/completion`, { credentials: "include" })
              .then((r) => r.ok ? r.json() : null)
          )
        ).then((results) => {
          const map = new Map<number, VendorCompletion>();
          results.forEach((res, i) => {
            if (res.status === "fulfilled" && res.value) {
              map.set(first30[i].id, res.value);
            }
          });
          setCompletions(map);
          setLoading(false);
        });
      });
  }, []);

  const filtered = suppliers
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortKey === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const sa = completions.get(a.id)?.overall ?? -1;
      const sb = completions.get(b.id)?.overall ?? -1;
      return sortDir === "asc" ? sa - sb : sb - sa;
    });

  const toggleSort = (key: "name" | "score") => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "score" ? "asc" : "asc"); }
  };

  // Aggregate stats
  const completed = suppliers.filter((s) => (completions.get(s.id)?.overall ?? 0) >= 80);
  const incomplete = suppliers.filter((s) => (completions.get(s.id)?.overall ?? 0) < 50 && completions.has(s.id));
  const avgScore = completions.size > 0
    ? Math.round(Array.from(completions.values()).reduce((s, v) => s + v.overall, 0) / completions.size)
    : null;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <CheckSquare className="h-6 w-6 text-green-500" />
            Kelengkapan Data Vendor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pantau kelengkapan data semua vendor — profil, katalog, dokumen, dan HS code.
          </p>
        </div>

        {/* Stats row */}
        {!loading && completions.size > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="border-slate-200">
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-black text-slate-900">{suppliers.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total Vendor</p>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 bg-emerald-50/50">
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-black text-emerald-600">{completed.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Lengkap (≥80%)</p>
              </CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50/50">
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-black text-red-500">{incomplete.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Perlu Dilengkapi (&lt;50%)</p>
              </CardContent>
            </Card>
            <Card className="border-sky-200 bg-sky-50/50">
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-black text-sky-600">{avgScore ?? "—"}%</p>
                <p className="text-xs text-muted-foreground mt-0.5">Rata-rata Skor</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari vendor..."
            className="pl-8"
          />
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {loading ? "Memuat skor…" : `${filtered.length} vendor ditemukan`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground"
                    onClick={() => toggleSort("name")}
                  >
                    Vendor {sortKey === "name" && (sortDir === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground w-28"
                    onClick={() => toggleSort("score")}
                  >
                    Skor {sortKey === "score" && (sortDir === "asc" ? "↑" : "↓")}
                  </TableHead>
                  {Object.keys(BREAKDOWN_LABELS).map((k) => (
                    <TableHead key={k} className="text-center text-[11px] w-20">
                      {BREAKDOWN_LABELS[k]}
                    </TableHead>
                  ))}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((supplier) => {
                  const comp = completions.get(supplier.id);
                  const isLoading = loadingIds.has(supplier.id) && !comp;
                  return (
                    <TableRow
                      key={supplier.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setLocation(`/purchase/vendor/${supplier.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {comp && <ScoreIcon score={comp.overall} />}
                          <span className="font-medium text-sm">{supplier.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isLoading ? (
                          <span className="text-xs text-muted-foreground">Memuat…</span>
                        ) : comp ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-100 rounded-full h-2 w-16">
                              <div
                                className="h-2 rounded-full"
                                style={{
                                  width: `${comp.overall}%`,
                                  background: comp.overall >= 80 ? "#16a34a" : comp.overall >= 50 ? "#d97706" : "#dc2626",
                                }}
                              />
                            </div>
                            <span className={`text-sm font-bold tabular-nums ${scoreColor(comp.overall)}`}>
                              {comp.overall}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">—</span>
                        )}
                      </TableCell>
                      {Object.keys(BREAKDOWN_LABELS).map((k) => {
                        const score = comp?.breakdown?.[k]?.score;
                        return (
                          <TableCell key={k} className="text-center">
                            {score == null ? (
                              <span className="text-muted-foreground/40 text-xs">—</span>
                            ) : (
                              <Badge
                                className={`text-[10px] px-1.5 py-0.5 border font-mono ${scoreBg(score)} ${scoreColor(score)}`}
                              >
                                {score}%
                              </Badge>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocation(`/purchase/vendor/${supplier.id}`);
                          }}
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9 + Object.keys(BREAKDOWN_LABELS).length} className="text-center text-muted-foreground py-10">
                      Tidak ada vendor yang cocok dengan pencarian.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
