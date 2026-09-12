import { useState, useEffect, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  MessageCircle,
  Send,
  Save,
  Eye,
  RefreshCw,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Inbox,
  Reply,
  Phone, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ReplyLog {
  id: number;
  rfqId: string | null;
  orderId: number | null;
  customerName: string;
  customerPhone: string;
  vendorName: string | null;
  serviceType: string | null;
  route: string | null;
  vendorPrice: number | null;
  finalPrice: number | null;
  status: string;
  sentStatus: string;
  sentToAdmin: boolean;
  sentAt: string | null;
  createdAt: string;
}

interface IncomingMessage {
  id: number;
  sender: string;
  senderName: string | null;
  message: string;
  messageType: string | null;
  isRead: boolean;
  repliedAt: string | null;
  replyMessage: string | null;
  receivedAt: string;
}

const idr = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(n);

const STATUS_COLORS: Record<string, string> = {
  Ready: "bg-green-100 text-green-800 border-green-200",
  "Need Info": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "Not Available": "bg-red-100 text-red-800 border-red-200",
};

const SENT_STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  sent: "bg-green-100 text-green-800 border-green-200",
  failed: "bg-red-100 text-red-800 border-red-200",
};

function normalizePhoneDisplay(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("62")) return "0" + digits.slice(2);
  return raw;
}

