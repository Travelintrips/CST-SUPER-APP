/**
 * Master Price Management — BizPortal Admin
 * Route: /marketplace/master-price
 * API:   /api/portal/admin/master-price  (requirePortalAdmin — BizPortal session cookie accepted)
 */

import { useState, useRef, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tags, TrendingUp, Package, Clock, AlertCircle,
  Upload, Download, RefreshCw, Loader2, CheckCircle,
  XCircle, Search, History, Settings, LayoutDashboard,
  ChevronLeft, ChevronRight,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const API = "/api/portal/admin/master-price";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, currency = "IDR") =>
  n != null
    ? new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(n)
    : "—";

const fmtPct = (n: number | null | undefined) =>
  n != null ? `${Number(n).toFixed(2)}%` : "0%";

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const ct = r.headers.get("Content-Type") ?? "";
  if (ct.includes("application/vnd") || ct.includes("text/csv")) {
    if (!r.ok) throw new Error("Export gagal");
    return r as any;
  }
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? "Terjadi kesalahan");
  return json;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PriceItem {
  id: number;
  name: string;
  supplierName: string;
  supplierId: number;
  category: string | null;
  isInternal: boolean;
  status: string;
  isPublished: boolean;
  priceBase: number | null;
  markupPct: number;
  priceSell: number | null;
  currency: string;
  updatedAt: string | null;
}

