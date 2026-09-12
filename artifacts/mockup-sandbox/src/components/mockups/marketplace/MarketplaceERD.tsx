import { useRef, useEffect, useState } from "react";

type TableDef = {
  id: string;
  name: string;
  isNew: boolean;
  fields: { name: string; type: "pk" | "fk" | "field" | "internal" }[];
};

type Edge = {
  from: string;
  to: string;
  label?: string;
  fromPort?: "top" | "bottom" | "left" | "right";
  toPort?: "top" | "bottom" | "left" | "right";
};

const TABLES: TableDef[] = [
  // ── Existing ERP ──────────────────────────────────────────────
  {
    id: "companies",
    name: "companies",
    isNew: false,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "name", type: "field" },
    ],
  },
  {
    id: "suppliers",
    name: "suppliers",
    isNew: false,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "name", type: "field" },
      { name: "contact_email", type: "field" },
    ],
  },
  {
    id: "vendor_catalog_items",
    name: "vendor_catalog_items",
    isNew: false,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "vendor_id (FK)", type: "fk" },
      { name: "name", type: "field" },
      { name: "price_sell", type: "field" },
    ],
  },
  {
    id: "accounting_taxes",
    name: "accounting_taxes",
    isNew: false,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "name", type: "field" },
      { name: "rate", type: "field" },
    ],
  },
  {
    id: "sales_documents",
    name: "sales_documents",
    isNew: false,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "doc_number", type: "field" },
      { name: "kind", type: "field" },
      { name: "status", type: "field" },
    ],
  },
  {
    id: "purchase_documents",
    name: "purchase_documents",
    isNew: false,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "doc_number", type: "field" },
      { name: "mkt_purchase_order_id (FK) ★", type: "fk" },
    ],
  },
  {
    id: "accounting_entries",
    name: "accounting_entries",
    isNew: false,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "source = 'marketplace_commission'", type: "field" },
      { name: "source_id = mkt_po.id", type: "fk" },
    ],
  },
  // ── New P0 tables ──────────────────────────────────────────────
  {
    id: "mkt_rfqs",
    name: "mkt_rfqs",
    isNew: true,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "rfq_number (UNIQUE)", type: "field" },
      { name: "company_id (FK)", type: "fk" },
      { name: "catalog_vendor_id (FK)", type: "fk" },
      { name: "buyer_email", type: "field" },
      { name: "status", type: "field" },
      { name: "guest_token (UNIQUE)", type: "field" },
      { name: "email_verified", type: "field" },
      { name: "line_count", type: "field" },
      { name: "quote_count", type: "field" },
    ],
  },
  {
    id: "mkt_rfq_lines",
    name: "mkt_rfq_lines",
    isNew: true,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "rfq_id (FK)", type: "fk" },
      { name: "vendor_catalog_item_id (FK)", type: "fk" },
      { name: "item_name", type: "field" },
      { name: "requested_qty", type: "field" },
    ],
  },
  {
    id: "mkt_vendor_quotes",
    name: "mkt_vendor_quotes",
    isNew: true,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "rfq_id (FK)", type: "fk" },
      { name: "vendor_id (FK)", type: "fk" },
      { name: "token (UNIQUE)", type: "field" },
      { name: "status", type: "field" },
      { name: "commission_rate 🔒", type: "internal" },
      { name: "commission_amount 🔒", type: "internal" },
      { name: "net_vendor_amount 🔒", type: "internal" },
      { name: "rank_score 🔒", type: "internal" },
      { name: "commission_tax_id (FK)", type: "fk" },
    ],
  },
  {
    id: "mkt_vendor_quote_lines",
    name: "mkt_vendor_quote_lines",
    isNew: true,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "quote_id (FK)", type: "fk" },
      { name: "rfq_line_id (FK)", type: "fk" },
      { name: "offered_unit_price", type: "field" },
      { name: "offered_qty", type: "field" },
      { name: "stock_status", type: "field" },
    ],
  },
  {
    id: "mkt_purchase_orders",
    name: "mkt_purchase_orders",
    isNew: true,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "po_number (UNIQUE)", type: "field" },
      { name: "rfq_id (FK)", type: "fk" },
      { name: "quote_id (FK)", type: "fk" },
      { name: "vendor_id (FK)", type: "fk" },
      { name: "company_id (FK)", type: "fk" },
      { name: "status", type: "field" },
      { name: "sales_document_id (FK)", type: "fk" },
      { name: "accounting_posted_at", type: "field" },
    ],
  },
  {
    id: "mkt_rfq_guest_claims",
    name: "mkt_rfq_guest_claims",
    isNew: true,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "rfq_id (FK)", type: "fk" },
      { name: "guest_email", type: "field" },
      { name: "guest_token", type: "field" },
      { name: "claim_status", type: "field" },
      { name: "expires_at", type: "field" },
    ],
  },
  {
    id: "mkt_activity_logs",
    name: "mkt_activity_logs",
    isNew: true,
    fields: [
      { name: "id (PK)", type: "pk" },
      { name: "rfq_id", type: "fk" },
      { name: "entity_type", type: "field" },
      { name: "entity_id", type: "field" },
      { name: "actor_type", type: "field" },
      { name: "action", type: "field" },
    ],
  },
];

