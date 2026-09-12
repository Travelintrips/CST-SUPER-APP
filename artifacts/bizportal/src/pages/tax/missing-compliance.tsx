import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, RefreshCw, CheckCircle2, Pencil, Download, ShieldAlert, ArrowLeft } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";
import { BackButton } from "@/components/ui/back-button";

function formatRp(n: number) {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
function generatePeriods() {
  const p: string[] = ["all"];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    p.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return p;
}
const PERIODS = generatePeriods();

interface TaxItem {
  id: number;
  transaction_type: string;
  transaction_id: number;
  transaction_ref: string | null;
  tax_name: string;
  tax_amount: number;
  base_amount: number;
  direction: string;
  partner_name: string | null;
  npwp: string | null;
  faktur_pajak_number?: string | null;
  bukti_potong_number?: string | null;
  period: string;
  status: string;
  created_at: string;
  issue_type?: string;
}

interface ComplianceSummary {
  npwpMissing: number;
  fakturPajakMissing: number;
  buktiPotongMissing: number;
  unpaidCount: number;
  unpaidTotalAmount: number;
}

const DIR_LABEL: Record<string, string> = {
  output: "PPN Keluaran",
  input: "PPN Masukan",
  withholding: "PPh Potong",
};

function PatchDialog({
  open,
  item,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: TaxItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    npwp: item?.npwp ?? "",
    fakturPajakNumber: item?.faktur_pajak_number ?? "",
    buktiPotongNumber: item?.bukti_potong_number ?? "",
  });

  const mut = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const r = await fetch(`/api/tax/transactions/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          npwp: form.npwp || null,
          fakturPajakNumber: form.fakturPajakNumber || null,
          buktiPotongNumber: form.buktiPotongNumber || null,
        }),
      });
      if (!r.ok) throw new Error("Gagal menyimpan");
    },
    onSuccess: () => {
      toast.success("Data pajak diperbarui");
      onSaved();
      onClose();
    },
    onError: () => toast.error("Gagal menyimpan perubahan"),
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Data Kepatuhan Pajak</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Ref. Transaksi</Label>
            <p className="text-sm text-slate-600 mt-1">{item.transaction_ref ?? `#${item.transaction_id}`} — {item.tax_name}</p>
          </div>
          <div>
            <Label>NPWP / NIK Mitra</Label>
            <Input
              placeholder="xx.xxx.xxx.x-xxx.xxx"
              value={form.npwp}
              onChange={(e) => setForm((f) => ({ ...f, npwp: e.target.value }))}
            />
          </div>
          {item.direction === "output" && (
            <div>
              <Label>Nomor Faktur Pajak</Label>
              <Input
                placeholder="xxx-xx.xxxxxxxx"
                value={form.fakturPajakNumber}
                onChange={(e) => setForm((f) => ({ ...f, fakturPajakNumber: e.target.value }))}
              />
            </div>
          )}
          {item.direction === "withholding" && (
            <div>
              <Label>Nomor Bukti Potong</Label>
              <Input
                placeholder="Nomor bukti potong"
                value={form.buktiPotongNumber}
                onChange={(e) => setForm((f) => ({ ...f, buktiPotongNumber: e.target.value }))}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaxItemTable({
  items,
  isLoading,
  onEdit,
  showFaktur,
  showBukti,
}: {
  items: TaxItem[];
  isLoading: boolean;
  onEdit: (item: TaxItem) => void;
  showFaktur?: boolean;
  showBukti?: boolean;
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead>Periode</TableHead>
            <TableHead>Referensi</TableHead>
            <TableHead>Pajak</TableHead>
            <TableHead>Mitra</TableHead>
            <TableHead>NPWP</TableHead>
            {showFaktur && <TableHead>No. Faktur</TableHead>}
            {showBukti && <TableHead>No. Bukti Potong</TableHead>}
            <TableHead className="text-right">DPP</TableHead>
            <TableHead className="text-right">Pajak</TableHead>
            <TableHead>Status</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={10} className="text-center py-8 text-slate-400">Memuat data...</TableCell></TableRow>
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="text-center py-12">
                <div className="flex flex-col items-center text-green-600 gap-2">
                  <CheckCircle2 className="w-8 h-8" />
                  <span className="font-medium">Tidak ada isu kepatuhan</span>
                </div>
              </TableCell>
            </TableRow>
          ) : items.map((item) => (
            <TableRow key={item.id} className="hover:bg-orange-50">
              <TableCell className="font-mono text-xs">{item.period}</TableCell>
              <TableCell className="font-mono text-xs text-slate-600">
                {item.transaction_ref ?? `${item.transaction_type}#${item.transaction_id}`}
              </TableCell>
              <TableCell>
                <div className="text-sm font-medium">{item.tax_name}</div>
                <Badge variant="outline" className="text-xs mt-1">{DIR_LABEL[item.direction] ?? item.direction}</Badge>
              </TableCell>
              <TableCell className="text-sm">{item.partner_name ?? "—"}</TableCell>
              <TableCell>
                {item.npwp ? (
                  <span className="text-xs text-green-700 font-mono">{item.npwp}</span>
                ) : (
                  <Badge className="bg-red-100 text-red-700 text-xs">Belum diisi</Badge>
                )}
              </TableCell>
              {showFaktur && (
                <TableCell>
                  {item.faktur_pajak_number ? (
                    <span className="text-xs text-green-700 font-mono">{item.faktur_pajak_number}</span>
                  ) : (
                    <Badge className="bg-red-100 text-red-700 text-xs">Belum diisi</Badge>
                  )}
                </TableCell>
              )}
              {showBukti && (
                <TableCell>
                  {item.bukti_potong_number ? (
                    <span className="text-xs text-green-700 font-mono">{item.bukti_potong_number}</span>
                  ) : (
                    <Badge className="bg-red-100 text-red-700 text-xs">Belum diisi</Badge>
                  )}
                </TableCell>
              )}
              <TableCell className="text-right text-sm">{formatRp(Number(item.base_amount))}</TableCell>
              <TableCell className="text-right text-sm font-medium text-red-600">{formatRp(Number(item.tax_amount))}</TableCell>
              <TableCell>
                <Badge className={
                  item.status === "paid" ? "bg-green-100 text-green-700" :
                  item.status === "reported" ? "bg-blue-100 text-blue-700" :
                  "bg-orange-100 text-orange-700"
                }>{item.status}</Badge>
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" onClick={() => onEdit(item)}>
                  <Pencil className="w-4 h-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const TABS = [
  { key: "npwp", label: "Tanpa NPWP/NIK" },
  { key: "faktur", label: "Tanpa Faktur/Bukti Potong" },
  { key: "unpaid", label: "Belum Dibayar" },
];

export default function TaxMissingCompliancePage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("npwp");
  const [period, setPeriod] = useState("all");
  const [editItem, setEditItem] = useState<TaxItem | null>(null);

  const companyId = typeof activeCompanyId === "number" && activeCompanyId > 0 ? activeCompanyId : null;

  const summaryParams = new URLSearchParams();
  if (companyId != null) summaryParams.set("companyId", String(companyId));
  if (period !== "all") summaryParams.set("period", period);

  const { data: summary, refetch: refetchSummary } = useQuery<ComplianceSummary>({
    queryKey: ["tax-compliance-summary", companyId, period],
    queryFn: () => fetch(`/api/tax/compliance-summary?${summaryParams}`, { credentials: "include" }).then((r) => r.json()),
  });

  const npwpParams = new URLSearchParams({ limit: "200" });
  if (companyId != null) npwpParams.set("companyId", String(companyId));
  if (period !== "all") npwpParams.set("period", period);

  const { data: npwpData, isLoading: npwpLoading, refetch: refetchNpwp } = useQuery<{ total: number; items: TaxItem[] }>({
    queryKey: ["tax-npwp-missing", companyId, period],
    queryFn: () => fetch(`/api/tax/npwp-missing?${npwpParams}`, { credentials: "include" }).then((r) => r.json()),
    enabled: activeTab === "npwp",
  });

  const fakturParams = new URLSearchParams({ limit: "200" });
  if (companyId != null) fakturParams.set("companyId", String(companyId));
  if (period !== "all") fakturParams.set("period", period);

  const { data: fakturData, isLoading: fakturLoading, refetch: refetchFaktur } = useQuery<{
    total: number;
    ppnOutputMissingFaktur: TaxItem[];
    pphWithholdingMissingBukti: TaxItem[];
  }>({
    queryKey: ["tax-faktur-missing", companyId, period],
    queryFn: () => fetch(`/api/tax/faktur-missing?${fakturParams}`, { credentials: "include" }).then((r) => r.json()),
    enabled: activeTab === "faktur",
  });

  const unpaidParams = new URLSearchParams({ limit: "200" });
  if (companyId != null) unpaidParams.set("companyId", String(companyId));
  if (period !== "all") unpaidParams.set("period", period);

  const { data: unpaidData, isLoading: unpaidLoading, refetch: refetchUnpaid } = useQuery<{ total: number; items: TaxItem[] }>({
    queryKey: ["tax-unpaid", companyId, period],
    queryFn: () => fetch(`/api/tax/unpaid?${unpaidParams}`, { credentials: "include" }).then((r) => r.json()),
    enabled: activeTab === "unpaid",
  });

  function handleRefresh() {
    refetchSummary();
    if (activeTab === "npwp") refetchNpwp();
    else if (activeTab === "faktur") refetchFaktur();
    else refetchUnpaid();
  }

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ["tax-compliance-summary", companyId, period] });
    qc.invalidateQueries({ queryKey: ["tax-npwp-missing", companyId, period] });
    qc.invalidateQueries({ queryKey: ["tax-faktur-missing", companyId, period] });
    qc.invalidateQueries({ queryKey: ["tax-unpaid", companyId, period] });
  }

  return (
    <AppShell>
      <BackButton href="/finance/workspace/tax-center" />
      <div className="p-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-orange-500" />
              Kepatuhan Pajak
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Audit kelengkapan data perpajakan: NPWP, faktur pajak, bukti potong
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p} value={p}>{p === "all" ? "Semua Periode" : p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { label: "Tanpa NPWP/NIK", count: summary?.npwpMissing ?? 0 },
            { label: "Faktur Pajak Kosong", count: summary?.fakturPajakMissing ?? 0 },
            { label: "Bukti Potong Kosong", count: summary?.buktiPotongMissing ?? 0 },
            { label: "Jumlah Belum Bayar", count: summary?.unpaidCount ?? 0 },
          ].map((s) => (
            <div key={s.label} className={`rounded-lg border p-4 ${s.count > 0 ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
              <div className={`text-2xl font-bold ${s.count > 0 ? "text-red-600" : "text-green-600"}`}>{s.count}</div>
              <div className={`text-xs mt-1 ${s.count > 0 ? "text-red-700" : "text-green-700"}`}>{s.label}</div>
            </div>
          ))}
          <div className={`rounded-lg border p-4 ${(summary?.unpaidTotalAmount ?? 0) > 0 ? "border-orange-200 bg-orange-50" : "border-green-200 bg-green-50"}`}>
            <div className={`text-lg font-bold ${(summary?.unpaidTotalAmount ?? 0) > 0 ? "text-orange-600" : "text-green-600"}`}>
              {formatRp(summary?.unpaidTotalAmount ?? 0)}
            </div>
            <div className={`text-xs mt-1 ${(summary?.unpaidTotalAmount ?? 0) > 0 ? "text-orange-700" : "text-green-700"}`}>
              Total Belum Dibayar
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="pt-6">
            {activeTab === "npwp" && (
              <TaxItemTable
                items={npwpData?.items ?? []}
                isLoading={npwpLoading}
                onEdit={setEditItem}
              />
            )}
            {activeTab === "faktur" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    PPN Output — Belum ada Faktur Pajak
                    <Badge variant="destructive" className="text-xs">
                      {fakturData?.ppnOutputMissingFaktur?.length ?? 0}
                    </Badge>
                  </h3>
                  <TaxItemTable
                    items={fakturData?.ppnOutputMissingFaktur ?? []}
                    isLoading={fakturLoading}
                    onEdit={setEditItem}
                    showFaktur
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    PPh Withholding — Belum ada Bukti Potong
                    <Badge variant="destructive" className="text-xs">
                      {fakturData?.pphWithholdingMissingBukti?.length ?? 0}
                    </Badge>
                  </h3>
                  <TaxItemTable
                    items={fakturData?.pphWithholdingMissingBukti ?? []}
                    isLoading={fakturLoading}
                    onEdit={setEditItem}
                    showBukti
                  />
                </div>
              </div>
            )}
            {activeTab === "unpaid" && (
              <TaxItemTable
                items={unpaidData?.items ?? []}
                isLoading={unpaidLoading}
                onEdit={setEditItem}
                showFaktur
                showBukti
              />
            )}
          </CardContent>
        </Card>

        <PatchDialog
          open={!!editItem}
          item={editItem}
          onClose={() => setEditItem(null)}
          onSaved={handleSaved}
        />
      </div>
    </AppShell>
  );
}
