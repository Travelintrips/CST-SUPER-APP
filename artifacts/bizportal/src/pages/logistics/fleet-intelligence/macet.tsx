import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, MessageSquare, ClipboardList, RefreshCw, Phone, Car, DollarSign, Users, CheckCircle, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(parseFloat(String(v ?? 0)) || 0);
}
function fmtNum(v: unknown) {
  return new Intl.NumberFormat("id-ID").format(parseFloat(String(v ?? 0)) || 0);
}
function fmtDate(s: unknown) {
  if (!s) return "-";
  return new Date(String(s)).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

type MacetDriver = {
  id: number;
  driver_id: number;
  driver_external_id: string;
  driver_name: string;
  outstanding_amount: string;
  last_updated_date: string;
  due_days: number;
  driver_phone: string;
  vehicle_plate: string;
  notes: string | null;
  days_inactive: number;
  wa_sent_at: string | null;
};

export default function FleetMacetPage() {
  const qc = useQueryClient();

  const [followupTarget, setFollowupTarget] = useState<MacetDriver | null>(null);
  const [followupNote, setFollowupNote] = useState("");
  const [waTarget, setWaTarget] = useState<MacetDriver | null>(null);
  const [waMsg, setWaMsg] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-macet"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding/macet", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil data macet");
      return res.json() as Promise<{
        drivers: MacetDriver[];
        summary: { count: string; total_outstanding: string };
      }>;
    },
  });

  const followupMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const res = await fetch(`/api/logistics/fleet/outstanding/${id}/followup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error("Gagal simpan catatan");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Catatan tindak lanjut disimpan");
      setFollowupTarget(null);
      setFollowupNote("");
      qc.invalidateQueries({ queryKey: ["fleet-macet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const waMutation = useMutation({
    mutationFn: async ({ id, phone, message }: { id: number; phone: string; message: string }) => {
      const res = await fetch(`/api/logistics/fleet/outstanding/${id}/wa`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message }),
      });
      if (!res.ok) throw new Error("Gagal kirim WhatsApp");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Pesan WhatsApp berhasil dikirim");
      setWaTarget(null);
      setWaMsg("");
      qc.invalidateQueries({ queryKey: ["fleet-macet"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const drivers = data?.drivers ?? [];
  const summary = data?.summary;
  const totalMacet = parseInt(String(summary?.count ?? 0)) || 0;
  const totalOutstanding = parseFloat(String(summary?.total_outstanding ?? 0));

  function openWaDialog(d: MacetDriver) {
    const phone = d.driver_phone?.replace(/\D/g, "").replace(/^0/, "62");
    const msg =
      `Halo Bapak/Ibu *${d.driver_name}*,\n\n` +
      `Kami menginformasikan bahwa terdapat outstanding yang belum diselesaikan:\n\n` +
      `🔴 *Outstanding: ${fmtIdr(d.outstanding_amount)}*\n` +
      `📅 Terakhir aktif: ${fmtDate(d.last_updated_date)}\n` +
      `🚗 Kendaraan: ${d.vehicle_plate || "-"}\n\n` +
      `Mohon segera menghubungi kami untuk penyelesaian. Terima kasih.`;
    setWaTarget({ ...d, driver_phone: phone });
    setWaMsg(msg);
  }

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Driver Macet</h1>
              <p className="text-slate-400 text-sm">Outstanding &gt; Rp 1 juta, tidak aktif ≥ 7 hari</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/logistics/fleet-intelligence/outstanding">
              <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700">
                Semua Outstanding
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 border-slate-600 text-slate-300">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card className="bg-red-950/30 border-red-800/40">
            <CardContent className="p-4">
              <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center mb-3">
                <Users className="w-4 h-4 text-red-400" />
              </div>
              <div className="text-2xl font-bold text-red-300">{isLoading ? "—" : fmtNum(totalMacet)}</div>
              <div className="text-xs text-slate-400">Driver Macet</div>
            </CardContent>
          </Card>
          <Card className="bg-orange-950/30 border-orange-800/40">
            <CardContent className="p-4">
              <div className="w-9 h-9 rounded-lg bg-orange-500/10 flex items-center justify-center mb-3">
                <DollarSign className="w-4 h-4 text-orange-400" />
              </div>
              <div className="text-2xl font-bold text-orange-300">{isLoading ? "—" : fmtIdr(totalOutstanding)}</div>
              <div className="text-xs text-slate-400">Total Outstanding Macet</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/60 border-slate-700 md:col-span-1 col-span-2">
            <CardContent className="p-4">
              <div className="w-9 h-9 rounded-lg bg-slate-600/30 flex items-center justify-center mb-3">
                <MessageSquare className="w-4 h-4 text-slate-400" />
              </div>
              <div className="text-2xl font-bold text-slate-300">
                {isLoading ? "—" : fmtNum(drivers.filter((d) => d.wa_sent_at).length)}
              </div>
              <div className="text-xs text-slate-400">Sudah Dikirim WA</div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              Daftar Driver Macet
              {!isLoading && totalMacet > 0 && (
                <Badge className="bg-red-900/70 text-red-300 border-red-700 text-xs">{totalMacet} driver</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-xs">
                    <th className="text-left px-4 py-2 text-slate-400 font-medium">#</th>
                    <th className="text-left px-3 py-2 text-slate-400 font-medium">Driver</th>
                    <th className="text-left px-3 py-2 text-slate-400 font-medium">Plat / Phone</th>
                    <th className="text-right px-3 py-2 text-slate-400 font-medium">Outstanding</th>
                    <th className="text-right px-3 py-2 text-slate-400 font-medium">Hari Macet</th>
                    <th className="text-left px-3 py-2 text-slate-400 font-medium">Terakhir Aktif</th>
                    <th className="text-left px-3 py-2 text-slate-400 font-medium">Catatan</th>
                    <th className="text-center px-3 py-2 text-slate-400 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-700/40">
                          <td colSpan={8} className="px-4 py-2">
                            <div className="h-4 bg-slate-700 rounded animate-pulse" />
                          </td>
                        </tr>
                      ))
                    : drivers.length === 0
                    ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-12 text-center">
                            <div className="flex flex-col items-center gap-2 text-slate-500">
                              <CheckCircle className="w-8 h-8 text-emerald-500/50" />
                              <span className="text-sm">Tidak ada driver macet saat ini</span>
                              <span className="text-xs">Semua outstanding dalam kondisi normal</span>
                            </div>
                          </td>
                        </tr>
                      )
                    : drivers.map((d, i) => (
                        <tr key={d.id} className="border-b border-slate-700/30 hover:bg-red-950/10 transition-colors bg-red-950/5">
                          <td className="px-4 py-2.5 text-slate-500 text-xs">{i + 1}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-white text-xs">{d.driver_name || "-"}</div>
                            {d.driver_external_id && (
                              <div className="text-slate-500 text-[10px]">{d.driver_external_id}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1 text-slate-400 text-xs">
                              <Car className="w-3 h-3" /> {d.vehicle_plate || "-"}
                            </div>
                            {d.driver_phone && (
                              <div className="flex items-center gap-1 text-slate-500 text-[10px] mt-0.5">
                                <Phone className="w-2.5 h-2.5" /> {d.driver_phone}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className="text-red-400 font-bold text-xs">{fmtIdr(d.outstanding_amount)}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Badge className={`text-[10px] ${d.days_inactive >= 30 ? "bg-red-900/70 text-red-200 border-red-700" : "bg-orange-900/60 text-orange-200 border-orange-700"}`}>
                              {d.days_inactive}h
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-slate-400 text-xs">{fmtDate(d.last_updated_date)}</td>
                          <td className="px-3 py-2.5 max-w-[180px]">
                            {d.notes
                              ? <span className="text-slate-300 text-xs line-clamp-2">{d.notes}</span>
                              : <span className="text-slate-600 text-xs italic">Belum ada catatan</span>
                            }
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5 justify-center">
                              <Button
                                size="sm"
                                className="h-7 text-[11px] bg-green-700 hover:bg-green-600 gap-1 px-2"
                                onClick={() => openWaDialog(d)}
                                title="Kirim tagihan via WhatsApp"
                              >
                                <MessageSquare className="w-3 h-3" />
                                {d.wa_sent_at ? "Kirim Ulang" : "Kirim WA"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] border-slate-600 text-slate-300 hover:bg-slate-700 gap-1 px-2"
                                onClick={() => { setFollowupTarget(d); setFollowupNote(d.notes ?? ""); }}
                                title="Catat tindak lanjut"
                              >
                                <ClipboardList className="w-3 h-3" />
                                Catat
                              </Button>
                            </div>
                            {d.wa_sent_at && (
                              <div className="text-[9px] text-slate-500 text-center mt-0.5">
                                WA: {fmtDate(d.wa_sent_at)}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
                {!isLoading && drivers.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-slate-600 bg-slate-800/80">
                      <td colSpan={3} className="px-4 py-2 text-slate-400 text-xs font-medium">Total</td>
                      <td className="px-3 py-2 text-right text-red-400 text-xs font-bold">
                        {fmtIdr(drivers.reduce((s, r) => s + (parseFloat(r.outstanding_amount) || 0), 0))}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Follow-up Dialog */}
      <Dialog open={!!followupTarget} onOpenChange={(open) => { if (!open) { setFollowupTarget(null); setFollowupNote(""); } }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <ClipboardList className="w-4 h-4 text-blue-400" />
              Catat Tindak Lanjut
            </DialogTitle>
          </DialogHeader>
          {followupTarget && (
            <div className="space-y-4">
              <div className="bg-slate-800 rounded-lg p-3 text-sm">
                <div className="font-medium text-white">{followupTarget.driver_name}</div>
                <div className="text-red-400 font-bold">{fmtIdr(followupTarget.outstanding_amount)}</div>
                <div className="text-slate-400 text-xs">{followupTarget.vehicle_plate} · Macet {followupTarget.days_inactive} hari</div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Catatan Tindak Lanjut</Label>
                <Textarea
                  value={followupNote}
                  onChange={(e) => setFollowupNote(e.target.value)}
                  placeholder="cth: Sudah dihubungi via WA, janji bayar tgl 25..."
                  className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 min-h-[100px] text-sm"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setFollowupTarget(null); setFollowupNote(""); }} className="border-slate-600 text-slate-300">
                  Batal
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-700 hover:bg-blue-600"
                  disabled={followupMutation.isPending || !followupNote.trim()}
                  onClick={() => followupMutation.mutate({ id: followupTarget.id, notes: followupNote })}
                >
                  {followupMutation.isPending ? "Menyimpan..." : "Simpan Catatan"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* WhatsApp Dialog */}
      <Dialog open={!!waTarget} onOpenChange={(open) => { if (!open) { setWaTarget(null); setWaMsg(""); } }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <MessageSquare className="w-4 h-4 text-green-400" />
              Kirim Tagihan via WhatsApp
            </DialogTitle>
          </DialogHeader>
          {waTarget && (
            <div className="space-y-4">
              <div className="bg-slate-800 rounded-lg p-3 text-sm">
                <div className="font-medium text-white">{waTarget.driver_name}</div>
                <div className="flex items-center gap-1 text-slate-400 text-xs mt-0.5">
                  <Phone className="w-3 h-3" /> {waTarget.driver_phone || "Tidak ada nomor"}
                </div>
              </div>
              {!waTarget.driver_phone && (
                <div className="bg-amber-900/30 border border-amber-700/40 rounded-lg p-3 text-xs text-amber-300">
                  ⚠ Nomor WhatsApp tidak tersedia untuk driver ini. Perbarui data driver terlebih dahulu.
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Pesan</Label>
                <Textarea
                  value={waMsg}
                  onChange={(e) => setWaMsg(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white text-sm min-h-[160px] font-mono text-xs"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setWaTarget(null); setWaMsg(""); }} className="border-slate-600 text-slate-300">
                  Batal
                </Button>
                <Button
                  size="sm"
                  className="bg-green-700 hover:bg-green-600 gap-1.5"
                  disabled={waMutation.isPending || !waTarget.driver_phone || !waMsg.trim()}
                  onClick={() => waMutation.mutate({ id: waTarget.id, phone: waTarget.driver_phone, message: waMsg })}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  {waMutation.isPending ? "Mengirim..." : "Kirim WhatsApp"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
