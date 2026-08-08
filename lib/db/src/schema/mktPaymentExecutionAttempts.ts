import {
  integer,
  index,
  serial,
  text,
  timestamp,
  uniqueIndex,
  pgTable,
} from "drizzle-orm/pg-core";
import { paymentRequestsTable } from "./purchaseWorkflow";

export const mktPaymentExecutionAttemptsTable = pgTable("mkt_payment_execution_attempts", {
  id: serial("id").primaryKey(),
  paymentRequestId: integer("payment_request_id")
    .notNull()
    .references(() => paymentRequestsTable.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  failureCode: text("failure_code"),
  failureReason: text("failure_reason"),
  failedAt: timestamp("failed_at"),
  failedBy: text("failed_by"),
  providerReference: text("provider_reference"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mkt_payment_attempt_request_number_unique")
    .on(t.paymentRequestId, t.attemptNumber),
  uniqueIndex("mkt_payment_attempt_idempotency_unique")
    .on(t.idempotencyKey),
  index("mkt_payment_attempt_request_idx").on(t.paymentRequestId),
  index("mkt_payment_attempt_status_idx").on(t.status),
]);

export type MktPaymentExecutionAttempt =
  typeof mktPaymentExecutionAttemptsTable.$inferSelect;