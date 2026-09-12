import { useState, useCallback, useRef, useEffect } from "react";
import { QueryState } from "@/components/ui/query-state";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, CheckCircle2, Download, RefreshCw,
  FileText, ShieldCheck, Info, XCircle, PencilLine,
  Save, ChevronDown, ChevronUp, Loader2, Search, Sparkles, ArrowLeft,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";
import { BackButton } from "@/components/ui/back-button";

// ── helpers ──────────────────────────────────────────────────────────────────

function generatePeriods() {
  const p: string[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    p.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return p;
}

const PERIODS = generatePeriods();

function periodLabel(p: string) {
  const [y, m] = p.split("-");
  const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${MONTHS[parseInt(m ?? "1") - 1]} ${y}`;
}

function formatNpwp(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 15);
  if (d.length < 3) return d;
  if (d.length < 6) return `${d.slice(0,2)}.${d.slice(2)}`;
  if (d.length < 9) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
  if (d.length < 10) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}.${d.slice(8)}`;
  if (d.length < 13) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}.${d.slice(8,9)}-${d.slice(9)}`;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}.${d.slice(8,9)}-${d.slice(9,12)}.${d.slice(12)}`;
}

function formatFaktur(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 16);
  if (d.length < 4) return d;
  if (d.length < 7) return `${d.slice(0,3)}.${d.slice(3)}`;
  if (d.length < 10) return `${d.slice(0,3)}.${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length < 12) return `${d.slice(0,3)}.${d.slice(3,6)}-${d.slice(6,8)}.${d.slice(8)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}-${d.slice(6,8)}.${d.slice(8)}`;
}

function isNpwpValid(v: string) {
  return v.replace(/\D/g, "").length === 15;
}
function isFakturValid(v: string) {
  return v.replace(/\D/g, "").length === 16;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface EfakturSide { total: number; npwpMissing: number; fakturMissing: number; }
interface PphByType  { taxName: string; total: number; npwpMissing: number; bukpotMissing: number; }
interface ValidateResult {
  period: string;
  efaktur: {
    keluaran: EfakturSide;
    masukan: EfakturSide;
    npwpFormatInvalid: number;
    fakturFormatInvalid: number;
    readyToExport: boolean;
    issues: number;
  };
  ebupot: {
    total: number;
    byType: PphByType[];
    npwpMissing: number;
    bukpotMissing: number;
    bukpotFormatInvalid: number;
    readyToExport: boolean;
    issues: number;
  };
}

interface IssueRow {
  id: number;
  period: string;
  direction: string;
  transaction_type: string;
  tax_name: string;
  transaction_ref: string | null;
  partner_name: string | null;
  npwp: string;
  faktur_number: string;
  bukpot_number: string;
  base_amount: number;
  tax_amount: number;
  status: string;
  npwp_issue: boolean;
  faktur_issue: boolean;
  bukpot_issue: boolean;
}

// ── sub-components ────────────────────────────────────────────────────────────

function IssueCount({ label, count, warn = false }: { label: string; count: number; warn?: boolean }) {
  if (count === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-700">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>{label}</span>
        <Badge className="ml-auto bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-medium hover:bg-emerald-100">OK</Badge>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 text-sm ${warn ? "text-orange-700" : "text-red-700"}`}>
      {warn ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
      <span>{label}</span>
      <Badge className={`ml-auto text-xs font-medium ${warn ? "bg-orange-100 text-orange-800 border border-orange-300 hover:bg-orange-100" : "bg-red-100 text-red-800 border border-red-300 hover:bg-red-100"}`}>
        {count} baris
      </Badge>
    </div>
  );
}

function ExportButton({ label, href, disabled, loading }: { label: string; href: string; disabled?: boolean; loading?: boolean }) {
  return (
    <Button variant="default" size="sm" disabled={disabled || loading} className="gap-2"
      onClick={() => { if (!disabled) window.open(href, "_blank"); }}>
      <Download className="h-4 w-4" />{label}
    </Button>
  );
}

// ── NpwpLookupDropdown ────────────────────────────────────────────────────────

type LookupCandidate = {
  id: number; name: string; npwp: string; source: "supplier" | "customer"; email?: string; phone?: string;
};

