import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { RefreshCw, Settings, Save, Plus, Trash2, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

interface SettingRow { key: string; value: string; updated_at: string; }

export default function PosSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pairs, setPairs] = useState<Array<{ key: string; value: string; dirty: boolean }>>([]);

  const { data, isFetching, dataUpdatedAt } = useQuery<{ rows: SettingRow[]; obj: Record<string, string> }>({
    queryKey: ["pos-settings"],
    queryFn: () => apiFetch("/api/tenant/pos/settings"),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (data) setPairs(data.rows.map(r => ({ key: r.key, value: r.value, dirty: false })));
  }, [data]);

  const save = useMutation({
    mutationFn: (kv: Record<string, string>) => apiFetch("/api/tenant/pos/settings", { method: "PUT", body: JSON.stringify(kv) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos-settings"] });
      toast({ title: "Pengaturan tersimpan" });
      setPairs(p => p.map(x => ({ ...x, dirty: false })));
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function addRow() { setPairs(p => [...p, { key: "", value: "", dirty: true }]); }
  function removeRow(i: number) { setPairs(p => p.filter((_, j) => j !== i)); }
  function updateKey(i: number, key: string) { setPairs(p => p.map((x, j) => j === i ? { ...x, key, dirty: true } : x)); }
  function updateValue(i: number, value: string) { setPairs(p => p.map((x, j) => j === i ? { ...x, value, dirty: true } : x)); }

  function handleSave() {
    const kv: Record<string, string> = {};
    for (const p of pairs) {
      if (p.key.trim()) kv[p.key.trim()] = p.value;
    }
    save.mutate(kv);
  }

  const dirtyCount = pairs.filter(p => p.dirty).length;

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
        <span>/</span>
        <Link href="/tenant" className="hover:text-foreground transition-colors">Tenant & Property</Link>
        <span>/</span>
        <Link href="/tenant/pos-tenant" className="hover:text-foreground transition-colors">POS Tenant</Link>
        <span>/</span>
        <span className="text-foreground font-medium">POS — Pengaturan</span>
      </nav>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">POS — Pengaturan</h1>
          <Badge variant="secondary">{pairs.length} konfigurasi</Badge>
          {dirtyCount > 0 && <Badge variant="destructive">{dirtyCount} belum disimpan</Badge>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => qc.invalidateQueries({ queryKey: ["pos-settings"] })} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" variant="outline" onClick={addRow}><Plus className="h-4 w-4 mr-1" />Baris Baru</Button>
          <Button size="sm" onClick={handleSave} disabled={save.isPending}>
            <Save className="h-4 w-4 mr-1" />{save.isPending ? "Menyimpan..." : "Simpan Semua"}
          </Button>
        </div>
      </div>
      {dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">Terakhir diperbarui: {new Date(dataUpdatedAt).toLocaleTimeString("id-ID")}</p>}

      <div className="rounded-md border overflow-hidden">
        <div className="grid grid-cols-[1fr_2fr_auto] gap-0">
          <div className="bg-muted px-4 py-2 text-sm font-medium border-b">Key</div>
          <div className="bg-muted px-4 py-2 text-sm font-medium border-b">Value</div>
          <div className="bg-muted px-4 py-2 text-sm font-medium border-b w-12"></div>

          {pairs.length === 0 && (
            <div className="col-span-3 text-center text-muted-foreground py-8 text-sm">
              Belum ada konfigurasi. Klik "+ Baris Baru" untuk menambahkan.
            </div>
          )}

          {pairs.map((p, i) => (
            <div key={i} className="contents">
              <div className={`px-2 py-1.5 border-b flex items-center ${p.dirty ? "bg-yellow-50 dark:bg-yellow-950/20" : ""}`}>
                <Input
                  className="h-7 text-sm font-mono border-0 shadow-none focus-visible:ring-0 bg-transparent"
                  value={p.key}
                  onChange={e => updateKey(i, e.target.value)}
                  placeholder="setting_key"
                />
              </div>
              <div className={`px-2 py-1.5 border-b flex items-center ${p.dirty ? "bg-yellow-50 dark:bg-yellow-950/20" : ""}`}>
                <Input
                  className="h-7 text-sm border-0 shadow-none focus-visible:ring-0 bg-transparent"
                  value={p.value}
                  onChange={e => updateValue(i, e.target.value)}
                  placeholder="nilai..."
                />
              </div>
              <div className={`px-2 py-1.5 border-b flex items-center justify-center ${p.dirty ? "bg-yellow-50 dark:bg-yellow-950/20" : ""}`}>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeRow(i)}>
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Baris kuning = perubahan belum disimpan. Klik "Simpan Semua" untuk menerapkan.</p>
    </div>
  );
}
