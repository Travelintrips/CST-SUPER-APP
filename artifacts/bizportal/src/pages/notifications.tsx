import { useState, useEffect, useCallback, useRef } from "react";
import {
  Bell, Package, Ship, ShoppingBag, FileText, RefreshCw,
  Container, Layers, ShoppingCart, Trash2, CheckCheck,
  ChevronLeft, ChevronRight, Eye, ClipboardList, MessageSquare,
  Filter, Search, X, Sparkles, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

type NotifType =
  | "logistic" | "logistic_status" | "portal_sales" | "sales_update"
  | "freight_new" | "freight_status" | "freight_stage"
  | "ecommerce" | "product"
  | "sales_new" | "purchase_rfq" | "purchase_po" | "vendor_quote"
  | "vendor_po_accepted";

interface DbNotification {
  id: number;
  type: NotifType;
  order_id: number | null;
  order_number: string;
  customer_name: string;
  company_name: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  logistic:        "Order Logistik",
  logistic_status: "Update Logistik",
  portal_sales:    "Order Portal",
  sales_update:    "Update Sales",
  sales_new:       "Sales Baru",
  freight_new:     "Freight Baru",
  freight_status:  "Update Freight",
  freight_stage:   "Stage Freight",
  ecommerce:       "E-commerce",
  product:         "Order Produk",
  purchase_rfq:      "RFQ Pembelian",
  purchase_po:       "Purchase Order",
  vendor_quote:      "Penawaran Vendor",
  vendor_po_accepted:"Vendor Konfirmasi PO",
};

const TYPE_COLORS: Record<string, string> = {
  logistic:        "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  logistic_status: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  portal_sales:    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  sales_update:    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  sales_new:       "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  freight_new:     "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  freight_status:  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  freight_stage:   "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  ecommerce:       "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  product:         "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  purchase_rfq:       "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  purchase_po:        "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300",
  vendor_quote:       "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  vendor_po_accepted: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const TYPE_HREFS: Record<string, (orderId: number | null) => string> = {
  logistic:        (id) => id ? `/bizportal/logistics/portal-orders/${id}` : "/bizportal/logistics/portal-orders",
  logistic_status: (id) => id ? `/bizportal/logistics/portal-orders/${id}` : "/bizportal/logistics/portal-orders",
  portal_sales:    () => "/bizportal/logistics/portal-orders",
  sales_update:    (id) => id ? `/bizportal/sales/documents/${id}` : "/bizportal/sales/documents",
  sales_new:       (id) => id ? `/bizportal/sales/documents/${id}` : "/bizportal/sales/documents",
  freight_new:     (id) => id ? `/bizportal/logistics/freight/${id}` : "/bizportal/logistics/freight",
  freight_status:  (id) => id ? `/bizportal/logistics/freight/${id}` : "/bizportal/logistics/freight",
  freight_stage:   (id) => id ? `/bizportal/logistics/freight/${id}` : "/bizportal/logistics/freight",
  ecommerce:       () => "/bizportal/ecommerce",
  product:         () => "/bizportal/portal-product-orders",
  purchase_rfq:       (id) => id ? `/bizportal/purchase/documents/${id}` : "/bizportal/purchase/documents",
  purchase_po:        (id) => id ? `/bizportal/purchase/documents/${id}` : "/bizportal/purchase/documents",
  vendor_quote:       (id) => id ? `/bizportal/logistics/portal-orders/${id}` : "/bizportal/logistics/portal-orders",
  vendor_po_accepted: (id) => id ? `/bizportal/purchase/orders/${id}` : "/bizportal/purchase/orders",
};

function TypeIcon({ type }: { type: string }) {
  const cls = "shrink-0";
  if (type === "logistic")        return <Ship size={15} className={`${cls} text-blue-500`} />;
  if (type === "logistic_status") return <RefreshCw size={15} className={`${cls} text-cyan-500`} />;
  if (type === "portal_sales")    return <ShoppingBag size={15} className={`${cls} text-purple-500`} />;
  if (type === "sales_update")    return <FileText size={15} className={`${cls} text-orange-500`} />;
  if (type === "sales_new")       return <ClipboardList size={15} className={`${cls} text-emerald-500`} />;
  if (type === "freight_new")     return <Container size={15} className={`${cls} text-indigo-500`} />;
  if (type === "freight_status")  return <RefreshCw size={15} className={`${cls} text-violet-500`} />;
  if (type === "freight_stage")   return <Layers size={15} className={`${cls} text-teal-500`} />;
  if (type === "ecommerce")       return <ShoppingCart size={15} className={`${cls} text-pink-500`} />;
  if (type === "purchase_rfq")      return <ShoppingCart size={15} className={`${cls} text-amber-500`} />;
  if (type === "purchase_po")       return <ShoppingCart size={15} className={`${cls} text-lime-600`} />;
  if (type === "vendor_quote")      return <MessageSquare size={15} className={`${cls} text-sky-500`} />;
  if (type === "vendor_po_accepted") return <CheckCheck size={15} className={`${cls} text-green-600`} />;
  return <Package size={15} className={`${cls} text-green-500`} />;
}

function formatRupiah(v: number) {
  return `Rp ${v.toLocaleString("id-ID")}`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "baru saja";
  if (mins < 60) return `${mins} mnt lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} jam lalu`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function notifDesc(n: DbNotification): string {
  const p = n.payload;
  if (n.type === "logistic") {
    const route = p.origin && p.destination ? `${p.origin} → ${p.destination}` : "";
    return route || (p.status as string | undefined) || "";
  }
  if (n.type === "logistic_status") {
    return `Status: ${p.status ?? ""}`;
  }
  if (n.type === "sales_update") {
    const label = (p.actionLabel as string | undefined) ?? "";
    const total = typeof p.grandTotal === "number" ? ` · ${formatRupiah(p.grandTotal)}` : "";
    return `${label}${total}`;
  }
  if (n.type === "sales_new") {
    const kind = p.docKind === "order" ? "Sales Order" : "Sales Quotation";
    const total = typeof p.grandTotal === "number" ? ` · ${formatRupiah(p.grandTotal)}` : "";
    return `${kind}${total}`;
  }
  if (n.type === "freight_new") {
    const route = p.origin && p.destination ? ` · ${p.origin} → ${p.destination}` : "";
    return `${p.commodity ?? ""}${route}`;
  }
  if (n.type === "freight_status") {
    const route = p.origin && p.destination ? ` · ${p.origin} → ${p.destination}` : "";
    return `Status: ${p.status ?? ""}${route}`;
  }
  if (n.type === "freight_stage") {
    const vendor = p.vendorName ? ` · ${p.vendorName}` : "";
    return `${p.stageType ?? ""}: ${p.stageStatus ?? ""}${vendor}`;
  }
  if (n.type === "portal_sales") {
    const total = typeof p.grandTotal === "number" ? ` · ${formatRupiah(p.grandTotal)}` : "";
    const items = typeof p.itemCount === "number" ? `${p.itemCount} item` : "";
    return `${items}${total}`;
  }
  if (n.type === "ecommerce" || n.type === "product") {
    const total = typeof p.grandTotal === "number" ? ` · ${formatRupiah(p.grandTotal)}` : "";
    return `${p.itemCount ?? 1} item${total}`;
  }
  if (n.type === "purchase_rfq") {
    const total = typeof p.grandTotal === "number" ? ` · ${formatRupiah(p.grandTotal)}` : "";
    return `Request for Quotation${total}`;
  }
  if (n.type === "purchase_po") {
    const total = typeof p.grandTotal === "number" ? ` · ${formatRupiah(p.grandTotal)}` : "";
    return `Purchase Order${total}`;
  }
  if (n.type === "vendor_quote") {
    const pos = typeof p.quotePosition === "number" ? ` · Vendor ke-${p.quotePosition}` : "";
    const price = typeof p.vendorPrice === "number" ? ` · ${formatRupiah(p.vendorPrice)}` : "";
    return `${p.rfqNumber ?? ""}${pos}${price}`;
  }
  return "";
}

const ALL_TYPES: { value: string; label: string }[] = [
  { value: "all",            label: "Semua" },
  { value: "logistic",       label: "Logistik" },
  { value: "freight_new",    label: "Freight" },
  { value: "sales_new",      label: "Sales Baru" },
  { value: "sales_update",   label: "Update Sales" },
  { value: "purchase_rfq",   label: "RFQ Beli" },
  { value: "purchase_po",    label: "PO Beli" },
  { value: "vendor_quote",      label: "Penawaran Vendor" },
  { value: "vendor_po_accepted", label: "Vendor Konfirmasi PO" },
  { value: "portal_sales",   label: "Order Portal" },
  { value: "ecommerce",      label: "E-commerce" },
  { value: "product",        label: "Order Produk" },
];

const READ_FILTERS = [
  { value: "all",    label: "Semua" },
  { value: "unread", label: "Belum Dibaca" },
  { value: "read",   label: "Sudah Dibaca" },
];

const PAGE_SIZE = 25;

const SSE_EVENTS = [
  "new_order", "new_logistic_order", "logistic_order_status_changed",
  "sales_order_update", "freight_shipment_created", "freight_shipment_status",
  "freight_stage_update", "new_ecommerce_order", "new_product_order",
  "sales_doc_created", "purchase_doc_created", "purchase_doc_confirmed",
  "vendor_quote_received", "portal_order_created",
];

export default function NotificationsPage() {
  const [data, setData] = useState<DbNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [readFilter, setReadFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [newArrived, setNewArrived] = useState(0);

  const pageRef = useRef(page);
  pageRef.current = page;

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      type:   typeFilter,
      read:   readFilter,
      limit:  String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (search.trim()) params.set("search", search.trim());
    fetch(`/api/notifications?${params}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : { data: [], total: 0, unreadTotal: 0 })
      .then((json) => {
        setData(json.data ?? []);
        setTotal(json.total ?? 0);
        setUnreadTotal(json.unreadTotal ?? 0);
        setNewArrived(0);
      })
      .finally(() => setLoading(false));
  }, [typeFilter, readFilter, page, search]);

  useEffect(() => { setPage(0); }, [typeFilter, readFilter, search]);
  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Polling auto-refresh (30 detik) ──
  // Tidak pakai EventSource sendiri di sini karena useOrderNotifications di layout
  // sudah subscribe ke endpoint yang sama — dua listener aktif menyebabkan event
  // diproses ganda dan invalidateQueries dipanggil 2x.
  useEffect(() => {
    let unmounted = false;
    const POLL_MS = 30_000;

    function poll() {
      if (unmounted) return;
      if (pageRef.current === 0) {
        setLoading(true);
        const params = new URLSearchParams({ type: "all", read: "all", limit: String(PAGE_SIZE), offset: "0" });
        fetch(`/api/notifications?${params}`, { credentials: "include" })
          .then((r) => r.ok ? r.json() : null)
          .then((json) => {
            if (!json || unmounted) return;
            setData(json.data ?? []);
            setTotal(json.total ?? 0);
            setUnreadTotal(json.unreadTotal ?? 0);
            setNewArrived(0);
          })
          .finally(() => { if (!unmounted) setLoading(false); });
      } else {
        // Halaman > 0: cek saja apakah ada yang baru tanpa replace data
        const params = new URLSearchParams({ type: "all", read: "unread", limit: "1", offset: "0" });
        fetch(`/api/notifications?${params}`, { credentials: "include" })
          .then((r) => r.ok ? r.json() : null)
          .then((json) => {
            if (!json || unmounted) return;
            const serverUnread = json.unreadTotal ?? 0;
            setUnreadTotal((prev) => {
              if (serverUnread > prev) setNewArrived((n) => n + (serverUnread - prev));
              return serverUnread;
            });
          });
      }
    }

    const timer = setInterval(poll, POLL_MS);
    return () => {
      unmounted = true;
      clearInterval(timer);
    };
  }, []);

  function markRead(id: number) {
    fetch(`/api/notifications/${id}/read`, { method: "POST", credentials: "include" })
      .then(() => fetchData());
  }

  function markAllRead() {
    fetch(`/api/notifications/mark-all-read`, { method: "POST", credentials: "include" })
      .then(() => fetchData());
  }

  function deleteOne(id: number) {
    fetch(`/api/notifications/${id}`, { method: "DELETE", credentials: "include" })
      .then(() => fetchData());
  }

  function deleteAll() {
    if (!confirm("Hapus semua notifikasi? Tindakan ini tidak dapat dibatalkan.")) return;
    setDeleting(true);
    fetch(`/api/notifications`, { method: "DELETE", credentials: "include" })
      .then(() => { setPage(0); fetchData(); })
      .finally(() => setDeleting(false));
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasActiveFilter = typeFilter !== "all" || readFilter !== "all" || search.trim() !== "";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 mt-0.5"
              onClick={() => window.history.back()}
              title="Kembali"
            >
              <ArrowLeft size={16} />
            </Button>
            <div>
            <div className="flex items-center gap-2">
              <Bell size={20} className="text-indigo-500" />
              <h1 className="text-lg font-semibold">Riwayat Notifikasi</h1>
              {unreadTotal > 0 && (
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-bold text-white">
                  {unreadTotal} baru
                </span>
              )}
            </div>
            {total > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {total} notifikasi tersimpan
              </p>
            )}
            </div>
          </div>
          <div className="flex gap-2">
            {unreadTotal > 0 && (
              <Button size="sm" variant="outline" onClick={markAllRead} className="gap-1.5 text-xs h-8">
                <CheckCheck size={13} />
                Semua dibaca
              </Button>
            )}
            {total > 0 && (
              <Button
                size="sm" variant="outline" onClick={deleteAll} disabled={deleting}
                className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
              >
                <Trash2 size={13} />
                Hapus semua
              </Button>
            )}
          </div>
        </div>

        {/* ── Banner notifikasi baru (halaman > 0) ── */}
        {newArrived > 0 && (
          <button
            onClick={() => { setPage(0); setNewArrived(0); }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-700 px-4 py-2.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors animate-in slide-in-from-top-2 duration-300"
          >
            <Sparkles size={13} className="animate-pulse" />
            {newArrived} notifikasi baru masuk — klik untuk melihat
            <span className="ml-auto text-indigo-400 dark:text-indigo-500">↑ ke atas</span>
          </button>
        )}

        {/* ── Search ── */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nomor order atau nama customer…"
              className="pl-8 h-8 text-xs"
            />
            {searchInput && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-8 text-xs gap-1.5">
            <Search size={12} />
            Cari
          </Button>
        </form>

        {/* ── Filter: Type ── */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Filter size={12} className="text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Tipe</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ALL_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTypeFilter(t.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                  typeFilter === t.value
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:border-indigo-300 hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Filter: Read status ── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {READ_FILTERS.map((r) => (
            <button
              key={r.value}
              onClick={() => setReadFilter(r.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                readFilter === r.value
                  ? "bg-foreground text-background border-foreground shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
          {hasActiveFilter && (
            <button
              onClick={() => { setTypeFilter("all"); setReadFilter("all"); clearSearch(); }}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border border-dashed border-destructive/40 text-destructive/70 hover:text-destructive hover:border-destructive transition-colors"
            >
              <X size={10} />
              Reset filter
            </button>
          )}
        </div>

        {/* ── List ── */}
        <div className="rounded-xl border border-border overflow-hidden shadow-sm">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3 px-4 py-3.5">
                  <Skeleton className="h-5 w-5 rounded-full shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-2.5 w-56" />
                  </div>
                  <Skeleton className="h-3 w-14 shrink-0" />
                </div>
              ))}
            </div>
          ) : data.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <Bell size={36} className="opacity-15" />
              <div className="text-center">
                <p className="text-sm font-medium">Tidak ada notifikasi</p>
                {hasActiveFilter && (
                  <p className="text-xs mt-1 text-muted-foreground/70">Coba ubah filter di atas</p>
                )}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.map((n) => {
                const isUnread = !n.read_at;
                const href = TYPE_HREFS[n.type]?.(n.order_id) ?? "/bizportal";
                const colorCls = TYPE_COLORS[n.type] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
                const desc = notifDesc(n);
                return (
                  <div
                    key={n.id}
                    className={`group flex gap-3 px-4 py-3.5 transition-colors ${
                      isUnread
                        ? "bg-blue-50/50 dark:bg-blue-950/15 hover:bg-blue-50 dark:hover:bg-blue-950/25"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    {/* Icon + unread dot */}
                    <div className="relative mt-0.5 shrink-0">
                      <TypeIcon type={n.type} />
                      {isUnread && (
                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-background" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">{n.order_number}</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${colorCls}`}>
                          {TYPE_LABELS[n.type] ?? n.type}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/80 mt-0.5 truncate">
                        {n.customer_name}
                        {n.company_name && (
                          <span className="text-muted-foreground"> · {n.company_name}</span>
                        )}
                      </p>
                      {desc && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{desc}</p>
                      )}
                    </div>

                    {/* Timestamp + hover actions */}
                    <div className="flex flex-col items-end justify-between gap-2 shrink-0">
                      <span
                        className="text-[10px] text-muted-foreground whitespace-nowrap"
                        title={formatDate(n.created_at)}
                      >
                        {timeAgo(n.created_at)}
                      </span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <a
                          href={href}
                          className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Buka"
                        >
                          <Eye size={12} />
                        </a>
                        {isUnread && (
                          <button
                            onClick={() => markRead(n.id)}
                            className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-blue-500 transition-colors"
                            title="Tandai dibaca"
                          >
                            <CheckCheck size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteOne(n.id)}
                          className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                          title="Hapus"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} dari{" "}
              <span className="font-medium text-foreground">{total}</span> notifikasi
            </p>
            <div className="flex items-center gap-1">
              <Button
                size="icon" variant="outline" className="h-7 w-7"
                disabled={page === 0}
                onClick={() => setPage(0)}
                title="Halaman pertama"
              >
                <ChevronLeft size={10} className="-mr-1" />
                <ChevronLeft size={10} />
              </Button>
              <Button
                size="icon" variant="outline" className="h-7 w-7"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={13} />
              </Button>

              <div className="flex gap-1 mx-1">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 7) {
                    pageNum = i;
                  } else if (page < 4) {
                    pageNum = i < 5 ? i : i === 5 ? -1 : totalPages - 1;
                  } else if (page > totalPages - 5) {
                    pageNum = i === 0 ? 0 : i === 1 ? -1 : totalPages - 7 + i;
                  } else {
                    pageNum = i === 0 ? 0 : i === 1 ? -1 : i === 5 ? -2 : i === 6 ? totalPages - 1 : page + i - 3;
                  }
                  if (pageNum < 0) {
                    return (
                      <span key={i} className="flex h-7 w-7 items-center justify-center text-xs text-muted-foreground">…</span>
                    );
                  }
                  return (
                    <button
                      key={i}
                      onClick={() => setPage(pageNum)}
                      className={`flex h-7 w-7 items-center justify-center rounded text-xs font-medium border transition-colors ${
                        pageNum === page
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-indigo-300"
                      }`}
                    >
                      {pageNum + 1}
                    </button>
                  );
                })}
              </div>

              <Button
                size="icon" variant="outline" className="h-7 w-7"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={13} />
              </Button>
              <Button
                size="icon" variant="outline" className="h-7 w-7"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(totalPages - 1)}
                title="Halaman terakhir"
              >
                <ChevronRight size={10} className="-ml-1" />
                <ChevronRight size={10} />
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
