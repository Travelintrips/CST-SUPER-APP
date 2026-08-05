import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Lock, Unlock, Calendar, CheckCircle, Clock, AlertTriangle, Hash, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

type PeriodStatus = "open" | "closing" | "closed";

function StatusBadge({ status, isClosed }: { status?: string; isClosed?: boolean }) {
  const s = status ?? (isClosed ? "closed" : "open");
  if (s === "closed")
    return <Badge className="bg-red-100 text-red-800 border-red-200"><Lock className="w-3 h-3 mr-1" />Closed</Badge>;
  if (s === "closing")
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200"><Clock className="w-3 h-3 mr-1" />Closing</Badge>;
  return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle className="w-3 h-3 mr-1" />Open</Badge>;
}

const MONTHS = [
  "Jan","Feb","Mar","Apr","Mei","Jun",
  "Jul","Ags","Sep","Okt","Nov","Des",
];

export default function PeriodClosingStatusPage() {
  const { activeCompanyId: selectedCompanyId } = useCompany();
  const qc = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [closeDialog, setCloseDialog] = useState<{ period: string } | null>(null);
  const [reopenDialog, setReopenDialog] = useState<{ period: string } | null>(null);
  const [notes, setNotes] = useState("");

  const periodsQ = useQuery({
    queryKey: ["financial-periods", selectedCompanyId, year],
    queryFn: () =>
      fetch(`/api/accounting/periods?company_id=${selectedCompanyId}&year=${year}`, { credentials: "include" })
        .then((r) => r.json()) as Promise<any[]>,
    enabled: !!selectedCompanyId,
  });

  const closingsQ = useQuery({
    queryKey: ["financial-closings", selectedCompanyId],
    queryFn: () =>
      fetch(`/api/accounting/closing?companyId=${selectedCompanyId}`, { credentials: "include" })
        .then((r) => r.json()) as Promise<any[]>,
    enabled: !!selectedCompanyId,
  });

  const snapshotQ = useQuery({
    queryKey: ["ledger-snapshots-summary", selectedCompanyId],
    queryFn: () =>
      fetch(`/api/accounting/ledger/summary?company_id=${selectedCompanyId}`, { credentials: "include" })
        .then((r) => r.json()) as Promise<any[]>,
    enabled: !!selectedCompanyId,
  });

  const closeMutation = useMutation({
    mutationFn: (periodArg: string) =>
      fetch(`/api/accounting/closing/${periodArg}/close`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId, notes: notes || undefined }),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw data;
        return data;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financial-periods"] });
      qc.invalidateQueries({ queryKey: ["financial-closings"] });
      setCloseDialog(null);
      setNotes("");
      toast.success("Periode berhasil ditutup");
    },
    onError: (e: any) =>
      toast.error(e?.message ?? "Gagal menutup periode"),
  });

  const reopenMutation = useMutation({
    mutationFn: (periodArg: string) =>
      fetch(`/api/accounting/closing/${periodArg}/reopen`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId, reason: notes || undefined }),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw data;
        return data;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financial-periods"] });
      qc.invalidateQueries({ queryKey: ["financial-closings"] });
      setReopenDialog(null);
      setNotes("");
      toast.success("Periode berhasil dibuka kembali");
    },
    onError: (e: any) =>
      toast.error(e?.message ?? "Gagal membuka periode"),
  });

  // Build grid: 12 months per year
  const periodMap = new Map((periodsQ.data ?? []).map((p: any) => [Number(p.month), p]));
  const closingMap = new Map((closingsQ.data ?? []).map((c: any) => [c.period, c]));
  const snapshotMap = new Map((snapshotQ.data ?? []).map((s: any) => [s.period, s]));

  const months = Array.from({ length: 12 }, (_, i) => {
    const month   = i + 1;
    const period  = `${year}-${String(month).padStart(2, "0")}`;
    const pData   = periodMap.get(month);
    const cData   = closingMap.get(period);
    const sData   = snapshotMap.get(period);
    const isClosed = pData?.is_closed ?? false;
    const status   = pData?.period_status ?? (isClosed ? "closed" : "open");
    return { month, period, pData, cData, sData, isClosed, status };
  });

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <Calendar className="w-6 h-6 text-amber-600" />
          <div>
            <h1 className="text-xl font-semibold">Status Closing Periode</h1>
            <p className="text-sm text-muted-foreground">Kelola pembukaan dan penutupan periode akuntansi — open / closing / closed</p>
          </div>
        </div>

        {/* Year selector */}
        <div className="flex items-end gap-4">
          <div className="space-y-1">
            <Label>Tahun</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Month grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {months.map(({ month, period, pData, cData, sData, isClosed, status }) => (
            <Card
              key={period}
              className={`transition-colors ${
                status === "closed"
                  ? "border-red-200 bg-red-50/30"
                  : status === "closing"
                  ? "border-amber-200 bg-amber-50/30"
                  : "border-green-200 bg-green-50/10"
              }`}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-base">{MONTHS[month - 1]} {year}</span>
                  <StatusBadge status={status} isClosed={isClosed} />
                </div>

                {cData && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {cData.closed_at && (
                      <div>
                        Ditutup:{" "}
                        {format(new Date(cData.closed_at), "dd MMM HH:mm", { locale: localeId })}
                      </div>
                    )}
                    {cData.closed_by && <div>Oleh: {cData.closed_by}</div>}
                    {cData.net_income != null && (
                      <div className={Number(cData.net_income) >= 0 ? "text-green-700" : "text-red-600"}>
                        Net: Rp {Number(cData.net_income).toLocaleString("id-ID")}
                      </div>
                    )}
                  </div>
                )}

                {sData && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Hash className="w-3 h-3" />
                    <span className="truncate font-mono" title={sData.snapshot_hash ?? ""}>
                      {sData.snapshot_hash
                        ? sData.snapshot_hash.substring(0, 12) + "…"
                        : "No hash"}
                    </span>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  {status !== "closed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-7 text-xs border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => {
                        setNotes("");
                        setCloseDialog({ period });
                      }}
                    >
                      <Lock className="w-3 h-3 mr-1" />
                      Tutup
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-7 text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
                      onClick={() => {
                        setNotes("");
                        setReopenDialog({ period });
                      }}
                    >
                      <Unlock className="w-3 h-3 mr-1" />
                      Buka
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Rules notice */}
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            <strong>Period Locking Rules:</strong> Setelah periode ditutup (<em>closed</em>),
            semua jurnal dan transaksi di periode tersebut diblokir oleh database trigger.
            Buka kembali hanya untuk koreksi darurat dengan alasan yang tercatat.
          </AlertDescription>
        </Alert>
      </div>

      {/* Close dialog */}
      <Dialog open={!!closeDialog} onOpenChange={() => setCloseDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tutup Periode {closeDialog?.period}</DialogTitle>
            <DialogDescription>
              Periode ini akan dikunci. Semua jurnal baru di periode ini akan diblokir.
              Closing entry akan dibuat secara otomatis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Catatan (opsional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan closing..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={() => closeDialog && closeMutation.mutate(closeDialog.period)}
              disabled={closeMutation.isPending}
            >
              {closeMutation.isPending ? "Menutup..." : "Tutup Periode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen dialog */}
      <Dialog open={!!reopenDialog} onOpenChange={() => setReopenDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buka Kembali Periode {reopenDialog?.period}</DialogTitle>
            <DialogDescription>
              Periode yang sudah ditutup akan dibuka kembali. Alasan wajib dicatat untuk audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Alasan membuka kembali *</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Alasan membuka kembali periode ini..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenDialog(null)}>
              Batal
            </Button>
            <Button
              onClick={() => reopenDialog && reopenMutation.mutate(reopenDialog.period)}
              disabled={reopenMutation.isPending || !notes.trim()}
            >
              {reopenMutation.isPending ? "Membuka..." : "Buka Kembali"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
