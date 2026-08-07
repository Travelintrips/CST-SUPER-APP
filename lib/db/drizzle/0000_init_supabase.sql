DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."user_role" AS ENUM('admin', 'ecommerce', 'trading', 'logistics', 'pos');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."order_status" AS ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipment_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."shipment_status" AS ENUM('pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."payment_method" AS ENUM('cash', 'debit', 'credit', 'qris', 'transfer');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_delivery_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."sales_delivery_status" AS ENUM('none', 'to_deliver', 'delivered');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_doc_kind' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."sales_doc_kind" AS ENUM('quote', 'order');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_doc_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."sales_doc_status" AS ENUM('draft', 'sent', 'confirmed', 'done', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_invoice_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."sales_invoice_status" AS ENUM('none', 'to_invoice', 'invoiced');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_payment_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."sales_payment_status" AS ENUM('unpaid', 'partial', 'paid');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_bill_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."purchase_bill_status" AS ENUM('none', 'to_bill', 'billed');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_doc_kind' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."purchase_doc_kind" AS ENUM('rfq', 'order');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_doc_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."purchase_doc_status" AS ENUM('draft', 'sent', 'confirmed', 'done', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_payment_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."purchase_payment_status" AS ENUM('unpaid', 'partial', 'paid');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_receive_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."purchase_receive_status" AS ENUM('none', 'to_receive', 'received');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_provider' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."payment_provider" AS ENUM('paylabs');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_ref_kind' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."payment_ref_kind" AS ENUM('sales', 'purchase');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'expired', 'cancelled', 'failed');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'accounting_entry_source' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."accounting_entry_source" AS ENUM('manual', 'sales_invoice', 'purchase_bill', 'sales_payment', 'purchase_payment', 'pos_sale', 'ecommerce_order', 'stock_received', 'manual_payment');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'accounting_entry_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."accounting_entry_status" AS ENUM('draft', 'posted');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'accounting_payment_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."accounting_payment_status" AS ENUM('posted', 'voided');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'accounting_payment_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."accounting_payment_type" AS ENUM('inbound', 'outbound');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."journal_type" AS ENUM('sales', 'purchase', 'bank', 'cash', 'general');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_kind' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."tax_kind" AS ENUM('sale', 'purchase');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'correspondence_direction' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."correspondence_direction" AS ENUM('inbound', 'outbound');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'correspondence_kind' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."correspondence_kind" AS ENUM('email', 'whatsapp', 'letter', 'other');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'freight_quote_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."freight_quote_status" AS ENUM('pending', 'approved', 'rejected');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'freight_shipment_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."freight_shipment_status" AS ENUM('draft', 'rfq_sent', 'confirmed', 'in_transit', 'completed', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'freight_attachment_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."freight_attachment_type" AS ENUM('photo', 'document');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_job_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."driver_job_status" AS ENUM('ASSIGNED', 'ACCEPTED', 'ON_THE_WAY_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'DELIVERED', 'COMPLETED', 'CANCELLED');
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"first_name" text,
	"last_name" text,
	"profile_image_url" text,
	"role" "user_role" DEFAULT 'ecommerce' NOT NULL,
	"division" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "product_category_map" (
	"product_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	CONSTRAINT "product_category_map_product_id_category_id_pk" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"description" text,
	"image_url" text,
	"media_items" text DEFAULT '[]',
	"default_sales_tax_id" integer,
	"default_purchase_tax_id" integer,
	"item_type" text DEFAULT 'barang' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"unit_options" text DEFAULT '[]' NOT NULL,
	"subcategory" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(12, 2) NOT NULL,
	"items" text,
	"line_items" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"contact_email" text,
	"phone" text,
	"address" text,
	"tax_id" text,
	"default_purchase_tax_id" integer,
	"service_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"logo" text DEFAULT '📦' NOT NULL,
	"eta" text,
	"fee" numeric(12, 2) DEFAULT '0',
	"markup" numeric(5, 2) DEFAULT '0',
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_catalog_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"type" text DEFAULT 'service' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit" text,
	"price_base" numeric(15, 2) DEFAULT '0' NOT NULL,
	"markup_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_name" text NOT NULL,
	"sku" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"cost_price" numeric(12, 2) NOT NULL,
	"supplier_id" integer,
	"hs_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer,
	"tracking_number" text NOT NULL,
	"carrier" text NOT NULL,
	"status" "shipment_status" DEFAULT 'pending' NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"estimated_delivery" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_tracking_number_unique" UNIQUE("tracking_number")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"total_price" numeric(12, 2) NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"cashier_id" text,
	"document_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"tax_id" text,
	"address" text,
	"notes" text,
	"default_sales_tax_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_document_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"product_id" integer,
	"name" text NOT NULL,
	"description" text,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_number" text NOT NULL,
	"kind" "sales_doc_kind" DEFAULT 'quote' NOT NULL,
	"status" "sales_doc_status" DEFAULT 'draft' NOT NULL,
	"invoice_status" "sales_invoice_status" DEFAULT 'none' NOT NULL,
	"delivery_status" "sales_delivery_status" DEFAULT 'none' NOT NULL,
	"payment_status" "sales_payment_status" DEFAULT 'unpaid' NOT NULL,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"customer_id" integer,
	"customer_name" text NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_rate_id" integer,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"origin" text,
	"destination" text,
	"transport_mode" text,
	"etd" date,
	"eta" date,
	"valid_until" timestamp,
	"expected_date" timestamp,
	"notes" text,
	"payment_type" text,
	"confirmed_at" timestamp,
	"created_by_id" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"ai_source_correspondence_id" integer,
	"ai_source_wa_phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_documents_doc_number_unique" UNIQUE("doc_number")
);
--> statement-breakpoint
CREATE TABLE "purchase_document_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"product_id" integer,
	"name" text NOT NULL,
	"description" text,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_number" text NOT NULL,
	"kind" "purchase_doc_kind" DEFAULT 'rfq' NOT NULL,
	"status" "purchase_doc_status" DEFAULT 'draft' NOT NULL,
	"receive_status" "purchase_receive_status" DEFAULT 'none' NOT NULL,
	"bill_status" "purchase_bill_status" DEFAULT 'none' NOT NULL,
	"payment_status" "purchase_payment_status" DEFAULT 'unpaid' NOT NULL,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"supplier_id" integer,
	"supplier_name" text NOT NULL,
	"supplier_address" text,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_rate_id" integer,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"expected_date" timestamp,
	"notes" text,
	"confirmed_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_documents_doc_number_unique" UNIQUE("doc_number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref_kind" "payment_ref_kind" NOT NULL,
	"ref_id" integer NOT NULL,
	"ref_doc_number" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"provider" "payment_provider" DEFAULT 'paylabs' NOT NULL,
	"provider_order_id" text,
	"provider_merchant_trade_no" text NOT NULL,
	"payment_url" text,
	"raw" jsonb,
	"expired_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_merchant_trade_no_unique" UNIQUE("provider_merchant_trade_no")
);
--> statement-breakpoint
CREATE TABLE "accounting_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_number" text NOT NULL,
	"journal_id" integer NOT NULL,
	"date" date NOT NULL,
	"ref" text,
	"description" text,
	"payment_method" text,
	"status" "accounting_entry_status" DEFAULT 'posted' NOT NULL,
	"source" "accounting_entry_source" DEFAULT 'manual' NOT NULL,
	"source_id" integer,
	"total_debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_entries_entry_number_unique" UNIQUE("entry_number")
);
--> statement-breakpoint
CREATE TABLE "accounting_entry_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"description" text,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_journals" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "journal_type" NOT NULL,
	"default_debit_account_id" integer,
	"default_credit_account_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_journals_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "accounting_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_type" "accounting_payment_type" NOT NULL,
	"status" "accounting_payment_status" DEFAULT 'posted' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"journal_id" integer NOT NULL,
	"partner_name" text,
	"date" date NOT NULL,
	"ref" text,
	"memo" text,
	"payment_method" text,
	"entry_id" integer,
	"void_entry_id" integer,
	"source_type" text,
	"source_doc_id" integer,
	"void_reason" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"ar_account_id" integer,
	"ap_account_id" integer,
	"sales_income_account_id" integer,
	"purchase_expense_account_id" integer,
	"default_bank_account_id" integer,
	"ppn_output_account_id" integer,
	"ppn_input_account_id" integer,
	"sales_journal_id" integer,
	"purchase_journal_id" integer,
	"bank_journal_id" integer,
	"cash_journal_id" integer,
	"default_sales_tax_id" integer,
	"default_purchase_tax_id" integer,
	"default_cash_account_id" integer,
	"inventory_account_id" integer,
	"cogs_account_id" integer,
	"company_name" text,
	"company_address" text,
	"company_npwp" text,
	"company_logo_url" text,
	"meta" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_taxes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(6, 3) NOT NULL,
	"kind" "tax_kind" NOT NULL,
	"account_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"parent_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chart_of_accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "correspondence_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondence_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"object_path" text NOT NULL,
	"mime_type" text,
	"extracted_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correspondences" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "correspondence_kind" DEFAULT 'email' NOT NULL,
	"direction" "correspondence_direction" DEFAULT 'inbound' NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"extracted_text" text,
	"sender_name" text,
	"sender_email" text,
	"receiver_name" text,
	"receiver_email" text,
	"cc_email" text,
	"status" text DEFAULT 'new' NOT NULL,
	"linked_doc_type" text,
	"linked_doc_id" integer,
	"customer_id" integer,
	"supplier_id" integer,
	"tags" text,
	"attachments" text,
	"email_message_id" text,
	"email_thread_id" text,
	"corresponded_at" timestamp DEFAULT now() NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"shipment_id" integer NOT NULL,
	"vendor_name" text NOT NULL,
	"trucking_cost" numeric(14, 2) DEFAULT '0',
	"handling_cost" numeric(14, 2) DEFAULT '0',
	"freight_cost" numeric(14, 2) DEFAULT '0',
	"other_cost" numeric(14, 2) DEFAULT '0',
	"total_cost" numeric(14, 2) DEFAULT '0',
	"estimated_days" integer,
	"notes" text,
	"status" "freight_quote_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_rfqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_number" text NOT NULL,
	"shipment_id" integer NOT NULL,
	"vendor_names" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "freight_rfqs_rfq_number_unique" UNIQUE("rfq_number")
);
--> statement-breakpoint
CREATE TABLE "freight_shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_number" text NOT NULL,
	"shipper_name" text NOT NULL,
	"shipper_address" text,
	"consignee_name" text NOT NULL,
	"consignee_address" text,
	"commodity" text NOT NULL,
	"gross_weight" numeric(12, 3),
	"net_weight" numeric(12, 3),
	"quantity" integer,
	"packing_type" text,
	"dimensions" text,
	"hs_code" text,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"port_of_loading" text,
	"port_of_discharge" text,
	"vessel" text,
	"voyage" text,
	"notify_party" text,
	"marks_and_numbers" text,
	"measurement" text,
	"status" "freight_shipment_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"actual_cost" numeric(14, 2),
	"departure_date" date,
	"arrival_date" date,
	"tracking_number" text,
	"awb_number" text,
	"transport_mode" text,
	"cargo_type" text,
	"container_no" text,
	"sales_doc_id" integer,
	"purchase_doc_id" integer,
	"approved_vendor_name" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "freight_shipments_shipment_number_unique" UNIQUE("shipment_number")
);
--> statement-breakpoint
CREATE TABLE "freight_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"object_path" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"file_type" "freight_attachment_type" NOT NULL,
	"label" text,
	"uploaded_by_id" text,
	"doc_type" text,
	"doc_number" text,
	"doc_date" date,
	"doc_status" text,
	"invoice_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"stage_type" text NOT NULL,
	"vendor_name" text,
	"date" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_response_times" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"path" text NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_id" integer NOT NULL,
	"object_path" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"expense_account_id" integer,
	"payable_account_id" integer,
	"requires_attachment" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_number" text NOT NULL,
	"date" date NOT NULL,
	"vendor_employee" text,
	"expense_type" text DEFAULT 'vendor_bill' NOT NULL,
	"sales_doc_id" integer,
	"shipment_id" integer,
	"category_id" integer,
	"description" text,
	"qty" numeric(14, 4) DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_rate_id" integer,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"entry_id" integer,
	"expense_account_id" integer,
	"payable_account_id" integer,
	"rejection_reason" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_expense_number_unique" UNIQUE("expense_number")
);
--> statement-breakpoint
CREATE TABLE "email_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_correspondence_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"mime_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_correspondences" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_message_id" text,
	"from_email" text,
	"to_email" text,
	"cc_email" text,
	"subject" text DEFAULT '' NOT NULL,
	"body" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"validated_by" text,
	"validated_at" timestamp,
	"ai_processed" boolean DEFAULT false NOT NULL,
	"ai_skip_reason" text,
	"linked_sales_doc_id" integer,
	"in_reply_to" text,
	"email_role" text DEFAULT 'inquiry',
	"thread_sales_doc_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_correspondences_email_message_id_unique" UNIQUE("email_message_id")
);
--> statement-breakpoint
CREATE TABLE "email_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_correspondence_id" integer NOT NULL,
	"linked_type" text NOT NULL,
	"linked_id" integer NOT NULL,
	"link_reason" text,
	"is_validated" boolean DEFAULT false NOT NULL,
	"validated_by" text,
	"validated_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_customs_docs" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"doc_type" text NOT NULL,
	"nomor_aju" text,
	"nomor_dokumen" text,
	"tanggal_dokumen" date,
	"data" jsonb DEFAULT '{}'::jsonb,
	"scan_source" text DEFAULT 'manual',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_content" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_content_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "portal_customer_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"phone" text,
	"company" text,
	"role" text DEFAULT 'customer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reset_password_token" text,
	"reset_password_expiry" timestamp,
	CONSTRAINT "portal_customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "logistic_order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" serial NOT NULL,
	"category" text NOT NULL,
	"service_name" text NOT NULL,
	"calculator_type" text NOT NULL,
	"input_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calculation_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistic_order_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"vendor_id" integer NOT NULL,
	"vendor_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"estimated_pickup" text,
	"estimated_delivery" text,
	"estimated_days" integer,
	"vendor_notes" text,
	"markup_type" text DEFAULT 'percentage' NOT NULL,
	"markup_percentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"fixed_selling_price" numeric(14, 2),
	"selling_price" numeric(14, 2),
	"quote_status" text DEFAULT 'pending' NOT NULL,
	"reply_source" text DEFAULT 'manual' NOT NULL,
	"reply_timestamp" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistic_order_rfqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"rfq_number" text NOT NULL,
	"vendor_ids" integer[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "logistic_order_rfqs_rfq_number_unique" UNIQUE("rfq_number")
);
--> statement-breakpoint
CREATE TABLE "logistic_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"company_name" text NOT NULL,
	"customer_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"shipment_type" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"commodity" text,
	"cargo_description" text,
	"gross_weight" numeric(12, 3),
	"volume_cbm" numeric(12, 3),
	"jumlah_koli" integer,
	"required_date" text,
	"notes" text,
	"payment_type" text,
	"payment_method" text,
	"nama_penerima" text,
	"nomor_penerima" text,
	"jam_order" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"ai_session_token" text,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'New Order' NOT NULL,
	"approved_quote_id" integer,
	"admin_approval_status" text DEFAULT 'pending',
	"approved_at" timestamp,
	"approved_vendor_id" integer,
	"final_selling_price" numeric(14, 2),
	"quotation_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "logistic_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"phone" text,
	"license_number" text,
	"vehicle_plate" text,
	"vehicle_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"current_lat" numeric(10, 7),
	"current_lng" numeric(10, 7),
	"last_location_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "driver_job_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_job_id" integer NOT NULL,
	"status" "driver_job_status" NOT NULL,
	"note" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"freight_shipment_id" integer,
	"logistic_order_id" integer,
	"job_number" text NOT NULL,
	"customer_name" text,
	"pickup_address" text,
	"delivery_address" text,
	"cargo_description" text,
	"vehicle_type" text,
	"truck_plate" text,
	"pickup_date_time" timestamp,
	"delivery_date_time" timestamp,
	"special_instruction" text,
	"weight" text,
	"distance" text,
	"status" "driver_job_status" DEFAULT 'ASSIGNED' NOT NULL,
	"notes" text,
	"pod_receiver_name" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "driver_jobs_job_number_unique" UNIQUE("job_number")
);
--> statement-breakpoint
CREATE TABLE "driver_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_job_id" integer NOT NULL,
	"url" text NOT NULL,
	"photo_type" text DEFAULT 'general' NOT NULL,
	"taken_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agent_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_token" text NOT NULL,
	"logistic_order_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_chat_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "wa_ai_intake_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"sender_name" text,
	"status" text NOT NULL,
	"skip_reason" text,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_product_order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer,
	"product_name" text NOT NULL,
	"product_sku" text,
	"unit" text,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_product_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"shipping_address" text NOT NULL,
	"notes" text,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'New Order' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_product_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
