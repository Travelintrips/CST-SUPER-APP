import {
  pgTable,
  serial,
  text,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const waIncomingMessagesTable = pgTable("wa_incoming_messages", {
  id: serial("id").primaryKey(),
  sender: text("sender").notNull(),
  senderName: text("sender_name"),
  message: text("message").notNull(),
  deviceId: text("device_id"),
  messageType: text("message_type").default("text"),
  isRead: boolean("is_read").default(false).notNull(),
  repliedAt: timestamp("replied_at"),
  replyMessage: text("reply_message"),
  rawPayload: jsonb("raw_payload"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
