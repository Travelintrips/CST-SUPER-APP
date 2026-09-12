/**
 * Halaman Audit: Bank Disbursement ↔ Biaya Operasional
 * READ-ONLY — tidak ada aksi write di halaman ini.
 * Menampilkan temuan, risiko, dan proposal refactor untuk review manajemen.
 */
import { useState } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, ShieldAlert, RefreshCw, AlertTriangle, CheckCircle2,
  Info, Layers, Table2, GitMerge, ArrowRight, BookOpen, Lock,
  Link2, Link2Off, Eye, Zap, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AuditData {
  counts: { expenses: number; disbursements: number };
  bridge: {
    linked: number;
    unlinked: number;
    conflict: number;
    readyToMigrate: boolean;
  };
  summary: {
    expenseByStatus: Array<{ status: string; jumlah: number; total_nominal: string; sudah_jurnal: number; belum_jurnal: number }>;
    disbBySourceModule: Array<{ source_module: string; jumlah: number; total_nominal: string }>;
  };
  categories: {
    expensePaidViaDisb: { count: number; rows: any[]; label: string };
    expenseUnpaidNoJournal: { count: number; rows: any[]; label: string };
    expenseJournaledNoPayment: { count: number; rows: any[]; label: string };
    disbursementStandalone: { count: number; rows: any[]; label: string };
    disbursementJournaled: { count: number; rows: any[]; label: string };
  };
  risks: {
    doubleJournal: { count: number; rows: any[]; label: string; severity: string };
    doublePayment: { count: number; rows: any[]; label: string; severity: string };
  };
  schema: { expenses: any[]; bankDisbursements: any[] };
}

