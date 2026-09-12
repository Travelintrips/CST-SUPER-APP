import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { Eye, FileText, ShoppingCart, Star, TrendingUp, Search, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";

interface CatalogRow {
  id: number;
  vendorId: number;
  vendorName: string | null;
  name: string;
  templateKind: string | null;
  kategori: string | null;
  status: string | null;
  isPublished: boolean;
  isFeatured: boolean;
  viewCount: number;
  quoteCount: number;
  orderCount: number;
  priceSell: number | null;
  validityDate: string | null;
  publishedAt: string | null;
}

function fmt(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-600" },
  pending_review: { label: "⏳ Review", cls: "bg-yellow-100 text-yellow-800" },
  approved: { label: "✅ Approved", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "❌ Rejected", cls: "bg-red-100 text-red-800" },
  published: { label: "Published", cls: "bg-blue-100 text-blue-800" },
  archived: { label: "Archived", cls: "bg-slate-100 text-red-600" },
};

export default function MarketplaceAnalyticsPage() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterKind, setFilterKind] = useState("all");
  const [sortKey, setSortKey] = useState<"viewCount" | "quoteCount" | "orderCount" | "engagement">("engagement");

  const { data: rows = [], isLoading } = useQuery<CatalogRow[]>({
    queryKey: ["marketplace-analytics-all"],
    queryFn: async () => {
      const r = await fetch("/api/trading/suppliers/catalog/all", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data");
      return r.json();
    },
    staleTime: 30_000,
  });

  const totalViews = rows.reduce((s, r) => s + (r.viewCount ?? 0), 0);
  const totalQuotes = rows.reduce((s, r) => s + (r.quoteCount ?? 0), 0);
  const totalOrders = rows.reduce((s, r) => s + (r.orderCount ?? 0), 0);
  const publishedCount = rows.filter((r) => r.isPublished).length;
  const featuredCount = rows.filter((r) => r.isFeatured).length;

  const filtered = useMemo(() => {
    let list = [...rows];
    if (filterStatus !== "all") list = list.filter((r) => r.status === filterStatus);
    if (filterKind !== "all") list = list.filter((r) => r.templateKind === filterKind);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.vendorName ?? "").toLowerCase().includes(q) ||
        (r.kategori ?? "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sortKey === "viewCount") return (b.viewCount ?? 0) - (a.viewCount ?? 0);
      if (sortKey === "quoteCount") return (b.quoteCount ?? 0) - (a.quoteCount ?? 0);
      if (sortKey === "orderCount") return (b.orderCount ?? 0) - (a.orderCount ?? 0);
      const engA = (a.viewCount ?? 0) + (a.quoteCount ?? 0) * 5 + (a.orderCount ?? 0) * 10;
      const engB = (b.viewCount ?? 0) + (b.quoteCount ?? 0) * 5 + (b.orderCount ?? 0) * 10;
      return engB - engA;
    });
    return list;
  }, [rows, filterStatus, filterKind, search, sortKey]);

  return (
    <AppShell>
      <BackButton href="/purchase" />
      <div className="space-y-6 p-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-sky-600" />
            Analytics Marketplace
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Statistik view, quote, dan order untuk semua item katalog vendor
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Views</p>
              <p className="text-2xl font-bold mt-0.5 flex items-center gap-1.5">
                <Eye className="h-4 w-4 text-sky-500" />{totalViews.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Quotes</p>
              <p className="text-2xl font-bold mt-0.5 flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-amber-500" />{totalQuotes.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Orders</p>
              <p className="text-2xl font-bold mt-0.5 flex items-center gap-1.5">
                <ShoppingCart className="h-4 w-4 text-green-500" />{totalOrders.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Item Published</p>
              <p className="text-2xl font-bold mt-0.5">{publishedCount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">dari {rows.length} total</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Item Unggulan</p>
              <p className="text-2xl font-bold mt-0.5 flex items-center gap-1.5">
                <Star className="h-4 w-4 text-amber-500 fill-amber-500" />{featuredCount}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Detail Per Item</CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama, vendor, kategori..."
                  className="pl-8 h-8 text-sm"
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-sm w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending_review">Pending Review</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterKind} onValueChange={setFilterKind}>
                <SelectTrigger className="h-8 text-sm w-[130px]">
                  <SelectValue placeholder="Tipe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Tipe</SelectItem>
                  <SelectItem value="product">Produk</SelectItem>
                  <SelectItem value="service">Layanan</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
                <SelectTrigger className="h-8 text-sm w-[150px]">
                  <SelectValue placeholder="Urut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="engagement">Engagement Score</SelectItem>
                  <SelectItem value="viewCount">Views Terbanyak</SelectItem>
                  <SelectItem value="quoteCount">Quotes Terbanyak</SelectItem>
                  <SelectItem value="orderCount">Orders Terbanyak</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">
                      <span className="flex items-center justify-center gap-1"><Eye className="h-3.5 w-3.5" />Views</span>
                    </TableHead>
                    <TableHead className="text-center">
                      <span className="flex items-center justify-center gap-1"><FileText className="h-3.5 w-3.5" />Quotes</span>
                    </TableHead>
                    <TableHead className="text-center">
                      <span className="flex items-center justify-center gap-1"><ShoppingCart className="h-3.5 w-3.5" />Orders</span>
                    </TableHead>
                    <TableHead className="text-right">Harga Jual</TableHead>
                    <TableHead className="text-center">Konversi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const engagement = (row.viewCount ?? 0) + (row.quoteCount ?? 0) * 5 + (row.orderCount ?? 0) * 10;
                    const convRate = row.viewCount > 0
                      ? (((row.quoteCount ?? 0) + (row.orderCount ?? 0)) / row.viewCount * 100).toFixed(1)
                      : null;
                    const st = STATUS_LABELS[row.status ?? "draft"] ?? STATUS_LABELS["draft"];
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="flex items-start gap-1.5">
                            {row.isFeatured && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 mt-0.5 shrink-0" />}
                            <div>
                              <p className="font-medium text-sm leading-tight">{row.name}</p>
                              {row.kategori && <p className="text-xs text-muted-foreground">{row.kategori}</p>}
                              <p className="text-[10px] text-muted-foreground/60">Score: {engagement}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <Link href={`/purchase/vendors/${row.vendorId}`} className="text-sky-600 hover:underline text-sm">
                            {row.vendorName ?? `#${row.vendorId}`}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${st.cls}`}>{st.label}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`font-mono text-sm font-semibold ${row.viewCount > 0 ? "text-sky-700" : "text-muted-foreground/40"}`}>
                            {row.viewCount ?? 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`font-mono text-sm font-semibold ${(row.quoteCount ?? 0) > 0 ? "text-amber-700" : "text-muted-foreground/40"}`}>
                            {row.quoteCount ?? 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`font-mono text-sm font-semibold ${(row.orderCount ?? 0) > 0 ? "text-green-700" : "text-muted-foreground/40"}`}>
                            {row.orderCount ?? 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {row.priceSell != null ? fmt(row.priceSell) : <span className="text-muted-foreground/40">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {convRate != null ? (
                            <span className={`text-sm font-semibold ${parseFloat(convRate) >= 10 ? "text-green-600" : parseFloat(convRate) >= 3 ? "text-amber-600" : "text-slate-500"}`}>
                              {convRate}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40 text-sm">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                        Tidak ada item yang cocok.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
