import { useState, useEffect, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Save, RotateCcw, Loader2, ArrowLeft, MessageCircle, CheckCircle } from "lucide-react";
import { Link } from "wouter";

type RecipientKey = "admin_personal" | "admin_group" | "customer" | "vendor";
type WorkflowKey =
  | "order_new" | "vendor_request" | "vendor_submission" | "vendor_revision"
  | "vendor_submit_confirm" | "vendor_rfq_forward" | "vendor_submission_summary"
  | "revision_fallback" | "customer_rejection" | "op_confirm_submitted" | "customer_rfq_response"
  | "customer_approval" | "customer_approved" | "so_created" | "op_request"
  | "driver_assigned" | "shipment_update" | "customs_update" | "delivery_completed"
  | "rfq_vendor_recap"
  | "product_order_new" | "product_order_status_update"
  | "invoice_issued";
type ServiceTypeSim = "trucking" | "freight_sea" | "freight_air" | "ppjk" | "product" | "handling" | "";

const WORKFLOW_VALID_RECIPIENTS: Partial<Record<WorkflowKey, RecipientKey[]>> = {
  product_order_new:         ["admin_personal", "admin_group", "customer"],
  vendor_submit_confirm:     ["vendor"],
  vendor_rfq_forward:        ["vendor"],
  vendor_submission_summary: ["admin_personal"],
  rfq_vendor_recap:          ["admin_personal"],
  revision_fallback:         ["vendor"],
  customer_rejection:        ["admin_personal"],
  op_confirm_submitted:      ["admin_personal"],
  customer_rfq_response:     ["admin_personal"],
  invoice_issued:            ["admin_personal", "admin_group", "customer"],
};

const RECIPIENT_META: Record<RecipientKey, { label: string; icon: string }> = {
  admin_personal: { label: "Admin Pribadi", icon: "👤" },
  admin_group:    { label: "Grup Admin",    icon: "👥" },
  customer:       { label: "Customer",      icon: "🛍️" },
  vendor:         { label: "Vendor",        icon: "🏭" },
};

const WORKFLOW_META: Record<WorkflowKey, { label: string; icon: string; desc: string }> = {
  order_new:                 { label: "Order Baru",             icon: "📦", desc: "Notifikasi saat order baru masuk dari customer portal" },
  vendor_request:            { label: "Vendor Request",         icon: "📋", desc: "Kirim mini form link ke vendor untuk pengisian penawaran" },
  vendor_submission:         { label: "Vendor Submit",          icon: "📩", desc: "Notifikasi admin saat vendor submit penawaran" },
  vendor_revision:           { label: "Revisi Penawaran",       icon: "↩️", desc: "Minta revisi harga ke vendor" },
  customer_approval:         { label: "Customer Approval",      icon: "✅", desc: "Kirim link persetujuan penawaran ke customer" },
  customer_approved:         { label: "Customer Approved",      icon: "🎉", desc: "Notifikasi admin saat customer menyetujui" },
  so_created:                { label: "SO Terkonfirmasi",       icon: "📑", desc: "Konfirmasi Sales Order ke customer" },
  op_request:                { label: "Op. Request",            icon: "⚙️", desc: "Kirim form konfirmasi operasional ke vendor" },
  driver_assigned:           { label: "Driver Ditugaskan",      icon: "🚚", desc: "Notifikasi customer saat driver ditugaskan" },
  shipment_update:           { label: "Update Shipment",        icon: "🚢", desc: "Update status pengiriman ke customer" },
  customs_update:            { label: "Update Kepabeanan",      icon: "🏛️", desc: "Update status bea cukai ke customer" },
  delivery_completed:        { label: "Pengiriman Selesai",     icon: "🏁", desc: "Notifikasi penyelesaian pengiriman" },
  product_order_new:         { label: "Pesanan Produk Baru",    icon: "🛒", desc: "Notifikasi saat order produk baru masuk dari customer portal" },
  product_order_status_update: { label: "Update Status Produk", icon: "📦", desc: "Notifikasi saat admin mengubah status order produk" },
  invoice_issued:            { label: "Invoice Diterbitkan",    icon: "🧾", desc: "Notifikasi ke customer dan admin saat invoice diterbitkan dari modul Accounting" },
  vendor_submit_confirm:     { label: "Konfirmasi Vendor",      icon: "✉️", desc: "Notifikasi balik ke vendor setelah mereka submit form penawaran" },
  vendor_rfq_forward:        { label: "RFQ Forward ke Vendor",  icon: "📤", desc: "Notifikasi ke vendor saat admin forward RFQ beserta detail permintaan" },
  vendor_submission_summary: { label: "Ringkasan Penawaran",    icon: "📋", desc: "Ringkasan submission form vendor yang dikirim ke admin" },
  rfq_vendor_recap:          { label: "Rekap Penawaran RFQ",    icon: "🔔", desc: "Rekap semua penawaran vendor untuk satu RFQ, dikirim ke admin" },
  revision_fallback:         { label: "Revisi Penawaran Vendor",icon: "↩️", desc: "Pesan fallback ke vendor saat admin minta revisi tanpa data order" },
  customer_rejection:        { label: "Customer Tolak",         icon: "❌", desc: "Notifikasi admin saat customer menolak penawaran" },
  op_confirm_submitted:      { label: "Data Ops Masuk",         icon: "🚚", desc: "Notifikasi admin saat vendor submit data operasional" },
  customer_rfq_response:     { label: "Respons Customer RFQ",   icon: "💬", desc: "Notifikasi admin saat customer setuju/tolak/minta revisi penawaran RFQ" },
};