// Layout positions [col, row] → rendered as x/y
const POSITIONS: Record<string, { x: number; y: number }> = {
  // Row 0 — Existing ERP (top)
  companies:             { x: 20,   y: 20  },
  suppliers:             { x: 220,  y: 20  },
  vendor_catalog_items:  { x: 460,  y: 20  },
  accounting_taxes:      { x: 1240, y: 20  },

  // Row 1 — Core RFQ tables
  mkt_rfqs:              { x: 20,   y: 260 },
  mkt_rfq_guest_claims:  { x: 300,  y: 420 },
  mkt_vendor_quotes:     { x: 840,  y: 260 },

  // Row 2 — Line tables
  mkt_rfq_lines:         { x: 20,   y: 560 },
  mkt_vendor_quote_lines:{ x: 840,  y: 560 },

  // Row 3 — Purchase + Activity + Accounting
  mkt_purchase_orders:   { x: 400,  y: 700 },
  mkt_activity_logs:     { x: 1130, y: 560 },

  // Row 4 — Existing ERP (bottom)
  sales_documents:       { x: 400,  y: 920 },
  purchase_documents:    { x: 700,  y: 920 },
  accounting_entries:    { x: 980,  y: 920 },
};

const EDGES: Edge[] = [
  // mkt_rfqs → existing
  { from: "mkt_rfqs", to: "companies",             label: "company_id" },
  { from: "mkt_rfqs", to: "suppliers",              label: "catalog_vendor_id" },

  // mkt_rfq_lines → parents
  { from: "mkt_rfq_lines", to: "mkt_rfqs",          label: "rfq_id" },
  { from: "mkt_rfq_lines", to: "vendor_catalog_items", label: "vendor_catalog_item_id" },

  // mkt_rfq_guest_claims → mkt_rfqs
  { from: "mkt_rfq_guest_claims", to: "mkt_rfqs",   label: "rfq_id" },

  // mkt_vendor_quotes → parents
  { from: "mkt_vendor_quotes", to: "mkt_rfqs",       label: "rfq_id" },
  { from: "mkt_vendor_quotes", to: "suppliers",       label: "vendor_id" },
  { from: "mkt_vendor_quotes", to: "accounting_taxes",label: "commission_tax_id" },

  // mkt_vendor_quote_lines → parents
  { from: "mkt_vendor_quote_lines", to: "mkt_vendor_quotes", label: "quote_id" },
  { from: "mkt_vendor_quote_lines", to: "mkt_rfq_lines",      label: "rfq_line_id" },

  // mkt_purchase_orders → parents
  { from: "mkt_purchase_orders", to: "mkt_rfqs",        label: "rfq_id" },
  { from: "mkt_purchase_orders", to: "mkt_vendor_quotes",label: "quote_id" },
  { from: "mkt_purchase_orders", to: "suppliers",        label: "vendor_id" },
  { from: "mkt_purchase_orders", to: "companies",        label: "company_id" },
  { from: "mkt_purchase_orders", to: "sales_documents",  label: "sales_document_id" },

  // Existing extended
  { from: "purchase_documents",  to: "mkt_purchase_orders", label: "mkt_purchase_order_id ★" },
  { from: "accounting_entries",  to: "mkt_purchase_orders", label: "source_id" },

  // activity logs
  { from: "mkt_activity_logs",   to: "mkt_rfqs",            label: "rfq_id" },
];

const TABLE_W = 196;