interface PriceListResponse {
  data: PriceItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface Stats {
  totalInternal: number;
  totalExternal: number;
  withoutPrice: number;
  pendingApproval: number;
  updatedToday: number;
  lastImport: string | null;
}

interface HistoryRow {
  id: number;
  catalog_item_id: number;
  item_name: string | null;
  vendor_name: string | null;
  vendor_type: string;
  priceBaseOld: number | null;
  priceBaseNew: number | null;
  markupOld: number | null;
  markupNew: number | null;
  priceSellOld: number | null;
  priceSellNew: number | null;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
  approval_status: string;
}

// ── Shared small components ───────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, accent,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`rounded-lg p-2.5 ${accent ?? "bg-blue-50"}`}>
          <Icon className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function VendorTypeBadge({ isInternal }: { isInternal: boolean }) {
  return isInternal
    ? <Badge className="bg-purple-100 text-purple-700 border-0 text-[10px]">INTERNAL</Badge>
    : <Badge variant="outline" className="text-[10px]">EXTERNAL</Badge>;
}

function ApprovalBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    auto_approved: "bg-green-100 text-green-700",
    approved:      "bg-green-100 text-green-700",
    pending:       "bg-yellow-100 text-yellow-700",
    rejected:      "bg-red-100 text-red-700",
  };
  return (
    <Badge className={`${cls[status] ?? "bg-gray-100 text-gray-600"} border-0 text-[10px]`}>
      {status === "auto_approved" ? "auto" : status}
    </Badge>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-end mt-4">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="text-sm text-muted-foreground">Hal {page} / {pages}</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ── Edit Price Dialog ─────────────────────────────────────────────────────────

function EditPriceDialog({
  item, onClose, onSaved,
}: { item: PriceItem; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [priceBase, setPriceBase] = useState(String(item.priceBase ?? ""));
  const [markup, setMarkup]       = useState(String(item.markupPct ?? 0));
  const [reason, setReason]       = useState("");
  const [effectiveAt, setEff]     = useState("");
  const [saving, setSaving]       = useState(false);

  const preview = (() => {
    const b = parseFloat(priceBase);
    const m = item.isInternal ? 0 : parseFloat(markup);
    if (isNaN(b) || b <= 0) return null;
    return Math.ceil(b * (1 + (isNaN(m) ? 0 : m) / 100));
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        priceBase: parseFloat(priceBase),
        markup: item.isInternal ? 0 : parseFloat(markup || "0"),
        reason: reason.trim() || null,
      };
      if (effectiveAt) body.effectiveAt = effectiveAt;
      await apiFetch(`${API}/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({ title: "Harga diperbarui", description: item.name });
      onSaved();
      onClose();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Gagal", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit Harga — {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <VendorTypeBadge isInternal={item.isInternal} />
            <span>{item.supplierName}</span>
          </div>
          <div className="space-y-1.5">
            <Label>Price Base (IDR)</Label>
            <Input type="number" min={0} value={priceBase} onChange={e => setPriceBase(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Markup (%)</Label>
            <Input
              type="number" min={0} max={100} value={markup}
              onChange={e => setMarkup(e.target.value)}
              disabled={item.isInternal}
              placeholder={item.isInternal ? "0 — terkunci (internal)" : "0–100"}
            />
          </div>
          {preview != null && (
            <div className="rounded-md bg-muted/50 px-4 py-3 text-sm flex justify-between">
              <span className="text-muted-foreground">Preview Selling Price</span>
              <span className="font-semibold">{fmt(preview)}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Alasan <span className="text-muted-foreground">(opsional)</span></Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="mis. penyesuaian pasar" />
          </div>
          <div className="space-y-1.5">
            <Label>Berlaku Mulai <span className="text-muted-foreground">(opsional — default segera)</span></Label>
            <Input type="datetime-local" value={effectiveAt} onChange={e => setEff(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk Update Dialog ────────────────────────────────────────────────────────

function BulkUpdateDialog({
  ids, hasInternal, onClose, onSaved,
}: { ids: number[]; hasInternal: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [priceBase, setPriceBase] = useState("");
  const [markup, setMarkup]       = useState("");
  const [reason, setReason]       = useState("");
  const [saving, setSaving]       = useState(false);

  const handleSave = async () => {
    if (!priceBase && !markup) { toast({ variant: "destructive", title: "Isi minimal satu field" }); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ids, reason: reason.trim() || "bulk_update" };
      if (priceBase) body.priceBase = parseFloat(priceBase);
      if (markup)    body.markup    = parseFloat(markup);
      const result = await apiFetch(`${API}/bulk-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const ok = (result as any).results?.filter((r: any) => r.ok).length ?? 0;
      toast({ title: `Bulk update: ${ok}/${ids.length} berhasil` });
      onSaved();
      onClose();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Gagal", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Bulk Update — {ids.length} produk</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {hasInternal && (
            <div className="rounded-md bg-purple-50 border border-purple-200 px-3 py-2 text-xs text-purple-700">
              Vendor <strong>Internal</strong>: markup otomatis dikunci ke 0.
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Price Base (IDR) <span className="text-muted-foreground text-xs">— kosong = tidak diubah</span></Label>
            <Input type="number" min={0} value={priceBase} onChange={e => setPriceBase(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Markup (%) <span className="text-muted-foreground text-xs">— hanya untuk External</span></Label>
            <Input type="number" min={0} max={100} value={markup} onChange={e => setMarkup(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Alasan</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="mis. revisi periodik" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────

function DashboardTab() {
  const { data, isLoading, refetch } = useQuery<Stats>({
    queryKey: ["master-price-stats"],
    queryFn: () => apiFetch(`${API}/stats`),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Ringkasan harga marketplace</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Total Internal" value={data?.totalInternal ?? 0} icon={Package} accent="bg-purple-50" />
          <StatCard label="Total External" value={data?.totalExternal ?? 0} icon={TrendingUp} accent="bg-blue-50" />
          <StatCard label="Tanpa Harga" value={data?.withoutPrice ?? 0} icon={AlertCircle} accent="bg-orange-50" />
          <StatCard label="Pending Approval" value={data?.pendingApproval ?? 0} icon={Clock} accent="bg-yellow-50" />
          <StatCard label="Diperbarui Hari Ini" value={data?.updatedToday ?? 0} icon={CheckCircle} accent="bg-green-50" />
          <StatCard label="Import Terakhir" value={data?.lastImport ? fmtDate(data.lastImport) : "—"} icon={Upload} accent="bg-gray-50" />
        </div>
      )}
    </div>
  );
}

// ── Price List Tab ────────────────────────────────────────────────────────────

function PriceListTab() {
  const qc = useQueryClient();
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState("");
  const [draft, setDraft]     = useState("");
  const [vendorType, setVT]   = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [editItem, setEdit]   = useState<PriceItem | null>(null);
  const [selected, setSel]    = useState<Set<number>>(new Set());
  const [bulkOpen, setBulk]   = useState(false);

  const qk = ["master-price-list", page, search, vendorType, statusF];
  const { data, isLoading } = useQuery<PriceListResponse>({
    queryKey: qk,
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) p.set("search", search);
      if (vendorType !== "all") p.set("vendorType", vendorType);
      if (statusF !== "all") p.set("status", statusF);
      return apiFetch(`${API}?${p}`);
    },
  });

  const items = data?.data ?? [];
  const hasInternal = items.filter(i => selected.has(i.id)).some(i => i.isInternal);

  const toggleAll = useCallback(() => {
    setSel(prev => prev.size === items.length && items.length > 0 ? new Set() : new Set(items.map(i => i.id)));
  }, [items]);

  const toggle = useCallback((id: number) => {
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ["master-price-list"] });
    qc.invalidateQueries({ queryKey: ["master-price-stats"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-44">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm" placeholder="Cari produk atau supplier..."
            value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === "Enter" && (setSearch(draft), setPage(1))}
          />
        </div>
        <Select value={vendorType} onValueChange={v => { setVT(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-36 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Vendor</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
            <SelectItem value="external">External</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusF} onValueChange={v => { setStatusF(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8" onClick={() => { setSearch(draft); setPage(1); }}>
          <Search className="w-3.5 h-3.5 mr-1" />Cari
        </Button>
        {selected.size > 0 && (
          <Button size="sm" className="h-8" onClick={() => setBulk(true)}>
            Bulk Update ({selected.size})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-10">
                    <Checkbox checked={selected.size === items.length && items.length > 0} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead className="w-12 text-xs">SKU</TableHead>
                  <TableHead className="text-xs">Produk</TableHead>
                  <TableHead className="text-xs">Supplier</TableHead>
                  <TableHead className="text-xs">Tipe</TableHead>
                  <TableHead className="text-xs text-right">Price Base</TableHead>
                  <TableHead className="text-xs text-right">Markup</TableHead>
                  <TableHead className="text-xs text-right">Selling Price</TableHead>
                  <TableHead className="text-xs">Diperbarui</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10 text-sm">
                      Tidak ada data
                    </TableCell>
                  </TableRow>
                ) : items.map(item => (
                  <TableRow key={item.id} className={selected.has(item.id) ? "bg-blue-50/40" : ""}>
                    <TableCell>
                      <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.id}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm max-w-[180px] truncate">{item.name}</div>
                      {item.category && <div className="text-xs text-muted-foreground">{item.category}</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[130px] truncate">{item.supplierName}</TableCell>
                    <TableCell><VendorTypeBadge isInternal={item.isInternal} /></TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(item.priceBase)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {item.isInternal
                        ? <span className="text-muted-foreground text-xs">0%</span>
                        : fmtPct(item.markupPct)
                      }
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">{fmt(item.priceSell)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(item.updatedAt)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEdit(item)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
          <p className="text-xs text-muted-foreground text-right">{data?.total ?? 0} produk</p>
        </>
      )}

      {editItem && <EditPriceDialog item={editItem} onClose={() => setEdit(null)} onSaved={onSaved} />}
      {bulkOpen && (
        <BulkUpdateDialog
          ids={[...selected]} hasInternal={hasInternal}
          onClose={() => setBulk(false)}
          onSaved={() => { onSaved(); setSel(new Set()); }}
        />
      )}
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab() {
  const [page, setPage]       = useState(1);
  const [vendorType, setVT]   = useState("all");

  const { data, isLoading, refetch } = useQuery<{ data: HistoryRow[]; total: number; page: number; pages: number }>({
    queryKey: ["master-price-history", page, vendorType],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "50" });
      if (vendorType !== "all") p.set("vendorType", vendorType);
      return apiFetch(`${API}/history?${p}`);
    },
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <Select value={vendorType} onValueChange={v => { setVT(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-36 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Vendor</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
            <SelectItem value="external">External</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">Produk</TableHead>
                  <TableHead className="text-xs">Tipe</TableHead>
                  <TableHead className="text-xs text-right">Base Lama</TableHead>
                  <TableHead className="text-xs text-right">Base Baru</TableHead>
                  <TableHead className="text-xs text-right">Markup Baru</TableHead>
                  <TableHead className="text-xs text-right">Sell Baru</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Alasan</TableHead>
                  <TableHead className="text-xs">Diubah Oleh</TableHead>
                  <TableHead className="text-xs">Tanggal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10 text-sm">
                      Belum ada riwayat
                    </TableCell>
                  </TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="text-sm font-medium max-w-[150px] truncate">{r.item_name ?? `#${r.catalog_item_id}`}</div>
                      <div className="text-xs text-muted-foreground max-w-[150px] truncate">{r.vendor_name}</div>
                    </TableCell>
                    <TableCell><VendorTypeBadge isInternal={r.vendor_type === "internal"} /></TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(r.priceBaseOld)}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{fmt(r.priceBaseNew)}</TableCell>
                    <TableCell className="text-right text-xs">{fmtPct(r.markupNew)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(r.priceSellNew)}</TableCell>
                    <TableCell><ApprovalBadge status={r.approval_status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[90px] truncate">{r.reason ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[110px] truncate">{r.changed_by}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.changed_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
          <p className="text-xs text-muted-foreground text-right">{data?.total ?? 0} record</p>
        </>
      )}
    </div>
  );
}

// ── Approval Tab ──────────────────────────────────────────────────────────────

function ApprovalTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [actingId, setActingId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<{ data: any[] }>({
    queryKey: ["master-price-pending"],
    queryFn: () => apiFetch(`${API}/pending-approvals`),
    refetchInterval: 15_000,
  });

  const rows = data?.data ?? [];

  const act = async (histId: number, action: "approve" | "reject") => {
    setActingId(histId);
    try {
      await apiFetch(`${API}/approvals/${histId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      toast({ title: action === "approve" ? "Disetujui" : "Ditolak" });
      qc.invalidateQueries({ queryKey: ["master-price-pending"] });
      qc.invalidateQueries({ queryKey: ["master-price-stats"] });
      qc.invalidateQueries({ queryKey: ["master-price-list"] });
      qc.invalidateQueries({ queryKey: ["master-price-history"] });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Gagal", description: e.message });
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows.length} perubahan menunggu persetujuan</p>
        <Button variant="ghost" size="sm" className="h-8" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle className="w-10 h-10 mx-auto mb-3 text-green-400" />
          <p className="text-sm">Tidak ada perubahan yang menunggu persetujuan</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs">Produk</TableHead>
                <TableHead className="text-xs">Tipe</TableHead>
                <TableHead className="text-xs text-right">Base Lama → Baru</TableHead>
                <TableHead className="text-xs text-right">Markup Baru</TableHead>
                <TableHead className="text-xs text-right">Sell Baru</TableHead>
                <TableHead className="text-xs">Alasan</TableHead>
                <TableHead className="text-xs">Diajukan</TableHead>
                <TableHead className="text-xs text-center">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{r.item_name ?? `#${r.catalog_item_id}`}</div>
                    <div className="text-xs text-muted-foreground">{r.vendor_name}</div>
                  </TableCell>
                  <TableCell><VendorTypeBadge isInternal={r.vendor_type === "internal"} /></TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    <span className="text-muted-foreground">{fmt(Number(r.price_base_old))}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span className="font-semibold">{fmt(Number(r.price_base_new))}</span>
                  </TableCell>
                  <TableCell className="text-right text-xs">{fmtPct(Number(r.markup_new))}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">{fmt(r.price_sell_new != null ? Number(r.price_sell_new) : null)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate">{r.reason ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.changed_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-center">
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-green-600 hover:bg-green-50"
                        disabled={actingId === r.id}
                        onClick={() => act(r.id, "approve")}
                        title="Setujui"
                      >
                        {actingId === r.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <CheckCircle className="w-3.5 h-3.5" />
                        }
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-red-500 hover:bg-red-50"
                        disabled={actingId === r.id}
                        onClick={() => act(r.id, "reject")}
                        title="Tolak"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Import / Export Tab ───────────────────────────────────────────────────────

function ImportExportTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [exporting, setExporting] = useState(false);

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast({ variant: "destructive", title: "Pilih file terlebih dahulu" }); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API}/import`, { method: "POST", credentials: "include", body: fd });
      const json = await r.json();
      if (!r.ok) throw new Error(json.message ?? "Gagal import");
      setImportResult(json);
      toast({ title: `Import selesai: ${json.ok}/${json.total} baris berhasil` });
      qc.invalidateQueries({ queryKey: ["master-price-list"] });
      qc.invalidateQueries({ queryKey: ["master-price-stats"] });
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      toast({ variant: "destructive", title: "Import gagal", description: e.message });
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async (format: "xlsx" | "csv") => {
    setExporting(true);
    try {
      const r = await fetch(`${API}/export?format=${format}`, { credentials: "include" });
      if (!r.ok) throw new Error("Export gagal");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `master-price-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Export ${format.toUpperCase()} berhasil` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Export gagal", description: e.message });
    } finally {
      setExporting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = "sku,price_base,markup\n21,5000000,10\n19,3000000,5";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "master-price-template.csv";
    a.click();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div>
            <h3 className="font-semibold">Export Data Harga</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Download seluruh daftar produk dengan harga dalam format CSV atau XLSX.
              Kolom: SKU, Product, Supplier, Vendor Type, Price Base, Markup, Selling Price, Currency, Status.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleExport("xlsx")} disabled={exporting}>
              {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              XLSX
            </Button>
            <Button variant="outline" onClick={() => handleExport("csv")} disabled={exporting}>
              {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div>
            <h3 className="font-semibold">Import Data Harga</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Upload CSV atau XLSX dengan kolom{" "}
              <code className="text-xs bg-muted px-1 rounded">sku</code> (atau <code className="text-xs bg-muted px-1 rounded">name</code>),{" "}
              <code className="text-xs bg-muted px-1 rounded">price_base</code>,{" "}
              <code className="text-xs bg-muted px-1 rounded">markup</code> (opsional).
              Vendor internal: markup selalu dikunci ke 0.
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={downloadTemplate}>
            <Download className="w-3 h-3 mr-1" />Download Template CSV
          </Button>
          <div className="flex gap-2 items-center">
            <input
              ref={fileRef} type="file" accept=".csv,.xlsx,.xls"
              className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:text-xs file:font-medium cursor-pointer"
            />
            <Button onClick={handleImport} disabled={importing}>
              {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload
            </Button>
          </div>
          {importResult && (
            <div className="space-y-2">
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 font-medium">✓ {importResult.ok} berhasil</span>
                {importResult.failed > 0 && <span className="text-red-600 font-medium">✗ {importResult.failed} gagal</span>}
                {importResult.pendingApproval && <span className="text-yellow-600">— Menunggu approval</span>}
              </div>
              {importResult.results?.filter((r: any) => !r.ok).length > 0 && (
                <div className="rounded-md border bg-red-50 p-3 space-y-1 max-h-40 overflow-y-auto">
                  {importResult.results.filter((r: any) => !r.ok).map((r: any) => (
                    <p key={r.row} className="text-xs text-red-700">Baris {r.row}: {r.error}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["master-price-config"],
    queryFn: () => apiFetch(`${API}/config`),
  });

  const [localVal, setLocal] = useState<boolean | null>(null);
  const [saving, setSaving]  = useState(false);

  const current   = data?.require_approval === "true";
  const effective = localVal ?? current;

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch(`${API}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ require_approval: effective }),
      });
      toast({ title: "Konfigurasi disimpan" });
      qc.invalidateQueries({ queryKey: ["master-price-config"] });
      setLocal(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Gagal", description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <Card>
        <CardContent className="p-6 space-y-5">
          <h3 className="font-semibold">Konfigurasi Approval</h3>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Wajib Persetujuan Admin</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Aktif: setiap perubahan harga harus disetujui sebelum berlaku. <br />
                    Nonaktif: harga langsung diterapkan (auto_approved).
                  </p>
                </div>
                <Switch checked={effective} onCheckedChange={v => setLocal(v)} />
              </div>
              <div className="rounded-md bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
                Status saat ini: <strong>{current ? "Wajib Approval" : "Auto Approved"}</strong>
              </div>
              {localVal !== null && localVal !== current && (
                <Button onClick={handleSave} disabled={saving} size="sm">
                  {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  Simpan Perubahan
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MasterPricePage() {
  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-50 p-2.5">
            <Tags className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight">Master Price Management</h1>
            <p className="text-sm text-muted-foreground">
              Kelola harga jual produk marketplace — base price, markup, dan approval workflow
            </p>
          </div>
        </div>

        <Tabs defaultValue="dashboard">
          <TabsList className="h-9">
            <TabsTrigger value="dashboard" className="text-xs gap-1.5">
              <LayoutDashboard className="w-3.5 h-3.5" />Dashboard
            </TabsTrigger>
            <TabsTrigger value="harga" className="text-xs gap-1.5">
              <Tags className="w-3.5 h-3.5" />Daftar Harga
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs gap-1.5">
              <History className="w-3.5 h-3.5" />History
            </TabsTrigger>
            <TabsTrigger value="approval" className="text-xs gap-1.5">
              <Clock className="w-3.5 h-3.5" />Approval
            </TabsTrigger>
            <TabsTrigger value="import" className="text-xs gap-1.5">
              <Upload className="w-3.5 h-3.5" />Import / Export
            </TabsTrigger>
            <TabsTrigger value="pengaturan" className="text-xs gap-1.5">
              <Settings className="w-3.5 h-3.5" />Pengaturan
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="dashboard"><DashboardTab /></TabsContent>
            <TabsContent value="harga"><PriceListTab /></TabsContent>
            <TabsContent value="history"><HistoryTab /></TabsContent>
            <TabsContent value="approval"><ApprovalTab /></TabsContent>
            <TabsContent value="import"><ImportExportTab /></TabsContent>
            <TabsContent value="pengaturan"><SettingsTab /></TabsContent>
          </div>
        </Tabs>
      </div>
    </AppShell>
  );
}
