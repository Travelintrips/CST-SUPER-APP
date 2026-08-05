import { useState, useEffect } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, CheckCircle, ChevronLeft } from "lucide-react";
import { toast } from "sonner";

interface QCLine { grLineId?: number; productId?: number; name: string; qtyInspected: string; qtyPassed: string; qtyFailed: string; failReason: string; notes: string; }
interface QC { id: number; qcNumber: string; status: string; grId: number; inspectorName?: string; notes?: string; lines: QCLine[]; gr?: Record<string, unknown>; }

const apiFetch = (path: string, opts?: RequestInit) => fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });

export default function QcEditorPage() {
  const { id } = useParams();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const grIdFromUrl = params.get("grId");
  const [, navigate] = useLocation();
  const qcClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const isNew = !id || id === "new";

  const { data: qc, isLoading } = useQuery<QC>({
    queryKey: ["/api/purchase-workflow/qc", id],
    queryFn: () => apiFetch(`/purchase-workflow/qc/${id}`).then(r => r.json()),
    enabled: !isNew,
  });

  const { data: grData } = useQuery({
    queryKey: ["/api/purchase-workflow/gr-detail", grIdFromUrl],
    queryFn: () => apiFetch(`/purchase-workflow/gr/${grIdFromUrl}`).then(r => r.json()),
    enabled: isNew && !!grIdFromUrl,
  });

  const [form, setForm] = useState({ grId: grIdFromUrl ?? "", inspectorName: "", notes: "" });
  const [lines, setLines] = useState<QCLine[]>([]);

  useEffect(() => {
    if (qc) {
      setForm({ grId: String(qc.grId), inspectorName: qc.inspectorName ?? "", notes: qc.notes ?? "" });
      setLines(qc.lines?.length ? qc.lines.map(l => ({ ...l, qtyInspected: String(l.qtyInspected), qtyPassed: String(l.qtyPassed), qtyFailed: String(l.qtyFailed), failReason: l.failReason ?? "", notes: l.notes ?? "" })) : []);
    }
  }, [qc]);

  useEffect(() => {
    if (grData?.lines && isNew && lines.length === 0) {
      setLines((grData.lines as Record<string, unknown>[]).map((l) => ({
        grLineId: Number(l.id),
        productId: l.productId ? Number(l.productId) : undefined,
        name: String(l.name ?? ""),
        qtyInspected: String(l.qtyReceived ?? "0"),
        qtyPassed: String(l.qtyReceived ?? "0"),
        qtyFailed: "0",
        failReason: "",
        notes: "",
      })));
    }
  }, [grData, isNew]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { ...form, grId: Number(form.grId), companyId: activeCompanyId, lines };
      const r = isNew
        ? await apiFetch("/purchase-workflow/qc", { method: "POST", body: JSON.stringify(payload) })
        : await apiFetch(`/purchase-workflow/qc/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    onSuccess: (data: QC) => { toast.success("QC tersimpan"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/qc"] }); if (isNew) navigate(`/purchase/qc/${data.id}`); },
    onError: () => toast.error("Gagal menyimpan"),
  });

  const completeMut = useMutation({
    mutationFn: () => apiFetch(`/purchase-workflow/qc/${qc?.id}/action`, { method: "POST", body: JSON.stringify({ action: "complete", inspectorName: form.inspectorName }) }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { toast.success("QC selesai"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/qc", id] }); },
    onError: () => toast.error("Gagal"),
  });

  const updateLine = (i: number, key: keyof QCLine, value: string) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: value } : l));
  const isPending = !qc || qc.status === "pending";
  if (!isNew && isLoading) return <AppShell><div className="flex items-center justify-center h-64">Loading...</div></AppShell>;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-5xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/purchase/qc")}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{isNew ? "Buat QC Inspection" : `QC: ${qc?.qcNumber}`}</h1>
            {qc && <Badge variant={qc.status === "passed" ? "default" : qc.status === "failed" ? "destructive" : "secondary"}>{qc.status}</Badge>}
          </div>
          <div className="flex gap-2">
            {isPending && <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Simpan</Button>}
            {!isNew && isPending && <Button variant="default" onClick={() => completeMut.mutate()} disabled={completeMut.isPending}><CheckCircle className="mr-1 h-4 w-4" />Selesaikan QC</Button>}
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Informasi QC</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>ID GRN</Label><Input value={form.grId} onChange={e => setForm(f => ({ ...f, grId: e.target.value }))} disabled={!isPending} /></div>
            <div><Label>Nama Inspektor</Label><Input value={form.inspectorName} onChange={e => setForm(f => ({ ...f, inspectorName: e.target.value }))} /></div>
            <div className="md:col-span-2"><Label>Catatan</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} disabled={!isPending} rows={2} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Hasil Inspeksi per Item</CardTitle>
            {isPending && <Button size="sm" variant="outline" onClick={() => setLines(prev => [...prev, { name: "", qtyInspected: "0", qtyPassed: "0", qtyFailed: "0", failReason: "", notes: "" }])}><Plus className="mr-1 h-4 w-4" />Tambah</Button>}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2 px-2">Nama Item</th>
                  <th className="text-left py-2 px-2 w-24">Qty Periksa</th>
                  <th className="text-left py-2 px-2 w-24">Qty Lulus</th>
                  <th className="text-left py-2 px-2 w-24">Qty Gagal</th>
                  <th className="text-left py-2 px-2">Alasan Gagal</th>
                  {isPending && <th className="w-10" />}
                </tr></thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="border-b">
                      <td className="py-1 px-2"><Input value={line.name} onChange={e => updateLine(i, "name", e.target.value)} disabled={!isPending} className="h-8" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.qtyInspected} onChange={e => updateLine(i, "qtyInspected", e.target.value)} disabled={!isPending} className="h-8" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.qtyPassed} onChange={e => updateLine(i, "qtyPassed", e.target.value)} disabled={!isPending} className="h-8" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.qtyFailed} onChange={e => updateLine(i, "qtyFailed", e.target.value)} disabled={!isPending} className="h-8" /></td>
                      <td className="py-1 px-2"><Input value={line.failReason} onChange={e => updateLine(i, "failReason", e.target.value)} disabled={!isPending} className="h-8" /></td>
                      {isPending && <td className="py-1 px-2"><Button size="icon" variant="ghost" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="h-8 w-8"><Trash2 className="h-4 w-4 text-destructive" /></Button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
