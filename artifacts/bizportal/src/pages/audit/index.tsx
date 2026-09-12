import { DatePicker } from "@/components/ui/date-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Plus, ClipboardCheck, Trash2, Pencil, GitCompare } from "lucide-react";
import { TOTAL_ITEMS } from "@/lib/auditChecklistData";

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
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft:     { label: "Draft",     variant: "secondary" },
  completed: { label: "Selesai",   variant: "default" },
  approved:  { label: "Disetujui", variant: "outline" },
};

function scoreColor(pct: number) {
  if (pct >= 80) return "text-green-600";
  if (pct >= 60) return "text-yellow-600";
  return "text-red-600";
}

export default function AuditReportListPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newDialog, setNewDialog] = useState(false);
  const [form, setForm] = useState({ title: "", auditorName: "", periodStart: "", periodEnd: "" });

  const { data: reports = [], isLoading } = useQuery<AuditReport[]>({
    queryKey: ["/api/erp-audits"],
    queryFn: async () => {
      const r = await fetch("/api/erp-audits");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Judul wajib diisi");
      const r = await fetch("/api/erp-audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (created: AuditReport) => {
      qc.invalidateQueries({ queryKey: ["/api/erp-audits"] });
      setNewDialog(false);
      setForm({ title: "", auditorName: "", periodStart: "", periodEnd: "" });
      toast({ title: "Laporan audit berhasil dibuat", description: created.reportNumber });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/erp-audits/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-audits"] });
      toast({ title: "Laporan berhasil dihapus" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" />
            Audit ERP
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Checklist audit interaktif · {TOTAL_ITEMS} item · 14 modul
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild disabled={reports.length < 2}>
            <Link href="/audit/compare">
              <GitCompare className="h-4 w-4 mr-2" />
              Bandingkan
            </Link>
          </Button>
          <Button onClick={() => setNewDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Buat Laporan Baru
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-16 text-muted-foreground">Memuat...</div>
      )}

      {!isLoading && reports.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <ClipboardCheck className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground">Belum ada laporan audit. Buat yang pertama!</p>
            <Button className="mt-4" onClick={() => setNewDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Buat Laporan Audit
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {reports.map((r) => {
          const answered = r.totalAnswered;
          const pctAnswered = Math.round((answered / TOTAL_ITEMS) * 100);
          const pctOk = answered > 0 ? Math.round((r.okCount / answered) * 100) : 0;
          const cfg = STATUS_BADGE[r.status] ?? { label: r.status, variant: "secondary" as const };

          return (
            <Card key={r.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground font-mono">{r.reportNumber}</span>
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                    </div>
                    <CardTitle className="text-base truncate">{r.title}</CardTitle>
                    {r.auditorName && (
                      <p className="text-sm text-muted-foreground mt-0.5">Auditor: {r.auditorName}</p>
                    )}
                    {(r.periodStart || r.periodEnd) && (
                      <p className="text-xs text-muted-foreground">
                        Periode: {r.periodStart ?? "?"} → {r.periodEnd ?? "?"}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-2xl font-bold ${scoreColor(pctOk)}`}>
                      {answered === 0 ? "—" : `${pctOk}%`}
                    </div>
                    <div className="text-xs text-muted-foreground">skor OK</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-4 text-xs mb-3">
                  <span className="text-green-600">✅ {r.okCount} OK</span>
                  <span className="text-red-600">❌ {r.notOkCount} Masalah</span>
                  <span className="text-yellow-600">⚠️ {r.warningCount} Perhatian</span>
                  <span className="text-gray-500">— {r.naCount} N/A</span>
                  <span className="ml-auto text-muted-foreground">{pctAnswered}% terisi ({answered}/{TOTAL_ITEMS})</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5 mb-3">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all"
                    style={{ width: `${pctAnswered}%` }}
                  />
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="default">
                    <Link href={`/audit/${r.id}`}>
                      <Pencil className="h-3 w-3 mr-1" />
                      Isi / Edit
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm("Hapus laporan audit ini?")) deleteMut.mutate(r.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Hapus
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={newDialog} onOpenChange={setNewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Laporan Audit Baru</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <Label>Judul Laporan *</Label>
              <Input
                className="mt-1"
                placeholder="cth. Audit ERP Q1 2026"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <Label>Nama Auditor</Label>
              <Input
                className="mt-1"
                placeholder="cth. Budi Santoso"
                value={form.auditorName}
                onChange={e => setForm(f => ({ ...f, auditorName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Periode Mulai</Label>
                <DatePicker value={form.periodStart} onChange={v => setForm(f => ({ ...f, periodStart: v }))} className="mt-1" />
              </div>
              <div>
                <Label>Periode Akhir</Label>
                <DatePicker value={form.periodEnd} onChange={v => setForm(f => ({ ...f, periodEnd: v }))} className="mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDialog(false)}>Batal</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending ? "Membuat..." : "Buat Laporan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
