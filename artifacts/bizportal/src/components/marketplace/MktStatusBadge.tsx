import { Badge } from "@/components/ui/badge";

// ── RFQ Status ────────────────────────────────────────────────────────────────
const RFQ_STATUS: Record<string, { label: string; cls: string }> = {
  draft:      { label: "Draft",      cls: "bg-slate-100 text-slate-700 border-slate-300" },
  submitted:  { label: "Submitted",  cls: "bg-blue-100 text-blue-700 border-blue-300" },
  quoting:    { label: "Quoting",    cls: "bg-amber-100 text-amber-700 border-amber-300" },
  quoted:     { label: "Quoted",     cls: "bg-cyan-100 text-cyan-700 border-cyan-300" },
  awarded:    { label: "Awarded",    cls: "bg-green-100 text-green-700 border-green-300" },
  cancelled:  { label: "Cancelled",  cls: "bg-red-100 text-red-700 border-red-300" },
};

const APPROVAL_STATUS: Record<string, { label: string; cls: string }> = {
  none:     { label: "—",               cls: "bg-slate-100 text-slate-500 border-slate-200" },
  pending:  { label: "⏳ Pending",      cls: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  approved: { label: "✅ Approved",     cls: "bg-green-100 text-green-700 border-green-300" },
  rejected: { label: "❌ Rejected",     cls: "bg-red-100 text-red-700 border-red-300" },
};

const REQUOTE_STATUS: Record<string, { label: string; cls: string }> = {
  requote_requested: { label: "🔁 Requote Requested", cls: "bg-orange-100 text-orange-700 border-orange-300" },
  submitted:         { label: "✅ Submitted",          cls: "bg-green-100 text-green-700 border-green-300" },
  selected:          { label: "🏆 Selected",           cls: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  rejected:          { label: "❌ Rejected",           cls: "bg-red-100 text-red-700 border-red-300" },
  expired:           { label: "⏰ Expired",            cls: "bg-slate-100 text-slate-600 border-slate-300" },
  withdrawn:         { label: "↩ Withdrawn",           cls: "bg-slate-100 text-slate-600 border-slate-300" },
  invited:           { label: "📧 Invited",            cls: "bg-blue-100 text-blue-700 border-blue-300" },
  opened:            { label: "👁 Opened",             cls: "bg-indigo-100 text-indigo-700 border-indigo-300" },
};

// ── PO Status ─────────────────────────────────────────────────────────────────
const PO_STATUS: Record<string, { label: string; cls: string }> = {
  pending:              { label: "Pending",          cls: "bg-slate-100 text-slate-700 border-slate-300" },
  revision_requested:   { label: "Revisi",           cls: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  issued:               { label: "Issued",           cls: "bg-blue-100 text-blue-700 border-blue-300" },
  vendor_accepted: { label: "Vendor Accepted",  cls: "bg-indigo-100 text-indigo-700 border-indigo-300" },
  production:      { label: "Produksi",         cls: "bg-amber-100 text-amber-700 border-amber-300" },
  ready_to_ship:   { label: "Siap Kirim",       cls: "bg-cyan-100 text-cyan-700 border-cyan-300" },
  in_transit:      { label: "Dalam Perjalanan", cls: "bg-orange-100 text-orange-700 border-orange-300" },
  delivered:       { label: "Terkirim",         cls: "bg-teal-100 text-teal-700 border-teal-300" },
  vendor_rejected:     { label: "Vendor Tolak",       cls: "bg-red-100 text-red-700 border-red-300" },
  partially_delivered: { label: "Sebagian Diterima",  cls: "bg-amber-100 text-amber-700 border-amber-300" },
  rejected_goods:      { label: "Barang Ditolak",     cls: "bg-rose-100 text-rose-700 border-rose-300" },
  completed:           { label: "Selesai",             cls: "bg-green-100 text-green-700 border-green-300" },
  closed:              { label: "Closed",              cls: "bg-slate-200 text-slate-600 border-slate-400" },
  cancelled:           { label: "Dibatalkan",          cls: "bg-red-100 text-red-700 border-red-300" },
};

// ── Shipment Status ───────────────────────────────────────────────────────────
const SHIPMENT_STATUS: Record<string, { label: string; cls: string }> = {
  pending:     { label: "Pending",           cls: "bg-slate-100 text-slate-700 border-slate-300" },
  dispatched:  { label: "Dispatched",        cls: "bg-blue-100 text-blue-700 border-blue-300" },
  in_transit:  { label: "Dalam Perjalanan",  cls: "bg-orange-100 text-orange-700 border-orange-300" },
  delivered:   { label: "Terkirim",          cls: "bg-green-100 text-green-700 border-green-300" },
  cancelled:   { label: "Dibatalkan",        cls: "bg-red-100 text-red-700 border-red-300" },
};

// ── Goods Receipt Type ────────────────────────────────────────────────────────
const GOODS_RECEIPT_TYPE: Record<string, { label: string; cls: string }> = {
  full:     { label: "✅ Full",     cls: "bg-green-100 text-green-700 border-green-300" },
  partial:  { label: "⚠ Partial",  cls: "bg-amber-100 text-amber-700 border-amber-300" },
  rejected: { label: "❌ Rejected", cls: "bg-red-100 text-red-700 border-red-300" },
};

// ── Inspection Status ─────────────────────────────────────────────────────────
const INSPECTION_STATUS: Record<string, { label: string; cls: string }> = {
  pending:  { label: "⏳ Pending", cls: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  passed:   { label: "✅ Passed",  cls: "bg-green-100 text-green-700 border-green-300" },
  failed:   { label: "❌ Failed",  cls: "bg-red-100 text-red-700 border-red-300" },
  partial:  { label: "⚠ Partial", cls: "bg-amber-100 text-amber-700 border-amber-300" },
};

// ── Exports ───────────────────────────────────────────────────────────────────
export function RfqStatusBadge({ status }: { status: string }) {
  const s = RFQ_STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <Badge variant="outline" className={`text-xs font-medium ${s.cls}`}>{s.label}</Badge>;
}

export function ApprovalStatusBadge({ status }: { status: string }) {
  const s = APPROVAL_STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <Badge variant="outline" className={`text-xs font-medium ${s.cls}`}>{s.label}</Badge>;
}

export function QuoteStatusBadge({ status }: { status: string }) {
  const s = REQUOTE_STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <Badge variant="outline" className={`text-xs font-medium ${s.cls}`}>{s.label}</Badge>;
}

export function PoStatusBadge({ status }: { status: string }) {
  const s = PO_STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <Badge variant="outline" className={`text-xs font-medium ${s.cls}`}>{s.label}</Badge>;
}

export function ShipmentStatusBadge({ status }: { status: string }) {
  const s = SHIPMENT_STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <Badge variant="outline" className={`text-xs font-medium ${s.cls}`}>{s.label}</Badge>;
}

export function GoodsReceiptBadge({ type }: { type: string }) {
  const s = GOODS_RECEIPT_TYPE[type] ?? { label: type, cls: "bg-slate-100 text-slate-600" };
  return <Badge variant="outline" className={`text-xs font-medium ${s.cls}`}>{s.label}</Badge>;
}

export function InspectionStatusBadge({ status }: { status: string }) {
  const s = INSPECTION_STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <Badge variant="outline" className={`text-xs font-medium ${s.cls}`}>{s.label}</Badge>;
}
