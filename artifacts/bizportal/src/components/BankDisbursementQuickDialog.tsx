/**
 * BankDisbursementQuickDialog — Phase 2
 *
 * Dialog ringan yang dapat dibuka dari halaman mana saja untuk membuat
 * Bank Disbursement dengan data prefill. Digunakan oleh:
 *   - Purchase Bills (payments)
 *   - Payment Request (workflow action=pay)
 *
 * Setelah BD berhasil dibuat, memanggil onSuccess(disbId, disbNumber).
 */

import { useState, useEffect } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowUpRight, Loader2, AlertTriangle } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });

interface Journal { id: number; code: string; name: string; type: string; }
interface Account { id: number; code: string; name: string; type: string; }

export interface BDPrefill {
  transactionType: "supplier_payment" | "expense" | "tax_payment" | "employee_advance" | "fund_transfer" | "other";
  purchaseDocumentId?: number;
  preferredAccountId?: number;
  amount: number;
  ref?: string;
  memo?: string;
  partnerName?: string;
  sourceModule?: string;
  sourceId?: number;
  sourceNumber?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefill: BDPrefill;
  title?: string;
  onSuccess: (disbId: number, disbNumber: string) => void;
}

export function BankDisbursementQuickDialog({
  open, onOpenChange, prefill, title = "Buat Bank Disbursement", onSuccess,
}: Props) {
  const { activeCompanyId } = useCompany();
  const today = new Date().toISOString().slice(0, 10);

  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    journalId: "",
    date: today,
    ref: prefill.ref ?? "",
    memo: prefill.memo ?? "",
    accountId: prefill.preferredAccountId ? String(prefill.preferredAccountId) : "",
    amount: String(prefill.amount > 0 ? prefill.amount : ""),
    description: prefill.partnerName ? `Pembayaran ke ${prefill.partnerName}` : "",
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      journalId: "",
      date: today,
      ref: prefill.ref ?? "",
      memo: prefill.memo ?? "",
      accountId: prefill.preferredAccountId ? String(prefill.preferredAccountId) : "",
      amount: String(prefill.amount > 0 ? prefill.amount : ""),
      description: prefill.partnerName ? `Pembayaran ke ${prefill.partnerName}` : "",
    });
    const q = activeCompanyId ? `?company=${activeCompanyId}` : "";
    const sep = q ? "&" : "?";

    // Build the accounts URL — for supplier_payment we use server-side whitelist
    // (for=supplier_payment) so the backend filters out Bank/Kas/Piutang/Aset Tetap/etc.
    // For other types we apply a type filter via the `type` query param.
    let acctUrl: string;
    if (prefill.transactionType === "supplier_payment") {
      acctUrl = `/accounting/bank-disbursements/meta/accounts${q}${sep}for=supplier_payment`;
    } else if (prefill.transactionType === "expense") {
      acctUrl = `/accounting/bank-disbursements/meta/accounts${q}${sep}type=expense`;
    } else if (prefill.transactionType === "employee_advance") {
      acctUrl = `/accounting/bank-disbursements/meta/accounts${q}${sep}type=asset&subtype=receivable`;
    } else if (prefill.transactionType === "fund_transfer") {
      acctUrl = `/accounting/bank-disbursements/meta/accounts${q}${sep}type=asset&subtype=cash_bank`;
    } else {
      // tax_payment, other — fetch all then client-side filter
      acctUrl = `/accounting/bank-disbursements/meta/accounts${q}`;
    }

    Promise.all([
      apiFetch(`/accounting/journals${q}`).then(r => r.json()).catch(() => []),
      apiFetch(acctUrl).then(r => r.json()).catch(() => []),
    ]).then(([jData, aData]) => {
      const bankCash = (Array.isArray(jData) ? jData : []).filter((j: Journal) => j.type === "bank" || j.type === "cash");
      setJournals(bankCash);
      if (bankCash.length > 0) setForm(f => ({ ...f, journalId: String(bankCash[0]!.id) }));

      let filtered: Account[] = Array.isArray(aData) ? aData : [];

      // For tax_payment (fetched without filter above), do client-side type filter
      if (prefill.transactionType === "tax_payment") {
        filtered = filtered.filter(a => a.type === "expense" || a.type === "liability");
      }

      setAccounts(filtered);

      if (prefill.preferredAccountId) {
        setForm(f => ({ ...f, accountId: String(prefill.preferredAccountId) }));
      } else if (filtered.length === 1) {
        setForm(f => ({ ...f, accountId: String(filtered[0]!.id) }));
      }
    });
  }, [open, activeCompanyId, prefill.amount, prefill.memo, prefill.partnerName, prefill.preferredAccountId, prefill.ref, prefill.transactionType, today]);

  const handleSubmit = async () => {
    setError(null);
    if (!form.journalId || !form.date || !form.accountId || !form.amount) {
      setError("Jurnal, tanggal, akun, dan jumlah wajib diisi.");
      return;
    }
    const amt = Number(form.amount);
    if (Number.isNaN(amt) || amt <= 0) {
      setError("Jumlah harus lebih dari 0.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        journalId: Number(form.journalId),
        date: form.date,
        ref: form.ref || undefined,
        memo: form.memo || undefined,
        sourceModule: prefill.sourceModule ?? undefined,
        sourceId: prefill.sourceId ?? undefined,
        sourceNumber: prefill.sourceNumber ?? undefined,
        items: [
          {
            seq: 1,
            transactionType: prefill.transactionType,
            accountId: Number(form.accountId),
            description: form.description || undefined,
            amount: amt,
            purchaseDocumentId: prefill.purchaseDocumentId ?? undefined,
          },
        ],
      };
      const q = activeCompanyId ? `?company=${activeCompanyId}` : "";
      const r = await apiFetch(`/accounting/bank-disbursements${q}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error((errBody as any).message ?? `HTTP ${r.status}`);
      }
      const created = await r.json();
      onSuccess(created.id, created.disbursementNumber ?? created.disbursement_number ?? `BD#${created.id}`);
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-orange-500" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="flex items-start gap-2 rounded border border-red-700/40 bg-red-900/20 px-3 py-2 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {prefill.partnerName && (
            <div className="text-sm text-muted-foreground">
              Penerima: <span className="font-semibold text-foreground">{prefill.partnerName}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Jurnal Bank/Kas <span className="text-red-500">*</span></Label>
              <Select value={form.journalId} onValueChange={v => setForm(f => ({ ...f, journalId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih jurnal..." />
                </SelectTrigger>
                <SelectContent>
                  {journals.map(j => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      <span className="font-mono text-xs text-muted-foreground mr-1">{j.code}</span>
                      {j.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Tanggal <span className="text-red-500">*</span></Label>
              <DatePicker value={form.date} onChange={(v) => setForm(f => ({ ...f, date: v }))} />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Akun Debit <span className="text-red-500">*</span></Label>
              {prefill.transactionType === "supplier_payment" && (
                <span className="text-[10px] text-purple-600 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                  Hutang Usaha · Beban · Persediaan · DP Supplier
                </span>
              )}
            </div>
            <Select value={form.accountId} onValueChange={v => setForm(f => ({ ...f, accountId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih akun..." />
              </SelectTrigger>
              <SelectContent>
                {accounts.map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    <span className="font-mono text-xs text-muted-foreground mr-1">{a.code}</span>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {prefill.transactionType === "supplier_payment" && (
              <p className="text-[10px] text-slate-400 leading-relaxed">
                ✓ Diizinkan: Hutang Usaha, Trade Payable, Beban Pembelian, Persediaan, Uang Muka Supplier
                <br />
                ✗ Diblok: Bank, Kas, Piutang, Piutang Karyawan, Aset Tetap
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Jumlah (IDR) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                min="0"
                step="1000"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              />
              {form.amount && Number(form.amount) > 0 && (
                <p className="text-xs text-muted-foreground">{idr(Number(form.amount))}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Referensi</Label>
              <Input
                value={form.ref}
                onChange={e => setForm(f => ({ ...f, ref: e.target.value }))}
                placeholder="No. dokumen..."
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Keterangan</Label>
            <Input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Deskripsi singkat..."
            />
          </div>

          <div className="space-y-1">
            <Label>Memo</Label>
            <Input
              value={form.memo}
              onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
              placeholder="Catatan tambahan..."
            />
          </div>

          {prefill.sourceNumber && (
            <p className="text-xs text-slate-500">
              Referensi dokumen: <span className="font-mono text-slate-400">{prefill.sourceNumber}</span>
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button onClick={handleSubmit} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Menyimpan...</> : "Simpan & Post Jurnal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
