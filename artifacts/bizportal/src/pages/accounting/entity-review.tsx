import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Users, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

const ENTITY_TYPES = ["CUSTOMER","VENDOR","EMPLOYEE","PAYMENT_GATEWAY","BANK","HOLDING_COMPANY","EXTERNAL_COMPANY"];

async function api(path: string, opt?: RequestInit) {
  const r = await fetch(`/api/bank-mutation-masters${path}`, opt);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request gagal");
  return j;
}

function ReviewQueue() {
  const qc = useQueryClient();
  const [selectedTypes, setSelectedTypes] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery({ queryKey: ["entity-review", "PENDING"], queryFn: () => api("/entity-review?status=PENDING") });
  const items = data?.items ?? [];

  const approve = useMutation({
    mutationFn: ({ id, entity_type }: { id: number; entity_type: string }) =>
      api(`/entity-review/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_type }) }),
    onSuccess: () => { toast.success("Entitas disetujui dan masuk ke master"); qc.invalidateQueries({ queryKey: ["entity-review"] }); qc.invalidateQueries({ queryKey: ["master-entities"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (id: number) => api(`/entity-review/${id}/reject`, { method: "POST" }),
    onSuccess: () => { toast.success("Ditolak"); qc.invalidateQueries({ queryKey: ["entity-review"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-2">
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Memuat...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-500" />
          <p className="font-medium">Semua entitas sudah diproses!</p>
          <p className="text-sm">Tidak ada entitas yang perlu direview</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Entitas</TableHead>
                <TableHead>Saran Tipe</TableHead>
                <TableHead>Sumber Mutasi</TableHead>
                <TableHead>Ditemukan</TableHead>
                <TableHead>Tipe yang Dipilih</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.entity_name}</TableCell>
                  <TableCell>
                    {item.entity_type_suggestion ? (
                      <Badge variant="outline">{item.entity_type_suggestion}</Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.source_mutation_key ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString("id-ID") : "—"}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={selectedTypes[item.id] ?? item.entity_type_suggestion ?? ""}
                      onValueChange={v => setSelectedTypes(s => ({ ...s, [item.id]: v }))}
                    >
                      <SelectTrigger className="w-44"><SelectValue placeholder="Pilih tipe..." /></SelectTrigger>
                      <SelectContent>
                        {ENTITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={!selectedTypes[item.id] && !item.entity_type_suggestion}
                        onClick={() => approve.mutate({ id: item.id, entity_type: selectedTypes[item.id] ?? item.entity_type_suggestion })}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />Setuju
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600" onClick={() => reject.mutate(item.id)}>
                        <XCircle className="w-3 h-3 mr-1" />Tolak
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function MasterEntities() {
  const { data, isLoading } = useQuery({ queryKey: ["master-entities"], queryFn: () => api("/entities") });
  const items = data?.items ?? [];
  const byType = items.reduce((acc: Record<string, any[]>, e: any) => {
    if (!acc[e.entity_type]) acc[e.entity_type] = [];
    acc[e.entity_type].push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {isLoading ? <div className="text-center py-8 text-muted-foreground">Memuat...</div> :
        Object.entries(byType).map(([type, ents]: [string, any[]]) => (
          <div key={type}>
            <h3 className="font-medium text-sm text-muted-foreground mb-1">{type} ({ents.length})</h3>
            <div className="flex flex-wrap gap-1">
              {ents.map((e: any) => (
                <Badge key={e.id} variant="secondary">{e.entity_name}</Badge>
              ))}
            </div>
          </div>
        ))
      }
      {!isLoading && items.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">Belum ada entitas disetujui</div>
      )}
    </div>
  );
}

export default function EntityReviewPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <Users className="w-6 h-6" />
        <div>
          <h1 className="text-2xl font-semibold">Review Entitas</h1>
          <p className="text-sm text-muted-foreground">Fase 13 — Proses entitas UNKNOWN dari mutasi bank menjadi master entitas</p>
        </div>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Antrian Review</TabsTrigger>
          <TabsTrigger value="master">Master Entitas</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <ReviewQueue />
        </TabsContent>
        <TabsContent value="master" className="mt-4">
          <MasterEntities />
        </TabsContent>
      </Tabs>
    </div>
  );
}