function NpwpLookupDropdown({
  partnerName,
  companyId,
  onSelect,
}: {
  partnerName: string;
  companyId: number | null;
  onSelect: (npwp: string) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [candidates, setCandidates] = useState<LookupCandidate[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function lookup() {
    if (!partnerName || partnerName.length < 2) {
      toast.error("Nama mitra terlalu pendek untuk dicari");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ partnerName });
      if (companyId) params.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/export/lookup-npwp?${params}`, { credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Gagal mencari");
      setCandidates(data.items ?? []);
      setOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal mencari NPWP");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[10px] border-dashed shrink-0"
        onClick={lookup}
        disabled={loading}
        title="Cari NPWP dari master vendor/customer"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
      </Button>
      {open && (
        <div className="absolute z-50 top-8 left-0 w-72 rounded-lg border bg-white shadow-lg overflow-hidden">
          {candidates.length === 0 ? (
            <div className="text-xs text-muted-foreground px-3 py-2.5">
              Tidak ada mitra dengan NPWP ditemukan untuk "<span className="font-medium">{partnerName}</span>"
            </div>
          ) : (
            <>
              <div className="text-[10px] text-muted-foreground px-3 py-1.5 bg-gray-50 border-b font-medium uppercase tracking-wide">
                Pilih NPWP dari master data
              </div>
              {candidates.map((c) => (
                <button
                  key={`${c.source}-${c.id}`}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b last:border-b-0"
                  onClick={() => { onSelect(c.npwp); setOpen(false); }}
                >
                  <div className="text-xs font-medium truncate">{c.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-mono text-blue-700">{formatNpwp(c.npwp)}</span>
                    <Badge variant="outline" className={`text-[9px] h-4 px-1 ${c.source === "supplier" ? "border-purple-300 text-purple-700" : "border-teal-300 text-teal-700"}`}>
                      {c.source === "supplier" ? "Vendor" : "Customer"}
                    </Badge>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── InlineEditRow component ───────────────────────────────────────────────────

function InlineEditRow({
  row, companyId, onSaved,
}: {
  row: IssueRow;
  companyId: number | null;
  onSaved: () => void;
}) {
  const [npwp, setNpwp]     = useState(row.npwp ?? "");
  const [faktur, setFaktur] = useState(row.faktur_number ?? "");
  const [bukpot, setBukpot] = useState(row.bukpot_number ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  const isWithholding = row.direction === "withholding";
  const npwpOk    = isNpwpValid(npwp);
  const fakturOk  = isFakturValid(faktur);
  const bukpotOk  = bukpot.length >= 8;
  const canSave   = isWithholding
    ? (npwpOk && bukpotOk)
    : (npwpOk && fakturOk);
  const dirty = npwp !== (row.npwp ?? "") || faktur !== (row.faktur_number ?? "") || bukpot !== (row.bukpot_number ?? "");

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      if (npwp !== row.npwp) body.npwp = npwp.replace(/\D/g, "").slice(0, 15);
      if (!isWithholding && faktur !== row.faktur_number) body.fakturPajakNumber = faktur;
      if (isWithholding  && bukpot !== row.bukpot_number)  body.buktiPotongNumber = bukpot;

      const r = await fetch(`/api/tax/transactions/${row.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).message ?? "Gagal menyimpan");
      setSaved(true);
      toast.success(`Baris #${row.id} berhasil disimpan`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  const dirBadge = isWithholding
    ? <Badge className="text-xs shrink-0 bg-slate-200 text-slate-700 hover:bg-slate-200">PPh</Badge>
    : row.direction === "input"
    ? <Badge className="text-xs shrink-0 bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-100">Masukan</Badge>
    : <Badge className="text-xs shrink-0 bg-orange-100 text-orange-700 border border-orange-300 hover:bg-orange-100">Keluaran</Badge>;

  const txTypeLabelMap: Record<string, string> = {
    sales_order: "Jual",
    purchase_order: "Beli",
    expense: "Biaya",
    logistic_order: "Logistik",
  };
  const txTypeBadge = row.transaction_type ? (
    <Badge className="text-xs shrink-0 bg-slate-100 text-slate-600 border border-slate-300 hover:bg-slate-100">
      {txTypeLabelMap[row.transaction_type] ?? row.transaction_type}
    </Badge>
  ) : null;

  return (
    <TableRow className={saved ? "bg-emerald-50/40" : ""}>
      <TableCell className="py-2 max-w-[140px]">
        <div className="text-xs font-medium truncate">{row.partner_name || "-"}</div>
        <div className="text-[10px] text-muted-foreground truncate">{row.tax_name}</div>
        <div className="flex items-center gap-1 mt-0.5">{dirBadge}{txTypeBadge}</div>
      </TableCell>

      <TableCell className="py-2">
        <div className="flex items-center gap-1">
          <Input
            value={npwp}
            onChange={(e) => setNpwp(formatNpwp(e.target.value))}
            placeholder="XX.XXX.XXX.X-XXX.XXX"
            className={`h-7 text-xs font-mono w-44 ${row.npwp_issue ? "border-red-300 focus-visible:ring-red-400" : ""} ${isNpwpValid(npwp) ? "border-emerald-400" : ""}`}
          />
          <NpwpLookupDropdown
            partnerName={row.partner_name ?? ""}
            companyId={companyId}
            onSelect={(val) => setNpwp(formatNpwp(val))}
          />
          {isNpwpValid(npwp) && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
          {npwp && !isNpwpValid(npwp) && <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
        </div>
      </TableCell>

      {!isWithholding ? (
        <TableCell className="py-2">
          <div className="flex items-center gap-1">
            <Input
              value={faktur}
              onChange={(e) => setFaktur(formatFaktur(e.target.value))}
              placeholder="KKK.SSS-TT.SSSSSSSS"
              className={`h-7 text-xs font-mono w-48 ${row.faktur_issue ? "border-red-300 focus-visible:ring-red-400" : ""} ${isFakturValid(faktur) ? "border-emerald-400" : ""}`}
            />
            {isFakturValid(faktur) && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
            {faktur && !isFakturValid(faktur) && <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
          </div>
        </TableCell>
      ) : (
        <TableCell className="py-2">
          <div className="flex items-center gap-1">
            <Input
              value={bukpot}
              onChange={(e) => setBukpot(e.target.value)}
              placeholder="No. Bukti Potong"
              className={`h-7 text-xs w-48 ${row.bukpot_issue ? "border-red-300 focus-visible:ring-red-400" : ""} ${bukpotOk ? "border-emerald-400" : ""}`}
            />
            {bukpotOk && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
          </div>
        </TableCell>
      )}

      <TableCell className="py-2 text-right">
        <div className="text-xs font-medium">
          Rp {Math.round(row.tax_amount).toLocaleString("id-ID")}
        </div>
        <div className="text-[10px] text-muted-foreground">
          DPP {Math.round(row.base_amount).toLocaleString("id-ID")}
        </div>
      </TableCell>

      <TableCell className="py-2">
        {saved ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
        ) : (
          <Button
            size="sm"
            variant={canSave && dirty ? "default" : "outline"}
            className="h-7 px-2.5 text-xs gap-1"
            disabled={!canSave || !dirty || saving}
            onClick={save}
          >
            {saving
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Save className="h-3.5 w-3.5" />}
            {saving ? "Simpan…" : "Simpan"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── IssuesPanel component ─────────────────────────────────────────────────────

function IssuesPanel({
  period, companyId, totalIssues, onFixed,
}: {
  period: string;
  companyId: number | null;
  totalIssues: number;
  onFixed: () => void;
}) {
  const [open, setOpen]               = useState(false);
  const [filter, setFilter]           = useState<"all" | "npwp" | "faktur" | "bukpot">("all");
  const [txTypeFilter, setTxTypeFilter] = useState<string>("all");
  const [savedCount, setSavedCount]   = useState(0);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillResult, setAutofillResult] = useState<{ updated: number } | null>(null);
  const [autofillingFaktur, setAutofillingFaktur] = useState(false);
  const [autofillFakturResult, setAutofillFakturResult] = useState<{ updated: number } | null>(null);
  const [autofillingPartner, setAutofillingPartner] = useState(false);
  const [autofillPartnerResult, setAutofillPartnerResult] = useState<{ updated: number } | null>(null);
  const [autofillingPurchasePartner, setAutofillingPurchasePartner] = useState(false);
  const [autofillPurchasePartnerResult, setAutofillPurchasePartnerResult] = useState<{ updated: number } | null>(null);
  const [autofillingPurchaseFaktur, setAutofillingPurchaseFaktur] = useState(false);
  const [autofillPurchaseFakturResult, setAutofillPurchaseFakturResult] = useState<{ updated: number } | null>(null);
  const [autofillingByTxn, setAutofillingByTxn] = useState(false);
  const [autofillByTxnResult, setAutofillByTxnResult] = useState<{ updated: number } | null>(null);

  const params = new URLSearchParams({ period, type: filter });
  if (companyId) params.set("companyId", String(companyId));
  if (txTypeFilter !== "all") params.set("txType", txTypeFilter);

  const { data, isLoading, refetch } = useQuery<{ total: number; items: IssueRow[] }>({
    queryKey: ["tax-export-issues", companyId, period, filter, txTypeFilter],
    queryFn: () => fetch(`/api/tax/export/issues?${params}`, { credentials: "include" }).then((r) => r.json()),
    enabled: open,
  });

  function handleSaved() {
    setSavedCount((c) => c + 1);
    refetch();
    onFixed();
  }

  async function runAutofill() {
    setAutofilling(true);
    setAutofillResult(null);
    try {
      const p = new URLSearchParams({ period });
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/export/autofill-npwp?${p}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? "Gagal auto-isi");
      setAutofillResult({ updated: body.updated ?? 0 });
      if (body.updated > 0) {
        toast.success(body.message);
        refetch();
        onFixed();
      } else {
        toast.info("Tidak ada NPWP yang bisa diisi otomatis (nama mitra tidak cocok atau master kosong)");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal auto-isi NPWP");
    } finally {
      setAutofilling(false);
    }
  }

  async function runAutofillFaktur() {
    setAutofillingFaktur(true);
    setAutofillFakturResult(null);
    try {
      const p = new URLSearchParams({ period });
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/export/autofill-faktur?${p}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? "Gagal auto-isi faktur");
      setAutofillFakturResult({ updated: body.updated ?? 0 });
      if (body.updated > 0) {
        toast.success(body.message);
        refetch();
        onFixed();
      } else {
        toast.info("Tidak ada No. Faktur yang bisa diisi otomatis (invoice penjualan belum memiliki nomor faktur atau sudah terisi)");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal auto-isi No. Faktur");
    } finally {
      setAutofillingFaktur(false);
    }
  }

  async function runAutofillPartner() {
    setAutofillingPartner(true);
    setAutofillPartnerResult(null);
    try {
      const p = new URLSearchParams({ period });
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/export/autofill-partner?${p}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? "Gagal auto-isi nama mitra");
      setAutofillPartnerResult({ updated: body.updated ?? 0 });
      if (body.updated > 0) {
        toast.success(body.message);
        refetch();
        onFixed();
      } else {
        toast.info("Tidak ada Nama Mitra yang perlu diisi (sudah terisi atau tidak ada sales order terkait)");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal auto-isi Nama Mitra");
    } finally {
      setAutofillingPartner(false);
    }
  }

  async function runAutofillByTxn() {
    setAutofillingByTxn(true);
    setAutofillByTxnResult(null);
    try {
      const p = new URLSearchParams({ period });
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/export/autofill-npwp-by-txn?${p}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? "Gagal auto-isi NPWP via relasi");
      setAutofillByTxnResult({ updated: body.updated ?? 0 });
      if (body.updated > 0) {
        toast.success(body.message);
        refetch();
        onFixed();
      } else {
        toast.info(body.message ?? "Tidak ada NPWP yang bisa diisi via relasi transaksi langsung");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal auto-isi NPWP via relasi transaksi");
    } finally {
      setAutofillingByTxn(false);
    }
  }

  async function runAutofillPurchasePartner() {
    setAutofillingPurchasePartner(true);
    setAutofillPurchasePartnerResult(null);
    try {
      const p = new URLSearchParams({ period });
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/export/autofill-purchase-partner?${p}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? "Gagal auto-isi nama mitra pembelian");
      setAutofillPurchasePartnerResult({ updated: body.updated ?? 0 });
      if (body.updated > 0) {
        toast.success(body.message);
        refetch();
        onFixed();
      } else {
        toast.info("Tidak ada Nama Mitra pembelian yang perlu diisi (sudah terisi atau tidak ada purchase order terkait)");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal auto-isi Nama Mitra pembelian");
    } finally {
      setAutofillingPurchasePartner(false);
    }
  }

  async function runAutofillPurchaseFaktur() {
    setAutofillingPurchaseFaktur(true);
    setAutofillPurchaseFakturResult(null);
    try {
      const p = new URLSearchParams({ period });
      if (companyId) p.set("companyId", String(companyId));
      const r = await fetch(`/api/tax/export/autofill-purchase-faktur?${p}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message ?? "Gagal auto-isi no. faktur pembelian");
      setAutofillPurchaseFakturResult({ updated: body.updated ?? 0 });
      if (body.updated > 0) {
        toast.success(body.message);
        refetch();
        onFixed();
      } else {
        toast.info("Tidak ada No. Faktur pembelian yang bisa diisi (bill_number belum ada atau sudah terisi)");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Gagal auto-isi No. Faktur pembelian");
    } finally {
      setAutofillingPurchaseFaktur(false);
    }
  }

  if (totalIssues === 0) return null;

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50/30 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-orange-50/60 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-orange-800 flex-wrap">
          <PencilLine className="h-4 w-4" />
          Perbaiki Data Bermasalah
          <Badge className="bg-orange-500 text-white text-xs font-semibold px-2 py-0.5 hover:bg-orange-500">
            {totalIssues} baris perlu dilengkapi
          </Badge>
          {savedCount > 0 && (
            <Badge className="bg-emerald-500 text-white text-xs font-semibold px-2 py-0.5 hover:bg-emerald-500">
              {savedCount} disimpan
            </Badge>
          )}
          {autofillResult && autofillResult.updated > 0 && (
            <Badge className="bg-blue-500 text-white text-xs font-semibold px-2 py-0.5 hover:bg-blue-500">
              {autofillResult.updated} NPWP diisi otomatis
            </Badge>
          )}
          {autofillFakturResult && autofillFakturResult.updated > 0 && (
            <Badge className="bg-emerald-500 text-white text-xs font-semibold px-2 py-0.5 hover:bg-emerald-500">
              {autofillFakturResult.updated} No. Faktur diisi otomatis
            </Badge>
          )}
          {autofillPartnerResult && autofillPartnerResult.updated > 0 && (
            <Badge className="bg-violet-500 text-white text-xs font-semibold px-2 py-0.5 hover:bg-violet-500">
              {autofillPartnerResult.updated} Nama Mitra diisi otomatis
            </Badge>
          )}
          {autofillPurchasePartnerResult && autofillPurchasePartnerResult.updated > 0 && (
            <Badge className="bg-amber-500 text-white text-xs font-semibold px-2 py-0.5 hover:bg-amber-500">
              {autofillPurchasePartnerResult.updated} Nama Mitra PO diisi otomatis
            </Badge>
          )}
          {autofillPurchaseFakturResult && autofillPurchaseFakturResult.updated > 0 && (
            <Badge className="bg-teal-500 text-white text-xs font-semibold px-2 py-0.5 hover:bg-teal-500">
              {autofillPurchaseFakturResult.updated} No. Faktur PO diisi otomatis
            </Badge>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-orange-600" /> : <ChevronDown className="h-4 w-4 text-orange-600" />}
      </button>

      {open && (
        <div className="border-t border-orange-200">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-white/60 border-b border-orange-100">
            <span className="text-xs text-muted-foreground">Masalah:</span>
            {(["all", "npwp", "faktur", "bukpot"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                className="h-6 px-2.5 text-[11px]"
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "Semua" : f === "npwp" ? "NPWP" : f === "faktur" ? "No. Faktur" : "No. Bukpot"}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground ml-2">Tipe:</span>
            {([
              { value: "all", label: "Semua" },
              { value: "sales_order", label: "Penjualan" },
              { value: "purchase_order", label: "Pembelian" },
              { value: "expense", label: "Biaya" },
              { value: "logistic_order", label: "Logistik" },
            ]).map(({ value, label }) => (
              <Button
                key={value}
                size="sm"
                variant={txTypeFilter === value ? "secondary" : "outline"}
                className="h-6 px-2.5 text-[11px]"
                onClick={() => setTxTypeFilter(value)}
              >
                {label}
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2.5 text-[11px] gap-1 border-indigo-400 text-indigo-700 hover:bg-indigo-50 font-semibold"
                onClick={runAutofillByTxn}
                disabled={autofillingByTxn}
                title="Isi NPWP via relasi langsung: transaction_id → purchase_documents → supplier.tax_id (akurat, tidak butuh nama cocok)"
              >
                {autofillingByTxn
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Sparkles className="h-3 w-3" />}
                Auto-isi NPWP via Relasi ✓
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2.5 text-[11px] gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={runAutofill}
                disabled={autofilling}
                title="Isi NPWP dari master vendor/customer berdasarkan kecocokan nama (fallback jika relasi langsung tidak cukup)"
              >
                {autofilling
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Sparkles className="h-3 w-3" />}
                Auto-isi NPWP (Nama)
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2.5 text-[11px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={runAutofillFaktur}
                disabled={autofillingFaktur}
                title="Isi No. Faktur Pajak secara otomatis dari nomor invoice penjualan terkait"
              >
                {autofillingFaktur
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <FileText className="h-3 w-3" />}
                Auto-isi No. Faktur dari Invoice
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2.5 text-[11px] gap-1 border-violet-300 text-violet-700 hover:bg-violet-50"
                onClick={runAutofillPartner}
                disabled={autofillingPartner}
                title="Isi Nama Mitra secara otomatis dari nama customer di sales order terkait, agar Auto-isi NPWP punya lebih banyak kecocokan"
              >
                {autofillingPartner
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Sparkles className="h-3 w-3" />}
                Auto-isi Nama Mitra
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2.5 text-[11px] gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={runAutofillPurchasePartner}
                disabled={autofillingPurchasePartner}
                title="Isi Nama Mitra dari supplier_name di purchase order terkait (transaction_type=purchase_order)"
              >
                {autofillingPurchasePartner
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Sparkles className="h-3 w-3" />}
                Auto-isi Nama Mitra (PO)
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2.5 text-[11px] gap-1 border-teal-300 text-teal-700 hover:bg-teal-50"
                onClick={runAutofillPurchaseFaktur}
                disabled={autofillingPurchaseFaktur}
                title="Isi No. Faktur dari bill_number di purchase order terkait"
              >
                {autofillingPurchaseFaktur
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <FileText className="h-3 w-3" />}
                Auto-isi No. Faktur (PO)
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto max-h-[440px] overflow-y-auto">
            <QueryState
              loading={isLoading}
              empty={!isLoading && !data?.items?.length}
              emptyMessage="Tidak ada baris bermasalah pada filter ini"
              emptyIcon={<CheckCircle2 className="h-8 w-8 text-emerald-400 opacity-70" />}
              skeletonRows={3}
              className="p-4"
            >
              <Table>
                <TableHeader className="sticky top-0 bg-white/95 z-10">
                  <TableRow className="text-[11px]">
                    <TableHead className="w-[140px] py-2">Mitra / Jenis</TableHead>
                    <TableHead className="py-2">NPWP (15 digit)</TableHead>
                    <TableHead className="py-2">No. Faktur / Bukti Potong</TableHead>
                    <TableHead className="py-2 text-right">Pajak</TableHead>
                    <TableHead className="py-2 w-20">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.items ?? []).map((row) => (
                    <InlineEditRow key={row.id} row={row} companyId={companyId} onSaved={handleSaved} />
                  ))}
                </TableBody>
              </Table>
            </QueryState>
          </div>

          {data?.total === 200 && (
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-orange-100 bg-white/40">
              Menampilkan 200 baris pertama. Perbaiki dan refresh untuk melihat baris berikutnya.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

interface CompanyProfile {
  npwp: string | null;
  name: string;
  npwp_missing: boolean;
  npwp_digits: number;
}

export default function TaxExportDjpPage() {
  const { selectedCompanyId } = useCompany();
  const [period, setPeriod] = useState(PERIODS[0]!);
  const [tab, setTab] = useState<"efaktur" | "ebupot">("efaktur");

  const params = new URLSearchParams({ period });
  if (selectedCompanyId) params.set("companyId", String(selectedCompanyId));

  const { data, isLoading, isFetching, refetch } = useQuery<ValidateResult>({
    queryKey: ["tax-export-validate", selectedCompanyId, period],
    queryFn: () =>
      fetch(`/api/tax/export/validate?${params}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!period,
  });

  // Fetch company NPWP status
  const cpParams = new URLSearchParams();
  if (selectedCompanyId) cpParams.set("companyId", String(selectedCompanyId));
  const { data: companyProfile } = useQuery<CompanyProfile>({
    queryKey: ["tax-company-profile", selectedCompanyId],
    queryFn: () =>
      fetch(`/api/tax/spt-builder/company-profile?${cpParams}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!selectedCompanyId,
    staleTime: 60_000,
  });

  function exportUrl(path: string, extra: Record<string, string> = {}) {
    const p = new URLSearchParams({ period, ...extra });
    if (selectedCompanyId) p.set("companyId", String(selectedCompanyId));
    return `/api/tax/export/${path}?${p}`;
  }

  const handleFixed = useCallback(() => {
    setTimeout(() => refetch(), 600);
  }, [refetch]);

  const ef = data?.efaktur;
  const eb = data?.ebupot;
  const totalIssues = (tab === "efaktur" ? ef?.issues : eb?.issues) ?? 0;

  return (
    <AppShell>
      <BackButton href="/finance/workspace/tax-center" />
      <div className="p-6 space-y-5 max-w-4xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600" />
              Export SPT Masa — DJP
            </h1>
            <p className="text-sm text-muted-foreground">
              Validasi, lengkapi, dan unduh file e-Faktur / e-Bupot siap upload ke DJP
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={(v) => { setPeriod(v); }}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue>{periodLabel(period)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* ── Warning NPWP Perusahaan kosong ── */}
        {companyProfile?.npwp_missing && (
          <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-300 p-3.5 text-sm text-red-800">
            <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
            <div>
              <span className="font-semibold">NPWP Perusahaan belum diatur!</span>{" "}
              File CSV yang diunduh akan memuat NPWP <code className="bg-red-100 px-1 rounded font-mono text-xs">000000000000000</code>{" "}
              dan <strong>tidak akan diterima DJP</strong>.{" "}
              Isi NPWP perusahaan di <strong>Settings → Company → NPWP</strong> sebelum export.
            </div>
          </div>
        )}

        {/* ── NPWP info jika sudah diset ── */}
        {companyProfile && !companyProfile.npwp_missing && (
          <div className="flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs text-emerald-800">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              <span className="font-semibold">NPWP Perusahaan:</span>{" "}
              <code className="font-mono bg-emerald-100 px-1 rounded">{companyProfile.npwp}</code>
              {" "}— akan otomatis tercantum di semua file CSV/XML yang diunduh.
            </span>
          </div>
        )}

        {/* ── Info banner ── */}
        <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 p-3.5 text-sm text-blue-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Cara pakai:</span>{" "}
            Pilih masa pajak → periksa validasi → klik <strong>Perbaiki Data</strong> untuk melengkapi NPWP / nomor faktur langsung di sini → klik Download.
          </div>
        </div>

        {/* ── Tabs ── */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="efaktur" className="gap-2">
              e-Faktur PPN
              {ef && ef.issues > 0 && (
                <Badge variant="destructive" className="text-xs font-semibold ml-1 px-1.5">{ef.issues}</Badge>
              )}
              {ef && ef.issues === 0 && ef.keluaran.total + ef.masukan.total > 0 && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-1" />
              )}
            </TabsTrigger>
            <TabsTrigger value="ebupot" className="gap-2">
              e-Bupot PPh
              {eb && eb.issues > 0 && (
                <Badge variant="destructive" className="text-xs font-semibold ml-1 px-1.5">{eb.issues}</Badge>
              )}
              {eb && eb.issues === 0 && eb.total > 0 && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-1" />
              )}
            </TabsTrigger>
          </TabsList>

          {/* ──── e-Faktur tab ──── */}
          <TabsContent value="efaktur" className="space-y-4 mt-4">
            {isLoading ? (
              <div className="space-y-3">{[1,2].map((i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />)}</div>
            ) : !ef ? null : (
              <>
                {/* Validation cards */}
                {/* Info NPWP konsumen akhir */}
                <div className="flex items-start gap-2.5 rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-600">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-500" />
                  <span>
                    <strong>NPWP pembeli kosong = otomatis diisi 000000000000000</strong> (konsumen akhir non-PKP).
                    Sesuai ketentuan DJP — perusahaan PKP tetap wajib memungut PPN. Yang wajib dilengkapi hanya <strong>nomor faktur pajak</strong> pada setiap transaksi.
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Card className={ef.keluaran.fakturMissing === 0 ? "border-emerald-200" : "border-orange-200"}>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
                        Faktur Keluaran
                        <Badge variant="secondary" className="ml-auto">{ef.keluaran.total} faktur</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-2">
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Info className="h-4 w-4 shrink-0" />
                        <span>NPWP pembeli</span>
                        <Badge className="ml-auto bg-slate-100 text-slate-600 border border-slate-300 text-xs font-medium hover:bg-slate-100">Auto 000…</Badge>
                      </div>
                      <IssueCount label="Nomor faktur pajak" count={ef.keluaran.fakturMissing} />
                    </CardContent>
                  </Card>
                  <Card className={ef.masukan.npwpMissing + ef.masukan.fakturMissing === 0 ? "border-emerald-200" : "border-orange-200"}>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                        Faktur Masukan
                        <Badge variant="secondary" className="ml-auto">{ef.masukan.total} faktur</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-2">
                      <IssueCount label="NPWP penjual" count={ef.masukan.npwpMissing} />
                      <IssueCount label="Nomor faktur pajak" count={ef.masukan.fakturMissing} />
                    </CardContent>
                  </Card>
                </div>

                {(ef.npwpFormatInvalid > 0 || ef.fakturFormatInvalid > 0) && (
                  <Card className="border-red-200 bg-red-50/40">
                    <CardContent className="p-4 space-y-2">
                      <p className="text-xs font-semibold text-red-700 mb-1">Format tidak valid:</p>
                      <IssueCount label="NPWP bukan 15 digit" count={ef.npwpFormatInvalid} />
                      <IssueCount label="Nomor faktur bukan 16 digit" count={ef.fakturFormatInvalid} />
                    </CardContent>
                  </Card>
                )}

                {/* Status banner */}
                {ef.keluaran.total + ef.masukan.total === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 border p-3 text-sm text-muted-foreground">
                    <Info className="h-4 w-4" />
                    Tidak ada data PPN untuk {periodLabel(period)}
                  </div>
                ) : ef.readyToExport ? (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                    <ShieldCheck className="h-4 w-4" />
                    Data siap export — nomor faktur lengkap dan NPWP valid
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 p-3 text-sm text-orange-800">
                    <AlertTriangle className="h-4 w-4" />
                    {ef.issues} masalah ditemukan — lengkapi nomor faktur atau NPWP penjual yang kosong
                  </div>
                )}

                {/* Inline fix panel */}
                <IssuesPanel
                  period={period}
                  companyId={selectedCompanyId}
                  totalIssues={ef.issues}
                  onFixed={handleFixed}
                />

                {/* Download buttons */}
                {ef.keluaran.total + ef.masukan.total > 0 && (
                  <div className="flex flex-wrap gap-3 pt-1">
                    <ExportButton label={`Unduh Keluaran (${ef.keluaran.total})`} href={exportUrl("efaktur", { direction: "keluaran" })} disabled={ef.keluaran.total === 0} loading={isFetching} />
                    <ExportButton label={`Unduh Masukan (${ef.masukan.total})`} href={exportUrl("efaktur", { direction: "masukan" })} disabled={ef.masukan.total === 0} loading={isFetching} />
                    <ExportButton label="Unduh Semua" href={exportUrl("efaktur", { direction: "all" })} loading={isFetching} />
                  </div>
                )}

                {/* Format notes */}
                <div className="rounded-lg bg-muted/40 border p-3.5 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground/70">Format e-Faktur DJP:</p>
                  <p>• File <code>.txt</code> pipe-delimited (<code>|</code>) — baris <code>FK</code> (header) + <code>OF</code> (detail) per faktur</p>
                  <p>• Import ke e-Faktur DJP: <em>Faktur → Import Faktur</em> (Keluaran) atau <em>Pajak Masukan → Upload CSV</em> (Masukan)</p>
                  <p>• NPWP wajib 15 digit, nomor faktur wajib 16 digit. Kode jenis transaksi default <code>01</code> — sesuaikan jika ada transaksi ke bendahara/fasilitas</p>
                </div>
              </>
            )}
          </TabsContent>

          {/* ──── e-Bupot tab ──── */}
          <TabsContent value="ebupot" className="space-y-4 mt-4">
            {isLoading ? (
              <div className="space-y-3">{[1,2].map((i) => <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />)}</div>
            ) : !eb ? null : (
              <>
                {eb.total === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 border p-3 text-sm text-muted-foreground">
                    <Info className="h-4 w-4" />
                    Tidak ada data PPh withholding untuk {periodLabel(period)}
                  </div>
                ) : (
                  <>
                    <div className="space-y-3">
                      {eb.byType.map((t, i) => (
                        <Card key={i} className={t.npwpMissing + t.bukpotMissing === 0 ? "border-emerald-200" : "border-orange-200"}>
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-sm font-semibold">{t.taxName}</span>
                              <Badge variant="secondary">{t.total} transaksi</Badge>
                            </div>
                            <div className="space-y-2">
                              <IssueCount label="NPWP yang dipotong" count={t.npwpMissing} />
                              <IssueCount label="Nomor bukti potong" count={t.bukpotMissing} warn />
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {eb.bukpotFormatInvalid > 0 && (
                      <Card className="border-red-200 bg-red-50/40">
                        <CardContent className="p-4">
                          <IssueCount label="Format nomor bukti potong terlalu pendek" count={eb.bukpotFormatInvalid} />
                        </CardContent>
                      </Card>
                    )}

                    {eb.readyToExport ? (
                      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                        <ShieldCheck className="h-4 w-4" />
                        Data siap export — semua NPWP dan nomor bukti potong valid
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 p-3 text-sm text-orange-800">
                        <AlertTriangle className="h-4 w-4" />
                        {eb.issues} masalah — perbaiki di bawah atau download tetap bisa (nomor bukpot kosong akan digenerate otomatis)
                      </div>
                    )}

                    {/* Inline fix panel */}
                    <IssuesPanel
                      period={period}
                      companyId={selectedCompanyId}
                      totalIssues={eb.issues}
                      onFixed={handleFixed}
                    />

                    {/* Download buttons */}
                    <div className="flex flex-wrap gap-3 pt-1">
                      {eb.byType.some((t) => /pph.?23|pasal.?23/i.test(t.taxName)) && (
                        <ExportButton label="Unduh e-Bupot PPh 23" href={exportUrl("ebupot", { jenisPph: "pph23" })} loading={isFetching} />
                      )}
                      {eb.byType.some((t) => /4.*\(2\)|pasal.?4.*final|final/i.test(t.taxName)) && (
                        <ExportButton label="Unduh e-Bupot PPh 4(2)" href={exportUrl("ebupot", { jenisPph: "pph4a2" })} loading={isFetching} />
                      )}
                      {eb.byType.some((t) => /pph.?21|pasal.?21/i.test(t.taxName)) && (
                        <ExportButton label="Unduh e-Bupot PPh 21" href={exportUrl("ebupot", { jenisPph: "pph21" })} loading={isFetching} />
                      )}
                      {!eb.byType.some((t) => /pph.?2[136]|pasal.?2[136]|4.*\(2\)|final/i.test(t.taxName)) && (
                        <ExportButton label="Unduh e-Bupot PPh 23" href={exportUrl("ebupot", { jenisPph: "pph23" })} loading={isFetching} />
                      )}
                    </div>
                  </>
                )}

                <div className="rounded-lg bg-muted/40 border p-3.5 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground/70">Format e-Bupot DJP:</p>
                  <p>• File <code>.csv</code> UTF-8 BOM — upload ke djponline.pajak.go.id</p>
                  <p>• <code>KODE_OBJEK_PAJAK</code> diderivasi otomatis dari nama pajak (misal <code>23-100-01</code> = jasa teknik) — verifikasi sebelum upload</p>
                  <p>• Nomor bukpot kosong akan digenerate otomatis format <code>BP/YYYY/MM/NNNNNN</code></p>
                  <p>• Upload di DJP Online: menu <em>Pelaporan → e-Bupot 23/26</em> atau <em>e-Bupot Unifikasi</em></p>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Link ke missing compliance */}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3.5 text-sm">
          <Info className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">
            Perlu melihat semua transaksi yang belum patuh?{" "}
            <a href="/tax/missing-compliance" className="text-indigo-600 hover:underline font-medium">
              Laporan Missing Compliance →
            </a>
          </span>
        </div>

      </div>
    </AppShell>
  );
}