const VAR_GROUPS: Array<{ label: string; color: string; vars: string[]; onlyWorkflows?: WorkflowKey[] }> = [
  { label: "Dasar",    color: "bg-slate-100 text-slate-700 border-slate-300",   vars: ["orderNumber","tanggal","jam","timestamp"] },
  { label: "Order",    color: "bg-blue-50 text-blue-700 border-blue-200",       vars: ["serviceType","shipmentType","route","commodity","cargoDescription","grossWeightDisplay","volumeDisplay","jumlahKoliDisplay","requiredDate","totalEst","serviceList","notes"] },
  { label: "Customer", color: "bg-green-50 text-green-700 border-green-200",    vars: ["customerName","customerDisplay","customerPhone","email","phone"] },
  { label: "Vendor",   color: "bg-purple-50 text-purple-700 border-purple-200", vars: ["vendorName","vendorPhone"] },
  { label: "Harga",    color: "bg-amber-50 text-amber-700 border-amber-200",    vars: ["vendorPrice","sellingPrice","currency","margin"] },
  { label: "Link",     color: "bg-indigo-50 text-indigo-700 border-indigo-200", vars: ["vendorMiniFormLink","customerApprovalLink","operationalFormLink","adminActionUrl","responseUrl"] },
  { label: "🛒 Produk", color: "bg-emerald-50 text-emerald-700 border-emerald-200", vars: ["itemList","shippingAddress","grandTotal","orderUrl","vendorFormUrl"], onlyWorkflows: ["product_order_new"] },
  { label: "🚛 Trk",   color: "bg-orange-50 text-orange-700 border-orange-200", vars: ["driverName","driverPhone","plateNumber","vehicleType"] },
  { label: "🚢 Sea",   color: "bg-cyan-50 text-cyan-700 border-cyan-200",       vars: ["vessel","voyage","containerNumber","blNumber"] },
  { label: "✈️ Air",   color: "bg-sky-50 text-sky-700 border-sky-200",          vars: ["airline","awbNumber","flightNumber"] },
  { label: "🏛️ PPJ",  color: "bg-rose-50 text-rose-700 border-rose-200",       vars: ["ajuNumber","bcType","sppbNumber"] },
  { label: "🛒 Prd",  color: "bg-teal-50 text-teal-700 border-teal-200",       vars: ["itemList","grandTotal","shippingAddress","orderUrl","vendorFormUrl","statusLabel"] },
  { label: "🧾 Invoice", color: "bg-violet-50 text-violet-700 border-violet-200", vars: ["invNumber","subtotalDisplay","taxAmountDisplay","taxRate","grandTotal","dueStr","invoiceUrl"], onlyWorkflows: ["invoice_issued"] },
];

