import { useState, useCallback } from "react";
import { Link } from "wouter";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Loader2, Building2, CreditCard, Trash2, ChevronsRight, ScanLine } from "lucide-react";
import { ScanDocumentDialog } from "@/components/ScanDocumentDialog";
import { cn } from "@/lib/utils";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtIDR = (raw: string) => { const d = raw.replace(/\D/g, ""); return d ? Number(d).toLocaleString("id-ID") : ""; };
const parseIDR = (v: string) => { const n = Number(v.replace(/\D/g, "")); return isNaN(n) ? 0 : n; };

const STATUS_COLORS: Record<string, string> = {
  active:  "bg-sky-900/40 text-sky-300 border-sky-600",
  partial: "bg-amber-900/40 text-amber-300 border-amber-600",
  paid:    "bg-emerald-900/40 text-emerald-300 border-emerald-600",
};
const STATUS_LABELS: Record<string, string> = { active: "Aktif", partial: "Sebagian", paid: "Lunas" };

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

export default function VendorInstallmentsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const cq = activeCompanyId ? `?company=${activeCompanyId}` : "";

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["vendor-installments", activeCompanyId],
    queryFn: () => apiFetch(`/api/vendor-installments${activeCompanyId ? `?company=${activeCompanyId}` : ""}`),
  });

  const [selected, setSelected] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  const fetchDetail = useCallback(async (id: number) => {
    const d = await apiFetch(`/api/vendor-installments/${id}`);
    setDetail(d);
  }, []);

  const openDetail = async (row: any) => { setSelected(row); await fetchDetail(row.id); };

  const today = new Date().toISOString().slice(0, 10);
  const [showForm, setShowForm] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [totalRaw, setTotalRaw] = useState("");
  const [pm, setPm] = useState("bank");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const createMut = useMutation({
    mutationFn: (body: object) => apiFetch(`/api/vendor-installments${cq}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: (d) => {
      toast({ title: `✓ ${d.installmentNumber} — ${idr(d.totalAmount)} berhasil dibuat.` });
      qc.invalidateQueries({ queryKey: ["vendor-installments"] });
      setShowForm(false); setVendorName(""); setTotalRaw(""); setReference(""); setNotes(""); setDate(today);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleCreate = () => {
    const totalAmount = parseIDR(totalRaw);
    if (!vendorName.trim()) { toast({ title: "Nama vendor wajib diisi.", variant: "destructive" }); return; }
    if (totalAmount <= 0) { toast({ title: "Nominal harus lebih dari 0.", variant: "destructive" }); return; }
    createMut.mutate({ vendorName, totalAmount, paymentMethod: pm, date, reference, notes });
  };

  // ── Payment form ──────────────────────────────────────────────────────
  const [payAmtRaw, setPayAmtRaw] = useState("");
  const [payPm, setPayPm] = useState("bank");
  const [payDate, setPayDate] = useState(today);
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const payMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/api/vendor-installments/${id}/pay`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: async (d) => {
      toast({ title: `✓ Cicilan ${idr(d.payment.amount)} berhasil dicatat.` });
      qc.invalidateQueries({ queryKey: ["vendor-installments"] });
      setPayAmtRaw(""); setPayRef(""); setPayNotes(""); setPayDate(today);
      setSelected(d.installment); await fetchDetail(d.installment.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handlePay = () => {
    if (!selected) return;
    const amount = parseIDR(payAmtRaw);
    if (amount <= 0) { toast({ title: "Nominal cicilan harus lebih dari 0.", variant: "destructive" }); return; }
    payMut.mutate({ id: selected.id, body: { amount, paymentMethod: payPm, date: payDate, reference: payRef, notes: payNotes } });
  };

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/vendor-installments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Vendor cicilan dihapus." });
      qc.invalidateQueries({ queryKey: ["vendor-installments"] });
      setSelected(null); setDetail(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/expense">
              <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={15} /></Button>
            </Link>
            <div className="flex items-center gap-2">
              <Building2 size={20} className="text-rose-400" />
              <div>
                <h1 className="text-xl font-bold">Cicilan Hutang Vendor</h1>
                <p className="text-sm text-muted-foreground">DR Hutang Vendor · CR Kas/Bank per cicilan</p>
              </div>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus size={14} className="mr-1" /> Buat Cicilan
          </Button>
        </div>

        {showForm && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-muted-foreground">Form Cicilan Hutang Vendor Baru</CardTitle>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setScanOpen(true)}>
                  <ScanLine size={12} /> Scan Invoice
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nama Vendor <span className="text-destructive">*</span></Label>
                  <Input placeholder="Nama vendor..." value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tanggal <span className="text-destructive">*</span></Label>
                  <DatePicker value={date} onChange={(v) => setDate(v)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Total Hutang (IDR) <span className="text-destructive">*</span></Label>
                  <Input placeholder="0" className="font-mono" value={totalRaw} onChange={(e) => setTotalRaw(fmtIDR(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Metode Bayar Default</Label>
                  <Select value={pm} onValueChange={setPm}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank">🏦 Bank</SelectItem>
                      <SelectItem value="cash">💵 Kas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>No. Referensi / Invoice</Label>
                  <Input placeholder="Opsional..." value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Keterangan</Label>
                  <Input placeholder="Opsional..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={createMut.isPending}>
                  {createMut.isPending ? <><Loader2 size={14} className="mr-1 animate-spin" />Menyimpan...</> : "Simpan"}
                </Button>
                <Button variant="ghost" onClick={() => setShowForm(false)}>Batal</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Cicilan</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Referensi</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Terbayar</TableHead>
                  <TableHead className="text-right">Sisa</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Memuat...</TableCell></TableRow>}
                {!isLoading && list.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Belum ada cicilan vendor.</TableCell></TableRow>}
                {list.map((row: any) => (
                  <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(row)}>
                    <TableCell className="font-mono text-xs text-primary">{row.installmentNumber}</TableCell>
                    <TableCell className="text-sm">{row.date}</TableCell>
                    <TableCell className="text-sm font-medium">{row.vendorName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.reference ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{idr(row.totalAmount)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-400">{idr(row.paidAmount)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-amber-400">{idr(row.remainingAmount)}</TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs border", STATUS_COLORS[row.status] ?? "")}>{STATUS_LABELS[row.status] ?? row.status}</Badge>
                    </TableCell>
                    <TableCell><ChevronsRight size={14} className="text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setDetail(null); } }}>
        <SheetContent className="w-[420px] sm:w-[520px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{selected.installmentNumber}</SheetTitle>
                <SheetDescription>{selected.vendorName}{selected.reference ? ` — ${selected.reference}` : ""}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Hutang</span>
                    <span className="font-mono font-semibold">{idr(selected.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Terbayar</span>
                    <span className="font-mono text-emerald-400">{idr(selected.paidAmount)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-bold">
                    <span>Sisa Hutang</span>
                    <span className="font-mono text-amber-400">{idr(selected.remainingAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge className={cn("text-xs border", STATUS_COLORS[selected.status] ?? "")}>{STATUS_LABELS[selected.status] ?? selected.status}</Badge>
                  </div>
                  {selected.notes && <p className="text-xs text-muted-foreground pt-1">{selected.notes}</p>}
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Riwayat Pembayaran</p>
                  {!detail?.payments?.length ? (
                    <p className="text-xs text-muted-foreground">Belum ada pembayaran cicilan.</p>
                  ) : (
                    <div className="space-y-1">
                      {detail.payments.map((p: any) => (
                        <div key={p.id} className="flex justify-between items-center rounded border px-3 py-2 text-xs">
                          <div className="text-muted-foreground">
                            {p.date} · {p.paymentMethod === "cash" ? "Kas" : "Bank"}
                            {p.reference ? ` · ${p.reference}` : ""}
                            {p.notes ? ` · ${p.notes}` : ""}
                          </div>
                          <span className="font-mono text-emerald-400">{idr(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selected.status !== "paid" && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm font-medium flex items-center gap-2"><CreditCard size={14} className="text-primary" />Bayar Cicilan</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Nominal</Label>
                        <Input placeholder="0" className="font-mono h-8 text-sm" value={payAmtRaw} onChange={(e) => setPayAmtRaw(fmtIDR(e.target.value))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tanggal</Label>
                        <DatePicker value={payDate} onChange={(v) => setPayDate(v)} className="h-8 text-sm" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Sumber Dana</Label>
                        <Select value={payPm} onValueChange={setPayPm}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bank">🏦 Bank</SelectItem>
                            <SelectItem value="cash">💵 Kas</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Referensi</Label>
                        <Input placeholder="Opsional..." className="h-8 text-sm" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                      </div>
                    </div>
                    <Input placeholder="Keterangan (opsional)..." className="h-8 text-sm" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
                    {parseIDR(payAmtRaw) > 0 && (
                      <div className="rounded-md bg-muted/40 border px-3 py-2 text-xs text-muted-foreground">
                        Jurnal: <strong>DR Hutang Vendor</strong> {idr(parseIDR(payAmtRaw))} · <strong>CR {payPm === "cash" ? "Kas" : "Bank"}</strong> {idr(parseIDR(payAmtRaw))}
                      </div>
                    )}
                    <Button size="sm" className="w-full" onClick={handlePay} disabled={payMut.isPending}>
                      {payMut.isPending ? <><Loader2 size={13} className="mr-1 animate-spin" />Menyimpan...</> : "Catat Pembayaran"}
                    </Button>
                  </div>
                )}

                {selected.status === "active" && Number(selected.paidAmount) === 0 && (
                  <div className="border-t pt-4">
                    <Button variant="destructive" size="sm" className="w-full" onClick={() => deleteMut.mutate(selected.id)} disabled={deleteMut.isPending}>
                      <Trash2 size={13} className="mr-1" /> Hapus Cicilan
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ScanDocumentDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Scan Invoice / Bukti Hutang Vendor"
        onDataExtracted={(data) => {
          if (data.docDate) setDate(data.docDate.slice(0, 10));
          const cost = data.estimatedCost ?? data.lines?.[0]?.unitPrice ?? null;
          if (cost != null && cost > 0) setTotalRaw(fmtIDR(String(Math.round(cost))));
          if (data.partyName) setVendorName(data.partyName);
          if (data.shipmentNumber || data.notes) setReference(data.shipmentNumber ?? data.notes ?? "");
        }}
      />
    </AppShell>
  );
}
