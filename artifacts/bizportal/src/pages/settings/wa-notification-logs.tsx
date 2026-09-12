import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  MessageCircle, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle,
  Send, ChevronLeft, ChevronRight, Search, Loader2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { id as localeID } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const DRIVER_CONTEXTS = [
  "fulfillment-driver-assigned",
  "op-confirm-driver",
  "driver-job-assigned-internal",
  "driver-job-assigned-external",
];

const CONTEXT_LABEL: Record<string, string> = {
  "fulfillment-driver-assigned":    "Fulfillment → Driver",
  "op-confirm-driver":              "Op-Confirm → Driver",
  "driver-job-assigned-internal":   "Job Internal (WA Form)",
  "driver-job-assigned-external":   "Job Eksternal (App)",
};

interface NotifLog {
  id: number;
  channel: string;
  recipient: string;
  message: string;
  status: string;
  errorMsg: string | null;
  context: string;
  refType: string | null;
  refId: string | null;
  createdAt: string;
  retryCount: number;
  nextRetryAt: string | null;
  waMessageId: string | null;
  waDeliveryStatus: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  mediaUrl: string | null;
}

interface ListResponse {
  data: NotifLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Stats {
  total: number;
  sent: number;
  failed: number;
  deduped: number;
  retrying: number;
  exhausted: number;
  delivered: number;
}

function statusBadge(row: NotifLog) {
  if (row.status === "sent") {
    if (row.waDeliveryStatus === "read") return <Badge className="bg-blue-100 text-blue-800 gap-1"><CheckCircle2 className="w-3 h-3" />Dibaca</Badge>;
    if (row.waDeliveryStatus === "delivered") return <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="w-3 h-3" />Terkirim</Badge>;
    return <Badge className="bg-emerald-100 text-emerald-800 gap-1"><Send className="w-3 h-3" />Sent</Badge>;
  }
  if (row.status === "deduped") return <Badge className="bg-gray-100 text-gray-600 gap-1"><Clock className="w-3 h-3" />Dedup</Badge>;
  if (row.status === "failed") {
    if (row.retryCount >= 3) return <Badge className="bg-red-100 text-red-700 gap-1"><XCircle className="w-3 h-3" />Gagal (habis)</Badge>;
    return <Badge className="bg-orange-100 text-orange-700 gap-1"><AlertTriangle className="w-3 h-3" />Gagal (retry {row.retryCount}/3)</Badge>;
  }
  return <Badge variant="outline">{row.status}</Badge>;
}

export default function WaNotificationLogsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [driverOnly, setDriverOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const statsKey = ["wa-notif-stats", driverOnly];
  const listKey  = ["wa-notif-logs", page, status, driverOnly, search];

  const buildParams = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(extra);
    if (driverOnly) p.set("driverOnly", "true");
    return p.toString();
  }, [driverOnly]);

  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: statsKey,
    queryFn: async () => {
      const res = await fetch(`/api/wa-notification-logs/stats?${buildParams()}`);
      if (!res.ok) throw new Error("Gagal ambil stats");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: listData, isLoading: listLoading, isFetching } = useQuery<ListResponse>({
    queryKey: listKey,
    queryFn: async () => {
      const p = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (driverOnly) p.set("driverOnly", "true");
      if (status !== "all") p.set("status", status);
      if (search) p.set("search", search);
      const res = await fetch(`/api/wa-notification-logs?${p.toString()}`);
      if (!res.ok) throw new Error("Gagal ambil data");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const retryMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/wa-notification-logs/${id}/retry`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Gagal retry");
      return body;
    },
    onSuccess: (_, id) => {
      toast({ title: "Retry berhasil", description: `WA ID #${id} berhasil dikirim ulang.` });
      queryClient.invalidateQueries({ queryKey: ["wa-notif-logs"] });
      queryClient.invalidateQueries({ queryKey: ["wa-notif-stats"] });
    },
    onError: (err: Error, id) => {
      toast({ title: "Retry gagal", description: err.message, variant: "destructive" });
    },
  });

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const rows = listData?.data ?? [];
  const total = listData?.total ?? 0;
  const totalPages = listData?.totalPages ?? 1;

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MessageCircle className="w-6 h-6 text-green-600" />
              Monitor WA Driver
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Riwayat pengiriman WhatsApp ke driver — status, retry otomatis, dan delivery tracking.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["wa-notif-logs"] });
              queryClient.invalidateQueries({ queryKey: ["wa-notif-stats"] });
            }}
            className="gap-2"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: "Total",     value: stats?.total,     color: "text-gray-700",   bg: "bg-gray-50" },
            { label: "Sent",      value: stats?.sent,      color: "text-emerald-700",bg: "bg-emerald-50" },
            { label: "Terkirim",  value: stats?.delivered, color: "text-blue-700",   bg: "bg-blue-50" },
            { label: "Gagal",     value: stats?.failed,    color: "text-red-700",    bg: "bg-red-50" },
            { label: "Retrying",  value: stats?.retrying,  color: "text-orange-700", bg: "bg-orange-50" },
            { label: "Habis 3x",  value: stats?.exhausted, color: "text-rose-700",   bg: "bg-rose-50" },
            { label: "Dedup",     value: stats?.deduped,   color: "text-gray-500",   bg: "bg-gray-50" },
          ].map((s) => (
            <Card key={s.label} className={`${s.bg} border-0`}>
              <CardContent className="p-3 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>
                  {statsLoading ? "—" : (s.value ?? 0)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2">
                <Switch
                  id="driverOnly"
                  checked={driverOnly}
                  onCheckedChange={(v) => { setDriverOnly(v); setPage(1); }}
                />
                <Label htmlFor="driverOnly" className="text-sm cursor-pointer">Driver only</Label>
              </div>

              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="deduped">Deduped</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex gap-2 flex-1 min-w-[200px] max-w-sm">
                <Input
                  placeholder="Cari nomor / context / refId..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <Button variant="outline" size="icon" onClick={handleSearch}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>

              <span className="text-sm text-muted-foreground ml-auto">
                {total} hasil · auto-refresh 30s
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Waktu</TableHead>
                  <TableHead className="w-36">Nomor</TableHead>
                  <TableHead className="w-44">Context</TableHead>
                  <TableHead className="w-28">Ref</TableHead>
                  <TableHead className="w-40">Status</TableHead>
                  <TableHead className="w-32">Next Retry</TableHead>
                  <TableHead>Error / Delivery</TableHead>
                  <TableHead className="w-20 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin inline mr-2" />Memuat...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      Tidak ada data
                    </TableCell>
                  </TableRow>
                ) : rows.map((row) => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                    >
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>{formatDistanceToNow(new Date(row.createdAt), { addSuffix: true, locale: localeID })}</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {format(new Date(row.createdAt), "dd MMM yyyy HH:mm:ss")}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.recipient}</TableCell>
                      <TableCell className="text-xs">
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {CONTEXT_LABEL[row.context] ?? row.context}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.refType && <span className="opacity-60">{row.refType}/</span>}
                        {row.refId ?? "—"}
                      </TableCell>
                      <TableCell>{statusBadge(row)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.status === "failed" && row.retryCount < 3 && row.nextRetryAt
                          ? formatDistanceToNow(new Date(row.nextRetryAt), { addSuffix: true, locale: localeID })
                          : row.status === "failed" && row.retryCount < 3
                            ? <span className="text-orange-600">Segera</span>
                            : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[280px] truncate text-muted-foreground">
                        {row.status === "failed"
                          ? <span className="text-red-600">{row.errorMsg ?? "Unknown error"}</span>
                          : row.waDeliveryStatus
                            ? <span className="text-blue-600">Delivery: {row.waDeliveryStatus}</span>
                            : row.waMessageId
                              ? <span className="text-emerald-600">ID: {row.waMessageId}</span>
                              : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs gap-1"
                            disabled={retryMutation.isPending}
                            onClick={(e) => { e.stopPropagation(); retryMutation.mutate(row.id); }}
                          >
                            {retryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Expanded row — pesan WA */}
                    {expandedId === row.id && (
                      <TableRow key={`${row.id}-expanded`} className="bg-muted/20">
                        <TableCell colSpan={8} className="px-4 py-3">
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Isi Pesan WA</div>
                            <pre className="text-xs bg-white border rounded p-3 whitespace-pre-wrap font-sans text-gray-700 max-h-48 overflow-auto">
                              {row.message}
                            </pre>
                            {row.errorMsg && (
                              <div className="text-xs text-red-600 bg-red-50 rounded p-2">
                                <span className="font-medium">Error:</span> {row.errorMsg}
                              </div>
                            )}
                            <div className="flex gap-4 text-xs text-muted-foreground">
                              <span>ID Log: #{row.id}</span>
                              {row.waMessageId && <span>WA Msg ID: {row.waMessageId}</span>}
                              <span>Retry: {row.retryCount}/3</span>
                              {row.deliveredAt && <span>Delivered: {format(new Date(row.deliveredAt), "HH:mm dd/MM")}</span>}
                              {row.readAt && <span>Read: {format(new Date(row.readAt), "HH:mm dd/MM")}</span>}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Halaman {page} dari {totalPages} ({total} total)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
