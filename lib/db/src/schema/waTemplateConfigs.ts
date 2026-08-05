
import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

import { companiesTable } from "./companies";

export const waTemplateConfigsTable = pgTable(
  "whatsapp_template_configs",
  {
    id: serial("id").primaryKey(),

    companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),

    recipient: text("recipient").notNull(),
    workflow: text("workflow").notNull(),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);
