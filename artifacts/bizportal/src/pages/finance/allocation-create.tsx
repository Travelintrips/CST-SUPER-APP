/**
 * Allocation Create — Sprint 3 Phase 1
 * Form header + detail grid untuk membuat alokasi baru.
 */
import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────────

const ALLOCATION_TYPES = [
  { value: "ADVANCE_PRINCIPAL", label: "Advance Principal",  hint: "DR Bank / CR Advance Receivable" },
  { value: "SALES_INVOICE",     label: "Invoice AR",         hint: "DR Bank / CR Account Receivable" },
  { value: "DIRECT_REVENUE",    label: "Direct Revenue",     hint: "DR Bank / CR Revenue" },
  { value: "CUSTOMER_DEPOSIT",  label: "Customer Deposit",   hint: "DR Bank / CR Customer Deposit" },
  { value: "OTHER_RECEIVABLE",  label: "Other Receivable",   hint: "DR Bank / CR Other Receivable" },
  { value: "ROUNDING",          label: "Pembulatan",         hint: "Selisih pembulatan" },
  { value: "ADJUSTMENT",        label: "Adjustment",         hint: "Koreksi / penyesuaian" },
] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

interface AllocationLine {
  id: string;
  allocation_type: string;
  reference_type: string;
  reference_id: string;
  coa_id: string;
  amount: string;
  remarks: string;
}

interface BankAccount {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  currency_code: string;
}

