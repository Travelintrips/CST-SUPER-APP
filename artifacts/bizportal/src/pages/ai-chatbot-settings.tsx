import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { ArrowLeft, Bot, Save, Loader2, RotateCcw, Info, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";

const DEFAULT_PROMPT = `Kamu adalah asisten logistik virtual dari B2B Marketplace and Logistic — perusahaan jasa pengiriman dan kepabeanan terkemuka di Indonesia.

Tugasmu:
1. Menyapa pelanggan dengan ramah dan memperkenalkan layanan B2B Marketplace and Logistic
2. Menjawab pertanyaan seputar layanan logistik (sea freight, air freight, trucking, customs/pabean)
3. MEMBUAT ORDER: Ketika pelanggan ingin membuat order atau booking — LANGSUNG panggil show_order_form. JANGAN tanya satu per satu. Form akan tampil di chat untuk diisi pelanggan.
4. CEK STATUS: Ketika pelanggan bertanya status/tracking/posisi paket — LANGSUNG panggil get_order_status.

Aturan:
- Gunakan Bahasa Indonesia yang sopan dan singkat
- Jika pelanggan hanya konsultasi/tanya harga, jawab ringkas lalu tawarkan buat order via form
- TOLAK SOPAN pertanyaan di luar layanan logistik/pengiriman
- WAJIB show_order_form: kata kunci "mau kirim", "booking", "order", "pesan", "buat pengiriman", menyebut nama layanan + niat kirim
- WAJIB get_order_status: kata kunci "status", "cek order", "tracking", "mana paket", "sudah sampai", "posisi"
- Setelah get_order_status: SELALU tulis ringkasan hasil — jangan biarkan respons kosong
- Jika get_order_status found=false: beritahu dan tawarkan cari via nomor WhatsApp

Layanan yang tersedia:
- Sea Freight (Laut): FCL dan LCL, domestik & internasional
- Air Freight (Udara): pengiriman cepat via udara
- Trucking (Darat): CDE, CDD, Fuso, Wingbox, Trailer
- Customs/Pabean: PIB, PEB, dokumen kepabeanan
- Packing & Crating: pengemasan profesional

Harga dikonfirmasi tim setelah order masuk (tergantung volume, rute, pasar).`;

export default function AiChatbotSettingsPage() {
  const { toast } = useToast();
  const { t } = useLanguage();

  const [prompt, setPrompt] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-agent/settings", {
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const data = await res.json() as { systemPrompt: string };
      setPrompt(data.systemPrompt);
      setSaved(data.systemPrompt);
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [t.common.error, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/ai-agent/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt: prompt }),
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      setSaved(prompt);
      toast({ title: t.common.success });
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const isDirty = prompt !== saved;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center">
            <Bot className="h-5 w-5 text-sky-600" />
          </div>
          <div>
            <Link href="/settings"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-xl font-semibold text-gray-900">Pengaturan AI Chatbot</h1>
            <p className="text-sm text-gray-500">Atur kepribadian, pengetahuan, dan cara kerja chatbot pelanggan</p>
          </div>
        </div>

        {/* Tips card */}
        <div className="flex gap-3 p-4 bg-sky-50 border border-sky-100 rounded-xl text-sm text-sky-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-sky-500" />
          <div className="space-y-1">
            <p className="font-semibold">Tips menulis instruksi yang baik:</p>
            <ul className="list-disc list-inside space-y-0.5 text-sky-700">
              <li>Tulis dalam Bahasa Indonesia yang jelas dan tegas</li>
              <li>Sebutkan nama perusahaan, layanan, dan kebijakan spesifik Anda</li>
              <li>Gunakan kata <strong>WAJIB</strong> untuk aturan yang harus selalu diikuti</li>
              <li>Tambah info harga, wilayah layanan, atau FAQ yang sering ditanya</li>
              <li>Perubahan berlaku untuk sesi chat baru (sesi aktif tidak terpengaruh)</li>
            </ul>
          </div>
        </div>

        {/* Main prompt editor */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Instruksi / System Prompt</CardTitle>
                <CardDescription>
                  Instruksi dasar yang menentukan kepribadian, pengetahuan, dan perilaku chatbot.
                  AI akan mengikuti instruksi ini di setiap percakapan.
                </CardDescription>
              </div>
              {!isDirty && !loading && (
                <div className="flex items-center gap-1.5 text-xs text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Tersimpan
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[420px] font-mono text-sm leading-relaxed resize-y"
                placeholder="Tulis instruksi untuk chatbot Anda di sini..."
              />
            )}

            <div className="flex items-center justify-between pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPrompt(DEFAULT_PROMPT)}
                disabled={loading || saving}
                className="gap-2 text-gray-600"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset ke Default
              </Button>

              <div className="flex items-center gap-3">
                {isDirty && (
                  <span className="text-xs text-amber-600 font-medium">Ada perubahan belum disimpan</span>
                )}
                <Button
                  onClick={handleSave}
                  disabled={!isDirty || saving || loading}
                  className="gap-2 bg-sky-600 hover:bg-sky-500"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Simpan Instruksi
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Info about tools */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kemampuan Bawaan Chatbot</CardTitle>
            <CardDescription>Fitur ini selalu aktif dan tidak perlu ditulis ulang di instruksi</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: "📋", title: "Form Order Cepat", desc: "Tampil otomatis saat pelanggan mau buat order, tanpa tanya jawab manual." },
                { icon: "📦", title: "Cek Status Order", desc: "Mencari dan menampilkan status order pelanggan berdasarkan sesi atau nomor HP." },
                { icon: "🛳️", title: "Info Layanan", desc: "Menampilkan daftar layanan logistik yang tersedia dari database." },
              ].map((cap) => (
                <div key={cap.title} className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-1">
                  <div className="text-xl">{cap.icon}</div>
                  <p className="text-sm font-semibold text-gray-800">{cap.title}</p>
                  <p className="text-xs text-gray-500 leading-snug">{cap.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