const COND_BLOCKS = [
  { label: "Trucking",    icon: "🚛", cond: "trucking",    hint: "Muncul hanya jika service type = trucking" },
  { label: "Sea Freight", icon: "🚢", cond: "freight_sea", hint: "Muncul hanya jika service type = sea freight" },
  { label: "Air Freight", icon: "✈️", cond: "freight_air", hint: "Muncul hanya jika service type = air freight" },
  { label: "PPJK",        icon: "🏛️", cond: "ppjk",        hint: "Muncul hanya jika service type = PPJK" },
  { label: "Product",     icon: "📦", cond: "product",     hint: "Muncul hanya jika service type = product" },
];

const SAMPLE_DATA: Record<string, Record<string, string>> = {
  "": {
    orderNumber: "CST/2025/000123", tanggal: "25 Mei 2025", jam: "09:00", timestamp: "25 Mei 2025 09:00",
    serviceType: "[service type]", shipmentType: "Import", route: "Shanghai → Jakarta", commodity: "Electronics",
    cargoDescription: "Electronic components", grossWeightDisplay: "500 kg", volumeDisplay: "2.5 CBM",
    jumlahKoliDisplay: "10 koli", requiredDate: "30 Mei 2025", totalEst: "15.000.000",
    serviceList: "- Sea Freight\n- Customs Clearance", notes: "Handle with care",
    customerName: "PT. Maju Sejahtera", customerDisplay: "PT. Maju Sejahtera", customerPhone: "6281234567890",
    email: "info@majusejahtera.com", phone: "6281234567890",
    vendorName: "PT. Trans Cepat", vendorPhone: "6289876543210",
    vendorPrice: "Rp 12.000.000", sellingPrice: "Rp 15.000.000", currency: "IDR", margin: "Rp 3.000.000",
    vendorMiniFormLink: "https://cst.app/vendor-form/xxxxx",
    customerApprovalLink: "https://cst.app/approval/yyyyy",
    operationalFormLink: "https://cst.app/op-confirm/zzzzz",
    adminActionUrl: "https://cst.app/admin/action/aaaaa",
    responseUrl: "https://cst.app/vendor-response/bbbbb",
    driverName: "Budi Santoso", driverPhone: "6287654321098", plateNumber: "B 1234 XYZ", vehicleType: "Truk CDD",
    vessel: "MV Ever Given", voyage: "V.025E", containerNumber: "MSCU1234567", blNumber: "MSCUA123456",
    airline: "Garuda Indonesia", awbNumber: "126-12345678", flightNumber: "GA-888",
    ajuNumber: "090100-2025-000123", bcType: "BC 2.0", sppbNumber: "SPPB-2025-000456",
  },
  trucking:    { serviceType: "Trucking",    shipmentType: "Domestik", route: "Jakarta → Surabaya", driverName: "Budi Santoso", driverPhone: "6287654321098", plateNumber: "B 1234 XYZ", vehicleType: "Truk CDD" },
  freight_sea: { serviceType: "Sea Freight", shipmentType: "Import",   route: "Shanghai → Jakarta", vessel: "MV Ever Given", voyage: "V.025E", containerNumber: "MSCU1234567", blNumber: "MSCUA123456" },
  freight_air: { serviceType: "Air Freight", shipmentType: "Export",   route: "Jakarta → Singapore", airline: "Garuda Indonesia", awbNumber: "126-12345678", flightNumber: "GA-888" },
  ppjk:        { serviceType: "PPJK",        shipmentType: "Import",   ajuNumber: "090100-2025-000123", bcType: "BC 2.0", sppbNumber: "SPPB-2025-000456" },
  product:     { serviceType: "Product", shipmentType: "Domestik", itemList: "- Baju Kaos (2 pcs) @ Rp 150.000\n- Celana Panjang (1 pcs) @ Rp 250.000", grandTotal: "550.000", shippingAddress: "Jl. Merdeka No. 10, Jakarta Pusat", orderUrl: "https://cst.app/bizportal/product-orders/123", vendorFormUrl: "https://cst.app/vendor-form/product/123", statusLabel: "Sedang Diproses" },
  product_order_new: { orderNumber: "PRD-260526-12345", customerName: "PT. Maju Sejahtera", email: "info@majusejahtera.com", phone: "6281234567890", shippingAddress: "Jl. Sudirman No. 45, Jakarta Pusat", itemList: "• Green Bean Arabica × 50 (kg) — Rp 5.000.000\n• Kopi Robusta × 30 (kg) — Rp 2.400.000", grandTotal: "7.400.000", notes: "Kirim sebelum jam 12", orderUrl: "https://cst.app/bizportal/logistics/portal-orders", vendorFormUrl: "https://cst.app/vendor-product-approval/PRD-260526-12345?t=xxxxx", timestamp: "26 Mei 2026, 09:00 WIB" },
  invoice_issued: { orderNumber: "CST/2026/000123", invNumber: "INV/2026/000045", customerName: "PT. Maju Sejahtera", subtotalDisplay: "Rp 14.545.455", taxAmountDisplay: "Rp 1.454.545", taxRate: "11%", grandTotal: "Rp 16.000.000", dueStr: "30 Jun 2026", invoiceUrl: "https://cst.app/invoice/INV-2026-000045", timestamp: "1 Jun 2026, 10:00 WIB" },
};