function tableHeight(t: TableDef) {
  return 32 + t.fields.length * 22 + 8;
}

function portXY(
  tableId: string,
  port: "top" | "bottom" | "left" | "right" | undefined,
  tableMap: Map<string, TableDef>
) {
  const pos = POSITIONS[tableId];
  const t = tableMap.get(tableId)!;
  const h = tableHeight(t);
  const cx = pos.x + TABLE_W / 2;
  const cy = pos.y + h / 2;
  switch (port) {
    case "top":    return { x: cx, y: pos.y };
    case "bottom": return { x: cx, y: pos.y + h };
    case "left":   return { x: pos.x, y: cy };
    case "right":  return { x: pos.x + TABLE_W, y: cy };
    default: {
      // auto-pick nearest edge
      return { x: cx, y: cy };
    }
  }
}

function autoPort(
  fromId: string,
  toId: string
): { fp: "top" | "bottom" | "left" | "right"; tp: "top" | "bottom" | "left" | "right" } {
  const fp = POSITIONS[fromId];
  const tp = POSITIONS[toId];
  const dx = tp.x - fp.x;
  const dy = tp.y - fp.y;
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy > 0
      ? { fp: "bottom", tp: "top" }
      : { fp: "top",    tp: "bottom" };
  }
  return dx > 0
    ? { fp: "right", tp: "left" }
    : { fp: "left",  tp: "right" };
}

