import { pgTable, serial, integer, text, numeric, timestamp, boolean } from "drizzle-orm/pg-core";

export const expenseApprovalLimitsTable = pgTable("expense_approval_limits", {
  id:                   serial("id").primaryKey(),
  companyId:            integer("company_id"),
  category:             text("category").notNull(), // kasbon | talangan | expense | bank_loan | vendor_installment
  userId:               text("user_id"), // NULL = berlaku global untuk kategori ini
  maxAutoApprove:       numeric("max_auto_approve", { precision: 14, scale: 2 }).notNull().default("0"),
  l1ApproverId:         text("l1_approver_id"),
  l2ApproverId:         text("l2_approver_id"),
  notes:                text("notes"),
  createdAt:            timestamp("created_at").defaultNow(),
  updatedAt:            timestamp("updated_at").defaultNow(),
});

export const expenseApprovalRequestsTable = pgTable("expense_approval_requests", {
  id:              serial("id").primaryKey(),
  companyId:       integer("company_id"),
  refType:         text("ref_type").notNull(), // kasbon | talangan | expense | bank_loan | vendor_installment
  refId:           integer("ref_id"),
  description:     text("description").notNull(),
  amount:          numeric("amount", { precision: 14, scale: 2 }).notNull(),
  requesterId:     text("requester_id"),
  requesterName:   text("requester_name"),
  status:          text("status").notNull().default("pending"), // pending | l1_approved | l2_approved | approved | rejected
  l1ApproverId:    text("l1_approver_id"),
  l1ApproverName:  text("l1_approver_name"),
  l1Status:        text("l1_status"), // pending | approved | rejected
  l1Notes:         text("l1_notes"),
  l1At:            timestamp("l1_at"),
  l2ApproverId:    text("l2_approver_id"),
  l2ApproverName:  text("l2_approver_name"),
  l2Status:        text("l2_status"), // pending | approved | rejected | skipped
  l2Notes:         text("l2_notes"),
  l2At:            timestamp("l2_at"),
  notes:           text("notes"),
  createdAt:       timestamp("created_at").defaultNow(),
  updatedAt:       timestamp("updated_at").defaultNow(),
});