ALTER TABLE "product_category_map" ADD CONSTRAINT "product_category_map_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_category_map" ADD CONSTRAINT "product_category_map_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_catalog_items" ADD CONSTRAINT "vendor_catalog_items_vendor_id_suppliers_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_document_id_sales_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sales_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_document_id_purchase_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."purchase_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_document_lines" ADD CONSTRAINT "purchase_document_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_journal_id_accounting_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."accounting_journals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_entry_id_accounting_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."accounting_entries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_entry_lines" ADD CONSTRAINT "accounting_entry_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_default_debit_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("default_debit_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_default_credit_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("default_credit_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD CONSTRAINT "accounting_payments_journal_id_accounting_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."accounting_journals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD CONSTRAINT "accounting_payments_entry_id_accounting_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."accounting_entries"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD CONSTRAINT "accounting_payments_void_entry_id_accounting_entries_id_fk" FOREIGN KEY ("void_entry_id") REFERENCES "public"."accounting_entries"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_ar_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("ar_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_ap_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("ap_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_sales_income_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("sales_income_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_purchase_expense_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("purchase_expense_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_default_bank_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("default_bank_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_ppn_output_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("ppn_output_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_ppn_input_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("ppn_input_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_sales_journal_id_accounting_journals_id_fk" FOREIGN KEY ("sales_journal_id") REFERENCES "public"."accounting_journals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_purchase_journal_id_accounting_journals_id_fk" FOREIGN KEY ("purchase_journal_id") REFERENCES "public"."accounting_journals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_bank_journal_id_accounting_journals_id_fk" FOREIGN KEY ("bank_journal_id") REFERENCES "public"."accounting_journals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_cash_journal_id_accounting_journals_id_fk" FOREIGN KEY ("cash_journal_id") REFERENCES "public"."accounting_journals"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_default_sales_tax_id_accounting_taxes_id_fk" FOREIGN KEY ("default_sales_tax_id") REFERENCES "public"."accounting_taxes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_default_purchase_tax_id_accounting_taxes_id_fk" FOREIGN KEY ("default_purchase_tax_id") REFERENCES "public"."accounting_taxes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_default_cash_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("default_cash_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_inventory_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("inventory_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_cogs_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("cogs_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_taxes" ADD CONSTRAINT "accounting_taxes_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "freight_quotes" ADD CONSTRAINT "freight_quotes_rfq_id_freight_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."freight_rfqs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "freight_rfqs" ADD CONSTRAINT "freight_rfqs_shipment_id_freight_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."freight_shipments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD CONSTRAINT "freight_shipments_sales_doc_id_sales_documents_id_fk" FOREIGN KEY ("sales_doc_id") REFERENCES "public"."sales_documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD CONSTRAINT "freight_shipments_purchase_doc_id_purchase_documents_id_fk" FOREIGN KEY ("purchase_doc_id") REFERENCES "public"."purchase_documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "freight_attachments" ADD CONSTRAINT "freight_attachments_shipment_id_freight_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."freight_shipments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_expense_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_payable_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("payable_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tax_rate_id_accounting_taxes_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."accounting_taxes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_expense_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payable_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("payable_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "freight_customs_docs" ADD CONSTRAINT "freight_customs_docs_shipment_id_freight_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."freight_shipments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistic_order_items" ADD CONSTRAINT "logistic_order_items_order_id_logistic_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."logistic_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistic_order_quotes" ADD CONSTRAINT "logistic_order_quotes_rfq_id_logistic_order_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."logistic_order_rfqs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistic_order_quotes" ADD CONSTRAINT "logistic_order_quotes_order_id_logistic_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."logistic_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistic_order_quotes" ADD CONSTRAINT "logistic_order_quotes_vendor_id_suppliers_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistic_order_rfqs" ADD CONSTRAINT "logistic_order_rfqs_order_id_logistic_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."logistic_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD CONSTRAINT "logistic_orders_approved_vendor_id_suppliers_id_fk" FOREIGN KEY ("approved_vendor_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "driver_job_logs" ADD CONSTRAINT "driver_job_logs_driver_job_id_driver_jobs_id_fk" FOREIGN KEY ("driver_job_id") REFERENCES "public"."driver_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "driver_jobs" ADD CONSTRAINT "driver_jobs_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "driver_jobs" ADD CONSTRAINT "driver_jobs_freight_shipment_id_freight_shipments_id_fk" FOREIGN KEY ("freight_shipment_id") REFERENCES "public"."freight_shipments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "driver_jobs" ADD CONSTRAINT "driver_jobs_logistic_order_id_logistic_orders_id_fk" FOREIGN KEY ("logistic_order_id") REFERENCES "public"."logistic_orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "driver_photos" ADD CONSTRAINT "driver_photos_driver_job_id_driver_jobs_id_fk" FOREIGN KEY ("driver_job_id") REFERENCES "public"."driver_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_session_id_ai_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_logistic_order_id_logistic_orders_id_fk" FOREIGN KEY ("logistic_order_id") REFERENCES "public"."logistic_orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_product_order_items" ADD CONSTRAINT "portal_product_order_items_order_id_portal_product_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."portal_product_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_product_order_items" ADD CONSTRAINT "portal_product_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");
--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_entries_source_uniq" ON "accounting_entries" USING btree ("source","source_id") WHERE "accounting_entries"."source" <> 'manual' AND "accounting_entries"."source_id" IS NOT NULL;