export default function MarketplaceERD() {
  const tableMap = new Map<string, TableDef>(TABLES.map((t) => [t.id, t]));

  // Compute SVG canvas size
  const maxX = Math.max(...Object.values(POSITIONS).map((p) => p.x)) + TABLE_W + 40;
  const maxY = Math.max(...Object.values(POSITIONS).map((p) => {
    const tid = Object.keys(POSITIONS).find(k => POSITIONS[k] === p)!;
    const t = tableMap.get(tid);
    return p.y + (t ? tableHeight(t) : 200);
  })) + 60;

  return (
    <div className="bg-slate-950 min-h-screen p-4 overflow-auto">
      {/* Header */}
      <div className="mb-4 flex items-center gap-6 flex-wrap">
        <h1 className="text-white text-xl font-bold tracking-tight">
          Enterprise Marketplace — ERD
        </h1>
        <span className="text-slate-400 text-sm">Blueprint v1.2 · 7 tabel P0</span>
        <div className="flex items-center gap-4 ml-auto text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-orange-500 inline-block" />
            <span className="text-slate-300">Tabel Baru P0</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-slate-600 inline-block" />
            <span className="text-slate-300">Existing ERP (Reuse)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-red-400">🔒</span>
            <span className="text-slate-300">Internal Only</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-yellow-400">★</span>
            <span className="text-slate-300">ADD COLUMN</span>
          </span>
        </div>
      </div>

      {/* SVG Diagram */}
      <div className="relative" style={{ width: maxX, height: maxY }}>
        <svg
          width={maxX}
          height={maxY}
          className="absolute inset-0"
          style={{ overflow: "visible" }}
        >
          <defs>
            <marker id="arrow-new" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#f97316" />
            </marker>
            <marker id="arrow-ext" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#64748b" />
            </marker>
            <marker id="arrow-add" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#fbbf24" />
            </marker>
          </defs>

          {EDGES.map((edge, i) => {
            const fromT = tableMap.get(edge.from);
            const toT = tableMap.get(edge.to);
            if (!fromT || !toT) return null;

            const { fp, tp } = autoPort(edge.from, edge.to);
            const fromPos = POSITIONS[edge.from];
            const toPos = POSITIONS[edge.to];
            const fh = tableHeight(fromT);
            const th = tableHeight(toT);

            let fx = fromPos.x + TABLE_W / 2;
            let fy = fromPos.y + fh / 2;
            let tx = toPos.x + TABLE_W / 2;
            let ty = toPos.y + th / 2;

            if (fp === "bottom") fy = fromPos.y + fh;
            if (fp === "top")    fy = fromPos.y;
            if (fp === "left")   fx = fromPos.x;
            if (fp === "right")  fx = fromPos.x + TABLE_W;

            if (tp === "bottom") ty = toPos.y + th;
            if (tp === "top")    ty = toPos.y;
            if (tp === "left")   tx = toPos.x;
            if (tp === "right")  tx = toPos.x + TABLE_W;

            // cubic bezier
            const dx = tx - fx;
            const dy = ty - fy;
            const cx1 = fp === "left" || fp === "right" ? fx + dx * 0.4 : fx;
            const cy1 = fp === "top"  || fp === "bottom" ? fy + dy * 0.4 : fy;
            const cx2 = tp === "left" || tp === "right" ? tx - dx * 0.4 : tx;
            const cy2 = tp === "top"  || tp === "bottom" ? ty - dy * 0.4 : ty;

            const isAddCol = edge.label?.includes("★");
            const isNew = fromT.isNew && toT.isNew;
            const stroke = isAddCol ? "#fbbf24" : isNew ? "#f97316" : "#64748b";
            const marker = isAddCol ? "url(#arrow-add)" : isNew ? "url(#arrow-new)" : "url(#arrow-ext)";

            const midX = (fx + tx) / 2;
            const midY = (fy + ty) / 2;

            return (
              <g key={i}>
                <path
                  d={`M${fx},${fy} C${cx1},${cy1} ${cx2},${cy2} ${tx},${ty}`}
                  stroke={stroke}
                  strokeWidth={isAddCol ? 2 : 1.5}
                  strokeDasharray={isAddCol ? "5,3" : undefined}
                  fill="none"
                  markerEnd={marker}
                  opacity={0.7}
                />
                {edge.label && (
                  <text
                    x={midX}
                    y={midY - 4}
                    fill={isAddCol ? "#fbbf24" : isNew ? "#fb923c" : "#94a3b8"}
                    fontSize={9}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Table boxes */}
        {TABLES.map((table) => {
          const pos = POSITIONS[table.id];
          if (!pos) return null;
          const h = tableHeight(table);

          return (
            <div
              key={table.id}
              className="absolute rounded-lg overflow-hidden border shadow-lg"
              style={{
                left: pos.x,
                top: pos.y,
                width: TABLE_W,
                borderColor: table.isNew ? "#f97316" : "#475569",
                boxShadow: table.isNew
                  ? "0 0 12px rgba(249,115,22,0.25)"
                  : "0 2px 8px rgba(0,0,0,0.4)",
              }}
            >
              {/* Header */}
              <div
                className="px-2 py-1.5 flex items-center gap-1.5"
                style={{
                  background: table.isNew
                    ? "linear-gradient(135deg, #ea580c, #c2410c)"
                    : "linear-gradient(135deg, #334155, #1e293b)",
                }}
              >
                {table.isNew && (
                  <span className="text-orange-200 text-xs font-bold bg-orange-900/50 px-1 rounded text-[9px] leading-none py-0.5">
                    NEW
                  </span>
                )}
                <span className="text-white text-xs font-mono font-semibold truncate">
                  {table.name}
                </span>
              </div>

              {/* Fields */}
              <div className="bg-slate-900 divide-y divide-slate-800">
                {table.fields.map((f, fi) => (
                  <div
                    key={fi}
                    className="px-2 py-0.5 flex items-center gap-1"
                    style={{ minHeight: 22 }}
                  >
                    {f.type === "pk" && (
                      <span className="text-yellow-400 text-[9px] font-bold leading-none shrink-0">🔑</span>
                    )}
                    {f.type === "fk" && (
                      <span className="text-blue-400 text-[9px] font-bold leading-none shrink-0">⬡</span>
                    )}
                    {f.type === "internal" && (
                      <span className="text-red-400 text-[9px] leading-none shrink-0">🔒</span>
                    )}
                    {f.type === "field" && (
                      <span className="w-2 shrink-0" />
                    )}
                    <span
                      className="text-[10px] font-mono truncate"
                      style={{
                        color: f.type === "pk" ? "#fde047"
                          : f.type === "fk" ? "#93c5fd"
                          : f.type === "internal" ? "#fca5a5"
                          : "#cbd5e1",
                      }}
                    >
                      {f.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <div className="mt-6 text-slate-500 text-xs flex gap-6 flex-wrap">
        <span>⬡ = Foreign Key</span>
        <span>🔑 = Primary Key</span>
        <span>🔒 = Internal Only — tidak pernah expose ke vendor/buyer API</span>
        <span>★ = ADD COLUMN ke tabel existing (nullable)</span>
        <span>Garis putus-putus = kolom baru di tabel lama</span>
      </div>
    </div>
  );
}
