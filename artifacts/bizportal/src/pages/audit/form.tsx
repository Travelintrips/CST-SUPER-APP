import { DatePicker } from "@/components/ui/date-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Save,
  Printer,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Minus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUDIT_MODULES,
  STATUS_CONFIG,
  TOTAL_ITEMS,
  type ItemStatus,
  type AuditModule,
} from "@/lib/auditChecklistData";

interface AuditReportDetail {
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
  conclusion: string | null;
  overallNotes: string | null;
  createdAt: string;
  responses: { itemId: string; status: string; notes: string }[];
}

type ResponseMap = Record<string, { status: ItemStatus; notes: string }>;

const STATUS_ICONS: Record<ItemStatus, React.ReactNode> = {
  ok:      <CheckCircle2 className="h-3.5 w-3.5" />,
  not_ok:  <AlertCircle className="h-3.5 w-3.5" />,
  warning: <AlertTriangle className="h-3.5 w-3.5" />,
  na:      <Minus className="h-3.5 w-3.5" />,
};

function moduleSummary(mod: AuditModule, responses: ResponseMap) {
  const ids = mod.sections.flatMap(s => s.items.map(i => i.id));
  let ok = 0, not_ok = 0, warning = 0, answered = 0;
  for (const id of ids) {
    const s = responses[id]?.status ?? "na";
    if (s === "ok") { ok++; answered++; }
    else if (s === "not_ok") { not_ok++; answered++; }
    else if (s === "warning") { warning++; answered++; }
  }
  return { total: ids.length, ok, not_ok, warning, answered };
}