function renderWaPreview(body: string, svcType: ServiceTypeSim, workflow?: WorkflowKey): string {
  let result = body.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, cond, content: string) =>
    svcType ? (cond === svcType ? content : "") : `‹${cond.toUpperCase()}›${content.trim()}‹/${cond.toUpperCase()}›`
  );
  const base = SAMPLE_DATA[""] ?? {};
  const svc  = svcType ? (SAMPLE_DATA[svcType] ?? {}) : {};
  const wf   = workflow ? (SAMPLE_DATA[workflow] ?? {}) : {};
  const data  = { ...base, ...svc, ...wf };
  result = result.replace(/\{\{(\w+)\}\}/g, (_m, k) => data[k] ?? `{{${k}}}`);
  const lines = result.split("\n").filter(line => !line.includes("{{") || line.trim() === "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export default function WaTemplatesPage() {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [recipient, setRecipient] = useState<RecipientKey>("admin_group");
  const [workflow, setWorkflow] = useState<WorkflowKey>("order_new");
  const [simSvc, setSimSvc] = useState<ServiceTypeSim>("");

  const cfgKey = (r: RecipientKey, w: WorkflowKey) => `${r}__${w}`;
  const validRecipients = WORKFLOW_VALID_RECIPIENTS[workflow] ?? (Object.keys(RECIPIENT_META) as RecipientKey[]);
  const effectiveRecipient = validRecipients.includes(recipient) ? recipient : validRecipients[0]!;
  const currentBody = configs[cfgKey(effectiveRecipient, workflow)] ?? "";
  const isSaved = savedKeys.has(cfgKey(effectiveRecipient, workflow));
  const visibleVarGroups = VAR_GROUPS.filter(g => !g.onlyWorkflows || g.onlyWorkflows.includes(workflow));
  const preview = renderWaPreview(currentBody, simSvc, workflow);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/wa-template-configs", { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as { configs: Record<string, string>; savedKeys: string[] };
          setConfigs(data.configs ?? {});
          setSavedKeys(new Set(data.savedKeys ?? []));
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const setBody = (body: string) =>
    setConfigs(prev => ({ ...prev, [cfgKey(effectiveRecipient, workflow)]: body }));

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    if (!el) { setBody(currentBody + text); return; }
    const s = el.selectionStart, e = el.selectionEnd;
    const next = currentBody.slice(0, s) + text + currentBody.slice(e);
    setBody(next);
    setTimeout(() => { el.selectionStart = el.selectionEnd = s + text.length; el.focus(); }, 0);
  }

  async function handleSave() {
    const bodyToSave = configs[cfgKey(effectiveRecipient, workflow)] ?? "";
    if (!bodyToSave.trim()) {
      toast({ title: "Template kosong", description: "Tulis isi template dulu, atau klik 'Reset ke Default' untuk mengembalikan template bawaan.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/wa-template-configs", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ recipient: effectiveRecipient, workflow, body: bodyToSave }),
      });
      if (!res.ok) {
        const err = await res.json().catch(async () => ({ message: await res.text() }));
        throw new Error((err as { message?: string }).message ?? "Gagal menyimpan");
      }
      setSavedKeys(prev => new Set([...prev, cfgKey(effectiveRecipient, workflow)]));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: "Template tersimpan ✅" });
    } catch (e) {
      toast({ title: "Gagal menyimpan", description: String(e), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch(`/api/settings/wa-template-configs/${effectiveRecipient}/${workflow}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const key = cfgKey(effectiveRecipient, workflow);
      setSavedKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
      const refetch = await fetch("/api/settings/wa-template-configs", { credentials: "include" });
      if (refetch.ok) {
        const data = await refetch.json() as { configs: Record<string, string>; savedKeys: string[] };
        setConfigs(data.configs ?? {});
        setSavedKeys(new Set(data.savedKeys ?? []));
      }
      toast({ title: "Template direset ke default" });
    } catch (e) {
      toast({ title: "Gagal reset", description: String(e), variant: "destructive" });
    } finally { setResetting(false); }
  }

  const totalCustomized = savedKeys.size;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* ── Header ── */}
        <div className="flex items-start gap-4">
          <Link href="/settings">
            <button type="button" className="mt-1 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <MessageCircle className="h-6 w-6 text-green-500" />
                WA Template Manager
              </h1>
              {totalCustomized > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-900/20">
                  {totalCustomized} dikustomisasi
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Edit template pesan WhatsApp per workflow dan penerima. Gunakan{" "}
              <code className="bg-muted px-1 rounded text-xs">{"{{variabel}}"}</code> untuk data dinamis dan{" "}
              <code className="bg-muted px-1 rounded text-xs">{"{{#if trucking}}...{{/if}}"}</code> untuk blok kondisional.
              Baris dengan variabel kosong dihilangkan otomatis saat pengiriman.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-muted rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">

            {/* ── Left: Editor ── */}
            <div className="space-y-4">

              {/* Recipient Tabs */}
              <Tabs value={effectiveRecipient} onValueChange={v => setRecipient(v as RecipientKey)}>
                <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50">
                  {(Object.keys(RECIPIENT_META) as RecipientKey[]).map(k => {
                    const disabled = !validRecipients.includes(k);
                    const customCount = (Object.keys(WORKFLOW_META) as WorkflowKey[]).filter(w => savedKeys.has(cfgKey(k, w))).length;
                    return (
                      <TabsTrigger key={k} value={k} disabled={disabled} className={`gap-1.5 ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                        <span>{RECIPIENT_META[k].icon}</span>
                        {RECIPIENT_META[k].label}
                        {customCount > 0 && !disabled && (
                          <span className="text-[9px] font-bold bg-amber-400/30 text-amber-700 dark:text-amber-400 rounded-full px-1.5 py-0.5 ml-0.5">
                            {customCount}
                          </span>
                        )}
                        {disabled && <span className="text-[9px] ml-0.5 text-muted-foreground">(N/A)</span>}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>

              {/* Workflow Selector */}
              <Card className="bg-card border-border">
                <CardContent className="pt-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pilih Workflow Stage:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(WORKFLOW_META) as WorkflowKey[]).map(w => {
                      const m = WORKFLOW_META[w];
                      const isActive = w === workflow;
                      const hasSaved = savedKeys.has(cfgKey(effectiveRecipient, w));
                      const recipientsForW = WORKFLOW_VALID_RECIPIENTS[w] ?? (Object.keys(RECIPIENT_META) as RecipientKey[]);
                      const applicable = recipientsForW.includes(effectiveRecipient);
                      return (
                        <button
                          key={w}
                          type="button"
                          title={applicable ? m.desc : `Workflow ini tidak berlaku untuk ${RECIPIENT_META[effectiveRecipient].label}`}
                          onClick={() => applicable && setWorkflow(w)}
                          className={`text-xs px-2.5 py-1.5 rounded-full border transition-all flex items-center gap-1 ${
                            !applicable
                              ? "opacity-30 cursor-not-allowed bg-muted text-muted-foreground border-border"
                              : isActive
                              ? "bg-primary text-primary-foreground border-primary shadow-sm"
                              : "bg-muted hover:bg-accent text-muted-foreground border-border hover:text-foreground"
                          }`}
                        >
                          <span>{m.icon}</span>
                          {m.label}
                          {hasSaved && !isActive && applicable && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Editor Card */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{WORKFLOW_META[workflow].icon}</span>
                      <div>
                        <CardTitle className="text-base">{WORKFLOW_META[workflow].label}</CardTitle>
                        <CardDescription className="text-xs mt-0.5">{WORKFLOW_META[workflow].desc}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {RECIPIENT_META[effectiveRecipient].icon} {RECIPIENT_META[effectiveRecipient].label}
                      </span>
                      {isSaved ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-[10px]">
                          ● Dikustomisasi
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-[10px]">
                          ○ Default
                        </Badge>
                      )}
                    </div>
                  </div>
                  {workflow === "product_order_new" && (
                    <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800 rounded px-2 py-1 mt-2">
                      🛒 Workflow ini hanya berlaku untuk <strong>Admin Pribadi</strong>, <strong>Grup Admin</strong>, dan <strong>Customer</strong>.
                    </p>
                  )}
                  {workflow === "invoice_issued" && (
                    <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-800 rounded px-2 py-1 mt-2">
                      🧾 Dikirim saat admin menerbitkan invoice dari modul <strong>Accounting</strong>. Berlaku untuk <strong>Admin Pribadi</strong> (notif internal) dan <strong>Customer</strong> (pesan ke nomor WA customer). Variabel khusus tersedia di panel kanan.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Textarea */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                      ✏️ Edit Template
                      <span className="font-normal">(klik variabel di panel kanan untuk insert ke posisi kursor)</span>
                    </p>
                    <Textarea
                      ref={textareaRef}
                      className={`font-mono text-xs min-h-[320px] resize-y leading-relaxed ${!currentBody.trim() ? "border-amber-400 focus:border-amber-500" : "border-primary/40 focus:border-primary"}`}
                      value={currentBody}
                      onChange={e => setBody(e.target.value)}
                      placeholder={`Template kosong — tulis pesan untuk workflow "${WORKFLOW_META[workflow].label}" penerima "${RECIPIENT_META[effectiveRecipient].label}"…`}
                      spellCheck={false}
                    />
                    <div className="flex items-center justify-between">
                      {!currentBody.trim() ? (
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          ⚠️ Template kosong — menggunakan pesan default bawaan sistem saat notifikasi dikirim.
                        </p>
                      ) : (
                        <span />
                      )}
                      <p className="text-xs text-muted-foreground">{currentBody.length} karakter</p>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview Real-time</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Simulasi service:</span>
                        <select
                          className="text-xs border rounded px-2 py-1 bg-background text-foreground"
                          value={simSvc}
                          onChange={e => setSimSvc(e.target.value as ServiceTypeSim)}
                        >
                          <option value="">— Tampilkan semua blok —</option>
                          <option value="trucking">🚛 Trucking</option>
                          <option value="freight_sea">🚢 Sea Freight</option>
                          <option value="freight_air">✈️ Air Freight</option>
                          <option value="ppjk">🏛️ PPJK</option>
                          <option value="product">📦 Product</option>
                        </select>
                      </div>
                    </div>
                    <div className="font-mono text-xs bg-muted/40 border rounded-md p-3 whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">
                      {preview
                        ? preview.split(/(\{\{[^}]+\}\})/).map((part, i) =>
                            part.startsWith("{{")
                              ? <span key={i} className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 rounded px-0.5">{part}</span>
                              : part
                          )
                        : <span className="text-muted-foreground italic">Template kosong</span>}
                    </div>
                    {simSvc && (
                      <p className="text-xs text-muted-foreground">
                        Blok <code>{`{{#if ${simSvc}}}`}</code> ditampilkan · blok lainnya disembunyikan · variabel kosong dihapus otomatis
                      </p>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Button size="sm" className="gap-1.5 min-w-[90px]" disabled={saving} onClick={() => void handleSave()}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <CheckCircle className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                      {saving ? "Menyimpan…" : saved ? "Tersimpan!" : "Simpan"}
                    </Button>
                    {isSaved && (
                      <Button
                        size="sm" variant="outline" className="gap-1.5 text-muted-foreground"
                        disabled={resetting}
                        onClick={() => void handleReset()}
                      >
                        {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        Reset ke Default
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      Perubahan berlaku langsung tanpa restart server
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── Right: Variables Reference Panel ── */}
            <div className="space-y-4">
              <Card className="bg-card border-border sticky top-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Variabel & Blok Kondisional</CardTitle>
                  <CardDescription className="text-xs">Klik untuk insert ke posisi kursor di editor</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">

                  {/* Variable Groups */}
                  <div className="space-y-2.5">
                    {visibleVarGroups.map(g => (
                      <div key={g.label} className="space-y-1">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{g.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {g.vars.map(v => (
                            <button
                              key={v}
                              type="button"
                              className={`text-[10px] font-mono border rounded px-1.5 py-0.5 cursor-pointer transition-all hover:opacity-80 hover:scale-105 active:scale-95 ${g.color}`}
                              title={`Klik untuk insert {{${v}}}`}
                              onClick={() => insertAtCursor(`{{${v}}}`)}
                            >
                              {`{{${v}}}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-3 space-y-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Blok Kondisional</p>
                    <div className="space-y-1.5">
                      {COND_BLOCKS.map(b => (
                        <button
                          key={b.cond}
                          type="button"
                          title={b.hint}
                          className="w-full text-left text-xs border border-dashed rounded-md px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:border-primary/60 hover:bg-muted/50 transition-colors flex items-center gap-1.5"
                          onClick={() => insertAtCursor(`{{#if ${b.cond}}}\n\n{{/if}}`)}
                        >
                          <span>{b.icon}</span>
                          <code className="text-[10px]">{`{{#if ${b.cond}}}`}</code>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Konten di dalam blok hanya muncul jika service type cocok.
                    </p>
                  </div>

                  {/* Quick tips */}
                  <div className="border-t pt-3 space-y-1.5">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Tips</p>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>• Baris dengan variabel kosong otomatis dihapus</li>
                      <li>• Gunakan <code className="bg-muted px-0.5 rounded">*teks*</code> untuk bold di WA</li>
                      <li>• Gunakan <code className="bg-muted px-0.5 rounded">_teks_</code> untuk italic di WA</li>
                      <li>• Gunakan <code className="bg-muted px-0.5 rounded">`teks`</code> untuk monospace di WA</li>
                      <li>• Baris kosong antara section agar lebih mudah dibaca</li>
                      <li>• Reset akan mengembalikan ke template default sistem</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>

          </div>
        )}
      </div>
    </AppShell>
  );
}
