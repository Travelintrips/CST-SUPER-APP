import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Trash2, ShieldAlert, CheckCircle2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const MAGIC_WORD = "HAPUS_SEMUA_TRANSAKSI";

type ResetResult = {
  ok: boolean;
  deleted: {
    entry_lines: number;
    entries: number;
    payments: number;
    transaction_taxes: number;
  };
};

export default function ResetTransactionsPage() {
  const [step, setStep] = useState<"idle" | "confirm1" | "confirm2" | "done">("idle");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<ResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/accounting/admin/reset-transactions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: MAGIC_WORD }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Gagal reset");
      return data as ResetResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setStep("done");
    },
    onError: (e: Error) => {
      setError(e.message);
      setStep("idle");
    },
  });

  return (
    <AppShell>
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/accounting/governance">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Reset Transaksi Akuntansi</h1>
            <p className="text-sm text-gray-500">Hanya untuk admin — tidak dapat dibatalkan</p>
          </div>
        </div>

        {/* Done state */}
        {step === "done" && result && (
          <Card className="border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-800">
                <CheckCircle2 className="w-5 h-5" />
                Reset Berhasil
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-green-700">Semua transaksi akuntansi telah dihapus dari database.</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-white rounded p-2 border border-green-200">
                  <div className="font-semibold text-green-900">{result.deleted.entries}</div>
                  <div className="text-green-700">Jurnal entries</div>
                </div>
                <div className="bg-white rounded p-2 border border-green-200">
                  <div className="font-semibold text-green-900">{result.deleted.entry_lines}</div>
                  <div className="text-green-700">Baris jurnal</div>
                </div>
                <div className="bg-white rounded p-2 border border-green-200">
                  <div className="font-semibold text-green-900">{result.deleted.payments}</div>
                  <div className="text-green-700">Pembayaran</div>
                </div>
                <div className="bg-white rounded p-2 border border-green-200">
                  <div className="font-semibold text-green-900">{result.deleted.transaction_taxes}</div>
                  <div className="text-green-700">Catatan pajak</div>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => { setStep("idle"); setResult(null); setTyped(""); }}
              >
                Tutup
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Main card */}
        {step !== "done" && (
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700">
                <ShieldAlert className="w-5 h-5" />
                Zona Bahaya
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive" className="border-red-300 bg-red-50">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-red-800 text-sm leading-relaxed">
                  Tindakan ini akan <strong>menghapus permanen</strong> semua data berikut dari database:
                  <ul className="mt-2 ml-4 list-disc space-y-1">
                    <li>Semua jurnal entries &amp; baris jurnal</li>
                    <li>Semua pembayaran (accounting payments)</li>
                    <li>Semua catatan pajak transaksi</li>
                  </ul>
                  <div className="mt-2">
                    Master data (COA, jurnal, pajak, settings) <strong>tidak dihapus</strong>.
                  </div>
                </AlertDescription>
              </Alert>

              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
                <strong>Tidak dapat dibatalkan.</strong> Pastikan Anda sudah backup data atau memang
                bermaksud menghapus semua transaksi akuntansi.
              </div>

              <Button
                variant="destructive"
                className="w-full gap-2"
                onClick={() => setStep("confirm1")}
              >
                <Trash2 className="w-4 h-4" />
                Hapus Semua Transaksi Akuntansi
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Confirm step 1 — dialog */}
        <Dialog open={step === "confirm1"} onOpenChange={(o) => { if (!o) setStep("idle"); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" />
                Konfirmasi Pertama
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-gray-700">
                Anda akan menghapus <strong>semua transaksi akuntansi</strong>. Tindakan ini tidak dapat dibatalkan.
              </p>
              <p className="text-sm text-gray-700">
                Apakah Anda yakin ingin melanjutkan?
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("idle")}>Batal</Button>
              <Button variant="destructive" onClick={() => setStep("confirm2")}>
                Ya, Saya Yakin
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm step 2 — type magic word */}
        <Dialog open={step === "confirm2"} onOpenChange={(o) => { if (!o) { setStep("idle"); setTyped(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-700">
                <ShieldAlert className="w-5 h-5" />
                Konfirmasi Kedua — Ketik Kata Kunci
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-gray-700">
                Untuk melanjutkan, ketik kata berikut persis seperti tertulis:
              </p>
              <div className="bg-gray-100 rounded px-3 py-2 font-mono text-sm font-bold text-red-700 select-all">
                {MAGIC_WORD}
              </div>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Ketik kata kunci di sini..."
                className={typed === MAGIC_WORD ? "border-green-500 ring-1 ring-green-400" : ""}
                autoFocus
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setStep("idle"); setTyped(""); }}>Batal</Button>
              <Button
                variant="destructive"
                disabled={typed !== MAGIC_WORD || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? "Menghapus..." : "Hapus Sekarang"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
