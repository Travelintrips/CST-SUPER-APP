import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle, CheckCircle2, RefreshCw, Wrench, ShieldAlert, Loader2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeaturedCorruptItem {
  id: number;
  vendorId: number;
  vendorName: string | null;
  name: string;
  isFeatured: boolean;
  featuredUntil: string | null;
  reason: "no_expiry" | "expired";
  repaired?: boolean;
}

interface ScanResult {
  totalCorrupt: number;
  items: FeaturedCorruptItem[];
  scannedAt: string;
}

interface RepairResult {
  repairedCount: number;
  skippedCount: number;
  items: Array<FeaturedCorruptItem & { repaired: boolean }>;
  repairedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const reasonBadge = (reason: string) =>
  reason === "no_expiry" ? (
    <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">Abadi</Badge>
  ) : (
    <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">Expired</Badge>
  );

const fmt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID") : "—";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FeaturedMaintenancePage() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [confirmRepair, setConfirmRepair] = useState(false);

  const scanMutation = useMutation({
    mutationFn: async (): Promise<ScanResult> => {
      const res = await fetch("/api/trading/featured-integrity/scan", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      setScanResult(data);
      setRepairResult(null);
      setConfirmRepair(false);
      toast({
        title: data.totalCorrupt === 0
          ? "✅ Tidak ada data corrupt"
          : `⚠️ ${data.totalCorrupt} item corrupt ditemukan`,
        description: data.totalCorrupt === 0
          ? "Semua item featured dalam kondisi valid."
          : "Jalankan Repair untuk memperbaiki.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Scan gagal", description: err.message, variant: "destructive" });
    },
  });

  const repairMutation = useMutation({
    mutationFn: async (): Promise<RepairResult> => {
      const res = await fetch("/api/trading/featured-integrity/repair", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      setRepairResult(data);
      setConfirmRepair(false);
      toast({
        title: `✅ Repair selesai: ${data.repairedCount} item diperbaiki`,
        description: data.skippedCount > 0 ? `${data.skippedCount} item gagal diperbaiki.` : undefined,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Repair gagal", description: err.message, variant: "destructive" });
    },
  });

  const hasScanItems = scanResult && scanResult.totalCorrupt > 0;
  const isLoading = scanMutation.isPending || repairMutation.isPending;

  const displayItems = repairResult ? repairResult.items : scanResult?.items ?? [];

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Featured Maintenance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scan dan perbaiki data featured product yang corrupt — tidak ada expiry atau sudah expired.
          </p>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* Scan */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-blue-500" /> Scan Integrity
              </CardTitle>
              <CardDescription className="text-xs">
                Laporan item is_featured=true tapi tidak punya expiry valid (dry-run, tidak mengubah data).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => scanMutation.mutate()}
                disabled={isLoading}
              >
                {scanMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Scan Sekarang
              </Button>
            </CardContent>
          </Card>

          {/* Dry Run info */}
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4" /> Dry Run Report
              </CardTitle>
              <CardDescription className="text-xs text-amber-600">
                Hasil scan adalah laporan untuk verifikasi sebelum repair. Data tidak diubah.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {scanResult ? (
                <div className="text-xs font-medium text-amber-700">
                  {scanResult.totalCorrupt === 0
                    ? "✅ Tidak ada item corrupt"
                    : `⚠️ ${scanResult.totalCorrupt} item perlu diperbaiki`}
                  <div className="text-amber-500 font-normal mt-0.5">
                    Scan: {fmt(scanResult.scannedAt)}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-amber-500">Jalankan Scan terlebih dahulu.</div>
              )}
            </CardContent>
          </Card>

          {/* Repair */}
          <Card className={hasScanItems ? "border-red-200" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Wrench className="h-4 w-4 text-red-500" /> Repair
              </CardTitle>
              <CardDescription className="text-xs">
                Set is_featured=false & featured_until=null untuk setiap item corrupt. Tidak bisa dibatalkan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!confirmRepair ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  disabled={!hasScanItems || isLoading}
                  onClick={() => setConfirmRepair(true)}
                >
                  Repair ({scanResult?.totalCorrupt ?? 0} item)
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-red-600 font-medium">
                    Konfirmasi repair {scanResult?.totalCorrupt} item?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1 text-xs"
                      disabled={repairMutation.isPending}
                      onClick={() => repairMutation.mutate()}
                    >
                      {repairMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      Ya, Repair
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs"
                      disabled={repairMutation.isPending}
                      onClick={() => setConfirmRepair(false)}
                    >
                      Batal
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Repair Result Summary */}
        {repairResult && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700 text-sm">
              Repair selesai pada {fmt(repairResult.repairedAt)}.{" "}
              <strong>{repairResult.repairedCount} item diperbaiki</strong>
              {repairResult.skippedCount > 0 && (
                <span className="text-red-600 ml-1">({repairResult.skippedCount} gagal)</span>
              )}.
            </AlertDescription>
          </Alert>
        )}

        {/* Result Table */}
        {(scanResult || repairResult) && (
          displayItems.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                Tidak ada item featured yang corrupt. Semua data valid.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  {repairResult ? "Repair Report" : "Scan Report"} — {displayItems.length} item
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-14">ID</TableHead>
                      <TableHead className="text-xs">Nama Item</TableHead>
                      <TableHead className="text-xs">Vendor</TableHead>
                      <TableHead className="text-xs">Alasan Corrupt</TableHead>
                      <TableHead className="text-xs">Featured Until</TableHead>
                      {repairResult && <TableHead className="text-xs w-24">Status</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs font-mono">{item.id}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{item.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.vendorName ?? `#${item.vendorId}`}
                        </TableCell>
                        <TableCell className="text-xs">
                          {reasonBadge(item.reason)}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {item.featuredUntil ? fmt(item.featuredUntil) : "—"}
                        </TableCell>
                        {repairResult && (
                          <TableCell className="text-xs">
                            {"repaired" in item && item.repaired ? (
                              <Badge className="bg-green-100 text-green-800 border-green-200">Diperbaiki</Badge>
                            ) : (
                              <Badge variant="outline" className="text-red-600 border-red-200">Gagal</Badge>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )
        )}
      </div>
    </AppShell>
  );
}
