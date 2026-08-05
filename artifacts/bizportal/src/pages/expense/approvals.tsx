import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Plus, Loader2, ShieldCheck, CheckCircle, XCircle, Clock,
  Trash2, Settings, ChevronsUpDown, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtIDR = (raw: string) => { const d = raw.replace(/\D/g, ""); return d ? Number(d).toLocaleString("id-ID") : ""; };
const parseIDR = (v: string) => { const n = Number(v.replace(/\D/g, "")); return isNaN(n) ? 0 : n; };

const REQ_STATUS_COLORS: Record<string, string> = {
  pending:     "bg-amber-900/40 text-amber-300 border-amber-600",
  l1_approved: "bg-sky-900/40 text-sky-300 border-sky-600",
  approved:    "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  rejected:    "bg-red-900/40 text-red-300 border-red-600",
};
const REQ_STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu", l1_approved: "L1 Disetujui", approved: "Disetujui", rejected: "Ditolak",
};
const CAT_LABELS: Record<string, string> = {
  kasbon: "Kasbon", talangan: "Dana Talangan", expense: "Expense",
  bank_loan: "Hutang Bank", vendor_installment: "Cicilan Vendor",
};

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Terjadi kesalahan.");
  return d;
}

// ── User Picker Combobox ──────────────────────────────────────────────────────
function UserPicker({
  value, onChange, placeholder = "Pilih user...",
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["expense-approval-users"],
    queryFn: () => apiFetch("/api/expense-approvals/users"),
    staleTime: 60_000,
  });

  const selected = (users as any[]).find((u) => u.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}>
          {selected ? selected.name : placeholder}
          <ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Cari nama..." />
          <CommandList>
            <CommandEmpty>Tidak ada user.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="" onSelect={() => { onChange(""); setOpen(false); }}>
                <Check size={14} className={cn("mr-2", value === "" ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground italic">— Kosongkan —</span>
              </CommandItem>
              {(users as any[]).map((u) => (
                <CommandItem key={u.id} value={u.name} onSelect={() => { onChange(u.id); setOpen(false); }}>
                  <Check size={14} className={cn("mr-2", value === u.id ? "opacity-100" : "opacity-0")} />
                  <div>
                    <p className="text-sm">{u.name}</p>
                    {u.email && <p className="text-xs text-muted-foreground">{u.email}</p>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const cq = activeCompanyId ? `?company=${activeCompanyId}` : "";

  const [tab, setTab] = useState("requests");
  const [statusFilter, setStatusFilter] = useState("all");

  // ── Approval Requests ─────────────────────────────────────────────────────
  const { data: requests = [], isLoading: reqLoading } = useQuery({
    queryKey: ["approval-requests", activeCompanyId, statusFilter],
    queryFn: () => apiFetch(`/api/expense-approvals/requests?${activeCompanyId ? `company=${activeCompanyId}&` : ""}status=${statusFilter}`),
  });

  const [selectedReq, setSelectedReq] = useState<any | null>(null);
  const [actionNotes, setActionNotes] = useState("");

  const actionMut = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      apiFetch(`/api/expense-approvals/requests/${id}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes: actionNotes }),
      }),
    onSuccess: (d) => {
      toast({ title: `Permintaan ${d.status === "approved" ? "disetujui ✓" : "ditolak"}.` });
      qc.invalidateQueries({ queryKey: ["approval-requests"] });
      qc.invalidateQueries({ queryKey: ["cash-advances"] });
      setSelectedReq(d); setActionNotes("");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // ── Approval Limits ───────────────────────────────────────────────────────
  const { data: limits = [], isLoading: limLoading } = useQuery({
    queryKey: ["approval-limits", activeCompanyId],
    queryFn: () => apiFetch(`/api/expense-approvals/limits${activeCompanyId ? `?company=${activeCompanyId}` : ""}`),
  });

  const [showLimitForm, setShowLimitForm] = useState(false);
  const [editLimit, setEditLimit] = useState<any | null>(null);
  const [limCat, setLimCat] = useState("kasbon");
  const [limMax, setLimMax] = useState("");
  const [limL1, setLimL1] = useState("");
  const [limL2, setLimL2] = useState("");
  const [limNotes, setLimNotes] = useState("");

  const openLimitForm = (lim?: any) => {
    if (lim) {
      setEditLimit(lim); setLimCat(lim.category); setLimMax(lim.max_auto_approve?.toString() ?? "");
      setLimL1(lim.l1_approver_id ?? ""); setLimL2(lim.l2_approver_id ?? ""); setLimNotes(lim.notes ?? "");
    } else {
      setEditLimit(null); setLimCat("kasbon"); setLimMax(""); setLimL1(""); setLimL2(""); setLimNotes("");
    }
    setShowLimitForm(true);
  };

  const saveLimitMut = useMutation({
    mutationFn: (body: object) => {
      if (editLimit) {
        return apiFetch(`/api/expense-approvals/limits/${editLimit.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      }
      return apiFetch(`/api/expense-approvals/limits${cq}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast({ title: "Limit tersimpan." });
      qc.invalidateQueries({ queryKey: ["approval-limits"] });
      setShowLimitForm(false); setEditLimit(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleSaveLimit = () => {
    saveLimitMut.mutate({
      category: limCat, maxAutoApprove: parseIDR(limMax), notes: limNotes,
      l1ApproverId: limL1 || null, l2ApproverId: limL2 || null,
    });
  };

  const delLimitMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/expense-approvals/limits/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Limit dihapus." }); qc.invalidateQueries({ queryKey: ["approval-limits"] }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const pendingCount = (requests as any[]).filter((r) => r.status === "pending" || r.status === "l1_approved").length;

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Link href="/expense">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Kembali"><ArrowLeft size={15} /></Button>
          </Link>
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-violet-400" />
            <div>
              <h1 className="text-xl font-bold">Approval & Limit</h1>
              <p className="text-sm text-muted-foreground">Multi-level approval · Limit per kategori</p>
            </div>
          </div>
          {pendingCount > 0 && (
            <Badge className="bg-amber-900/40 text-amber-300 border-amber-600 border">{pendingCount} menunggu</Badge>
          )}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="requests">Permintaan Approval</TabsTrigger>
            <TabsTrigger value="limits">Konfigurasi Limit</TabsTrigger>
          </TabsList>

          {/* ── Requests Tab ─────────────────────────────────────────────── */}
          <TabsContent value="requests" className="space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="pending">Menunggu</SelectItem>
                  <SelectItem value="l1_approved">L1 Disetujui</SelectItem>
                  <SelectItem value="approved">Disetujui</SelectItem>
                  <SelectItem value="rejected">Ditolak</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead>Pemohon</TableHead>
                      <TableHead className="text-right">Nominal</TableHead>
                      <TableHead>L1</TableHead>
                      <TableHead>L2</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reqLoading && <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Memuat...</TableCell></TableRow>}
                    {!reqLoading && (requests as any[]).length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Belum ada permintaan approval.</TableCell></TableRow>
                    )}
                    {(requests as any[]).map((r) => (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setSelectedReq(r); setActionNotes(""); }}>
                        <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("id-ID")}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{CAT_LABELS[r.ref_type] ?? r.ref_type}</Badge>
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{r.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.requester_name ?? r.requester_id ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{idr(r.amount)}</TableCell>
                        <TableCell>
                          {r.l1_status === "approved" ? <CheckCircle size={14} className="text-emerald-400" /> :
                           r.l1_status === "rejected" ? <XCircle size={14} className="text-red-400" /> :
                           r.l1_status === "pending" ? <Clock size={14} className="text-amber-400" /> : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell>
                          {r.l2_status === "approved" ? <CheckCircle size={14} className="text-emerald-400" /> :
                           r.l2_status === "rejected" ? <XCircle size={14} className="text-red-400" /> :
                           r.l2_status === "pending" ? <Clock size={14} className="text-amber-400" /> :
                           r.l2_status === "skipped" ? <span className="text-xs text-muted-foreground">Skip</span> : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge className={cn("text-xs border", REQ_STATUS_COLORS[r.status] ?? "")}>
                            {REQ_STATUS_LABELS[r.status] ?? r.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Limits Tab ────────────────────────────────────────────────── */}
          <TabsContent value="limits" className="space-y-4 mt-4">
            <div className="flex items-start justify-between">
              <div className="text-sm text-muted-foreground max-w-lg">
                Konfigurasi batas nominal per kategori. Jika nominal melebihi <strong>Maks. Auto-Approve</strong>,
                transaksi akan masuk antrian approval dan menunggu persetujuan L1 (dan L2 jika ada) sebelum diproses.
              </div>
              <Button size="sm" onClick={() => openLimitForm()} className="ml-4 shrink-0">
                <Plus size={14} className="mr-1" /> Tambah Limit
              </Button>
            </div>

            {showLimitForm && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-muted-foreground">{editLimit ? "Edit Limit" : "Limit Baru"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Kategori</Label>
                      <Select value={limCat} onValueChange={setLimCat}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(CAT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Maks. Auto-Approve (IDR)</Label>
                      <Input
                        placeholder="0 = semua butuh approval"
                        className="font-mono"
                        value={limMax}
                        onChange={(e) => setLimMax(fmtIDR(e.target.value))}
                      />
                      <p className="text-xs text-muted-foreground">Nominal di atas ini akan masuk antrian approval.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>L1 Approver (Supervisor)</Label>
                      <UserPicker value={limL1} onChange={setLimL1} placeholder="Pilih approver L1..." />
                    </div>
                    <div className="space-y-1.5">
                      <Label>L2 Approver (Manager/Finance) <span className="text-muted-foreground text-xs">opsional</span></Label>
                      <UserPicker value={limL2} onChange={setLimL2} placeholder="Pilih approver L2..." />
                    </div>
                  </div>
                  <Input placeholder="Keterangan..." value={limNotes} onChange={(e) => setLimNotes(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveLimit} disabled={saveLimitMut.isPending}>
                      {saveLimitMut.isPending ? <Loader2 size={13} className="mr-1 animate-spin" /> : null}
                      Simpan
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setShowLimitForm(false); setEditLimit(null); }}>Batal</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kategori</TableHead>
                      <TableHead className="text-right">Maks. Auto-Approve</TableHead>
                      <TableHead>L1 Approver</TableHead>
                      <TableHead>L2 Approver</TableHead>
                      <TableHead>Keterangan</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {limLoading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>}
                    {!limLoading && (limits as any[]).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Belum ada konfigurasi limit. Tambahkan limit untuk mengaktifkan alur approval.
                        </TableCell>
                      </TableRow>
                    )}
                    {(limits as any[]).map((lim) => (
                      <TableRow key={lim.id}>
                        <TableCell><Badge variant="outline" className="text-xs">{CAT_LABELS[lim.category] ?? lim.category}</Badge></TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {parseFloat(lim.max_auto_approve) > 0 ? idr(lim.max_auto_approve) : <span className="text-muted-foreground text-xs">Semua butuh approval</span>}
                        </TableCell>
                        <TableCell className="text-sm">{lim.l1_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-sm">{lim.l2_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{lim.notes ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openLimitForm(lim)}>
                              <Settings size={12} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => delLimitMut.mutate(lim.id)}>
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Request Detail Sheet ──────────────────────────────────────────── */}
      <Sheet open={!!selectedReq} onOpenChange={(v) => { if (!v) setSelectedReq(null); }}>
        <SheetContent className="w-[400px] sm:w-[480px] overflow-y-auto">
          {selectedReq && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">Detail Permintaan #{selectedReq.id}</SheetTitle>
                <SheetDescription>{CAT_LABELS[selectedReq.ref_type] ?? selectedReq.ref_type} · {new Date(selectedReq.created_at).toLocaleDateString("id-ID")}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <p className="text-sm font-medium">{selectedReq.description}</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Nominal</span>
                    <span className="font-mono font-bold">{idr(selectedReq.amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Pemohon</span>
                    <span>{selectedReq.requester_name ?? selectedReq.requester_id ?? "—"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge className={cn("text-xs border", REQ_STATUS_COLORS[selectedReq.status] ?? "")}>
                      {REQ_STATUS_LABELS[selectedReq.status] ?? selectedReq.status}
                    </Badge>
                  </div>
                </div>

                {/* Approval trail */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Alur Approval</p>
                  {selectedReq.l1_approver_id ? (
                    <div className="flex justify-between items-center text-sm rounded border px-3 py-2">
                      <div>
                        <p className="font-medium">L1 (Supervisor): {selectedReq.l1_approver_display ?? selectedReq.l1_approver_name ?? selectedReq.l1_approver_id}</p>
                        {selectedReq.l1_notes && <p className="text-xs text-muted-foreground">{selectedReq.l1_notes}</p>}
                        {selectedReq.l1_at && <p className="text-xs text-muted-foreground">{new Date(selectedReq.l1_at).toLocaleString("id-ID")}</p>}
                      </div>
                      {selectedReq.l1_status === "approved" ? <CheckCircle size={16} className="text-emerald-400" /> :
                       selectedReq.l1_status === "rejected" ? <XCircle size={16} className="text-red-400" /> :
                       <Clock size={16} className="text-amber-400" />}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground px-1">Tidak ada approver yang dikonfigurasi untuk kategori ini.</p>
                  )}
                  {selectedReq.l2_approver_id && (
                    <div className="flex justify-between items-center text-sm rounded border px-3 py-2">
                      <div>
                        <p className="font-medium">L2 (Manager): {selectedReq.l2_approver_display ?? selectedReq.l2_approver_name ?? selectedReq.l2_approver_id}</p>
                        {selectedReq.l2_notes && <p className="text-xs text-muted-foreground">{selectedReq.l2_notes}</p>}
                        {selectedReq.l2_at && <p className="text-xs text-muted-foreground">{new Date(selectedReq.l2_at).toLocaleString("id-ID")}</p>}
                      </div>
                      {selectedReq.l2_status === "approved" ? <CheckCircle size={16} className="text-emerald-400" /> :
                       selectedReq.l2_status === "rejected" ? <XCircle size={16} className="text-red-400" /> :
                       selectedReq.l2_status === "skipped" ? <span className="text-xs text-muted-foreground">Skip</span> :
                       <Clock size={16} className="text-amber-400" />}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Action buttons */}
                {(selectedReq.status === "pending" || selectedReq.status === "l1_approved") && (
                  <div className="space-y-3">
                    <Label className="text-xs">Catatan (opsional)</Label>
                    <Input className="h-8 text-sm" placeholder="Alasan approval / penolakan..." value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} />
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" className="bg-emerald-700 hover:bg-emerald-600"
                        onClick={() => actionMut.mutate({ id: selectedReq.id, action: "approve" })} disabled={actionMut.isPending}>
                        {actionMut.isPending ? <Loader2 size={13} className="mr-1 animate-spin" /> : <CheckCircle size={13} className="mr-1" />}
                        Setujui
                      </Button>
                      <Button size="sm" variant="destructive"
                        onClick={() => actionMut.mutate({ id: selectedReq.id, action: "reject" })} disabled={actionMut.isPending}>
                        {actionMut.isPending ? <Loader2 size={13} className="mr-1 animate-spin" /> : <XCircle size={13} className="mr-1" />}
                        Tolak
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedReq.status === "pending"
                        ? "Anda menyetujui sebagai L1. Jika ada L2, akan dilanjutkan ke L2."
                        : "Anda menyetujui sebagai L2 (final)."}
                    </p>
                  </div>
                )}

                {selectedReq.status === "approved" && (
                  <div className="rounded-lg bg-emerald-900/20 border border-emerald-700 p-3 text-sm text-emerald-300">
                    ✅ Disetujui — transaksi sudah aktif dan jurnal telah dibuat.
                  </div>
                )}
                {selectedReq.status === "rejected" && (
                  <div className="rounded-lg bg-red-900/20 border border-red-700 p-3 text-sm text-red-300">
                    ❌ Ditolak — transaksi tidak diproses.
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
