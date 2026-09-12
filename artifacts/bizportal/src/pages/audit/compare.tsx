import { useQuery } from "@tanstack/react-query";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUDIT_MODULES,
  STATUS_CONFIG,
  TOTAL_ITEMS,
  type ItemStatus,
} from "@/lib/auditChecklistData";

interface AuditReport {
  id: number;
  reportNumber: string;
  title: string;
  auditorName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
  okCount: number;
  notOkCount: number;
  warningCount: number;
  naCount: number;
  totalAnswered: number;
  createdAt: string;
}

interface AuditReportDetail extends AuditReport {
  conclusion: string | null;
  overallNotes: string | null;
  responses: { itemId: string; status: string; notes: string }[];
}

type ResponseMap = Record<string, { status: ItemStatus; notes: string }>;

function toMap(detail: AuditReportDetail | undefined): ResponseMap {
  if (!detail) return {};
  const m: ResponseMap = {};
  for (const r of detail.responses) {
    m[r.itemId] = { status: r.status as ItemStatus, notes: r.notes };
  }
  return m;
}

function moduleStat(moduleId: string, responses: ResponseMap) {
  const mod = AUDIT_MODULES.find(m => m.id === moduleId)!;
  const ids = mod.sections.flatMap(s => s.items.map(i => i.id));
  let ok = 0, not_ok = 0, warning = 0;
  for (const id of ids) {
    const s = responses[id]?.status ?? "na";
    if (s === "ok") ok++;
    else if (s === "not_ok") not_ok++;
    else if (s === "warning") warning++;
  }
  const answered = ok + not_ok + warning;
  const score = answered > 0 ? Math.round((ok / answered) * 100) : 0;
  return { total: ids.length, ok, not_ok, warning, answered, score };
}