export default function AuditReportFormPage() {
  const [, params] = useRoute("/audit/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const reportId = Number(params?.id);

  const [responses, setResponses] = useState<ResponseMap>({});
  const [header, setHeader] = useState({
    title: "", auditorName: "", periodStart: "", periodEnd: "",
    status: "draft", conclusion: "", overallNotes: "",
  });
  const [activeModule, setActiveModule] = useState("1");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: report, isLoading } = useQuery<AuditReportDetail>({
    queryKey: ["/api/erp-audits", reportId],
    queryFn: async () => {
      const r = await fetch(`/api/erp-audits/${reportId}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !isNaN(reportId),
  });

  useEffect(() => {
    if (!report) return;
    setHeader({
      title: report.title,
      auditorName: report.auditorName ?? "",
      periodStart: report.periodStart ?? "",
      periodEnd: report.periodEnd ?? "",
      status: report.status,
      conclusion: report.conclusion ?? "",
      overallNotes: report.overallNotes ?? "",
    });
    const map: ResponseMap = {};
    for (const r of report.responses) {
      map[r.itemId] = { status: r.status as ItemStatus, notes: r.notes };
    }
    setResponses(map);
    const expanded: Record<string, boolean> = {};
    AUDIT_MODULES.forEach(m => m.sections.forEach(s => { expanded[s.id] = true; }));
    setExpandedSections(expanded);
  }, [report]);

  const saveResponsesMut = useMutation({
    mutationFn: async (resp: ResponseMap) => {
      const payload = Object.entries(resp).map(([itemId, v]) => ({
        itemId,
        status: v.status,
        notes: v.notes,
      }));
      const r = await fetch(`/api/erp-audits/${reportId}/responses`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: payload }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-audits", reportId] });
      qc.invalidateQueries({ queryKey: ["/api/erp-audits"] });
      setDirty(false);
    },
    onError: (e: Error) => toast({ title: "Gagal simpan: " + e.message, variant: "destructive" }),
  });

  const saveHeaderMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/erp-audits/${reportId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(header),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-audits", reportId] });
      qc.invalidateQueries({ queryKey: ["/api/erp-audits"] });
      toast({ title: "Laporan disimpan" });
    },
    onError: (e: Error) => toast({ title: "Gagal simpan header: " + e.message, variant: "destructive" }),
  });

  const handleSaveAll = useCallback(async () => {
    await Promise.all([
      saveResponsesMut.mutateAsync(responses),
      saveHeaderMut.mutateAsync(),
    ]);
    toast({ title: "✅ Semua perubahan tersimpan" });
  }, [responses, saveHeaderMut, saveResponsesMut, toast]);

  const setItemStatus = useCallback((itemId: string, status: ItemStatus) => {
    setResponses(prev => {
      const next = { ...prev, [itemId]: { ...prev[itemId], status, notes: prev[itemId]?.notes ?? "" } };
      if (pendingSave.current) clearTimeout(pendingSave.current);
      pendingSave.current = setTimeout(() => saveResponsesMut.mutate(next), 2000);
      return next;
    });
    setDirty(true);
  }, [saveResponsesMut]);

  const setItemNotes = useCallback((itemId: string, notes: string) => {
    setResponses(prev => {
      const next = { ...prev, [itemId]: { ...prev[itemId], notes, status: prev[itemId]?.status ?? "na" } };
      if (pendingSave.current) clearTimeout(pendingSave.current);
      pendingSave.current = setTimeout(() => saveResponsesMut.mutate(next), 2000);
      return next;
    });
    setDirty(true);
  }, [saveResponsesMut]);

  const totalAnswered = Object.values(responses).filter(r => r.status !== "na").length;
  const totalOk = Object.values(responses).filter(r => r.status === "ok").length;
  const totalNotOk = Object.values(responses).filter(r => r.status === "not_ok").length;
  const totalWarning = Object.values(responses).filter(r => r.status === "warning").length;
  const pctAnswered = Math.round((totalAnswered / TOTAL_ITEMS) * 100);
  const pctOk = totalAnswered > 0 ? Math.round((totalOk / totalAnswered) * 100) : 0;

  const handlePrint = () => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const lines: string[] = [];
    lines.push(`<html><head><meta charset="UTF-8"><title>Audit ERP — ${header.title}</title>`);
    lines.push(`<style>
      body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 20px; }
      h1 { font-size: 16px; margin-bottom: 4px; }
      .meta { font-size: 10px; color: #555; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th { background: #f0f0f0; border: 1px solid #ccc; padding: 5px 8px; text-align: left; font-size: 10px; }
      td { border: 1px solid #ccc; padding: 5px 8px; vertical-align: top; font-size: 10px; }
      .module-title { background: #1e3a5f; color: white; font-weight: bold; font-size: 12px; padding: 6px 8px; margin-top: 16px; margin-bottom: 0; }
      .section-title { background: #e8eef5; font-weight: bold; font-size: 10px; padding: 4px 8px; }
      .ok { color: #166534; font-weight: bold; }
      .not_ok { color: #991b1b; font-weight: bold; }
      .warning { color: #92400e; font-weight: bold; }
      .na { color: #6b7280; }
      .summary-box { border: 1px solid #ccc; border-radius: 4px; padding: 12px; margin-bottom: 20px; display: flex; gap: 24px; }
      .score { font-size: 28px; font-weight: bold; }
      @media print { body { padding: 0; } }
    </style></head><body>`);
    lines.push(`<h1>Laporan Audit ERP — ${header.title}</h1>`);
    lines.push(`<div class="meta">Nomor: ${report?.reportNumber ?? "—"} | Auditor: ${header.auditorName || "—"} | Periode: ${header.periodStart || "?"} s/d ${header.periodEnd || "?"} | Status: ${header.status} | Tanggal cetak: ${new Date().toLocaleDateString("id-ID")}</div>`);
    lines.push(`<div class="summary-box">
      <div><div class="score" style="color:${pctOk >= 80 ? '#166534' : pctOk >= 60 ? '#92400e' : '#991b1b'}">${pctOk}%</div><div>Skor OK</div></div>
      <div><b style="color:#166534">✅ ${totalOk}</b> OK</div>
      <div><b style="color:#991b1b">❌ ${totalNotOk}</b> Masalah</div>
      <div><b style="color:#92400e">⚠️ ${totalWarning}</b> Perhatian</div>
      <div><b>${pctAnswered}%</b> terisi (${totalAnswered}/${TOTAL_ITEMS})</div>
      ${header.conclusion ? `<div>Kesimpulan: <b>${header.conclusion}</b></div>` : ""}
    </div>`);

    for (const mod of AUDIT_MODULES) {
      const ms = moduleSummary(mod, responses);
      lines.push(`<div class="module-title">${mod.icon} ${mod.title} — ${ms.answered}/${ms.total} terisi | ✅${ms.ok} ❌${ms.not_ok} ⚠️${ms.warning}</div>`);
      lines.push(`<table>`);
      lines.push(`<tr><th>#</th><th>Item Audit</th><th>Status</th><th>Temuan / Catatan</th></tr>`);
      for (const sec of mod.sections) {
        lines.push(`<tr><td colspan="4" class="section-title">${sec.title}</td></tr>`);
        for (const item of sec.items) {
          const resp = responses[item.id];
          const st = resp?.status ?? "na";
          const stCfg = STATUS_CONFIG[st as ItemStatus];
          lines.push(`<tr>
            <td style="white-space:nowrap">${item.id}</td>
            <td>${item.text}</td>
            <td class="${st}">${stCfg.emoji} ${stCfg.label}</td>
            <td>${resp?.notes || ""}</td>
          </tr>`);
        }
      }
      lines.push(`</table>`);
    }

    if (header.overallNotes) {
      lines.push(`<p><b>Catatan Umum:</b> ${header.overallNotes}</p>`);
    }
    lines.push(`</body></html>`);
    win.document.write(lines.join(""));
    win.document.close();
    win.print();
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Memuat laporan...</div>;
  }

  const activeMod = AUDIT_MODULES.find(m => m.id === activeModule) ?? AUDIT_MODULES[0];

  return (
    <div className="flex flex-col h-full">
      {/* ─── Top bar ─────────────────────────────────────────────────── */}
      <div className="border-b bg-background sticky top-0 z-10 px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/audit")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Kembali
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{report?.reportNumber}</span>
            <span className="font-semibold truncate">{header.title}</span>
            {dirty && <Badge variant="outline" className="text-xs">Belum disimpan</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{pctAnswered}%</span> terisi
              ({totalAnswered}/{TOTAL_ITEMS})
            </span>
            <span className="text-green-600">✅ {totalOk}</span>
            <span className="text-red-600">❌ {totalNotOk}</span>
            <span className="text-yellow-600">⚠️ {totalWarning}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" />
            Cetak / PDF
          </Button>
          <Button
            size="sm"
            onClick={handleSaveAll}
            disabled={saveResponsesMut.isPending || saveHeaderMut.isPending}
          >
            <Save className="h-4 w-4 mr-1" />
            {saveResponsesMut.isPending || saveHeaderMut.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </div>

      {/* ─── Progress bar ────────────────────────────────────────────── */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${pctAnswered}%` }}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ─── Left sidebar: modules ─────────────────────────────────── */}
        <div className="w-56 shrink-0 border-r overflow-y-auto bg-muted/30 p-2 hidden md:block">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-2 mt-1">
            Modul
          </div>
          {AUDIT_MODULES.map(mod => {
            const ms = moduleSummary(mod, responses);
            const pct = ms.total > 0 ? Math.round((ms.answered / ms.total) * 100) : 0;
            const isActive = mod.id === activeModule;
            return (
              <button
                key={mod.id}
                onClick={() => setActiveModule(mod.id)}
                className={cn(
                  "w-full text-left px-2 py-2 rounded-md text-sm mb-0.5 transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span>{mod.icon}</span>
                  <span className="flex-1 leading-tight text-xs font-medium line-clamp-2">{mod.title}</span>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <div className={cn("flex-1 h-1 rounded-full", isActive ? "bg-primary-foreground/30" : "bg-muted")}>
                    <div
                      className={cn("h-full rounded-full", isActive ? "bg-primary-foreground" : "bg-primary")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={cn("text-[10px]", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {ms.answered}/{ms.total}
                  </span>
                </div>
                {ms.not_ok > 0 && (
                  <span className={cn("text-[10px]", isActive ? "text-red-200" : "text-red-500")}>
                    ❌ {ms.not_ok} masalah
                  </span>
                )}
              </button>
            );
          })}

          {/* Header section at bottom */}
          <div className="mt-4 border-t pt-3 px-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Info Laporan
            </div>
            <div className="grid gap-2">
              <div>
                <Label className="text-xs">Judul</Label>
                <Input
                  className="h-7 text-xs mt-0.5"
                  value={header.title}
                  onChange={e => { setHeader(h => ({ ...h, title: e.target.value })); setDirty(true); }}
                />
              </div>
              <div>
                <Label className="text-xs">Auditor</Label>
                <Input
                  className="h-7 text-xs mt-0.5"
                  value={header.auditorName}
                  onChange={e => { setHeader(h => ({ ...h, auditorName: e.target.value })); setDirty(true); }}
                />
              </div>
              <div>
                <Label className="text-xs">Periode</Label>
                <DatePicker value={header.periodStart} onChange={v => { setHeader(h => ({ ...h, periodStart: v })); setDirty(true); }} className="h-7 text-xs mt-0.5" />
                <DatePicker value={header.periodEnd} onChange={v => { setHeader(h => ({ ...h, periodEnd: v })); setDirty(true); }} className="h-7 text-xs mt-1" />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={header.status} onValueChange={v => { setHeader(h => ({ ...h, status: v })); setDirty(true); }}>
                  <SelectTrigger className="h-7 text-xs mt-0.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="completed">Selesai</SelectItem>
                    <SelectItem value="approved">Disetujui</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Kesimpulan</Label>
                <Select value={header.conclusion || "none"} onValueChange={v => { setHeader(h => ({ ...h, conclusion: v === "none" ? "" : v })); setDirty(true); }}>
                  <SelectTrigger className="h-7 text-xs mt-0.5">
                    <SelectValue placeholder="Pilih..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Belum ditentukan —</SelectItem>
                    <SelectItem value="Lulus">✅ Lulus</SelectItem>
                    <SelectItem value="Lulus Bersyarat">⚠️ Lulus Bersyarat</SelectItem>
                    <SelectItem value="Tidak Lulus">❌ Tidak Lulus</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Main content: items ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Module header */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">{activeMod.icon}</span>
            <div>
              <h2 className="font-bold text-lg">{activeMod.title}</h2>
              <p className="text-xs text-muted-foreground">
                {activeMod.sections.reduce((s, sec) => s + sec.items.length, 0)} item
                {" · "}
                {(() => {
                  const ms = moduleSummary(activeMod, responses);
                  return `${ms.answered} terisi · ✅${ms.ok} ❌${ms.not_ok} ⚠️${ms.warning}`;
                })()}
              </p>
            </div>

            {/* Mobile module selector */}
            <div className="ml-auto md:hidden">
              <Select value={activeModule} onValueChange={setActiveModule}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIT_MODULES.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.icon} {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Sections */}
          {activeMod.sections.map(section => {
            const isExpanded = expandedSections[section.id] !== false;
            const sectionAnswered = section.items.filter(i => (responses[i.id]?.status ?? "na") !== "na").length;
            const sectionNotOk = section.items.filter(i => responses[i.id]?.status === "not_ok").length;
            const sectionWarning = section.items.filter(i => responses[i.id]?.status === "warning").length;

            return (
              <Card key={section.id} className="mb-3">
                <CardHeader
                  className="py-3 px-4 cursor-pointer select-none"
                  onClick={() => setExpandedSections(prev => ({ ...prev, [section.id]: !isExpanded }))}
                >
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">{section.title}</CardTitle>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{sectionAnswered}/{section.items.length}</span>
                      {sectionNotOk > 0 && <span className="text-xs text-red-600">❌ {sectionNotOk}</span>}
                      {sectionWarning > 0 && <span className="text-xs text-yellow-600">⚠️ {sectionWarning}</span>}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 pb-3 px-0">
                    {section.items.map((item, idx) => {
                      const resp = responses[item.id] ?? { status: "na" as ItemStatus, notes: "" };
                      const st = resp.status as ItemStatus;
                      const needsNotes = st === "not_ok" || st === "warning";

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "px-4 py-3 border-b last:border-b-0",
                            st === "not_ok" ? "bg-red-50/50 dark:bg-red-950" :
                            st === "warning" ? "bg-yellow-50/50 dark:bg-yellow-950" :
                            st === "ok" ? "bg-green-50/30 dark:bg-green-950" : ""
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0 w-12">{item.id}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm leading-snug mb-2">{item.text}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(Object.keys(STATUS_CONFIG) as ItemStatus[]).map(s => (
                                  <button
                                    key={s}
                                    onClick={() => setItemStatus(item.id, s)}
                                    className={cn(
                                      "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all",
                                      st === s
                                        ? `${STATUS_CONFIG[s].color} ring-2 ${STATUS_CONFIG[s].ring} ring-offset-1`
                                        : "bg-background border-input hover:bg-muted text-muted-foreground"
                                    )}
                                  >
                                    {STATUS_ICONS[s]}
                                    {STATUS_CONFIG[s].label}
                                  </button>
                                ))}
                              </div>
                              {needsNotes && (
                                <Textarea
                                  className="mt-2 text-xs h-16 resize-none"
                                  placeholder={`Temuan / catatan untuk item ini...`}
                                  value={resp.notes}
                                  onChange={e => setItemNotes(item.id, e.target.value)}
                                />
                              )}
                              {!needsNotes && resp.notes && (
                                <p className="mt-1 text-xs text-muted-foreground italic">📝 {resp.notes}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })}

          {/* Module navigation */}
          <div className="flex justify-between mt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={activeModule === "1"}
              onClick={() => {
                const idx = AUDIT_MODULES.findIndex(m => m.id === activeModule);
                if (idx > 0) setActiveModule(AUDIT_MODULES[idx - 1].id);
              }}
            >
              ← Modul Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={activeModule === AUDIT_MODULES[AUDIT_MODULES.length - 1].id}
              onClick={() => {
                const idx = AUDIT_MODULES.findIndex(m => m.id === activeModule);
                if (idx < AUDIT_MODULES.length - 1) setActiveModule(AUDIT_MODULES[idx + 1].id);
              }}
            >
              Modul Berikutnya →
            </Button>
          </div>

          {/* Overall notes at bottom */}
          <div className="mt-6 border-t pt-4">
            <Label className="text-sm font-medium">Catatan Umum / Kesimpulan Akhir</Label>
            <Textarea
              className="mt-2 h-24 text-sm"
              placeholder="Tulis catatan umum hasil audit, rekomendasi prioritas, atau hal-hal yang perlu ditindaklanjuti..."
              value={header.overallNotes}
              onChange={e => { setHeader(h => ({ ...h, overallNotes: e.target.value })); setDirty(true); }}
            />
          </div>

          {/* Summary card */}
          <Card className="mt-4 mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Ringkasan Audit</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-center dark:bg-green-950">
                  <div className="text-2xl font-bold text-green-700">{totalOk}</div>
                  <div className="text-xs text-green-600">✅ OK / Sesuai</div>
                </div>
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-center dark:bg-red-950">
                  <div className="text-2xl font-bold text-red-700">{totalNotOk}</div>
                  <div className="text-xs text-red-600">❌ Masalah</div>
                </div>
                <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-center dark:bg-yellow-950">
                  <div className="text-2xl font-bold text-yellow-700">{totalWarning}</div>
                  <div className="text-xs text-yellow-600">⚠️ Perlu Perhatian</div>
                </div>
                <div className="rounded-lg bg-muted border p-3 text-center">
                  <div className="text-2xl font-bold">{TOTAL_ITEMS - totalAnswered}</div>
                  <div className="text-xs text-muted-foreground">— Belum diisi</div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div
                  className={cn(
                    "text-3xl font-bold",
                    pctOk >= 80 ? "text-green-600" : pctOk >= 60 ? "text-yellow-600" : "text-red-600"
                  )}
                >
                  {totalAnswered === 0 ? "—" : `${pctOk}%`}
                </div>
                <div>
                  <div className="text-sm font-medium">Skor OK</div>
                  <div className="text-xs text-muted-foreground">{pctAnswered}% item terisi ({totalAnswered}/{TOTAL_ITEMS})</div>
                  {header.conclusion && (
                    <div className="text-xs font-medium mt-0.5">Kesimpulan: {header.conclusion}</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
