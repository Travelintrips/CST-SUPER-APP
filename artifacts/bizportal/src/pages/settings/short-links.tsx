import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, ExternalLink, Search, BanIcon, RefreshCcw, Copy } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Link } from "wouter";
import { BackButton } from "@/components/ui/back-button";

interface ShortLink {
  id: number;
  code: string;
  targetUrl: string;
  context: string;
  refType: string | null;
  refId: string | null;
  hitCount: number;
  expiresAt: string | null;
  createdAt: string;
}

interface ShortLinksResponse {
  data: ShortLink[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 20;

const CONTEXT_LABELS: Record<string, string> = {
  general: "Umum",
  admin_action: "Admin Action",
  admin_review: "Admin Review",
  vendor_quote: "Vendor Quote",
  customer_quote: "Customer Quote",
  vendor_form: "Vendor Form",
};

function contextBadgeVariant(ctx: string): "default" | "secondary" | "destructive" | "outline" {
  if (ctx === "admin_action" || ctx === "admin_review") return "default";
  if (ctx === "vendor_quote" || ctx === "vendor_form") return "secondary";
  if (ctx === "customer_quote") return "outline";
  return "outline";
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function ShortLinksPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<ShortLink | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ShortLink | null>(null);

  const { data, isLoading } = useQuery<ShortLinksResponse>({
    queryKey: ["settings", "short-links", page, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/api/settings/short-links?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat data");
      return res.json();
    },
    placeholderData: (prev) => prev,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/settings/short-links/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Gagal menghapus");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "short-links"] });
      toast({ title: "Short link dihapus" });
      setDeleteTarget(null);
    },
    onError: () => toast({ title: "Gagal menghapus", variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/settings/short-links/${id}/deactivate`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Gagal menonaktifkan");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "short-links"] });
      toast({ title: "Short link dinonaktifkan" });
      setDeactivateTarget(null);
    },
    onError: () => toast({ title: "Gagal menonaktifkan", variant: "destructive" }),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/settings/short-links/${id}/reactivate`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Gagal mengaktifkan kembali");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "short-links"] });
      toast({ title: "Short link diaktifkan kembali" });
    },
    onError: () => toast({ title: "Gagal mengaktifkan", variant: "destructive" }),
  });

  const links = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const copyToClipboard = (code: string) => {
    const domain = window.location.hostname;
    const url = `${window.location.protocol}//${window.location.host}/q/${code}`;
    navigator.clipboard.writeText(url).then(() =>
      toast({ title: "URL disalin ke clipboard" })
    );
  };

  return (
    <AppShell>
      <BackButton href="/settings" />
      <div className="p-6 space-y-6">
        <PageHeader
          onBack={() => window.history.back()}
          title="Manajemen Short Link"
          description="Kelola semua short link yang dihasilkan sistem"
          breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Short Links" }]}
          favoriteEnabled
        />

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Link</p>
              <p className="text-2xl font-bold">{total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Aktif</p>
              <p className="text-2xl font-bold text-green-600">
                {links.filter(l => !isExpired(l.expiresAt)).length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Kadaluarsa</p>
              <p className="text-2xl font-bold text-yellow-600">
                {links.filter(l => isExpired(l.expiresAt)).length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Klik (halaman ini)</p>
              <p className="text-2xl font-bold text-blue-600">
                {links.reduce((s, l) => s + l.hitCount, 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <CardTitle className="text-base">Daftar Short Link</CardTitle>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari kode, URL, konteks..."
                  className="pl-8 h-8 text-sm"
                  value={search}
                  onChange={e => handleSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Kode</TableHead>
                  <TableHead>Target URL</TableHead>
                  <TableHead className="w-28">Konteks</TableHead>
                  <TableHead className="w-16 text-center">Klik</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-32">Dibuat</TableHead>
                  <TableHead className="w-28 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-muted rounded animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : links.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      {search ? "Tidak ditemukan hasil pencarian" : "Belum ada short link"}
                    </TableCell>
                  </TableRow>
                ) : (
                  links.map((link) => {
                    const expired = isExpired(link.expiresAt);
                    return (
                      <TableRow key={link.id} className={expired ? "opacity-50" : ""}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                              {link.code}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={() => copyToClipboard(link.code)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 max-w-xs">
                            <span className="text-xs text-muted-foreground truncate" title={link.targetUrl}>
                              {link.targetUrl}
                            </span>
                            <a
                              href={link.targetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0"
                            >
                              <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-primary" />
                            </a>
                          </div>
                          {link.refId && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              ref: {link.refType}/{link.refId}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={contextBadgeVariant(link.context)} className="text-xs">
                            {CONTEXT_LABELS[link.context] ?? link.context}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="font-medium text-sm">{link.hitCount}</span>
                        </TableCell>
                        <TableCell>
                          {expired ? (
                            <Badge variant="destructive" className="text-xs">Kadaluarsa</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-green-600 border-green-300">Aktif</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(link.createdAt), "d MMM yy HH:mm", { locale: idLocale })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {expired ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-green-600 hover:text-green-700"
                                title="Aktifkan kembali"
                                onClick={() => reactivateMutation.mutate(link.id)}
                                disabled={reactivateMutation.isPending}
                              >
                                <RefreshCcw className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-yellow-600 hover:text-yellow-700"
                                title="Nonaktifkan"
                                onClick={() => setDeactivateTarget(link)}
                              >
                                <BanIcon className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Hapus permanen"
                              onClick={() => setDeleteTarget(link)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
                <span>{total} link total</span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}
                  >
                    Sebelumnya
                  </Button>
                  <span className="px-2 py-1">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Short Link?</AlertDialogTitle>
            <AlertDialogDescription>
              Link <code className="font-mono bg-muted px-1 rounded">/q/{deleteTarget?.code}</code> akan dihapus permanen.
              Siapapun yang mengklik link ini tidak akan bisa diarahkan lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deactivate confirmation */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={() => setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nonaktifkan Short Link?</AlertDialogTitle>
            <AlertDialogDescription>
              Link <code className="font-mono bg-muted px-1 rounded">/q/{deactivateTarget?.code}</code> akan dinonaktifkan.
              Link ini masih tersimpan dan bisa diaktifkan kembali kapan saja.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
            >
              Nonaktifkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