function overallScore(responses: ResponseMap) {
  let ok = 0, answered = 0;
  for (const v of Object.values(responses)) {
    if (v.status !== "na") { answered++; if (v.status === "ok") ok++; }
  }
  return answered > 0 ? Math.round((ok / answered) * 100) : 0;
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-muted-foreground text-xs flex items-center gap-0.5"><Minus className="h-3 w-3" />0%</span>;
  if (delta > 0) return (
    <span className="text-green-600 text-xs font-medium flex items-center gap-0.5">
      <TrendingUp className="h-3 w-3" />+{delta}%
    </span>
  );
  return (
    <span className="text-red-600 text-xs font-medium flex items-center gap-0.5">
      <TrendingDown className="h-3 w-3" />{delta}%
    </span>
  );
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-2">
        <div
          className={cn("h-2 rounded-full transition-all", color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-sm font-bold w-10 text-right">{score}%</span>
    </div>
  );
}

function scoreColor(s: number) {
  if (s >= 80) return "bg-green-500";
  if (s >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

function scoreTextColor(s: number) {
  if (s >= 80) return "text-green-600";
  if (s >= 60) return "text-yellow-600";
  return "text-red-600";
}

export default function AuditComparePage() {
  const [, navigate] = useLocation();
  const search = new URLSearchParams(useSearch());
  const aId = search.get("a") ?? "";
  const bId = search.get("b") ?? "";

  const { data: reports = [] } = useQuery<AuditReport[]>({
    queryKey: ["/api/erp-audits"],
    queryFn: async () => {
      const r = await fetch("/api/erp-audits");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: reportA, isLoading: loadingA } = useQuery<AuditReportDetail>({
    queryKey: ["/api/erp-audits", Number(aId)],
    queryFn: async () => {
      const r = await fetch(`/api/erp-audits/${aId}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!aId && aId !== "",
  });

  const { data: reportB, isLoading: loadingB } = useQuery<AuditReportDetail>({
    queryKey: ["/api/erp-audits", Number(bId)],
    queryFn: async () => {
      const r = await fetch(`/api/erp-audits/${bId}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!bId && bId !== "",
  });

  const mapA = toMap(reportA);
  const mapB = toMap(reportB);

  const scoreA = overallScore(mapA);
  const scoreB = overallScore(reportB ? mapB : {});
  const deltaOverall = scoreB - scoreA;

  const ready = !!reportA && !!reportB;

  // Changed items analysis
  const improvedItems: { id: string; text: string; from: string; to: string }[] = [];
  const regressedItems: { id: string; text: string; from: string; to: string }[] = [];

  if (ready) {
    const allItems = AUDIT_MODULES.flatMap(m => m.sections.flatMap(s => s.items));
    for (const item of allItems) {
      const stA = mapA[item.id]?.status ?? "na";
      const stB = mapB[item.id]?.status ?? "na";
      if (stA === stB) continue;
      const improved =
        (stA === "not_ok" && (stB === "ok" || stB === "warning")) ||
        (stA === "warning" && stB === "ok") ||
        (stA === "na" && stB === "ok");
      const regressed =
        (stB === "not_ok" && (stA === "ok" || stA === "warning")) ||
        (stB === "warning" && stA === "ok") ||
        ((stA === "ok" || stA === "warning") && stB === "na");
      if (improved) improvedItems.push({ id: item.id, text: item.text, from: stA, to: stB });
      else if (regressed) regressedItems.push({ id: item.id, text: item.text, from: stA, to: stB });
    }
  }

  const handlePrint = () => {
    if (!ready) return;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const lines: string[] = [];
    lines.push(`<html><head><meta charset="UTF-8"><title>Perbandingan Audit ERP</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;padding:20px;color:#111}
      h1{font-size:16px}table{width:100%;border-collapse:collapse;margin-bottom:16px}
      th{background:#1e3a5f;color:white;padding:5px 8px;border:1px solid #ccc;text-align:left;font-size:10px}
      td{border:1px solid #ccc;padding:5px 8px;font-size:10px}
      .up{color:#166534;font-weight:bold}.down{color:#991b1b;font-weight:bold}.same{color:#6b7280}
      .green{color:#166534}.red{color:#991b1b}.yellow{color:#92400e}
    </style></head><body>`);
    lines.push(`<h1>Perbandingan Laporan Audit ERP</h1>`);
    lines.push(`<p><b>Sebelum:</b> ${reportA!.reportNumber} — ${reportA!.title}<br><b>Sesudah:</b> ${reportB!.reportNumber} — ${reportB!.title}<br>Dicetak: ${new Date().toLocaleDateString("id-ID")}</p>`);
    lines.push(`<table><tr><th>Modul</th><th>Skor Sebelum</th><th>Skor Sesudah</th><th>Delta</th><th>OK A→B</th><th>Masalah A→B</th></tr>`);
    for (const mod of AUDIT_MODULES) {
      const stA = moduleStat(mod.id, mapA);
      const stB = moduleStat(mod.id, mapB);
      const d = stB.score - stA.score;
      lines.push(`<tr><td>${mod.icon} ${mod.title}</td><td class="${stA.score>=80?'green':stA.score>=60?'yellow':'red'}">${stA.score}%</td><td class="${stB.score>=80?'green':stB.score>=60?'yellow':'red'}">${stB.score}%</td><td class="${d>0?'up':d<0?'down':'same'}">${d>0?'+':''}${d}%</td><td>${stA.ok}→${stB.ok}</td><td>${stA.not_ok}→${stB.not_ok}</td></tr>`);
    }
    lines.push(`</table>`);
    if (improvedItems.length > 0) {
      lines.push(`<h3 style="color:#166534">✅ Item yang Membaik (${improvedItems.length})</h3><table><tr><th>ID</th><th>Item</th><th>Dari</th><th>Menjadi</th></tr>`);
      for (const i of improvedItems) lines.push(`<tr><td>${i.id}</td><td>${i.text}</td><td>${STATUS_CONFIG[i.from as ItemStatus]?.emoji??i.from}</td><td>${STATUS_CONFIG[i.to as ItemStatus]?.emoji??i.to}</td></tr>`);
      lines.push(`</table>`);
    }
    if (regressedItems.length > 0) {
      lines.push(`<h3 style="color:#991b1b">❌ Item yang Memburuk (${regressedItems.length})</h3><table><tr><th>ID</th><th>Item</th><th>Dari</th><th>Menjadi</th></tr>`);
      for (const i of regressedItems) lines.push(`<tr><td>${i.id}</td><td>${i.text}</td><td>${STATUS_CONFIG[i.from as ItemStatus]?.emoji??i.from}</td><td>${STATUS_CONFIG[i.to as ItemStatus]?.emoji??i.to}</td></tr>`);
      lines.push(`</table>`);
    }
    lines.push(`</body></html>`);
    win.document.write(lines.join(""));
    win.document.close();
    win.print();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/audit">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Kembali
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Perbandingan Laporan Audit</h1>
          <p className="text-sm text-muted-foreground">Lihat perkembangan skor ERP antar dua periode</p>
        </div>
        {ready && (
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" />
            Cetak / PDF
          </Button>
        )}
      </div>

      {/* Report selectors */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="text-sm font-medium mb-1 block text-muted-foreground">
            📋 Laporan A — Sebelumnya / Baseline
          </label>
          <Select
            value={aId}
            onValueChange={(v) => {
              const next = new URLSearchParams();
              next.set("a", v);
              if (bId) next.set("b", bId);
              navigate(`/audit/compare?${next.toString()}`);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pilih laporan A..." />
            </SelectTrigger>
            <SelectContent>
              {reports.map(r => (
                <SelectItem key={r.id} value={String(r.id)} disabled={String(r.id) === bId}>
                  <span className="font-mono text-xs mr-2 text-muted-foreground">{r.reportNumber}</span>
                  {r.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {reportA && (
            <p className="text-xs text-muted-foreground mt-1">
              Auditor: {reportA.auditorName ?? "—"} · {reportA.periodStart ?? "?"} s/d {reportA.periodEnd ?? "?"}
            </p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block text-muted-foreground">
            📋 Laporan B — Terkini / Terbaru
          </label>
          <Select
            value={bId}
            onValueChange={(v) => {
              const next = new URLSearchParams();
              if (aId) next.set("a", aId);
              next.set("b", v);
              navigate(`/audit/compare?${next.toString()}`);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pilih laporan B..." />
            </SelectTrigger>
            <SelectContent>
              {reports.map(r => (
                <SelectItem key={r.id} value={String(r.id)} disabled={String(r.id) === aId}>
                  <span className="font-mono text-xs mr-2 text-muted-foreground">{r.reportNumber}</span>
                  {r.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {reportB && (
            <p className="text-xs text-muted-foreground mt-1">
              Auditor: {reportB.auditorName ?? "—"} · {reportB.periodStart ?? "?"} s/d {reportB.periodEnd ?? "?"}
            </p>
          )}
        </div>
      </div>

      {!aId && !bId && (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
          <div className="text-4xl mb-3">📊</div>
          <p className="font-medium">Pilih dua laporan audit untuk membandingkan</p>
          <p className="text-sm mt-1">Pilih Laporan A (baseline) dan Laporan B (terkini) di atas</p>
        </div>
      )}

      {(loadingA || loadingB) && (
        <div className="text-center py-8 text-muted-foreground">Memuat data laporan...</div>
      )}

      {ready && (
        <>
          {/* Overall score comparison */}
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Skor Keseluruhan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-6 items-center">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1 truncate">{reportA.title}</div>
                  <div className={cn("text-4xl font-bold", scoreTextColor(scoreA))}>{scoreA}%</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    ✅{reportA.okCount} ❌{reportA.notOkCount} ⚠️{reportA.warningCount}
                  </div>
                  <div className="text-xs text-muted-foreground">{reportA.totalAnswered}/{TOTAL_ITEMS} terisi</div>
                </div>

                <div className="text-center">
                  <div className={cn(
                    "inline-flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-lg",
                    deltaOverall > 0 ? "bg-green-100 text-green-700" :
                    deltaOverall < 0 ? "bg-red-100 text-red-700" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {deltaOverall > 0 ? <TrendingUp className="h-5 w-5" /> :
                     deltaOverall < 0 ? <TrendingDown className="h-5 w-5" /> :
                     <Minus className="h-5 w-5" />}
                    {deltaOverall > 0 ? "+" : ""}{deltaOverall}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    {deltaOverall > 0 ? "Meningkat" : deltaOverall < 0 ? "Menurun" : "Sama"}
                  </div>
                  <div className="mt-3 flex gap-1 justify-center flex-wrap">
                    {improvedItems.length > 0 && (
                      <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                        ✅ {improvedItems.length} membaik
                      </Badge>
                    )}
                    {regressedItems.length > 0 && (
                      <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
                        ❌ {regressedItems.length} memburuk
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1 truncate">{reportB.title}</div>
                  <div className={cn("text-4xl font-bold", scoreTextColor(scoreB))}>{scoreB}%</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    ✅{reportB.okCount} ❌{reportB.notOkCount} ⚠️{reportB.warningCount}
                  </div>
                  <div className="text-xs text-muted-foreground">{reportB.totalAnswered}/{TOTAL_ITEMS} terisi</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Per-module comparison */}
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Perbandingan Per Modul</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-[1fr_3px_1fr] divide-x">
                <div className="p-4 space-y-1 hidden md:block">
                  <div className="text-xs font-medium text-muted-foreground pb-1 border-b mb-3 truncate">
                    A — {reportA.title}
                  </div>
                  {AUDIT_MODULES.map(mod => {
                    const st = moduleStat(mod.id, mapA);
                    return (
                      <div key={mod.id} className="py-1">
                        <ScoreBar score={st.score} color={scoreColor(st.score)} />
                      </div>
                    );
                  })}
                </div>

                {/* Middle: module labels + delta */}
                <div className="col-span-1 md:col-span-1 px-3 py-4 space-y-1">
                  <div className="text-xs font-medium text-center text-muted-foreground pb-1 border-b mb-3">
                    Modul / Delta
                  </div>
                  {AUDIT_MODULES.map(mod => {
                    const stA = moduleStat(mod.id, mapA);
                    const stB = moduleStat(mod.id, mapB);
                    const d = stB.score - stA.score;
                    return (
                      <div key={mod.id} className="py-1 flex items-center gap-2">
                        <span className="text-base">{mod.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium leading-tight truncate">{mod.title}</div>
                          <div className="text-[10px] text-muted-foreground">{mod.sections.reduce((s,sec)=>s+sec.items.length,0)} item</div>
                        </div>
                        <DeltaBadge delta={d} />
                      </div>
                    );
                  })}
                </div>

                {/* Right: Report B scores */}
                <div className="p-4 space-y-1 hidden md:block">
                  <div className="text-xs font-medium text-muted-foreground pb-1 border-b mb-3 truncate">
                    B — {reportB.title}
                  </div>
                  {AUDIT_MODULES.map(mod => {
                    const st = moduleStat(mod.id, mapB);
                    return (
                      <div key={mod.id} className="py-1">
                        <ScoreBar score={st.score} color={scoreColor(st.score)} />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mobile: stacked module cards */}
              <div className="md:hidden divide-y">
                {AUDIT_MODULES.map(mod => {
                  const stA = moduleStat(mod.id, mapA);
                  const stB = moduleStat(mod.id, mapB);
                  const d = stB.score - stA.score;
                  return (
                    <div key={mod.id} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span>{mod.icon}</span>
                        <span className="text-sm font-medium">{mod.title}</span>
                        <DeltaBadge delta={d} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">A: {stA.score}%</div>
                          <ScoreBar score={stA.score} color={scoreColor(stA.score)} />
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">B: {stB.score}%</div>
                          <ScoreBar score={stB.score} color={scoreColor(stB.score)} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Changed items */}
          {(improvedItems.length > 0 || regressedItems.length > 0) && (
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {improvedItems.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-green-700 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Item yang Membaik ({improvedItems.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y max-h-80 overflow-y-auto">
                      {improvedItems.map(item => (
                        <div key={item.id} className="px-4 py-2.5">
                          <div className="flex items-start gap-2">
                            <span className="font-mono text-[10px] text-muted-foreground shrink-0 mt-0.5 w-12">{item.id}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs leading-snug">{item.text}</p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted">
                                  {STATUS_CONFIG[item.from as ItemStatus]?.emoji} {STATUS_CONFIG[item.from as ItemStatus]?.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground">→</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                                  {STATUS_CONFIG[item.to as ItemStatus]?.emoji} {STATUS_CONFIG[item.to as ItemStatus]?.label}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {regressedItems.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-red-700 flex items-center gap-2">
                      <TrendingDown className="h-4 w-4" />
                      Item yang Memburuk ({regressedItems.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y max-h-80 overflow-y-auto">
                      {regressedItems.map(item => (
                        <div key={item.id} className="px-4 py-2.5">
                          <div className="flex items-start gap-2">
                            <span className="font-mono text-[10px] text-muted-foreground shrink-0 mt-0.5 w-12">{item.id}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs leading-snug">{item.text}</p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted">
                                  {STATUS_CONFIG[item.from as ItemStatus]?.emoji} {STATUS_CONFIG[item.from as ItemStatus]?.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground">→</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                  {STATUS_CONFIG[item.to as ItemStatus]?.emoji} {STATUS_CONFIG[item.to as ItemStatus]?.label}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {improvedItems.length === 0 && regressedItems.length > 0 && (
                <div /> // spacer
              )}
            </div>
          )}

          {ready && improvedItems.length === 0 && regressedItems.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Minus className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Tidak ada perbedaan status item antara kedua laporan.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