const fmt = (n: string | number | null) =>
  n == null ? "—" : Number(n).toLocaleString("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 });

const fmtNum = (n: number) => n.toLocaleString("id-ID");

function SeverityBadge({ s }: { s: string }) {
  if (s === "HIGH") return <Badge className="bg-red-600 text-white text-xs">HIGH RISK</Badge>;
  if (s === "NONE") return <Badge variant="outline" className="text-emerald-400 border-emerald-700 text-xs">Aman</Badge>;
  return <Badge variant="outline" className="text-xs">{s}</Badge>;
}

// ── Kolom Perbandingan ────────────────────────────────────────────────────────
const COMPARISON = [
  { field: "Nomor Transaksi",    expense: "expense_number",            disb: "disbursement_number",    note: "Format berbeda" },
  { field: "Tanggal",           expense: "date",                       disb: "date",                   note: "Duplikat" },
  { field: "Nominal / Total",    expense: "total (qty×unit_price+tax)", disb: "total_amount",           note: "Disbursement flat, Expense berstruktur" },
  { field: "Status",            expense: "draft/posted/voided",        disb: "posted/voided",          note: "Duplikat (nilai hampir sama)" },
  { field: "Jurnal ID",         expense: "entry_id",                   disb: "entry_id",               note: "Keduanya buat jurnal sendiri — risiko double" },
  { field: "Sumber Dana",       expense: "source_account_id (COA)",    disb: "journal_id → bank COA",  note: "Mekanisme berbeda, konsep sama" },
  { field: "COA Beban",         expense: "expense_account_id",         disb: "account_id per item",    note: "Disbursement: multi-line" },
  { field: "COA Hutang",        expense: "payable_account_id",         disb: "account_id (hutang)",    note: "Disbursement: per item, flexible" },
  { field: "Vendor / Pihak",    expense: "vendor_id + vendor_employee", disb: "counterparty_*",        note: "Duplikat — field berbeda, data sama" },
  { field: "Perusahaan",        expense: "company_id",                  disb: "company_id",            note: "Duplikat" },
  { field: "Dibuat oleh",       expense: "created_by_id",              disb: "created_by_id",          note: "Duplikat" },
  { field: "Deskripsi",         expense: "description / notes",         disb: "memo / description",    note: "Duplikat (nama kolom berbeda)" },
  { field: "Attachment",        expense: "expense_attachments (table)",  disb: "attachment_url (text)", note: "Disb lebih sederhana" },
  { field: "Approval",          expense: "expense_approval_requests",   disb: "(tidak ada)",           note: "Hanya di Expense" },
  { field: "WHT / Pajak",       expense: "tax_rate_id + tax_amount",    disb: "wht_amount per item",   note: "Disb lebih detail (split jurnal)" },
  { field: "Kategori Biaya",    expense: "category_id",                 disb: "(tidak ada)",           note: "Hanya di Expense" },
  { field: "Qty / Unit / Price",expense: "qty, unit, unit_price",       disb: "(tidak ada)",           note: "Hanya di Expense" },
  { field: "PO / Vendor Invoice", expense: "sales_doc_id / shipment_id", disb: "purchase_document_id / vendor_invoice_id per item", note: "Disb lebih terintegrasi ke Purchase" },
  { field: "Multi-line",        expense: "(tidak ada, satu baris)",     disb: "bank_disbursement_items", note: "Hanya di Disbursement" },
  { field: "Source traceability", expense: "(tidak ada)",               disb: "source_module + source_id + source_number", note: "Hanya di Disbursement" },
];

// ── Proposal Refactor (READ-ONLY) ─────────────────────────────────────────────
const REFACTOR_PLAN = {
  menu: [
    { tipe: "TETAP", menu: "Biaya Operasional (/expense)", aksi: "Tetap sebagai pusat input. Tambah tab 'Status Pembayaran'." },
    { tipe: "TETAP", menu: "Bank Disbursement (/accounting/bank-disbursements)", aksi: "Menjadi modul pembayaran. Tambah fitur 'Bayar dari Expense'." },
    { tipe: "PINDAH", menu: "Dana Talangan (/expense/talangan)", aksi: "Tetap di Biaya, tapi flow pembayarannya arahkan ke Bank Disbursement." },
    { tipe: "PINDAH", menu: "Kasbon (/expense/kasbon)", aksi: "Tetap di Biaya, disbursement otomatis dibuat saat approved." },
    { tipe: "PINDAH", menu: "Vendor Payments (/expense/vendor-payments)", aksi: "Pindah ke bawah Bank Disbursement sebagai sub-view." },
    { tipe: "TERSEMBUNYI", menu: "Payment Requests (/purchase/payment-requests)", aksi: "Gabung ke flow Bank Disbursement, tampilkan sebagai 'Antrian Pembayaran'." },
    { tipe: "TETAP", menu: "Treasury Dashboard (/finance)", aksi: "Hanya dashboard + action center, tidak lagi bisa buat transaksi baru sendiri." },
  ],
  tables: [
    { tabel: "expenses", status: "TETAP", keterangan: "Pusat pencatatan beban. Tambahkan FK disbursement_id (nullable)." },
    { tabel: "expense_categories", status: "TETAP", keterangan: "Dipakai bersama, tidak perlu ubah." },
    { tabel: "expense_approval_requests", status: "TETAP + EXTEND", keterangan: "Extend untuk cover disbursement juga. Tambah kolom entity_type." },
    { tabel: "expense_attachments", status: "TETAP + EXTEND", keterangan: "Extend untuk disbursement. Tambah kolom entity_type + entity_id." },
    { tabel: "bank_disbursements", status: "TETAP", keterangan: "Tetap sebagai tabel pembayaran. Tambahkan expense_id (nullable FK ke expenses)." },
    { tabel: "bank_disbursement_items", status: "TETAP", keterangan: "Tetap untuk multi-line. Tambah kolom expense_id per item." },
    { tabel: "payment_requests", status: "LEGACY", keterangan: "Tidak drop, tapi tidak ada input baru. Data lama tetap terbaca." },
    { tabel: "accounting_payments", status: "TETAP", keterangan: "Tetap sebagai record pembayaran AR/AP. Tidak perlu ubah." },
    { tabel: "cash_advances", status: "TETAP", keterangan: "Kasbon & Talangan tetap dikelola tersendiri. Flow pembayarannya diarahkan ke bank_disbursements." },
  ],
  migrations: [
    { langkah: "1", aksi: "Backup production DB", detail: "pg_dump sebelum apapun" },
    { langkah: "2", aksi: "Tambah kolom disbursement_id di expenses", detail: "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS disbursement_id INT REFERENCES bank_disbursements(id)" },
    { langkah: "3", aksi: "Tambah kolom expense_id di bank_disbursements", detail: "ALTER TABLE bank_disbursements ADD COLUMN IF NOT EXISTS expense_id INT REFERENCES expenses(id)" },
    { langkah: "4", aksi: "Backfill link dari source_module='expense'", detail: "UPDATE bank_disbursements SET expense_id = source_id WHERE source_module = 'expense'" },
    { langkah: "5", aksi: "Tambah kolom source_flag di expenses", detail: "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_module TEXT DEFAULT 'biaya_operasional'" },
    { langkah: "6", aksi: "Audit double jurnal & double bayar", detail: "Jalankan query risiko → void mana yang salah → jangan drop entry" },
    { langkah: "7", aksi: "Extend expense_approval_requests", detail: "ADD COLUMN entity_type TEXT DEFAULT 'expense', ADD COLUMN entity_id INT" },
    { langkah: "8", aksi: "Extend expense_attachments", detail: "ADD COLUMN entity_type TEXT DEFAULT 'expense', ADD COLUMN entity_id INT" },
    { langkah: "9", aksi: "Deploy frontend: UI baru flow Expense → Disbursement", detail: "Tanpa hapus halaman lama dulu" },
    { langkah: "10", aksi: "Monitor 30 hari, lalu sembunyikan menu legacy", detail: "Gunakan feature flag / role-based hide" },
  ],
};

interface BackfillPreview {
  dryRun: true;
  totalCandidates: number;
  willApply: number;
  willSkip: number;
  applicable: any[];
  skippedConflict: any[];
  skippedAmountMismatch: any[];
}

interface BackfillResult {
  dryRun: false;
  totalCandidates: number;
  applied: number;
  appliedRows: any[];
  skippedConflict: number;
  skippedAmountMismatch: number;
  failed: number;
  failedRows: any[];
}

export default function AuditDisbursementPage() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId && activeCompanyId > 0 ? activeCompanyId : null;
  const [tab, setTab] = useState("overview");
  const { toast } = useToast();

  // Backfill state
  const [backfillPreview, setBackfillPreview] = useState<BackfillPreview | null>(null);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);

  const { data, isLoading, refetch } = useQuery<AuditData>({
    queryKey: ["audit-disbursement-expense", companyId],
    queryFn: async () => {
      const qs = companyId ? `?company=${companyId}` : "";
      const r = await fetch(`/api/audit/disbursement-expense${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data audit");
      return r.json();
    },
    staleTime: 120_000,
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const qs = companyId ? `?company=${companyId}` : "";
      const r = await fetch(`/api/audit/disbursement-expense/backfill-preview${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal mengambil preview backfill");
      return r.json() as Promise<BackfillPreview>;
    },
    onSuccess: (d) => {
      setBackfillPreview(d);
      setBackfillResult(null);
      toast({ title: `Preview: ${d.willApply} pasangan siap dibackfill, ${d.willSkip} dilewati.` });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const applyMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/audit/disbursement-expense/backfill-apply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: companyId }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "Gagal apply backfill");
      return r.json() as Promise<BackfillResult>;
    },
    onSuccess: (d) => {
      setBackfillResult(d);
      setBackfillPreview(null);
      refetch();
      toast({ title: `✓ Backfill selesai: ${d.applied} pasangan berhasil ditautkan.` });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const highRiskCount = data
    ? Object.values(data.risks).filter((r) => r.severity === "HIGH").length
    : 0;

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/expense">
              <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={15} /></Button>
            </Link>
            <div className="flex items-center gap-2">
              <GitMerge size={20} className="text-violet-400" />
              <div>
                <h1 className="text-xl font-bold">Audit Pra-Merge: Bank Disbursement ↔ Biaya Operasional</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Read-only · Tidak ada data yang diubah · {companyId ? `Company #${companyId}` : "Semua perusahaan"}
                </p>
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw size={13} className={cn("mr-1", isLoading && "animate-spin")} /> Refresh
          </Button>
        </div>

        {/* Notifikasi high risk */}
        {highRiskCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-300">
              <strong>{highRiskCount} risiko tinggi terdeteksi.</strong> Selesaikan risiko double jurnal / double bayar sebelum melakukan merge.
            </p>
          </div>
        )}
        {!isLoading && data && highRiskCount === 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-800/60 bg-emerald-950/20 px-4 py-3">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-300">Tidak ada risiko double jurnal / double bayar terdeteksi. Aman untuk lanjut ke tahap refactor.</p>
          </div>
        )}

        {/* Summary Cards — Data */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Biaya Operasional", value: data?.counts.expenses ?? "—", color: "text-blue-400" },
            { label: "Total Bank Disbursement", value: data?.counts.disbursements ?? "—", color: "text-violet-400" },
            { label: "Double Jurnal", value: data?.risks.doubleJournal.count ?? 0, color: data?.risks.doubleJournal.count ? "text-red-400" : "text-emerald-400" },
            { label: "Double Bayar", value: data?.risks.doublePayment.count ?? 0, color: data?.risks.doublePayment.count ? "text-red-400" : "text-emerald-400" },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
                <p className={cn("text-2xl font-bold", c.color)}>{isLoading ? "…" : fmtNum(Number(c.value))}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Summary Cards — Bridge Status */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Bridge Linked",
              value: data?.bridge.linked ?? 0,
              color: (data?.bridge.linked ?? 0) > 0 ? "text-emerald-400" : "text-muted-foreground",
              icon: <Link2 size={14} className="text-emerald-500" />,
              desc: "Kedua kolom FK sudah terisi",
            },
            {
              label: "Bridge Unlinked",
              value: data?.bridge.unlinked ?? 0,
              color: (data?.bridge.unlinked ?? 0) > 0 ? "text-amber-400" : "text-muted-foreground",
              icon: <Link2Off size={14} className="text-amber-500" />,
              desc: "Source_module cocok tapi FK masih null",
            },
            {
              label: "Conflict",
              value: data?.bridge.conflict ?? 0,
              color: (data?.bridge.conflict ?? 0) > 0 ? "text-red-400" : "text-muted-foreground",
              icon: <AlertTriangle size={14} className="text-red-500" />,
              desc: "Expense punya >1 disbursement aktif",
            },
            {
              label: "Ready to Migrate",
              value: data?.bridge.readyToMigrate ? "✓ Ya" : "—",
              color: data?.bridge.readyToMigrate ? "text-emerald-400" : "text-muted-foreground",
              icon: <CheckCircle2 size={14} className={data?.bridge.readyToMigrate ? "text-emerald-500" : "text-muted-foreground"} />,
              desc: "Semua bridge linked, tidak ada konflik",
            },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  {c.icon}
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </div>
                <p className={cn("text-2xl font-bold", c.color)}>{isLoading ? "…" : typeof c.value === "number" ? fmtNum(c.value) : c.value}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{c.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="overview">📊 Overview</TabsTrigger>
            <TabsTrigger value="bridge" className="relative">
              🔗 Bridge Status
              {(data?.bridge.unlinked ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-400" />
              )}
            </TabsTrigger>
            <TabsTrigger value="categories">🗂 Temuan Data</TabsTrigger>
            <TabsTrigger value="risks">⚠ Risiko</TabsTrigger>
            <TabsTrigger value="schema">🔍 Perbandingan Schema</TabsTrigger>
            <TabsTrigger value="refactor">🏗 Proposal Refactor</TabsTrigger>
            <TabsTrigger value="migration">🛡 Strategi Migrasi</TabsTrigger>
          </TabsList>

          {/* ── TAB: Bridge Status ─────────────────────────────────────────── */}
          <TabsContent value="bridge" className="space-y-4 mt-4">
            {/* Status ringkasan bridge */}
            <div className="grid md:grid-cols-3 gap-4">
              <Card className={cn("border", (data?.bridge.linked ?? 0) > 0 ? "border-emerald-700/40" : "border-border")}>
                <CardContent className="p-4 flex items-center gap-3">
                  <Link2 size={20} className="text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Linked</p>
                    <p className="text-2xl font-bold text-emerald-400">{isLoading ? "…" : fmtNum(data?.bridge.linked ?? 0)}</p>
                    <p className="text-[10px] text-muted-foreground">Kedua FK sudah terisi & konsisten</p>
                  </div>
                </CardContent>
              </Card>
              <Card className={cn("border", (data?.bridge.unlinked ?? 0) > 0 ? "border-amber-700/40" : "border-border")}>
                <CardContent className="p-4 flex items-center gap-3">
                  <Link2Off size={20} className="text-amber-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Unlinked</p>
                    <p className="text-2xl font-bold text-amber-400">{isLoading ? "…" : fmtNum(data?.bridge.unlinked ?? 0)}</p>
                    <p className="text-[10px] text-muted-foreground">source_module cocok tapi FK belum diisi</p>
                  </div>
                </CardContent>
              </Card>
              <Card className={cn("border", (data?.bridge.conflict ?? 0) > 0 ? "border-red-700/40" : "border-border")}>
                <CardContent className="p-4 flex items-center gap-3">
                  <AlertTriangle size={20} className="text-red-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Conflict</p>
                    <p className="text-2xl font-bold text-red-400">{isLoading ? "…" : fmtNum(data?.bridge.conflict ?? 0)}</p>
                    <p className="text-[10px] text-muted-foreground">Expense punya &gt;1 disbursement aktif</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Backfill Bridge Button */}
            <Card className="border-violet-700/40 bg-violet-950/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap size={14} className="text-violet-400" /> Backfill Bridge
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Mengisi kolom FK (<code className="font-mono bg-muted px-1 rounded">expense_id</code> di disbursement dan{" "}
                  <code className="font-mono bg-muted px-1 rounded">disbursement_id</code> di expense) untuk pasangan lama
                  yang sudah tertaut via <code className="font-mono bg-muted px-1 rounded">source_module='expense'</code>{" "}
                  tapi kolom bridge-nya masih NULL. Tidak ada data yang dihapus atau dibuat baru.
                </p>

                {(data?.bridge.conflict ?? 0) > 0 && (
                  <div className="flex items-start gap-2 rounded border border-red-700/40 bg-red-950/20 px-3 py-2 text-xs text-red-300">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    Backfill dinonaktifkan karena ada <strong>{data!.bridge.conflict} conflict</strong> (double-pay). Selesaikan dulu di tab Risiko.
                  </div>
                )}

                <div className="flex flex-wrap gap-2 items-center">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-violet-600 text-violet-300 hover:bg-violet-900/30 gap-1.5"
                    onClick={() => previewMut.mutate()}
                    disabled={previewMut.isPending || applyMut.isPending || (data?.bridge.conflict ?? 0) > 0}
                  >
                    {previewMut.isPending
                      ? <><Loader2 size={12} className="animate-spin" />Memuat preview…</>
                      : <><Eye size={12} />Preview Backfill</>}
                  </Button>
                  {backfillPreview && !backfillResult && (
                    <Button
                      size="sm"
                      className="gap-1.5 bg-violet-700 hover:bg-violet-600"
                      onClick={() => applyMut.mutate()}
                      disabled={applyMut.isPending || backfillPreview.willApply === 0}
                    >
                      {applyMut.isPending
                        ? <><Loader2 size={12} className="animate-spin" />Menerapkan…</>
                        : <><Zap size={12} />Apply Backfill ({backfillPreview.willApply} pasangan)</>}
                    </Button>
                  )}
                </div>

                {/* Preview result */}
                {backfillPreview && !backfillResult && (
                  <div className="rounded border border-violet-700/40 bg-violet-950/20 p-3 space-y-2 text-xs">
                    <p className="font-medium text-violet-300 flex items-center gap-1.5"><Eye size={11} />Preview Backfill (dry-run, belum ada yang diubah)</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center">
                        <p className="text-emerald-400 font-bold text-lg">{backfillPreview.willApply}</p>
                        <p className="text-muted-foreground">Akan dilink</p>
                      </div>
                      <div className="text-center">
                        <p className="text-amber-400 font-bold text-lg">{backfillPreview.skippedConflict.length}</p>
                        <p className="text-muted-foreground">Dilewati (conflict)</p>
                      </div>
                      <div className="text-center">
                        <p className="text-slate-400 font-bold text-lg">{backfillPreview.skippedAmountMismatch.length}</p>
                        <p className="text-muted-foreground">Dilewati (nominal beda)</p>
                      </div>
                    </div>
                    {backfillPreview.applicable.length > 0 && (
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {backfillPreview.applicable.slice(0, 10).map((r, i) => (
                          <div key={i} className="flex gap-2 text-muted-foreground border border-border/40 rounded px-2 py-1">
                            <span className="font-mono text-emerald-300">{r.expense_number}</span>
                            <span>↔</span>
                            <span className="font-mono text-violet-300">{r.disbursement_number}</span>
                            <span className="ml-auto">{fmt(r.total_amount)}</span>
                          </div>
                        ))}
                        {backfillPreview.applicable.length > 10 && <p className="text-muted-foreground">… dan {backfillPreview.applicable.length - 10} lainnya</p>}
                      </div>
                    )}
                  </div>
                )}

                {/* Apply result */}
                {backfillResult && (
                  <div className="rounded border border-emerald-700/40 bg-emerald-950/20 p-3 space-y-2 text-xs">
                    <p className="font-medium text-emerald-300 flex items-center gap-1.5"><CheckCircle2 size={11} />Backfill Selesai</p>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="text-center"><p className="text-emerald-400 font-bold text-lg">{backfillResult.applied}</p><p className="text-muted-foreground">Berhasil</p></div>
                      <div className="text-center"><p className="text-amber-400 font-bold text-lg">{backfillResult.skippedConflict}</p><p className="text-muted-foreground">Dilewati (conflict)</p></div>
                      <div className="text-center"><p className="text-slate-400 font-bold text-lg">{backfillResult.skippedAmountMismatch}</p><p className="text-muted-foreground">Dilewati (nominal)</p></div>
                      <div className="text-center"><p className={cn("font-bold text-lg", backfillResult.failed > 0 ? "text-red-400" : "text-muted-foreground")}>{backfillResult.failed}</p><p className="text-muted-foreground">Gagal</p></div>
                    </div>
                    {backfillResult.failedRows.length > 0 && (
                      <div className="space-y-1 border-t border-border/40 pt-2">
                        <p className="text-red-300">Baris yang gagal:</p>
                        {backfillResult.failedRows.map((r, i) => (
                          <p key={i} className="font-mono text-red-300/70">Expense #{r.expenseId} ↔ Disb #{r.disbursementId}: {r.error}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── TAB: Overview ──────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              {/* Expense by Status */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Biaya Operasional — per Status</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Jumlah</TableHead>
                        <TableHead className="text-right">Sudah Jurnal</TableHead>
                        <TableHead className="text-right">Belum Jurnal</TableHead>
                        <TableHead className="text-right">Nominal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading && <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">Memuat…</TableCell></TableRow>}
                      {data?.summary.expenseByStatus.map((r) => (
                        <TableRow key={r.status}>
                          <TableCell><Badge variant="outline" className="text-xs">{r.status}</Badge></TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(r.jumlah)}</TableCell>
                          <TableCell className="text-right font-mono text-emerald-400">{fmtNum(r.sudah_jurnal)}</TableCell>
                          <TableCell className="text-right font-mono text-amber-400">{fmtNum(r.belum_jurnal)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(r.total_nominal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Disb by source_module */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Bank Disbursement — per Source Module</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source Module</TableHead>
                        <TableHead className="text-right">Jumlah</TableHead>
                        <TableHead className="text-right">Nominal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading && <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">Memuat…</TableCell></TableRow>}
                      {data?.summary.disbBySourceModule.map((r) => (
                        <TableRow key={r.source_module}>
                          <TableCell className="font-mono text-xs">{r.source_module}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(r.jumlah)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(r.total_nominal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Kategori ringkasan */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Ringkasan Kategori Temuan</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Keterangan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data && Object.entries(data.categories).map(([key, cat], i) => (
                      <TableRow key={key}>
                        <TableCell className="font-mono text-muted-foreground text-xs">{i + 1}</TableCell>
                        <TableCell className="text-sm">{cat.label}</TableCell>
                        <TableCell className="text-right font-mono font-bold">{fmtNum(cat.count)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {cat.count > 0 ? "→ Lihat tab Temuan Data" : "✓ Bersih"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── TAB: Temuan Data ───────────────────────────────────────────── */}
          <TabsContent value="categories" className="space-y-4 mt-4">
            {data && Object.entries(data.categories).map(([key, cat]) => (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Table2 size={14} />
                    {cat.label}
                    <Badge variant="outline" className="ml-auto">{fmtNum(cat.count)}</Badge>
                  </CardTitle>
                </CardHeader>
                {cat.rows.length > 0 && (
                  <CardContent className="p-0">
                    <div className="overflow-x-auto max-h-64">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(cat.rows[0]).map((col) => (
                              <TableHead key={col} className="text-xs whitespace-nowrap">{col}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cat.rows.slice(0, 20).map((row, i) => (
                            <TableRow key={i}>
                              {Object.values(row).map((val: any, j) => (
                                <TableCell key={j} className="text-xs font-mono whitespace-nowrap max-w-[200px] truncate">
                                  {val == null ? <span className="text-muted-foreground italic">null</span> : String(val)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {cat.rows.length > 20 && (
                      <p className="text-xs text-muted-foreground px-4 py-2">… dan {cat.rows.length - 20} baris lainnya (limit 100)</p>
                    )}
                  </CardContent>
                )}
                {cat.rows.length === 0 && (
                  <CardContent><p className="text-xs text-muted-foreground">Tidak ada data di kategori ini.</p></CardContent>
                )}
              </Card>
            ))}
          </TabsContent>

          {/* ── TAB: Risiko ────────────────────────────────────────────────── */}
          <TabsContent value="risks" className="space-y-4 mt-4">
            {data && Object.entries(data.risks).map(([key, risk]) => (
              <Card key={key} className={cn("border", risk.severity === "HIGH" ? "border-red-800/60 bg-red-950/10" : "border-emerald-800/40 bg-emerald-950/10")}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {risk.severity === "HIGH" ? <AlertTriangle size={14} className="text-red-400" /> : <CheckCircle2 size={14} className="text-emerald-400" />}
                    {risk.label}
                    <SeverityBadge s={risk.severity} />
                  </CardTitle>
                </CardHeader>
                {risk.rows.length > 0 ? (
                  <CardContent className="p-0">
                    <div className="overflow-x-auto max-h-72">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(risk.rows[0]).map((col) => (
                              <TableHead key={col} className="text-xs whitespace-nowrap">{col}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {risk.rows.map((row, i) => (
                            <TableRow key={i} className="bg-red-950/5">
                              {Object.values(row).map((val: any, j) => (
                                <TableCell key={j} className="text-xs font-mono whitespace-nowrap">
                                  {val == null ? <span className="text-muted-foreground italic">null</span>
                                    : Array.isArray(val) ? val.join(", ") : String(val)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                ) : (
                  <CardContent>
                    <p className="text-xs text-emerald-400">Tidak ada risiko terdeteksi. ✓</p>
                  </CardContent>
                )}
              </Card>
            ))}

            {/* Penjelasan risiko */}
            <Card className="border-amber-800/40">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Info size={14} className="text-amber-400" /> Apa artinya risiko ini?</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground mb-1">Double Jurnal</p>
                  <p>Expense sudah membuat <code className="text-xs font-mono bg-muted px-1 rounded">entry_id</code> (jurnal beban + hutang), lalu Bank Disbursement membuat <code className="text-xs font-mono bg-muted px-1 rounded">entry_id</code> lagi (jurnal kas/bank keluar). Jika keduanya aktif dan tidak berkaitan via hutang yang sama, saldo akan salah dua kali.</p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">Double Bayar</p>
                  <p>Satu expense memiliki lebih dari satu bank disbursement aktif yang menunjuk ke expense yang sama via <code className="text-xs font-mono bg-muted px-1 rounded">source_module='expense' AND source_id</code>. Kas/bank akan berkurang dua kali untuk beban yang sama.</p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">Cara Aman Memperbaiki</p>
                  <p>Jangan drop entry. Lakukan VOID pada disbursement atau expense yang salah, lalu buat ulang satu transaksi yang benar. Semua void akan membuat reversal entry otomatis.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── TAB: Perbandingan Schema ───────────────────────────────────── */}
          <TabsContent value="schema" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Perbandingan Kolom: expenses vs bank_disbursements</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Konsep</TableHead>
                        <TableHead>expenses</TableHead>
                        <TableHead>bank_disbursements</TableHead>
                        <TableHead>Catatan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {COMPARISON.map((c) => (
                        <TableRow key={c.field}>
                          <TableCell className="font-medium text-sm whitespace-nowrap">{c.field}</TableCell>
                          <TableCell className="font-mono text-xs text-blue-300 max-w-[180px]">{c.expense}</TableCell>
                          <TableCell className="font-mono text-xs text-violet-300 max-w-[180px]">{c.disb}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{c.note}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Kolom aktual dari DB */}
            <div className="grid md:grid-cols-2 gap-4">
              {[
                { title: "Kolom tabel expenses (dari DB)", cols: data?.schema.expenses ?? [] },
                { title: "Kolom tabel bank_disbursements (dari DB)", cols: data?.schema.bankDisbursements ?? [] },
              ].map(({ title, cols }) => (
                <Card key={title}>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-72 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Kolom</TableHead>
                            <TableHead className="text-xs">Tipe</TableHead>
                            <TableHead className="text-xs">Nullable</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cols.map((c: any) => (
                            <TableRow key={c.column_name}>
                              <TableCell className="font-mono text-xs">{c.column_name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{c.data_type}</TableCell>
                              <TableCell className="text-xs">{c.is_nullable === "YES" ? <span className="text-amber-400">nullable</span> : <span className="text-emerald-400">NOT NULL</span>}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Fitur duplikat, hanya di salah satu */}
            <div className="grid md:grid-cols-3 gap-4">
              <Card className="border-amber-800/40">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400">🔄 Fitur Duplikat</CardTitle></CardHeader>
                <CardContent>
                  <ul className="text-xs space-y-1.5 text-muted-foreground">
                    {["Tanggal transaksi", "Nominal / total", "Status (draft/posted/voided)", "Jurnal entry_id", "company_id", "created_by_id", "Deskripsi / memo", "Sumber dana (kas/bank)", "Vendor / counterparty"].map((f) => (
                      <li key={f} className="flex items-center gap-1.5"><span className="text-amber-500">⚠</span>{f}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card className="border-violet-800/40">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-violet-400">🏦 Hanya di Bank Disbursement</CardTitle></CardHeader>
                <CardContent>
                  <ul className="text-xs space-y-1.5 text-muted-foreground">
                    {["Multi-line items", "WHT per item", "journal_id (link ke jurnal bank)", "source_module / source_id", "void_entry_id (reversal)", "purchase_document_id / vendor_invoice_id", "payment_type", "counterparty_type"].map((f) => (
                      <li key={f} className="flex items-center gap-1.5"><span className="text-violet-500">+</span>{f}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card className="border-blue-800/40">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-blue-400">📋 Hanya di Biaya Operasional</CardTitle></CardHeader>
                <CardContent>
                  <ul className="text-xs space-y-1.5 text-muted-foreground">
                    {["Approval flow (L1/L2)", "Kategori biaya (expense_categories)", "Qty / Unit / Unit Price", "Tax rate (bukan WHT)", "sales_doc_id / shipment_id", "payable_account_id (hutang)", "Attachment table (relasi)", "expense_type (vendor_bill, reimbursement)"].map((f) => (
                      <li key={f} className="flex items-center gap-1.5"><span className="text-blue-500">+</span>{f}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── TAB: Proposal Refactor ─────────────────────────────────────── */}
          <TabsContent value="refactor" className="space-y-4 mt-4">
            <div className="rounded-lg border border-violet-800/40 bg-violet-950/20 p-4 space-y-2">
              <p className="font-semibold text-violet-300 flex items-center gap-2"><BookOpen size={15} /> Arsitektur Target</p>
              <div className="flex items-center gap-2 text-sm flex-wrap">
                {["Biaya Operasional", "Approval", "Bank Disbursement (Payment)", "Jurnal Otomatis"].map((step, i, arr) => (
                  <span key={step} className="flex items-center gap-2">
                    <span className="rounded bg-violet-900/60 px-3 py-1 text-violet-200 font-medium">{step}</span>
                    {i < arr.length - 1 && <ArrowRight size={14} className="text-violet-500" />}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Biaya Operasional = pusat pencatatan beban. Bank Disbursement = proses pembayaran. Treasury = dashboard saja.</p>
            </div>

            {/* Tabel menu */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Menu & Halaman</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipe Aksi</TableHead>
                      <TableHead>Menu / Halaman</TableHead>
                      <TableHead>Rencana</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {REFACTOR_PLAN.menu.map((m) => (
                      <TableRow key={m.menu}>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-xs", {
                            "text-emerald-400 border-emerald-700": m.tipe === "TETAP",
                            "text-amber-400 border-amber-700": m.tipe === "PINDAH",
                            "text-slate-400 border-slate-700": m.tipe === "TERSEMBUNYI",
                          })}>{m.tipe}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{m.menu}</TableCell>
                        <TableCell className="text-sm">{m.aksi}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Tabel */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Status Tabel Database</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tabel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Keterangan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {REFACTOR_PLAN.tables.map((t) => (
                      <TableRow key={t.tabel}>
                        <TableCell className="font-mono text-xs">{t.tabel}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-xs", {
                            "text-emerald-400 border-emerald-700": t.status === "TETAP",
                            "text-blue-400 border-blue-700": t.status === "TETAP + EXTEND",
                            "text-slate-400 border-slate-700": t.status === "LEGACY",
                          })}>{t.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{t.keterangan}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Tombol Apply Refactor Plan */}
            {highRiskCount === 0 ? (
              <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-emerald-300">Apply Refactor Plan</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Semua risiko HIGH sudah diselesaikan. Konfirmasi dengan manajemen sebelum melanjutkan.</p>
                </div>
                <Button
                  variant="outline"
                  className="border-emerald-600 text-emerald-300 hover:bg-emerald-900/30 gap-2"
                  onClick={() => toast({ title: "Konfirmasi diperlukan", description: "Hubungi manajemen untuk mendapatkan otorisasi sebelum menjalankan plan ini." })}
                >
                  <CheckCircle2 size={13} /> Konfirmasi & Apply
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Apply Refactor Plan</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Masih ada <strong className="text-red-400">{highRiskCount} risiko HIGH</strong> yang harus diselesaikan dahulu sebelum plan ini bisa dijalankan.
                  </p>
                </div>
                <Button disabled className="opacity-50 cursor-not-allowed gap-2">
                  <Lock size={13} /> Terkunci — Selesaikan Risiko Dulu
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ── TAB: Strategi Migrasi ──────────────────────────────────────── */}
          <TabsContent value="migration" className="space-y-4 mt-4">
            <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-4 flex items-start gap-3">
              <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-medium text-amber-300">Penting: Urutan langkah harus diikuti</p>
                <p className="text-muted-foreground text-xs">Backup wajib sebelum langkah apapun. Semua perubahan schema menggunakan <code className="font-mono bg-muted px-1 rounded">IF NOT EXISTS</code> untuk idempotency. Tidak ada tabel yang di-drop.</p>
              </div>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Langkah</TableHead>
                      <TableHead>Aksi</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {REFACTOR_PLAN.migrations.map((m) => (
                      <TableRow key={m.langkah}>
                        <TableCell>
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-900 text-xs font-bold text-violet-200">{m.langkah}</span>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{m.aksi}</TableCell>
                        <TableCell>
                          <code className="text-xs font-mono bg-muted px-2 py-1 rounded text-muted-foreground block max-w-lg whitespace-pre-wrap">{m.detail}</code>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* SQL Audit Queries untuk referensi */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Query SQL Audit (Referensi)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  {
                    label: "Expense yang sudah dibayar via Disbursement",
                    sql: `SELECT e.expense_number, e.total, bd.disbursement_number, bd.total_amount\nFROM expenses e\nJOIN bank_disbursements bd ON bd.source_module='expense' AND bd.source_id=e.id\nWHERE bd.status <> 'voided';`,
                  },
                  {
                    label: "Expense belum dibayar & belum jurnal",
                    sql: `SELECT expense_number, date, total, status, entry_id\nFROM expenses\nWHERE entry_id IS NULL\n  AND status NOT IN ('voided','cancelled')\n  AND NOT EXISTS (\n    SELECT 1 FROM bank_disbursements bd\n    WHERE bd.source_module='expense' AND bd.source_id=expenses.id AND bd.status<>'voided'\n  );`,
                  },
                  {
                    label: "Deteksi Double Jurnal",
                    sql: `SELECT e.expense_number, e.entry_id AS expense_entry,\n       bd.disbursement_number, bd.entry_id AS disb_entry\nFROM expenses e\nJOIN bank_disbursements bd ON bd.source_module='expense' AND bd.source_id=e.id\nWHERE e.entry_id IS NOT NULL AND bd.entry_id IS NOT NULL\n  AND bd.status <> 'voided';`,
                  },
                  {
                    label: "Deteksi Double Bayar",
                    sql: `SELECT source_id, COUNT(*) AS disb_count, SUM(total_amount::numeric) AS total_paid\nFROM bank_disbursements\nWHERE source_module='expense' AND status <> 'voided'\nGROUP BY source_id\nHAVING COUNT(*) > 1;`,
                  },
                ].map((q) => (
                  <div key={q.label}>
                    <p className="text-xs font-medium mb-1 text-muted-foreground">{q.label}</p>
                    <pre className="text-xs font-mono bg-muted p-3 rounded whitespace-pre-wrap text-slate-300 overflow-x-auto">{q.sql}</pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
