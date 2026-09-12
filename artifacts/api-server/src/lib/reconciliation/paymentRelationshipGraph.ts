/**
 * Payment Relationship Graph — Batch 3 Phase 4
 *
 * Builds a traversable graph representing payment–invoice relationships.
 *
 * Supported topologies:
 *   1 mutation  → N invoices   (MULTI_INVOICE)
 *   N mutations → 1 invoice    (SPLIT_PAYMENT)
 *   N mutations → N invoices   (MANY_TO_MANY)
 *
 * Graph nodes:
 *   MUTATION  — bank_mutations row
 *   INVOICE   — sales_documents row (doc_type=invoice)
 *   GROUP     — payment_matching_groups row
 *
 * Graph edges: payment_allocations rows
 */

import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { db as DrizzleDb } from "@workspace/db";

// Lazy DB loader — graph builder is pure (no DB connection on import)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
async function getDb() {
  if (!_db) { _db = (await import("@workspace/db")).db; }
  return _db as typeof DrizzleDb;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type NodeType = "MUTATION" | "INVOICE" | "GROUP";

export interface GraphNode {
  nodeType: NodeType;
  id: number;
  ref: string;
  amount: number;
  status?: string;
  companyId?: number | null;
}

export interface GraphEdge {
  allocationId: number;
  fromNodeType: NodeType;
  fromId: number;
  toNodeType: NodeType;
  toId: number;
  allocatedAmount: number;
  strategy: string;
  sequence: number;
}

export interface PaymentGraph {
  groupType: string;
  groupId: number | null;
  companyId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalMutationAmount: number;
  totalInvoiceAmount: number;
  totalAllocated: number;
  remaining: number;
  summary: string;
}

// ─── Build graph from a mutation ─────────────────────────────────────────────

export async function buildGraphFromMutation(
  mutationId: number,
  companyId: number,
): Promise<PaymentGraph> {
  const db = await getDb();
  try {
    // Get all allocations for this mutation
    const { rows: allocRows } = await db.execute(sql.raw(`
      SELECT pa.id AS alloc_id, pa.invoice_id, pa.invoice_ref,
             pa.allocated_amount, pa.remaining_amount, pa.allocation_sequence,
             pa.strategy, pa.group_id
      FROM payment_allocations pa
      WHERE pa.mutation_id = ${mutationId}
        AND pa.company_id  = ${companyId}
        AND pa.is_active   = TRUE
      ORDER BY pa.allocation_sequence ASC
    `));

    // Get mutation details
    const { rows: mutRows } = await db.execute(sql.raw(`
      SELECT id, amount, description, mutation_key, status, transaction_date, company_id
      FROM bank_mutations WHERE id = ${mutationId} LIMIT 1
    `)).catch(() => ({ rows: [] as unknown[] }));

    const mut = (mutRows[0] as any) ?? {};
    const mutNode: GraphNode = {
      nodeType: "MUTATION",
      id: mutationId,
      ref: String(mut.mutation_key ?? `MUT-${mutationId}`),
      amount: Number(mut.amount ?? 0),
      status: String(mut.status ?? ""),
      companyId,
    };

    const nodes: GraphNode[] = [mutNode];
    const edges: GraphEdge[] = [];
    let totalAllocated = 0;
    let groupId: number | null = null;
    let groupType = "MULTI_INVOICE";

    const invoiceIds = new Set<number>();

    for (const alloc of allocRows as any[]) {
      const invoiceId = Number(alloc.invoice_id);
      const allocAmt = Number(alloc.allocated_amount);
      totalAllocated += allocAmt;

      if (alloc.group_id != null) groupId = Number(alloc.group_id);

      edges.push({
        allocationId: Number(alloc.alloc_id),
        fromNodeType: "MUTATION",
        fromId: mutationId,
        toNodeType: "INVOICE",
        toId: invoiceId,
        allocatedAmount: allocAmt,
        strategy: String(alloc.strategy ?? "MANUAL"),
        sequence: Number(alloc.allocation_sequence),
      });

      if (!invoiceIds.has(invoiceId)) {
        invoiceIds.add(invoiceId);
        // Fetch invoice details
        const { rows: invRows } = await db.execute(sql.raw(`
          SELECT id, doc_number, total_amount, status
          FROM sales_documents WHERE id = ${invoiceId} AND doc_type = 'invoice' LIMIT 1
        `)).catch(() => ({ rows: [] as unknown[] }));
        const inv = (invRows[0] as any) ?? {};
        nodes.push({
          nodeType: "INVOICE",
          id: invoiceId,
          ref: String(alloc.invoice_ref ?? inv.doc_number ?? `INV-${invoiceId}`),
          amount: Number(inv.total_amount ?? 0),
          status: String(inv.status ?? ""),
          companyId,
        });
      }
    }

    // Get group metadata
    let groupMeta: any = null;
    if (groupId) {
      const { rows: grpRows } = await db.execute(sql.raw(`
        SELECT group_type, total_invoice_amount, remaining_amount
        FROM payment_matching_groups WHERE id = ${groupId} LIMIT 1
      `)).catch(() => ({ rows: [] as unknown[] }));
      groupMeta = (grpRows[0] as any) ?? null;
      if (groupMeta) groupType = String(groupMeta.group_type ?? "MULTI_INVOICE");
    }

    const totalInvoiceAmount = nodes.filter(n => n.nodeType === "INVOICE").reduce((s, n) => s + n.amount, 0);
    const remaining = Math.max(0, mutNode.amount - totalAllocated);

    const invCount = invoiceIds.size;
    const summary = invCount === 0
      ? "Mutasi belum dialokasikan ke invoice manapun"
      : `Mutasi Rp ${mutNode.amount.toLocaleString("id")} → ${invCount} invoice (alokasi Rp ${totalAllocated.toLocaleString("id")})`;

    return { groupType, groupId, companyId, nodes, edges, totalMutationAmount: mutNode.amount, totalInvoiceAmount, totalAllocated, remaining, summary };
  } catch (e: any) {
    logger.warn({ err: e.message, mutationId }, "[paymentRelationshipGraph] buildGraphFromMutation failed");
    return emptyGraph(companyId);
  }
}

// ─── Build graph from an invoice ─────────────────────────────────────────────

export async function buildGraphFromInvoice(
  invoiceId: number,
  companyId: number,
): Promise<PaymentGraph> {
  const db = await getDb();
  try {
    // Get all allocations for this invoice
    const { rows: allocRows } = await db.execute(sql.raw(`
      SELECT pa.id AS alloc_id, pa.mutation_id, pa.invoice_ref,
             pa.allocated_amount, pa.remaining_amount, pa.allocation_sequence,
             pa.strategy, pa.group_id
      FROM payment_allocations pa
      WHERE pa.invoice_id = ${invoiceId}
        AND pa.company_id = ${companyId}
        AND pa.is_active  = TRUE
      ORDER BY pa.allocation_sequence ASC
    `));

    // Get invoice details
    const { rows: invRows } = await db.execute(sql.raw(`
      SELECT id, doc_number, total_amount, status
      FROM sales_documents WHERE id = ${invoiceId} AND doc_type = 'invoice' LIMIT 1
    `)).catch(() => ({ rows: [] as unknown[] }));

    const inv = (invRows[0] as any) ?? {};
    const invNode: GraphNode = {
      nodeType: "INVOICE",
      id: invoiceId,
      ref: String(inv.doc_number ?? `INV-${invoiceId}`),
      amount: Number(inv.total_amount ?? 0),
      status: String(inv.status ?? ""),
      companyId,
    };

    const nodes: GraphNode[] = [invNode];
    const edges: GraphEdge[] = [];
    let totalAllocated = 0;
    let groupId: number | null = null;
    let groupType = "SPLIT_PAYMENT";
    const mutationIds = new Set<number>();

    for (const alloc of allocRows as any[]) {
      const mutationId = Number(alloc.mutation_id);
      const allocAmt = Number(alloc.allocated_amount);
      totalAllocated += allocAmt;

      if (alloc.group_id != null) groupId = Number(alloc.group_id);

      edges.push({
        allocationId: Number(alloc.alloc_id),
        fromNodeType: "MUTATION",
        fromId: mutationId,
        toNodeType: "INVOICE",
        toId: invoiceId,
        allocatedAmount: allocAmt,
        strategy: String(alloc.strategy ?? "MANUAL"),
        sequence: Number(alloc.allocation_sequence),
      });

      if (!mutationIds.has(mutationId)) {
        mutationIds.add(mutationId);
        const { rows: mutRows } = await db.execute(sql.raw(`
          SELECT id, amount, mutation_key, status
          FROM bank_mutations WHERE id = ${mutationId} LIMIT 1
        `)).catch(() => ({ rows: [] as unknown[] }));
        const mut = (mutRows[0] as any) ?? {};
        nodes.push({
          nodeType: "MUTATION",
          id: mutationId,
          ref: String(mut.mutation_key ?? `MUT-${mutationId}`),
          amount: Number(mut.amount ?? 0),
          status: String(mut.status ?? ""),
          companyId,
        });
      }
    }

    if (groupId) {
      const { rows: grpRows } = await db.execute(sql.raw(`
        SELECT group_type FROM payment_matching_groups WHERE id = ${groupId} LIMIT 1
      `)).catch(() => ({ rows: [] as unknown[] }));
      const grp = (grpRows[0] as any) ?? null;
      if (grp) groupType = String(grp.group_type ?? "SPLIT_PAYMENT");
    }

    const totalMutationAmount = nodes.filter(n => n.nodeType === "MUTATION").reduce((s, n) => s + n.amount, 0);
    const remaining = Math.max(0, invNode.amount - totalAllocated);
    const mutCount = mutationIds.size;
    const summary = mutCount === 0
      ? `Invoice ${invNode.ref} belum ada pembayaran`
      : `Invoice ${invNode.ref} Rp ${invNode.amount.toLocaleString("id")} ← ${mutCount} transfer (terlunasi Rp ${totalAllocated.toLocaleString("id")}, sisa Rp ${remaining.toLocaleString("id")})`;

    return { groupType, groupId, companyId, nodes, edges, totalMutationAmount, totalInvoiceAmount: invNode.amount, totalAllocated, remaining, summary };
  } catch (e: any) {
    logger.warn({ err: e.message, invoiceId }, "[paymentRelationshipGraph] buildGraphFromInvoice failed");
    return emptyGraph(companyId);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyGraph(companyId: number): PaymentGraph {
  return {
    groupType: "UNKNOWN",
    groupId: null,
    companyId,
    nodes: [],
    edges: [],
    totalMutationAmount: 0,
    totalInvoiceAmount: 0,
    totalAllocated: 0,
    remaining: 0,
    summary: "Tidak ada data relasi pembayaran",
  };
}
