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
import { ArrowLeft, Plus, Loader2, Landmark, CreditCard, Trash2, ChevronsRight, TrendingDown } from "lucide-react";
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
const TYPE_LABELS: Record<string, string> = { bank: "Bank", leasing: "Leasing", other: "Pinjaman Lain" };
const TYPE_COLORS: Record<string, string> = {
  bank:    "bg-blue-900/40 text-blue-300 border-blue-600",
  leasing: "bg-purple-900/40 text-purple-300 border-purple-600",
  other:   "bg-slate-800 text-slate-300 border-slate-600",
};

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

export default function BankLoansPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const cq = activeCompanyId ? `?company=${activeCompanyId}` : "";

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["bank-loans", activeCompanyId],
    queryFn: () => apiFetch(`/api/bank-loans${activeCompanyId ? `?company=${activeCompanyId}` : ""}`),
  });

  const [selected, setSelected] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const fetchDetail = useCallback(async (id: number) => {
    setDetail(await apiFetch(`/api/bank-loans/${id}`));
  }, []);
  const openDetail = async (row: any) => { setSelected(row); await fetchDetail(row.id); };

  const today = new Date().toISOString().slice(0, 10);
  const [showForm, setShowForm] = useState(false);
  const [loanType, setLoanType] = useState("bank");
  const [lenderName, setLenderName] = useState("");
  const [principalRaw, setPrincipalRaw] = useState("");
  const [pm, setPm] = useState("bank");
  const [disbDate, setDisbDate] = useState(today);
  const [tenor, setTenor] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [adminFee, setAdminFee] = useState("");
  const [notes, setNotes] = useState("");

  const createMut = useMutation({
    mutationFn: (body: object) => apiFetch(`/api/bank-loans${cq}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: (d) => {
      toast({ title: `✓ ${d.loan_number} — ${idr(d.principal_amount)} berhasil dibuat.` });
      qc.invalidateQueries({ queryKey: ["bank-loans"] });
      setShowForm(false); setLenderName(""); setPrincipalRaw(""); setNotes(""); setDisbDate(today);
      setTenor(""); setInterestRate(""); setAdminFee("");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleCreate = () => {
    const principal = parseIDR(principalRaw);
    if (!lenderName.trim()) { toast({ title: "Nama pemberi pinjaman wajib diisi.", variant: "destructive" }); return; }
    if (principal <= 0) { toast({ title: "Nominal pinjaman harus lebih dari 0.", variant: "destructive" }); return; }
    createMut.mutate({
      loanType, lenderName, principalAmount: principal, paymentMethod: pm,
      disbursementDate: disbDate,
      tenorMonths: tenor ? parseInt(tenor) : null,
      interestRate: interestRate ? parseFloat(interestRate) : 0,
      adminFee: adminFee ? parseIDR(adminFee) : 0,
      notes,
    });
  };

  // ── Payment form ──────────────────────────────────────────────────────────
  const [payPrinRaw, setPayPrinRaw] = useState("");
  const [payIntRaw, setPayIntRaw] = useState("");
  const [payPm, setPayPm] = useState("bank");
  const [payDate, setPayDate] = useState(today);
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const payMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/api/bank-loans/${id}/pay`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    onSuccess: async (d) => {
      const total = parseIDR(payPrinRaw) + parseIDR(payIntRaw);
      toast({ title: `✓ Cicilan ${idr(total)} berhasil dicatat.` });
      qc.invalidateQueries({ queryKey: ["bank-loans"] });
      setPayPrinRaw(""); setPayIntRaw(""); setPayRef(""); setPayNotes(""); setPayDate(today);
      setSelected(d.loan); await fetchDetail(d.loan.id);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handlePay = () => {
    if (!selected) return;
    const principal = parseIDR(payPrinRaw);
    if (principal <= 0) { toast({ title: "Nominal pokok harus lebih dari 0.", variant: "destructive" }); return; }
    payMut.mutate({ id: selected.id, body: {
      principalAmount: principal, interestAmount: parseIDR(payIntRaw),
      paymentMethod: payPm, paymentDate: payDate, reference: payRef, notes: payNotes,
    }});
  };

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/bank-loans/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Pinjaman dihapus." });
      qc.invalidateQueries({ queryKey: ["bank-loans"] });
      setSelected(null); setDetail(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const totalOutstanding = (list as any[]).filter((r) => r.status !== "paid")
    .reduce((s, r) => s + parseFloat(r.outstanding_amount ?? 0), 0);

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/expense">
              <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={15} /></Button>
            </Link>
            <div className="flex items-center gap-2">
              <Landmark size={20} className="text-blue-400" />
              <div>
                <h1 className="text-xl font-bold">Hutang Bank & Leasing</h1>
                <p className="text-sm text-muted-foreground">DR Kas/Bank · CR Hutang Bank (pencairan)</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {totalOutstanding > 0 && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total Outstanding</p>
                <p className="font-mono text-amber-400 font-semibold">{idr(totalOutstanding)}</p>
              </div>
            )}
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus size={14} className="mr-1" /> Buat Pinjaman
            </Button>
          </div>
        </div>

        {showForm && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">Form Pinjaman Baru</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Jenis Pinjaman</Label>
                  <Select value={loanType} onValueChange={setLoanType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank">🏦 Bank</SelectItem>
                      <SelectItem value="leasing">🚗 Leasing</SelectItem>
                      <SelectItem value="other">📄 Pinjaman Lain</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Pemberi Pinjaman <span className="text-destructive">*</span></Label>
                  <Input placeholder="Nama bank / leasing..." value={lenderName} onChange={(e) => setLenderName(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nominal Pinjaman (IDR) <span className="text-destructive">*</span></Label>
                  <Input placeholder="0" className="font-mono" value={principalRaw} onChange={(e) => setPrincipalRaw(fmtIDR(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tanggal Pencairan <span className="text-destructive">*</span></Label>
                  <DatePicker value={disbDate} onChange={(v) => setDisbDate(v)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Tenor (bulan)</Label>
                  <Input type="number" placeholder="12" value={tenor} onChange={(e) => setTenor(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Bunga (%/tahun)</Label>
                  <Input type="number" step="0.01" placeholder="0.00" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Biaya Admin (IDR)</Label>
                  <Input placeholder="0" className="font-mono" value={adminFee} onChange={(e) => setAdminFee(fmtIDR(e.target.value))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Sumber Kas</Label>
                  <Select value={pm} onValueChange={setPm}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank">🏦 Bank</SelectItem>
                      <SelectItem value="cash">💵 Kas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Keterangan</Label>
                  <Input placeholder="Opsional..." value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              {parseIDR(principalRaw) > 0 && (
                <div className="rounded-md bg-muted/40 border px-4 py-2 text-xs text-muted-foreground">
                  Jurnal Pencairan: <strong>DR {pm === "cash" ? "Kas" : "Bank"}</strong> {idr(parseIDR(principalRaw))} · <strong>CR Hutang {TYPE_LABELS[loanType]}</strong> {idr(parseIDR(principalRaw))}
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={createMut.isPending}>
                  {createMut.isPending ? <><Loader2 size={14} className="mr-1 animate-spin" />Menyimpan...</> : "Simpan Pinjaman"}
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
                  <TableHead>No. Pinjaman</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Pemberi Pinjaman</TableHead>
                  <TableHead>Cair</TableHead>
                  <TableHead className="text-right">Pokok</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Tenor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Memuat...</TableCell></TableRow>}
                {!isLoading && list.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Belum ada pinjaman.</TableCell></TableRow>}
                {(list as any[]).map((row) => (
                  <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(row)}>
                    <TableCell className="font-mono text-xs text-primary">{row.loan_number}</TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs border", TYPE_COLORS[row.loan_type] ?? "")}>{TYPE_LABELS[row.loan_type] ?? row.loan_type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{row.lender_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.disbursement_date}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{idr(row.principal_amount)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-amber-400">{idr(row.outstanding_amount)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.tenor_months ? `${row.tenor_months} bln` : "—"}</TableCell>
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
        <SheetContent className="w-[440px] sm:w-[540px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{selected.loan_number}</SheetTitle>
                <SheetDescription>{selected.lender_name} · {TYPE_LABELS[selected.loan_type]}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Pokok Awal</span>
                    <span className="font-mono font-semibold">{idr(selected.principal_amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Terbayar</span>
                    <span className="font-mono text-emerald-400">{idr(selected.paid_amount)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-bold">
                    <span>Outstanding</span>
                    <span className="font-mono text-amber-400">{idr(selected.outstanding_amount)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {selected.tenor_months && <div className="text-xs text-muted-foreground">Tenor: {selected.tenor_months} bulan</div>}
                    {parseFloat(selected.interest_rate) > 0 && <div className="text-xs text-muted-foreground">Bunga: {selected.interest_rate}%/thn</div>}
                    <div className="text-xs text-muted-foreground">Cair: {selected.disbursement_date}</div>
                  </div>
                  {selected.notes && <p className="text-xs text-muted-foreground pt-1">{selected.notes}</p>}
                </div>

                {/* Payment history */}
                <div>
                  <p className="text-sm font-medium mb-2">Riwayat Cicilan</p>
                  {!detail?.payments?.length ? (
                    <p className="text-xs text-muted-foreground">Belum ada cicilan.</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {detail.payments.map((p: any) => (
                        <div key={p.id} className="flex justify-between items-start rounded border px-3 py-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">{p.payment_date} · {p.payment_method === "cash" ? "Kas" : "Bank"}</div>
                            {parseFloat(p.interest_amount) > 0 && <div className="text-orange-400">Bunga: {idr(p.interest_amount)}</div>}
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-emerald-400">{idr(p.total_amount)}</div>
                            <div className="text-muted-foreground text-[10px]">Pokok: {idr(p.principal_amount)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pay form */}
                {selected.status !== "paid" && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-sm font-medium flex items-center gap-2"><CreditCard size={14} className="text-primary" />Bayar Cicilan</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Pokok <span className="text-destructive">*</span></Label>
                        <Input placeholder="0" className="font-mono h-8 text-sm" value={payPrinRaw} onChange={(e) => setPayPrinRaw(fmtIDR(e.target.value))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Bunga (opsional)</Label>
                        <Input placeholder="0" className="font-mono h-8 text-sm" value={payIntRaw} onChange={(e) => setPayIntRaw(fmtIDR(e.target.value))} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tanggal</Label>
                        <DatePicker value={payDate} onChange={(v) => setPayDate(v)} className="h-8 text-sm" />
                      </div>
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
                    </div>
                    <Input placeholder="Referensi / keterangan..." className="h-8 text-sm" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                    {(parseIDR(payPrinRaw) > 0 || parseIDR(payIntRaw) > 0) && (
                      <div className="rounded-md bg-muted/40 border px-3 py-2 text-xs text-muted-foreground">
                        DR Hutang {idr(parseIDR(payPrinRaw))}{parseIDR(payIntRaw) > 0 ? ` + DR Biaya Bunga ${idr(parseIDR(payIntRaw))}` : ""} · CR {payPm === "cash" ? "Kas" : "Bank"} {idr(parseIDR(payPrinRaw) + parseIDR(payIntRaw))}
                      </div>
                    )}
                    <Button size="sm" className="w-full" onClick={handlePay} disabled={payMut.isPending}>
                      {payMut.isPending ? <><Loader2 size={13} className="mr-1 animate-spin" />Menyimpan...</> : "Catat Cicilan"}
                    </Button>
                  </div>
                )}

                {selected.status === "active" && parseFloat(selected.paid_amount) === 0 && (
                  <div className="border-t pt-4">
                    <Button variant="destructive" size="sm" className="w-full" onClick={() => deleteMut.mutate(selected.id)} disabled={deleteMut.isPending}>
                      <Trash2 size={13} className="mr-1" /> Hapus Pinjaman
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