export default function LogisticsQuotationReplyPage() {
  const { toast } = useToast();

  const [form, setForm] = useState({
    rfqId: "",
    orderId: "",
    customerName: "",
    customerPhone: "",
    vendorName: "",
    vendorPhone: "",
    serviceType: "",
    route: "",
    vendorPrice: "",
    finalPrice: "",
    pickupDate: "",
    deliveryDate: "",
    notes: "",
    status: "Ready",
  });

  const [preview, setPreview] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<ReplyLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Inbox state
  const [inbox, setInbox] = useState<IncomingMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);


  function buildPreview(): string {
    const fp = parseFloat(form.finalPrice) || 0;
    const fmt = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
    return (
      `Halo ${form.customerName || "{customerName}"},\n\n` +
      `Berikut quotation layanan B2B Marketplace and Logistic:\n\n` +
      `No. RFQ       : ${form.rfqId || "-"}\n` +
      `Layanan       : ${form.serviceType || "-"}\n` +
      `Rute          : ${form.route || "-"}\n` +
      (form.pickupDate ? `Estimasi Pickup   : ${form.pickupDate}\n` : "") +
      (form.deliveryDate ? `Estimasi Delivery : ${form.deliveryDate}\n` : "") +
      `Harga Final   : ${fmt(fp)}\n` +
      `Status        : ${form.status}\n` +
      (form.notes ? `\nCatatan:\n${form.notes}\n` : "") +
      `\nSilakan konfirmasi apabila quotation ini disetujui.\n\n` +
      `Terima kasih,\nB2B Marketplace and Logistic`
    );
  }

  function handlePreview() {
    setPreview(buildPreview());
    setShowPreview(true);
  }

  async function fetchLogs() {
    setLogsLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/whatsapp/quotation-logs`);
      if (res.ok) {
        const data = await res.json() as ReplyLog[];
        setLogs(data);
      }
    } catch {
      // silent
    } finally {
      setLogsLoading(false);
    }
  }

  async function fetchInbox() {
    setInboxLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/whatsapp/inbox`);
      if (res.ok) {
        const data = await res.json() as IncomingMessage[];
        setInbox(data);
      }
    } catch {
      // silent
    } finally {
      setInboxLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
    fetchInbox();
    // Auto-refresh inbox setiap 30 detik
    pollRef.current = setInterval(() => {
      fetchInbox();
    }, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function markRead(id: number) {
    try {
      await fetch(`${BASE_URL}/api/whatsapp/inbox/${id}/read`, { method: "PATCH" });
      setInbox((prev) => prev.map((m) => m.id === id ? { ...m, isRead: true } : m));
    } catch {
      // silent
    }
  }

  async function sendReply(id: number) {
    if (!replyText.trim()) return;
    setReplySending(true);
    try {
      const res = await fetch(`${BASE_URL}/api/whatsapp/inbox/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyText.trim() }),
      });
      const data = await res.json() as { ok: boolean; sentStatus: string };
      if (data.sentStatus === "sent") {
        toast({ title: "Balasan terkirim!", description: "Pesan berhasil dikirim via WhatsApp." });
      } else {
        toast({ title: "Gagal mengirim", description: "Cek koneksi Fonnte dan token.", variant: "destructive" });
      }
      setReplyingId(null);
      setReplyText("");
      await fetchInbox();
    } catch {
      toast({ title: "Error", description: "Terjadi kesalahan saat mengirim balasan.", variant: "destructive" });
    } finally {
      setReplySending(false);
    }
  }

  async function submit(isDraft: boolean, sendToAdminGroup = false) {
    if (!form.customerName.trim() || !form.customerPhone.trim()) {
      toast({ title: "Nama dan nomor WhatsApp customer wajib diisi", variant: "destructive" });
      return;
    }
    if (!form.finalPrice || parseFloat(form.finalPrice) <= 0) {
      toast({ title: "Harga final customer wajib diisi", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/whatsapp/send-quotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfqId: form.rfqId || null,
          orderId: form.orderId ? parseInt(form.orderId) : null,
          customerName: form.customerName,
          customerPhone: form.customerPhone,
          vendorName: form.vendorName || null,
          vendorPhone: form.vendorPhone || null,
          serviceType: form.serviceType || null,
          route: form.route || null,
          vendorPrice: form.vendorPrice ? parseFloat(form.vendorPrice) : null,
          finalPrice: parseFloat(form.finalPrice),
          pickupDate: form.pickupDate || null,
          deliveryDate: form.deliveryDate || null,
          notes: form.notes || null,
          status: form.status,
          sendToAdminGroup,
          isDraft,
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? "Gagal mengirim");
      }

      const data = await res.json() as { sentStatus: string; sentToAdmin: boolean };

      if (isDraft) {
        toast({ title: "Draft disimpan", description: "Log tersimpan tanpa pengiriman WA." });
      } else if (data.sentStatus === "sent") {
        toast({
          title: "Berhasil dikirim!",
          description: sendToAdminGroup && data.sentToAdmin
            ? "Quotation dikirim ke customer dan admin group."
            : "Quotation dikirim ke customer via WhatsApp.",
        });
      } else {
        toast({
          title: "Pengiriman gagal",
          description: "Pesan tersimpan sebagai log, tapi gagal terkirim via Fonnte.",
          variant: "destructive",
        });
      }

      await fetchLogs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({
      rfqId: "",
      orderId: "",
      customerName: "",
      customerPhone: "",
      vendorName: "",
      vendorPhone: "",
      serviceType: "",
      route: "",
      vendorPrice: "",
      finalPrice: "",
      pickupDate: "",
      deliveryDate: "",
      notes: "",
      status: "Ready",
    });
  }

  function field(label: string, key: keyof typeof form, opts?: { placeholder?: string; type?: string }) {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <Input
          type={opts?.type ?? "text"}
          placeholder={opts?.placeholder ?? ""}
          value={form[key]}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        />
      </div>
    );
  }

  const unreadCount = inbox.filter((m) => !m.isRead).length;

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-3">
          <MessageCircle className="h-6 w-6 text-green-600" />
          <div>
            <Link href="/logistics/rfq"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold tracking-tight">Balasan Quotation via WhatsApp</h1>
            <p className="text-sm text-muted-foreground">
              Kirim quotation ke customer & lihat pesan masuk dari vendor/customer
            </p>
          </div>
        </div>

        <Tabs defaultValue="form">
          <TabsList className="mb-4">
            <TabsTrigger value="form" className="gap-2">
              <Send className="h-4 w-4" />
              Kirim Quotation
            </TabsTrigger>
            <TabsTrigger value="inbox" className="gap-2" onClick={() => { fetchInbox(); }}>
              <Inbox className="h-4 w-4" />
              Inbox WA Masuk
              {unreadCount > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white leading-none">
                  {unreadCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-2">
              <Clock className="h-4 w-4" />
              Riwayat Kirim
            </TabsTrigger>
          </TabsList>

          {/* ====== TAB: FORM KIRIM ====== */}
          <TabsContent value="form">
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Identitas Order / RFQ</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    {field("No. RFQ / Order ID", "rfqId", { placeholder: "RFQ-250511-12345" })}
                    {field("Order ID (angka)", "orderId", { placeholder: "123", type: "number" })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Data Customer</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    {field("Nama Customer *", "customerName", { placeholder: "PT. Maju Bersama" })}
                    {field("No. WhatsApp Customer *", "customerPhone", { placeholder: "08123456789" })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Data Vendor</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    {field("Nama Vendor", "vendorName", { placeholder: "CV. Ekspres Jaya" })}
                    {field("No. WhatsApp Vendor", "vendorPhone", { placeholder: "08119876543" })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Detail Layanan</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    {field("Jenis Layanan", "serviceType", { placeholder: "Trucking Lokal / Sea Freight / dll." })}
                    {field("Rute / Tujuan", "route", { placeholder: "Jakarta → Surabaya" })}
                    {field("Estimasi Pickup", "pickupDate", { placeholder: "Besok / 13 Mei 2025" })}
                    {field("Estimasi Delivery", "deliveryDate", { placeholder: "3-5 hari / 16 Mei 2025" })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Harga</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    {field("Harga Vendor / Harga Dasar (Rp)", "vendorPrice", { placeholder: "5000000", type: "number" })}

                    <div className="space-y-1.5">
                      <Label className="font-semibold text-green-700">Harga Jual ke Customer (Rp) *</Label>
                      <Input
                        type="number"
                        placeholder="Masukkan harga jual..."
                        value={form.finalPrice}
                        onChange={(e) => setForm((p) => ({ ...p, finalPrice: e.target.value }))}
                        className="border-green-300 focus:border-green-500 font-semibold"
                      />
                      {form.vendorPrice && form.finalPrice && (
                        <p className="text-xs text-muted-foreground">
                          Profit: <span className="text-green-700 font-semibold">{idr(parseFloat(form.finalPrice) - parseFloat(form.vendorPrice))}</span>
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select
                        value={form.status}
                        onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Ready">Ready</SelectItem>
                          <SelectItem value="Need Info">Need Info</SelectItem>
                          <SelectItem value="Not Available">Not Available</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Catatan Vendor/Admin</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      rows={3}
                      placeholder="Catatan tambahan untuk customer..."
                      value={form.notes}
                      onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    />
                  </CardContent>
                </Card>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => submit(true)} disabled={loading}>
                    <Save className="mr-2 h-4 w-4" />
                    Save Draft
                  </Button>
                  <Button variant="secondary" onClick={handlePreview} disabled={loading}>
                    <Eye className="mr-2 h-4 w-4" />
                    Preview WA
                  </Button>
                  <Button
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => submit(false, false)}
                    disabled={loading}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Kirim ke Customer
                  </Button>
                  <Button
                    variant="outline"
                    className="border-green-600 text-green-700 hover:bg-green-50"
                    onClick={() => submit(false, true)}
                    disabled={loading}
                  >
                    <Users className="mr-2 h-4 w-4" />
                    Kirim ke Customer + Admin Group
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={resetForm}
                    disabled={loading}
                    className="ml-auto text-slate-500"
                  >
                    Reset Form
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <Card className="sticky top-4">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-green-600" />
                      Preview Pesan WA
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="bg-white rounded p-3 text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed min-h-[200px] border border-slate-100 shadow-sm">
                        {buildPreview()}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      Harga vendor tidak ditampilkan ke customer.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ====== TAB: INBOX ====== */}
          <TabsContent value="inbox">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Inbox className="h-4 w-4" />
                  Pesan Masuk dari Vendor / Customer
                  {unreadCount > 0 && (
                    <Badge className="bg-red-500 text-white ml-1">{unreadCount} belum dibaca</Badge>
                  )}
                </CardTitle>
                <Button size="sm" variant="outline" onClick={fetchInbox} disabled={inboxLoading}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${inboxLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {inbox.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground space-y-2">
                    <Inbox className="h-10 w-10 mx-auto opacity-30" />
                    <p className="text-sm">Belum ada pesan masuk.</p>
                    <p className="text-xs">
                      Pesan akan muncul di sini setelah webhook Fonnte dikonfigurasi.<br />
                      URL Webhook:{" "}
                      <code className="bg-slate-100 rounded px-1 text-slate-700 break-all">
                        https://[domain-api-server]/api/whatsapp/webhook
                      </code>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {inbox.map((msg) => (
                      <div
                        key={msg.id}
                        className={`rounded-lg border p-4 transition-colors ${
                          msg.isRead ? "bg-white border-slate-200" : "bg-blue-50 border-blue-200"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-semibold text-sm text-slate-800">
                                {msg.senderName || "Pengirim tidak dikenal"}
                              </span>
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <Phone className="h-3 w-3" />
                                {normalizePhoneDisplay(msg.sender)}
                              </span>
                              {!msg.isRead && (
                                <Badge className="bg-blue-500 text-white text-[10px] px-1.5 py-0">Baru</Badge>
                              )}
                              {msg.repliedAt && (
                                <Badge variant="outline" className="text-green-700 border-green-300 text-[10px] px-1.5 py-0">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Sudah dibalas
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-white border border-slate-100 rounded p-2.5 mt-1">
                              {msg.message}
                            </p>
                            {msg.replyMessage && (
                              <div className="mt-2 ml-4 pl-3 border-l-2 border-green-400">
                                <p className="text-xs text-muted-foreground mb-0.5">Balasan Anda:</p>
                                <p className="text-xs text-slate-600 whitespace-pre-wrap">{msg.replyMessage}</p>
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground mt-2">
                              {new Date(msg.receivedAt).toLocaleString("id-ID", {
                                day: "2-digit", month: "short", year: "numeric",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </p>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            {!msg.isRead && (
                              <Button size="sm" variant="outline" onClick={() => markRead(msg.id)} className="text-xs h-7">
                                Tandai Dibaca
                              </Button>
                            )}
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
                              onClick={() => {
                                setReplyingId(msg.id);
                                setReplyText("");
                                markRead(msg.id);
                              }}
                            >
                              <Reply className="h-3 w-3 mr-1" />
                              Balas
                            </Button>
                          </div>
                        </div>

                        {replyingId === msg.id && (
                          <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                            <Label className="text-xs font-medium text-slate-600">
                              Balas ke {msg.senderName || normalizePhoneDisplay(msg.sender)}:
                            </Label>
                            <Textarea
                              rows={3}
                              placeholder="Tulis balasan WA..."
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              className="text-sm"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => sendReply(msg.id)}
                                disabled={replySending || !replyText.trim()}
                              >
                                <Send className="h-3 w-3 mr-1" />
                                {replySending ? "Mengirim..." : "Kirim Balasan"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => { setReplyingId(null); setReplyText(""); }}
                                disabled={replySending}
                              >
                                Batal
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ====== TAB: RIWAYAT ====== */}
          <TabsContent value="logs">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Riwayat Pengiriman Quotation</CardTitle>
                <Button size="sm" variant="outline" onClick={fetchLogs} disabled={logsLoading}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${logsLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Belum ada riwayat pengiriman quotation.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Waktu</TableHead>
                          <TableHead>RFQ / Order</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>No. HP</TableHead>
                          <TableHead>Layanan</TableHead>
                          <TableHead>Rute</TableHead>
                          <TableHead className="text-right">Harga Final</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Kirim</TableHead>
                          <TableHead>Admin</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(log.createdAt).toLocaleString("id-ID", {
                                day: "2-digit", month: "short",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {log.rfqId ?? log.orderId ?? "—"}
                            </TableCell>
                            <TableCell className="font-medium text-sm">{log.customerName}</TableCell>
                            <TableCell className="text-xs text-slate-600">{log.customerPhone}</TableCell>
                            <TableCell className="text-xs">{log.serviceType ?? "—"}</TableCell>
                            <TableCell className="text-xs">{log.route ?? "—"}</TableCell>
                            <TableCell className="text-right font-semibold text-sm">
                              {idr(log.finalPrice)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={STATUS_COLORS[log.status] ?? "bg-slate-100 text-slate-600"}
                              >
                                {log.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={SENT_STATUS_COLORS[log.sentStatus] ?? "bg-slate-100"}
                              >
                                {log.sentStatus === "sent" ? (
                                  <><CheckCircle className="mr-1 h-3 w-3" />Terkirim</>
                                ) : log.sentStatus === "failed" ? (
                                  <><XCircle className="mr-1 h-3 w-3" />Gagal</>
                                ) : (
                                  <><Clock className="mr-1 h-3 w-3" />Draft</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {log.sentToAdmin ? (
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Dialog preview */}
        <Dialog open={showPreview} onOpenChange={setShowPreview}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-green-600" />
                Preview Pesan WhatsApp
              </DialogTitle>
            </DialogHeader>
            <div className="bg-green-50 rounded-lg p-4">
              <div className="bg-white rounded p-3 text-sm text-slate-700 whitespace-pre-wrap font-mono leading-relaxed border border-slate-100 shadow-sm">
                {preview}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Pesan ini akan dikirim ke {form.customerPhone ? normalizePhoneDisplay(form.customerPhone) : "customer"} via Fonnte WhatsApp.
            </p>
            <DialogFooter className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setShowPreview(false)}>
                Tutup
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => { setShowPreview(false); submit(false, false); }}
                disabled={loading}
              >
                <Send className="mr-2 h-4 w-4" />
                Kirim Sekarang
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