interface Coa {
  id: number;
  code: string;
  name: string;
  type: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function newLine(): AllocationLine {
  return {
    id: `line-${Date.now()}-${Math.random()}`,
    allocation_type: "ADVANCE_PRINCIPAL",
    reference_type: "",
    reference_id: "",
    coa_id: "",
    amount: "",
    remarks: "",
  };
}

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID").format(n);
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AllocationCreatePage() {
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();

  // Header form
  const [allocationDate, setAllocationDate] = useState(
    new Date().toISOString().substring(0, 10),
  );
  const [bankAccountId, setBankAccountId] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");

  // Lines
  const [lines, setLines] = useState<AllocationLine[]>([newLine()]);

  // Reference data
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [coaList, setCoaList] = useState<Coa[]>([]);

  // UI state
  const [saving, setSaving] = useState(false);
  const [loadingRef, setLoadingRef] = useState(false);

  // Balance validation
  const received = parseFloat(receivedAmount) || 0;
  const linesTotal = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const diff = Math.abs(received - linesTotal);
  const isBalanced = diff < 0.01;

  // ── Fetch reference data ──────────────────────────────────────────────────

  const fetchBankAccounts = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await fetch(
        `/api/cash-bank/accounts?companyId=${activeCompanyId}`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const data = await res.json();
      setBankAccounts(data.data ?? data ?? []);
    } catch {}
  }, [activeCompanyId]);

  const fetchCoa = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await fetch(
        `/api/accounting/accounts?companyId=${activeCompanyId}&limit=500`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const data = await res.json();
      setCoaList(data.data ?? data ?? []);
    } catch {}
  }, [activeCompanyId]);

  useEffect(() => {
    setLoadingRef(true);
    Promise.all([fetchBankAccounts(), fetchCoa()]).finally(() => setLoadingRef(false));
  }, [fetchBankAccounts, fetchCoa]);

  // ── Line operations ───────────────────────────────────────────────────────

  const addLine = () => setLines((prev) => [...prev, newLine()]);

  const removeLine = (id: string) =>
    setLines((prev) => prev.filter((l) => l.id !== id));

  const updateLine = (id: string, field: keyof AllocationLine, value: string) =>
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );

  // ── Save as draft ─────────────────────────────────────────────────────────

  const handleSave = async (andSubmit = false) => {
    if (!activeCompanyId) {
      toast({ title: "Pilih company terlebih dahulu", variant: "destructive" });
      return;
    }
    if (!receivedAmount || received <= 0) {
      toast({ title: "Received Amount wajib diisi", variant: "destructive" });
      return;
    }
    if (!isBalanced) {
      toast({
        title: `Alokasi tidak balance. Selisih: Rp ${fmt(diff)}`,
        variant: "destructive",
      });
      return;
    }

    const payload = {
      company_id: activeCompanyId,
      bank_account_id: bankAccountId ? parseInt(bankAccountId) : undefined,
      received_amount: received,
      reference_no: referenceNo || undefined,
      notes: notes || undefined,
      allocation_date: allocationDate,
      lines: lines
        .filter((l) => parseFloat(l.amount) > 0)
        .map((l, i) => ({
          allocation_type: l.allocation_type,
          reference_type: l.reference_type || undefined,
          reference_id: l.reference_id ? parseInt(l.reference_id) : undefined,
          coa_id: l.coa_id ? parseInt(l.coa_id) : undefined,
          amount: parseFloat(l.amount),
          remarks: l.remarks || undefined,
          sort_order: i,
        })),
    };

    setSaving(true);
    try {
      const res = await fetch("/api/allocation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan");

      if (andSubmit) {
        const res2 = await fetch(`/api/allocation/${data.id}/submit`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res2.ok) {
          const d2 = await res2.json();
          throw new Error(d2.error ?? "Gagal submit");
        }
        toast({ title: `Allocation ${data.allocation_no} berhasil disimpan & disubmit` });
      } else {
        toast({ title: `Allocation ${data.allocation_no} tersimpan sebagai draft` });
      }

      navigate("/finance/allocation");
    } catch (err: any) {
      toast({ title: err.message ?? "Terjadi kesalahan", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/finance/allocation" className="hover:text-slate-700 flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" /> Allocation Center
        </Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">Buat Alokasi Baru</span>
      </div>

      {/* Title + Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Buat Alokasi</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Alokasikan penerimaan bank ke advance, invoice, deposit, atau revenue
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/finance/allocation">Batal</Link>
          </Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
            <Save className="h-4 w-4 mr-1.5" /> Simpan Draft
          </Button>
          <Button
            onClick={() => handleSave(true)}
            disabled={saving || !isBalanced || received <= 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            {saving ? "Menyimpan..." : "Simpan & Submit"}
          </Button>
        </div>
      </div>

      {/* Balance indicator */}
      <BalanceBar received={received} linesTotal={linesTotal} isBalanced={isBalanced} diff={diff} />

      {/* Header form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Informasi Penerimaan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Tanggal *</Label>
              <Input
                type="date"
                value={allocationDate}
                onChange={(e) => setAllocationDate(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Bank Account *</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih rekening bank..." />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      {loadingRef ? "Memuat..." : "Tidak ada data bank"}
                    </SelectItem>
                  ) : (
                    bankAccounts.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.bank_name} — {b.account_number} ({b.currency_code})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Received Amount (IDR) *</Label>
              <Input
                type="number"
                placeholder="0"
                value={receivedAmount}
                onChange={(e) => setReceivedAmount(e.target.value)}
                min={0}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Nomor Referensi</Label>
              <Input
                placeholder="No. bukti transfer / kuitansi"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label>Catatan</Label>
              <Textarea
                placeholder="Keterangan tambahan..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Allocation Lines */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base">Allocation Lines</CardTitle>
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-4 w-4 mr-1.5" /> Tambah Baris
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Type</TableHead>
                <TableHead>COA *</TableHead>
                <TableHead>Referensi (opsional)</TableHead>
                <TableHead className="w-36 text-right">Amount (IDR)</TableHead>
                <TableHead>Keterangan</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  {/* Type */}
                  <TableCell className="py-2">
                    <Select
                      value={line.allocation_type}
                      onValueChange={(v) => updateLine(line.id, "allocation_type", v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALLOCATION_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value} className="text-xs">
                            <div>
                              <div>{t.label}</div>
                              <div className="text-[10px] text-slate-400">{t.hint}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>

                  {/* COA */}
                  <TableCell className="py-2">
                    <Select
                      value={line.coa_id || "__none__"}
                      onValueChange={(v) => updateLine(line.id, "coa_id", v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Pilih COA..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs text-slate-400">
                          — Auto dari tipe —
                        </SelectItem>
                        {coaList.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)} className="text-xs">
                            {c.code} — {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>

                  {/* Reference */}
                  <TableCell className="py-2">
                    <Input
                      className="h-8 text-xs"
                      placeholder="ID referensi (advance/invoice)"
                      value={line.reference_id}
                      onChange={(e) => updateLine(line.id, "reference_id", e.target.value)}
                    />
                  </TableCell>

                  {/* Amount */}
                  <TableCell className="py-2">
                    <Input
                      type="number"
                      className="h-8 text-xs text-right"
                      placeholder="0"
                      min={0}
                      value={line.amount}
                      onChange={(e) => updateLine(line.id, "amount", e.target.value)}
                    />
                  </TableCell>

                  {/* Remarks */}
                  <TableCell className="py-2">
                    <Input
                      className="h-8 text-xs"
                      placeholder="Keterangan..."
                      value={line.remarks}
                      onChange={(e) => updateLine(line.id, "remarks", e.target.value)}
                    />
                  </TableCell>

                  {/* Delete */}
                  <TableCell className="py-2">
                    {lines.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => removeLine(line.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Footer totals */}
          <div className="flex justify-end mt-3 gap-8 text-sm pr-8">
            <div className="text-slate-500">
              Total Lines:{" "}
              <span className="font-semibold text-slate-900">
                Rp {fmt(linesTotal)}
              </span>
            </div>
            <div className="text-slate-500">
              Received:{" "}
              <span className="font-semibold text-slate-900">
                Rp {fmt(received)}
              </span>
            </div>
            <div className={isBalanced ? "text-green-600" : "text-red-600"}>
              Selisih:{" "}
              <span className="font-semibold">
                Rp {fmt(diff)}
              </span>
            </div>
          </div>

          {/* Accounting note */}
          <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800">
            <p className="font-semibold mb-1">Catatan Akuntansi</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Setiap posting akan membuat <strong>satu jurnal</strong> melalui AdvanceJournalService</li>
              <li><strong>DR Bank</strong> (Received Amount) / <strong>CR</strong> setiap line sesuai COA</li>
              <li>Over allocation atau under allocation <strong>ditolak sistem</strong></li>
              <li>COA kosong → sistem akan resolve otomatis dari accounting settings</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Balance Bar ────────────────────────────────────────────────────────────────

function BalanceBar({
  received,
  linesTotal,
  isBalanced,
  diff,
}: {
  received: number;
  linesTotal: number;
  isBalanced: boolean;
  diff: number;
}) {
  if (received <= 0) return null;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm border ${
        isBalanced
          ? "bg-green-50 border-green-200 text-green-800"
          : "bg-orange-50 border-orange-200 text-orange-800"
      }`}
    >
      {isBalanced ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      )}
      {isBalanced ? (
        <span>
          <strong>Balance OK</strong> — Total alokasi Rp{" "}
          {new Intl.NumberFormat("id-ID").format(linesTotal)} = Received Amount
        </span>
      ) : (
        <span>
          <strong>Belum balance</strong> — Total lines Rp{" "}
          {new Intl.NumberFormat("id-ID").format(linesTotal)} | Received Rp{" "}
          {new Intl.NumberFormat("id-ID").format(received)} | Selisih Rp{" "}
          {new Intl.NumberFormat("id-ID").format(diff)}
        </span>
      )}
    </div>
  );
}
