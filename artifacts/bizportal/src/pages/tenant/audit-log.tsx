import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { Shield, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "wouter";

interface AuditRow {
  id: number;
  action: string;
  module: string;
  reference_id: string | null;
  new_data: any;
  user_name: string | null;
  company_id: number | null;
  created_at: string;
}

const ACTION_COLOR: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
  CANCEL: "bg-orange-100 text-orange-800",
  PAID: "bg-emerald-100 text-emerald-800",
  SENT: "bg-sky-100 text-sky-800",
  DEACTIVATE: "bg-slate-100 text-slate-700",
  KIRIM_WA: "bg-violet-100 text-violet-800",
};

export default function TenantAuditLogPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const LIMIT = 50;

  const { data, isLoading } = useQuery<{ data: AuditRow[]; total: number; page: number; limit: number }>({
    queryKey: ["tenant-audit-log", page, search, action],
    queryFn: async () => {
      const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (search.trim()) p.set("search", search.trim());
      if (action !== "all") p.set("action", action);
      const r = await fetch(`/api/tenant/audit-log?${p}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    staleTime: 15_000,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6 text-slate-600" />Audit Log Tenant</h1>
          <p className="text-sm text-muted-foreground mt-1">Riwayat semua aktivitas operasional modul tenant</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Log Aktivitas</CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Cari modul, aksi..." className="pl-8 h-8 text-sm" />
              </div>
              <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
                <SelectTrigger className="h-8 text-sm w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Aksi</SelectItem>
                  <SelectItem value="CREATE">Create</SelectItem>
                  <SelectItem value="UPDATE">Update</SelectItem>
                  <SelectItem value="DELETE">Delete</SelectItem>
                  <SelectItem value="CANCEL">Cancel</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="SENT">Sent</SelectItem>
                  <SelectItem value="KIRIM_WA">Kirim WA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p> : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Waktu</TableHead>
                      <TableHead>Aksi</TableHead>
                      <TableHead>Modul</TableHead>
                      <TableHead>Ref ID</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${ACTION_COLOR[r.action] ?? "bg-slate-100 text-slate-700"}`}>{r.action}</Badge>
                        </TableCell>
                        <TableCell className="text-sm font-mono text-muted-foreground">{r.module}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.reference_id ?? "—"}</TableCell>
                        <TableCell className="text-sm">{r.user_name ?? <span className="text-muted-foreground/40">—</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {r.new_data ? JSON.stringify(r.new_data).slice(0, 60) + (JSON.stringify(r.new_data).length > 60 ? "…" : "") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">Tidak ada log.</TableCell></TableRow>}
                  </TableBody>
                </Table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-xs text-muted-foreground">Halaman {page} dari {totalPages} ({total} total)</p>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
