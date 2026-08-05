import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageCircle, Send, Users, CheckCircle, AlertCircle, ChevronLeft } from "lucide-react";
import { Link } from "wouter";

interface Tenant { id: number; business_name: string; owner_name: string; phone: string | null; status: string; company_id: number; }

const TEMPLATES = [
  { label: "Pengingat Pembayaran", text: "Yth. {nama},\n\nKami mengingatkan bahwa tagihan sewa Anda sudah jatuh tempo. Mohon segera melakukan pembayaran.\n\nTerima kasih." },
  { label: "Konfirmasi Pembayaran", text: "Yth. {nama},\n\nPembayaran sewa Anda telah kami terima dan dikonfirmasi. Terima kasih atas kepercayaan Anda.\n\nSalam," },
  { label: "Informasi Umum", text: "Yth. {nama},\n\nKami ingin menyampaikan informasi penting terkait operasional. Mohon diperhatikan.\n\nTerima kasih." },
];

export default function TenantKirimWaPage() {
  const [companyId, setCompanyId] = useState("all");
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sendToAll, setSendToAll] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; total: number } | null>(null);

  const { data } = useQuery<{ data: Tenant[] }>({
    queryKey: ["tenant-list-wa", companyId],
    queryFn: async () => {
      const p = companyId !== "all" ? `?companyId=${companyId}` : "";
      const r = await fetch(`/api/tenant/tenants${p}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
  });

  const tenants = (data?.data ?? []).filter((t) => t.status === "active");
  const withPhone = tenants.filter((t) => t.phone);
  const targetCount = sendToAll ? withPhone.length : [...selectedIds].filter((id) => tenants.find((t) => t.id === id && t.phone)).length;

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/tenant/kirim-wa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message,
          tenantIds: sendToAll ? [] : [...selectedIds],
          companyId: companyId !== "all" ? Number(companyId) : null,
          sendToAll,
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Gagal"); }
      return r.json();
    },
    onSuccess: (data) => { setResult(data); },
  });

  const toggleTenant = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <AppShell>
      <div className="space-y-5 p-6 max-w-4xl">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MessageCircle className="h-6 w-6 text-green-600" />Kirim WhatsApp</h1>
          <p className="text-sm text-muted-foreground mt-1">Kirim pesan WhatsApp ke penyewa aktif</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />Pilih Penerima</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Lokasi</SelectItem>
                    <SelectItem value="1">PT Cahaya Sejati Teknologi</SelectItem>
                    <SelectItem value="4">PT Elmira Ratu Abadi</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox id="sendAll" checked={sendToAll} onCheckedChange={(v) => setSendToAll(!!v)} />
                <label htmlFor="sendAll" className="text-sm cursor-pointer">
                  Kirim ke semua penyewa aktif ({withPhone.length} dengan nomor WA)
                </label>
              </div>

              {!sendToAll && (
                <div className="max-h-64 overflow-y-auto space-y-1 border rounded-md p-2">
                  {tenants.length === 0 && <p className="text-center text-muted-foreground py-4 text-sm">Tidak ada penyewa aktif.</p>}
                  {tenants.map((t) => (
                    <div key={t.id} className={`flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer ${!t.phone ? "opacity-50" : ""}`}
                      onClick={() => t.phone && toggleTenant(t.id)}>
                      <Checkbox checked={selectedIds.has(t.id)} disabled={!t.phone} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{t.business_name}</p>
                        <p className="text-xs text-muted-foreground">{t.phone ?? "Tidak ada nomor WA"}</p>
                      </div>
                      {t.company_id === 1 ? <Badge className="bg-indigo-100 text-indigo-700 text-xs">SC</Badge> : <Badge className="bg-violet-100 text-violet-700 text-xs">TOD</Badge>}
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">Target: <strong>{targetCount}</strong> penyewa</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Pesan</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {TEMPLATES.map((t) => (
                  <Button key={t.label} variant="outline" size="sm" className="text-xs h-7" onClick={() => setMessage(t.text)}>
                    {t.label}
                  </Button>
                ))}
              </div>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tulis pesan... Gunakan {nama} untuk nama usaha penyewa."
                rows={8}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">Tip: gunakan <code className="bg-slate-100 px-1 rounded">{"{nama}"}</code> untuk nama usaha penyewa</p>

              {result && (
                <div className={`p-3 rounded-md text-sm flex items-start gap-2 ${result.failed === 0 ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
                  {result.failed === 0 ? <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                  <div>
                    <p className="font-medium">Selesai: {result.sent} terkirim, {result.failed} gagal dari {result.total} penyewa.</p>
                    {result.failed > 0 && <p className="text-xs mt-0.5">Beberapa nomor mungkin tidak valid atau tidak aktif di WhatsApp.</p>}
                  </div>
                </div>
              )}

              {mutation.error && (
                <div className="p-3 rounded-md text-sm bg-red-50 text-red-800 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {(mutation.error as Error).message}
                </div>
              )}

              <Button
                className="w-full gap-2"
                disabled={!message.trim() || targetCount === 0 || mutation.isPending}
                onClick={() => { setResult(null); mutation.mutate(); }}
              >
                <Send className="h-4 w-4" />
                {mutation.isPending ? "Mengirim..." : `Kirim ke ${targetCount} Penyewa`}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
