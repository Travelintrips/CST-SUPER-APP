DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kasir_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."kasir_status" AS ENUM('pending', 'approved', 'rejected');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pos_order_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."pos_order_status" AS ENUM('open', 'paid', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pos_payment_method' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."pos_payment_method" AS ENUM('cash', 'qris', 'debit', 'credit', 'transfer');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pos_shift_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."pos_shift_status" AS ENUM('open', 'closed');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_damage_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."wh_damage_status" AS ENUM('draft', 'confirmed', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_damage_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."wh_damage_type" AS ENUM('rusak', 'hilang', 'expired', 'lainnya');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_movement_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."wh_movement_type" AS ENUM('po_receipt', 'so_delivery', 'pos_sale', 'transfer_in', 'transfer_out', 'opname_adjust', 'damage', 'return_in', 'return_out', 'manual_in', 'manual_out');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_return_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."wh_return_status" AS ENUM('draft', 'confirmed', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_return_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."wh_return_type" AS ENUM('purchase', 'sales');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wh_transfer_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."wh_transfer_status" AS ENUM('draft', 'in_transit', 'received', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inv_movement_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."inv_movement_type" AS ENUM('PURCHASE_RECEIPT', 'SALES_DELIVERY', 'POS_SALE', 'TRANSFER_IN', 'TRANSFER_OUT', 'RETURN_IN', 'RETURN_OUT', 'OPNAME_ADJUST', 'DAMAGE', 'MANUAL_IN', 'MANUAL_OUT');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inv_reference_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."inv_reference_type" AS ENUM('PURCHASE_ORDER', 'SALES_ORDER', 'POS_SESSION', 'TRANSFER', 'RETURN', 'OPNAME', 'MANUAL');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_type' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."warehouse_type" AS ENUM('CENTRAL', 'BRANCH', 'OUTLET');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gr_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."gr_status" AS ENUM('draft', 'confirmed', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lc_method' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."lc_method" AS ENUM('equal', 'by_quantity', 'by_amount', 'by_weight', 'by_volume');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pay_req_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."pay_req_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pr_return_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."pr_return_status" AS ENUM('draft', 'confirmed', 'done', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pr_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."pr_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'converted', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pw_approval_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."pw_approval_status" AS ENUM('pending', 'approved', 'rejected');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qc_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."qc_status" AS ENUM('pending', 'passed', 'failed', 'partial');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vi_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."vi_status" AS ENUM('draft', 'posted', 'matched', 'paid', 'cancelled');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vq_status' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."vq_status" AS ENUM('draft', 'submitted', 'selected', 'rejected');
  END IF;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."accounting_entry_source" ADD VALUE IF NOT EXISTS 'reversal';
--> statement-breakpoint
ALTER TYPE "public"."accounting_entry_source" ADD VALUE IF NOT EXISTS 'cogs_delivery';
--> statement-breakpoint
ALTER TYPE "public"."accounting_entry_source" ADD VALUE IF NOT EXISTS 'purchase_return';
--> statement-breakpoint
ALTER TYPE "public"."accounting_entry_source" ADD VALUE IF NOT EXISTS 'sales_return';
--> statement-breakpoint
ALTER TYPE "public"."accounting_entry_source" ADD VALUE IF NOT EXISTS 'opname_adjust';
--> statement-breakpoint
ALTER TYPE "public"."accounting_entry_source" ADD VALUE IF NOT EXISTS 'damage_adjust';
--> statement-breakpoint
ALTER TYPE "public"."accounting_entry_source" ADD VALUE IF NOT EXISTS 'grn_receipt';
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"company_code" text NOT NULL,
	"logo_url" text,
	"address" text,
	"phone" text,
	"email" text,
	"npwp" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"is_holding" boolean DEFAULT false NOT NULL,
	"parent_company_id" integer,
	CONSTRAINT "companies_company_code_unique" UNIQUE("company_code")
);
--> statement-breakpoint
CREATE TABLE "vendor_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer,
	"vendor_id" integer,
	"transport_mode" text,
	"offer_price" numeric(15, 2) DEFAULT '0' NOT NULL,
	"vehicle_year" integer,
	"carrier_name" text,
	"transit_days" integer,
	"notes" text,
	"is_selected_by_admin" boolean DEFAULT false NOT NULL,
	"final_customer_price" numeric(15, 2),
	"option_label" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"chosen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"order_id" integer,
	"vendor_name" text,
	"status" text NOT NULL,
	"estimated_pickup_time" text,
	"driver_name" text,
	"driver_phone" text,
	"plate_number" text,
	"vehicle_type" text,
	"notes" text,
	"unit_photo_url" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer,
	"transport_mode" text NOT NULL,
	"truck_type" text,
	"origin_keyword" text,
	"dest_keyword" text,
	"base_rate" numeric(15, 2) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'per_trip' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatbot_knowledge_base" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'umum' NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_reply_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" text,
	"order_id" integer,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"vendor_name" text,
	"vendor_phone" text,
	"service_type" text,
	"route" text,
	"vendor_price" numeric(14, 2),
	"markup_type" text DEFAULT 'percentage' NOT NULL,
	"markup_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"final_price" numeric(14, 2) NOT NULL,
	"pickup_date" text,
	"delivery_date" text,
	"notes" text,
	"status" text DEFAULT 'Ready' NOT NULL,
	"message_body" text NOT NULL,
	"fonnte_response" jsonb,
	"sent_status" text DEFAULT 'draft' NOT NULL,
	"sent_to_admin" boolean DEFAULT false,
	"sent_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_holding_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"holding_group_id" integer,
	"company_id" integer NOT NULL,
	"ownership_percentage" numeric(5, 2) DEFAULT '100.00',
	"consolidation_method" text DEFAULT 'full',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"holding_name" text NOT NULL,
	"holding_code" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holding_groups_holding_code_unique" UNIQUE("holding_code")
);
--> statement-breakpoint
CREATE TABLE "wa_incoming_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender" text NOT NULL,
	"sender_name" text,
	"message" text NOT NULL,
	"device_id" text,
	"message_type" text DEFAULT 'text',
	"is_read" boolean DEFAULT false NOT NULL,
	"replied_at" timestamp,
	"reply_message" text,
	"raw_payload" jsonb,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"whatsapp" text NOT NULL,
	"service" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"weight" text,
	"length" text,
	"width" text,
	"height" text,
	"incoterms" text,
	"insurance" boolean DEFAULT false,
	"express" boolean DEFAULT false,
	"estimated_total" numeric(14, 2),
	"estimated_cbm" numeric(10, 4),
	"estimated_chargeable_weight" numeric(10, 2),
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"handled_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer,
	"url" text NOT NULL,
	"object_path" text NOT NULL,
	"uploaded_by" text,
	"folder" text DEFAULT 'Umum' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"public_url" text
);
--> statement-breakpoint
CREATE TABLE "pos_branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"business_unit" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_cashiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"phone" text,
	"status" "kasir_status" DEFAULT 'pending' NOT NULL,
	"branch_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pos_cashiers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "pos_inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"min_stock" numeric(12, 3) DEFAULT '0' NOT NULL,
	"cost_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pos_inventory_items_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "pos_inventory_stocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"warehouse_id" integer,
	"rack_id" integer,
	"qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"product_name" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"order_number" text NOT NULL,
	"cashier_id" integer NOT NULL,
	"branch_id" integer,
	"status" "pos_order_status" DEFAULT 'open' NOT NULL,
	"payment_method" "pos_payment_method",
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(12, 2),
	"change" numeric(12, 2),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	CONSTRAINT "pos_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "pos_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"category" text DEFAULT 'minuman' NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"product_type" text DEFAULT 'STOCK' NOT NULL,
	"linked_product_id" integer,
	"stock" numeric(12, 3),
	"stock_unit" text DEFAULT 'pcs' NOT NULL,
	"stock_item_id" integer,
	"stock_usage_per_unit" numeric(12, 3),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_racks" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"warehouse_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_recipe_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"waste_pct" numeric(5, 2),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "pos_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"recipe_name" text,
	"yield_qty" numeric(12, 3) DEFAULT '1' NOT NULL,
	"yield_unit" text DEFAULT 'pcs' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pos_recipes_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE "pos_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"cashier_id" integer NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"opening_cash" numeric(12, 2) DEFAULT '0' NOT NULL,
	"closing_cash" numeric(12, 2),
	"total_sales" numeric(12, 2) DEFAULT '0' NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"status" "pos_shift_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_stock_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"stock_item_id" integer NOT NULL,
	"cashier_id" integer,
	"delta" numeric(12, 3) NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_stock_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"current_stock" numeric(12, 3) DEFAULT '0' NOT NULL,
	"min_stock" numeric(12, 3) DEFAULT '0' NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_stock_mutations" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"warehouse_id" integer,
	"rack_id" integer,
	"type" text NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"qty_before" numeric(12, 3) DEFAULT '0' NOT NULL,
	"qty_after" numeric(12, 3) DEFAULT '0' NOT NULL,
	"ref_type" text,
	"ref_id" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_stock_opname_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"opname_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"system_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"actual_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"diff_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "pos_stock_opnames" (
	"id" serial PRIMARY KEY NOT NULL,
	"opname_number" text NOT NULL,
	"branch_id" integer NOT NULL,
	"warehouse_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	CONSTRAINT "pos_stock_opnames_opname_number_unique" UNIQUE("opname_number")
);
--> statement-breakpoint
CREATE TABLE "pos_stock_transfer_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"from_warehouse_id" integer,
	"to_warehouse_id" integer
);
--> statement-breakpoint
CREATE TABLE "pos_stock_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_number" text NOT NULL,
	"from_branch_id" integer NOT NULL,
	"to_branch_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"received_at" timestamp,
	CONSTRAINT "pos_stock_transfers_transfer_number_unique" UNIQUE("transfer_number")
);
--> statement-breakpoint
CREATE TABLE "pos_warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"name" text NOT NULL,
	"branch_id" integer NOT NULL,
	"type" text DEFAULT 'umum' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_recipe_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"ingredient_product_id" integer NOT NULL,
	"qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "product_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"yield_qty" numeric(12, 3) DEFAULT '1' NOT NULL,
	"yield_unit" text DEFAULT 'pcs' NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_recipes_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
CREATE TABLE "wh_damage_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"rack_id" integer,
	"qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"damage_type" "wh_damage_type" DEFAULT 'rusak' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "wh_damage_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"report_number" text NOT NULL,
	"warehouse_id" integer NOT NULL,
	"status" "wh_damage_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by_id" text,
	"confirmed_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"cancelled_at" timestamp,
	CONSTRAINT "wh_damage_reports_report_number_unique" UNIQUE("report_number")
);
--> statement-breakpoint
CREATE TABLE "wh_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"product_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"rack_id" integer,
	"type" "wh_movement_type" NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"qty_before" numeric(14, 3) DEFAULT '0' NOT NULL,
	"qty_after" numeric(14, 3) DEFAULT '0' NOT NULL,
	"cost_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ref_type" text,
	"ref_id" integer,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wh_opname_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"opname_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"rack_id" integer,
	"system_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"actual_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"diff_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "wh_opnames" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"opname_number" text NOT NULL,
	"warehouse_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by_id" text,
	"confirmed_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	CONSTRAINT "wh_opnames_opname_number_unique" UNIQUE("opname_number")
);
--> statement-breakpoint
CREATE TABLE "wh_return_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"rack_id" integer,
	"qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "wh_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"return_number" text NOT NULL,
	"type" "wh_return_type" NOT NULL,
	"ref_doc_id" integer,
	"ref_doc_number" text,
	"warehouse_id" integer NOT NULL,
	"status" "wh_return_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"cancelled_at" timestamp,
	CONSTRAINT "wh_returns_return_number_unique" UNIQUE("return_number")
);
--> statement-breakpoint
CREATE TABLE "wh_stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"product_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"rack_id" integer,
	"qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"cost_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wh_transfer_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"from_rack_id" integer,
	"to_rack_id" integer,
	"qty_requested" numeric(14, 3) DEFAULT '0' NOT NULL,
	"qty_sent" numeric(14, 3) DEFAULT '0' NOT NULL,
	"qty_received" numeric(14, 3) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wh_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"transfer_number" text NOT NULL,
	"from_warehouse_id" integer NOT NULL,
	"to_warehouse_id" integer NOT NULL,
	"status" "wh_transfer_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"received_at" timestamp,
	"cancelled_at" timestamp,
	CONSTRAINT "wh_transfers_transfer_number_unique" UNIQUE("transfer_number")
);
--> statement-breakpoint
CREATE TABLE "inventory_stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"rack_id" integer,
	"stock_on_hand" numeric(14, 3) DEFAULT '0' NOT NULL,
	"stock_reserved" numeric(14, 3) DEFAULT '0' NOT NULL,
	"stock_available" numeric(14, 3) DEFAULT '0' NOT NULL,
	"minimum_stock" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"average_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_stock_product_warehouse_rack_unique" UNIQUE("product_id","warehouse_id","rack_id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"movement_no" text NOT NULL,
	"product_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"rack_id" integer,
	"movement_type" "inv_movement_type" NOT NULL,
	"reference_type" "inv_reference_type",
	"reference_id" integer,
	"qty_in" numeric(14, 3) DEFAULT '0' NOT NULL,
	"qty_out" numeric(14, 3) DEFAULT '0' NOT NULL,
	"balance_after" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_movement_no_unique" UNIQUE("movement_no")
);
--> statement-breakpoint
CREATE TABLE "warehouse_racks" (
	"id" serial PRIMARY KEY NOT NULL,
	"warehouse_id" integer NOT NULL,
	"rack_code" text NOT NULL,
	"rack_name" text NOT NULL,
	"zone" text,
	"qr_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "warehouse_racks_code_unique" UNIQUE("warehouse_id","rack_code")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"warehouse_code" text NOT NULL,
	"warehouse_name" text NOT NULL,
	"warehouse_type" "warehouse_type" DEFAULT 'BRANCH' NOT NULL,
	"branch_id" integer,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_warehouse_code_unique" UNIQUE("warehouse_code")
);
--> statement-breakpoint
CREATE TABLE "thai_tea_warehouse_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"pos_warehouse_id" integer NOT NULL,
	"erp_warehouse_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"gr_id" integer NOT NULL,
	"po_line_id" integer,
	"product_id" integer,
	"name" text NOT NULL,
	"qty_ordered" numeric(12, 3) DEFAULT '0' NOT NULL,
	"qty_received" numeric(12, 3) DEFAULT '0' NOT NULL,
	"qty_rejected" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"rack_id" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"gr_number" text NOT NULL,
	"company_id" integer,
	"po_id" integer NOT NULL,
	"warehouse_id" integer,
	"supplier_id" integer,
	"status" "gr_status" DEFAULT 'draft' NOT NULL,
	"receive_date" timestamp DEFAULT now() NOT NULL,
	"delivery_note" text,
	"notes" text,
	"confirmed_by" text,
	"confirmed_at" timestamp,
	"cancelled_at" timestamp,
	"created_by" text,
	"journal_entry_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_gr_number_unique" UNIQUE("gr_number")
);
--> statement-breakpoint
CREATE TABLE "landed_cost_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"lc_id" integer NOT NULL,
	"gr_line_id" integer,
	"product_id" integer,
	"name" text NOT NULL,
	"allocated_amount" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_cost_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"lc_id" integer NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"supplier_id" integer,
	"account_id" integer
);
--> statement-breakpoint
CREATE TABLE "landed_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"lc_number" text NOT NULL,
	"company_id" integer,
	"gr_id" integer,
	"po_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"allocation_method" "lc_method" DEFAULT 'by_amount' NOT NULL,
	"notes" text,
	"total_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "landed_costs_lc_number_unique" UNIQUE("lc_number")
);
--> statement-breakpoint
CREATE TABLE "payment_request_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_request_id" integer NOT NULL,
	"vendor_invoice_id" integer,
	"description" text NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"pay_req_number" text NOT NULL,
	"company_id" integer,
	"supplier_id" integer,
	"supplier_name" text NOT NULL,
	"status" "pay_req_status" DEFAULT 'draft' NOT NULL,
	"requested_by" text,
	"approved_by" text,
	"approved_at" timestamp,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payment_method" text,
	"bank_account" text,
	"payment_date" timestamp,
	"journal_entry_id" integer,
	"notes" text,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_pay_req_number_unique" UNIQUE("pay_req_number")
);
--> statement-breakpoint
CREATE TABLE "purchase_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" integer NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"approver_name" text,
	"approver_id" text,
	"status" "pw_approval_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"approved_at" timestamp,
	"rejected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"po_line_id" integer,
	"product_id" integer,
	"rack_id" integer,
	"qty_ordered" numeric(12, 3) DEFAULT '0' NOT NULL,
	"qty_received" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_no" text NOT NULL,
	"po_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"notes" text,
	"received_by" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipts_receipt_no_unique" UNIQUE("receipt_no")
);
--> statement-breakpoint
CREATE TABLE "purchase_request_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"pr_id" integer NOT NULL,
	"product_id" integer,
	"name" text NOT NULL,
	"description" text,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"estimated_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"pr_number" text NOT NULL,
	"company_id" integer,
	"warehouse_id" integer,
	"status" "pr_status" DEFAULT 'draft' NOT NULL,
	"requested_by" text,
	"department" text,
	"required_date" timestamp,
	"notes" text,
	"rfq_id" integer,
	"cancelled_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requests_pr_number_unique" UNIQUE("pr_number")
);
--> statement-breakpoint
CREATE TABLE "purchase_return_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"product_id" integer,
	"name" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_number" text NOT NULL,
	"company_id" integer,
	"po_id" integer,
	"gr_id" integer,
	"supplier_id" integer,
	"supplier_name" text NOT NULL,
	"warehouse_id" integer,
	"status" "pr_return_status" DEFAULT 'draft' NOT NULL,
	"return_date" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"confirmed_by" text,
	"confirmed_at" timestamp,
	"cancelled_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_returns_return_number_unique" UNIQUE("return_number")
);
--> statement-breakpoint
CREATE TABLE "qc_inspections" (
	"id" serial PRIMARY KEY NOT NULL,
	"qc_number" text NOT NULL,
	"gr_id" integer NOT NULL,
	"company_id" integer,
	"status" "qc_status" DEFAULT 'pending' NOT NULL,
	"inspector_name" text,
	"inspected_at" timestamp,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "qc_inspections_qc_number_unique" UNIQUE("qc_number")
);
--> statement-breakpoint
CREATE TABLE "qc_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"qc_id" integer NOT NULL,
	"gr_line_id" integer,
	"product_id" integer,
	"name" text NOT NULL,
	"qty_inspected" numeric(12, 3) DEFAULT '0' NOT NULL,
	"qty_passed" numeric(12, 3) DEFAULT '0' NOT NULL,
	"qty_failed" numeric(12, 3) DEFAULT '0' NOT NULL,
	"fail_reason" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "uom_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_uom_id" integer NOT NULL,
	"to_uom_id" integer NOT NULL,
	"factor" numeric(18, 6) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uom_conversions_pair_uidx" UNIQUE("from_uom_id","to_uom_id")
);
--> statement-breakpoint
CREATE TABLE "uom" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"category" text DEFAULT 'count' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uom_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "vendor_invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"product_id" integer,
	"name" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "vendor_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"vendor_invoice_ref" text,
	"company_id" integer,
	"supplier_id" integer,
	"supplier_name" text NOT NULL,
	"po_id" integer,
	"gr_id" integer,
	"status" "vi_status" DEFAULT 'draft' NOT NULL,
	"invoice_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp,
	"payment_term_days" integer DEFAULT 30,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"three_way_match_status" text DEFAULT 'unmatched' NOT NULL,
	"match_notes" text,
	"journal_entry_id" integer,
	"notes" text,
	"cancelled_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "vendor_quotation_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"quotation_id" integer NOT NULL,
	"product_id" integer,
	"name" text NOT NULL,
	"description" text,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"unit_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"lead_time_days" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "vendor_quotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"supplier_id" integer,
	"supplier_name" text NOT NULL,
	"status" "vq_status" DEFAULT 'draft' NOT NULL,
	"valid_until" timestamp,
	"payment_term_days" integer DEFAULT 30,
	"delivery_days" integer,
	"notes" text,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_shipment_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"shipment_number" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_by" text NOT NULL,
	"changed_by_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"address" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"division_id" integer,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_journals" DROP CONSTRAINT "accounting_journals_code_unique";
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" DROP CONSTRAINT "chart_of_accounts_code_unique";
--> statement-breakpoint
ALTER TABLE "portal_customers" ALTER COLUMN "password_hash" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "branch_id" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "custom_role_id" integer;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "cost_price" numeric(12, 2) DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "base_uom_id" integer;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "year_vehicle" integer;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "supported_modes" text[];
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD COLUMN "sales_uom_id" integer;
--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD COLUMN "base_qty" numeric(12, 4);
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "invoice_number" text;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "invoice_date" date;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "due_date" date;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "payment_term_days" integer DEFAULT 30;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "cancelled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "logistic_order_id" integer;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "warehouse_id" integer;
--> statement-breakpoint
ALTER TABLE "purchase_document_lines" ADD COLUMN "unit" text;
--> statement-breakpoint
ALTER TABLE "purchase_document_lines" ADD COLUMN "uom_id" integer;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD COLUMN "warehouse_id" integer;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD COLUMN "bill_number" text;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD COLUMN "bill_date" text;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD COLUMN "due_date" text;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD COLUMN "payment_term_days" integer DEFAULT 30;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD COLUMN "cancelled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "accounting_entries" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "accounting_payments" ADD COLUMN "payment_number" text;
--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "accounting_taxes" ADD COLUMN "company_id" integer NOT NULL;
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "correspondences" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN IF NOT EXISTS "freight_cost" numeric(14, 2) DEFAULT '0';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'freight_service_category' AND typnamespace = 'public'::regnamespace) THEN
      CREATE TYPE "public"."freight_service_category" AS ENUM('FF_UDARA', 'FF_LAUT', 'PPJK', 'TRUCKING', 'MULTIMODAL', 'GENERAL_FORWARDING');
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN IF NOT EXISTS "service_category" "freight_service_category";
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN IF NOT EXISTS "source_module" text;
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN IF NOT EXISTS "source_order_id" integer;
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN IF NOT EXISTS "estimated_revenue" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN IF NOT EXISTS "estimated_cost" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN IF NOT EXISTS "actual_revenue" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN IF NOT EXISTS "invoice_status" text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD COLUMN IF NOT EXISTS "vendor_bill_status" text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "portal_customers" ADD COLUMN "oauth_provider" text;
--> statement-breakpoint
ALTER TABLE "portal_customers" ADD COLUMN "oauth_id" text;
--> statement-breakpoint
ALTER TABLE "logistic_order_quotes" ADD COLUMN "vendor_confirm_token" text;
--> statement-breakpoint
ALTER TABLE "logistic_order_quotes" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'IDR';
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "customer_confirm_token" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "customer_confirm_status" text DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "customer_confirmed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "pickup_date" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "pickup_time" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "truck_type" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "markup_percent" numeric(5, 2) DEFAULT '20';
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "final_price" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "transport_mode" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "origin_district" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "dest_district" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "etd" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "eta" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "origin_port" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "dest_port" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "weight_kg" numeric(12, 3);
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "incoterm" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "options_token" text;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "options_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD COLUMN "public_rfq_token" text;
--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "company_id" integer;
--> statement-breakpoint
ALTER TABLE "vendor_offers" ADD CONSTRAINT "vendor_offers_order_id_logistic_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."logistic_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_offers" ADD CONSTRAINT "vendor_offers_vendor_id_suppliers_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_responses" ADD CONSTRAINT "vendor_responses_order_id_logistic_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."logistic_orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_rates" ADD CONSTRAINT "vendor_rates_vendor_id_suppliers_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_holding_members" ADD CONSTRAINT "company_holding_members_holding_group_id_holding_groups_id_fk" FOREIGN KEY ("holding_group_id") REFERENCES "public"."holding_groups"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_branches" ADD CONSTRAINT "pos_branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_cashiers" ADD CONSTRAINT "pos_cashiers_branch_id_pos_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."pos_branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_inventory_items" ADD CONSTRAINT "pos_inventory_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_inventory_stocks" ADD CONSTRAINT "pos_inventory_stocks_item_id_pos_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."pos_inventory_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_inventory_stocks" ADD CONSTRAINT "pos_inventory_stocks_branch_id_pos_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."pos_branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_inventory_stocks" ADD CONSTRAINT "pos_inventory_stocks_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_inventory_stocks" ADD CONSTRAINT "pos_inventory_stocks_rack_id_pos_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_order_id_pos_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pos_orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_product_id_pos_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pos_products"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_cashier_id_pos_cashiers_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."pos_cashiers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_branch_id_pos_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."pos_branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_products" ADD CONSTRAINT "pos_products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_racks" ADD CONSTRAINT "pos_racks_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_recipe_items" ADD CONSTRAINT "pos_recipe_items_recipe_id_pos_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."pos_recipes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_recipe_items" ADD CONSTRAINT "pos_recipe_items_item_id_pos_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."pos_inventory_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_recipes" ADD CONSTRAINT "pos_recipes_product_id_pos_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pos_products"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_branch_id_pos_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."pos_branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_cashier_id_pos_cashiers_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."pos_cashiers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_adjustments" ADD CONSTRAINT "pos_stock_adjustments_stock_item_id_pos_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."pos_stock_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_adjustments" ADD CONSTRAINT "pos_stock_adjustments_cashier_id_pos_cashiers_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."pos_cashiers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_mutations" ADD CONSTRAINT "pos_stock_mutations_item_id_pos_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."pos_inventory_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_mutations" ADD CONSTRAINT "pos_stock_mutations_branch_id_pos_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."pos_branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_mutations" ADD CONSTRAINT "pos_stock_mutations_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_mutations" ADD CONSTRAINT "pos_stock_mutations_rack_id_pos_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_opname_items" ADD CONSTRAINT "pos_stock_opname_items_opname_id_pos_stock_opnames_id_fk" FOREIGN KEY ("opname_id") REFERENCES "public"."pos_stock_opnames"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_opname_items" ADD CONSTRAINT "pos_stock_opname_items_item_id_pos_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."pos_inventory_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_opnames" ADD CONSTRAINT "pos_stock_opnames_branch_id_pos_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."pos_branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_opnames" ADD CONSTRAINT "pos_stock_opnames_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_transfer_items" ADD CONSTRAINT "pos_stock_transfer_items_transfer_id_pos_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."pos_stock_transfers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_transfer_items" ADD CONSTRAINT "pos_stock_transfer_items_item_id_pos_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."pos_inventory_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_transfer_items" ADD CONSTRAINT "pos_stock_transfer_items_from_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_transfer_items" ADD CONSTRAINT "pos_stock_transfer_items_to_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_transfers" ADD CONSTRAINT "pos_stock_transfers_from_branch_id_pos_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."pos_branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_transfers" ADD CONSTRAINT "pos_stock_transfers_to_branch_id_pos_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."pos_branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_warehouses" ADD CONSTRAINT "pos_warehouses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_warehouses" ADD CONSTRAINT "pos_warehouses_branch_id_pos_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."pos_branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_recipe_id_product_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."product_recipes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_ingredient_product_id_products_id_fk" FOREIGN KEY ("ingredient_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_damage_lines" ADD CONSTRAINT "wh_damage_lines_report_id_wh_damage_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."wh_damage_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_damage_lines" ADD CONSTRAINT "wh_damage_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_damage_lines" ADD CONSTRAINT "wh_damage_lines_rack_id_pos_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_damage_reports" ADD CONSTRAINT "wh_damage_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_damage_reports" ADD CONSTRAINT "wh_damage_reports_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_movements" ADD CONSTRAINT "wh_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_movements" ADD CONSTRAINT "wh_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_movements" ADD CONSTRAINT "wh_movements_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_movements" ADD CONSTRAINT "wh_movements_rack_id_pos_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_opname_lines" ADD CONSTRAINT "wh_opname_lines_opname_id_wh_opnames_id_fk" FOREIGN KEY ("opname_id") REFERENCES "public"."wh_opnames"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_opname_lines" ADD CONSTRAINT "wh_opname_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_opname_lines" ADD CONSTRAINT "wh_opname_lines_rack_id_pos_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_opnames" ADD CONSTRAINT "wh_opnames_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_opnames" ADD CONSTRAINT "wh_opnames_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_return_lines" ADD CONSTRAINT "wh_return_lines_return_id_wh_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."wh_returns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_return_lines" ADD CONSTRAINT "wh_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_return_lines" ADD CONSTRAINT "wh_return_lines_rack_id_pos_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_returns" ADD CONSTRAINT "wh_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_returns" ADD CONSTRAINT "wh_returns_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_stock" ADD CONSTRAINT "wh_stock_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_stock" ADD CONSTRAINT "wh_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_stock" ADD CONSTRAINT "wh_stock_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_stock" ADD CONSTRAINT "wh_stock_rack_id_pos_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_transfer_lines" ADD CONSTRAINT "wh_transfer_lines_transfer_id_wh_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."wh_transfers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_transfer_lines" ADD CONSTRAINT "wh_transfer_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_transfer_lines" ADD CONSTRAINT "wh_transfer_lines_from_rack_id_pos_racks_id_fk" FOREIGN KEY ("from_rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_transfer_lines" ADD CONSTRAINT "wh_transfer_lines_to_rack_id_pos_racks_id_fk" FOREIGN KEY ("to_rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_transfers" ADD CONSTRAINT "wh_transfers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_transfers" ADD CONSTRAINT "wh_transfers_from_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wh_transfers" ADD CONSTRAINT "wh_transfers_to_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_rack_id_warehouse_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."warehouse_racks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_rack_id_warehouse_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."warehouse_racks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "warehouse_racks" ADD CONSTRAINT "warehouse_racks_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "thai_tea_warehouse_links" ADD CONSTRAINT "thai_tea_warehouse_links_pos_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("pos_warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "thai_tea_warehouse_links" ADD CONSTRAINT "thai_tea_warehouse_links_erp_warehouse_id_warehouses_id_fk" FOREIGN KEY ("erp_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_gr_id_goods_receipts_id_fk" FOREIGN KEY ("gr_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_rack_id_pos_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_documents_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_lc_id_landed_costs_id_fk" FOREIGN KEY ("lc_id") REFERENCES "public"."landed_costs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_gr_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("gr_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "landed_cost_allocations" ADD CONSTRAINT "landed_cost_allocations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_lc_id_landed_costs_id_fk" FOREIGN KEY ("lc_id") REFERENCES "public"."landed_costs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "landed_cost_lines" ADD CONSTRAINT "landed_cost_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_gr_id_goods_receipts_id_fk" FOREIGN KEY ("gr_id") REFERENCES "public"."goods_receipts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_po_id_purchase_documents_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_request_items" ADD CONSTRAINT "payment_request_items_vendor_invoice_id_vendor_invoices_id_fk" FOREIGN KEY ("vendor_invoice_id") REFERENCES "public"."vendor_invoices"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_po_line_id_purchase_document_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_document_lines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_rack_id_pos_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."pos_racks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_po_id_purchase_documents_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_po_id_purchase_documents_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_gr_id_goods_receipts_id_fk" FOREIGN KEY ("gr_id") REFERENCES "public"."goods_receipts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_gr_id_goods_receipts_id_fk" FOREIGN KEY ("gr_id") REFERENCES "public"."goods_receipts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qc_lines" ADD CONSTRAINT "qc_lines_qc_id_qc_inspections_id_fk" FOREIGN KEY ("qc_id") REFERENCES "public"."qc_inspections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qc_lines" ADD CONSTRAINT "qc_lines_gr_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("gr_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qc_lines" ADD CONSTRAINT "qc_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_from_uom_id_uom_id_fk" FOREIGN KEY ("from_uom_id") REFERENCES "public"."uom"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_to_uom_id_uom_id_fk" FOREIGN KEY ("to_uom_id") REFERENCES "public"."uom"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_invoice_id_vendor_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."vendor_invoices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_po_id_purchase_documents_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_gr_id_goods_receipts_id_fk" FOREIGN KEY ("gr_id") REFERENCES "public"."goods_receipts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_quotation_lines" ADD CONSTRAINT "vendor_quotation_lines_quotation_id_vendor_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."vendor_quotations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_quotation_lines" ADD CONSTRAINT "vendor_quotation_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_rfq_id_purchase_documents_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."purchase_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "freight_shipment_audit_logs" ADD CONSTRAINT "freight_shipment_audit_logs_shipment_id_freight_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."freight_shipments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pos_branches_company_idx" ON "pos_branches" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "pos_cashiers_branch_idx" ON "pos_cashiers" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "pos_order_items_order_idx" ON "pos_order_items" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX "pos_order_items_product_idx" ON "pos_order_items" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "pos_orders_company_idx" ON "pos_orders" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "pos_orders_branch_idx" ON "pos_orders" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "pos_orders_cashier_idx" ON "pos_orders" USING btree ("cashier_id");
--> statement-breakpoint
CREATE INDEX "pos_orders_status_idx" ON "pos_orders" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "pos_orders_created_idx" ON "pos_orders" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "wh_movements_company_idx" ON "wh_movements" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "wh_movements_product_idx" ON "wh_movements" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "wh_movements_warehouse_idx" ON "wh_movements" USING btree ("warehouse_id");
--> statement-breakpoint
CREATE INDEX "wh_movements_type_idx" ON "wh_movements" USING btree ("type");
--> statement-breakpoint
CREATE INDEX "wh_movements_created_idx" ON "wh_movements" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "wh_stock_company_idx" ON "wh_stock" USING btree ("company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wh_stock_product_warehouse_rack_idx" ON "wh_stock" USING btree ("product_id","warehouse_id","rack_id");
--> statement-breakpoint
CREATE INDEX "wh_transfers_from_idx" ON "wh_transfers" USING btree ("from_warehouse_id");
--> statement-breakpoint
CREATE INDEX "wh_transfers_to_idx" ON "wh_transfers" USING btree ("to_warehouse_id");
--> statement-breakpoint
CREATE INDEX "wh_transfers_status_idx" ON "wh_transfers" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "stock_movements_product_idx" ON "stock_movements" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "stock_movements_warehouse_idx" ON "stock_movements" USING btree ("warehouse_id");
--> statement-breakpoint
CREATE INDEX "stock_movements_type_idx" ON "stock_movements" USING btree ("movement_type");
--> statement-breakpoint
CREATE INDEX "stock_movements_created_idx" ON "stock_movements" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "warehouses_company_idx" ON "warehouses" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "gr_lines_gr_idx" ON "goods_receipt_lines" USING btree ("gr_id");
--> statement-breakpoint
CREATE INDEX "gr_po_idx" ON "goods_receipts" USING btree ("po_id");
--> statement-breakpoint
CREATE INDEX "gr_company_idx" ON "goods_receipts" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "gr_status_idx" ON "goods_receipts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "lc_alloc_lc_idx" ON "landed_cost_allocations" USING btree ("lc_id");
--> statement-breakpoint
CREATE INDEX "lc_lines_lc_idx" ON "landed_cost_lines" USING btree ("lc_id");
--> statement-breakpoint
CREATE INDEX "landed_costs_gr_idx" ON "landed_costs" USING btree ("gr_id");
--> statement-breakpoint
CREATE INDEX "landed_costs_po_idx" ON "landed_costs" USING btree ("po_id");
--> statement-breakpoint
CREATE INDEX "pay_req_items_pr_idx" ON "payment_request_items" USING btree ("payment_request_id");
--> statement-breakpoint
CREATE INDEX "pay_req_supplier_idx" ON "payment_requests" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "pay_req_status_idx" ON "payment_requests" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "pw_approvals_doc_idx" ON "purchase_approvals" USING btree ("doc_type","doc_id");
--> statement-breakpoint
CREATE INDEX "purchase_receipt_lines_receipt_idx" ON "purchase_receipt_lines" USING btree ("receipt_id");
--> statement-breakpoint
CREATE INDEX "purchase_receipts_po_idx" ON "purchase_receipts" USING btree ("po_id");
--> statement-breakpoint
CREATE INDEX "purchase_receipts_wh_idx" ON "purchase_receipts" USING btree ("warehouse_id");
--> statement-breakpoint
CREATE INDEX "pr_lines_pr_idx" ON "purchase_request_lines" USING btree ("pr_id");
--> statement-breakpoint
CREATE INDEX "pr_company_idx" ON "purchase_requests" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "pr_status_idx" ON "purchase_requests" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "purchase_return_lines_return_idx" ON "purchase_return_lines" USING btree ("return_id");
--> statement-breakpoint
CREATE INDEX "purchase_returns_po_idx" ON "purchase_returns" USING btree ("po_id");
--> statement-breakpoint
CREATE INDEX "purchase_returns_status_idx" ON "purchase_returns" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "qc_gr_idx" ON "qc_inspections" USING btree ("gr_id");
--> statement-breakpoint
CREATE INDEX "qc_lines_qc_idx" ON "qc_lines" USING btree ("qc_id");
--> statement-breakpoint
CREATE INDEX "vi_lines_invoice_idx" ON "vendor_invoice_lines" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "vi_po_idx" ON "vendor_invoices" USING btree ("po_id");
--> statement-breakpoint
CREATE INDEX "vi_supplier_idx" ON "vendor_invoices" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "vi_status_idx" ON "vendor_invoices" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "vq_lines_quotation_idx" ON "vendor_quotation_lines" USING btree ("quotation_id");
--> statement-breakpoint
CREATE INDEX "vq_rfq_idx" ON "vendor_quotations" USING btree ("rfq_id");
--> statement-breakpoint
CREATE INDEX "vq_supplier_idx" ON "vendor_quotations" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "custom_roles_company_idx" ON "custom_roles" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "branches_company_idx" ON "branches" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "departments_company_idx" ON "departments" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "departments_division_idx" ON "departments" USING btree ("division_id");
--> statement-breakpoint
CREATE INDEX "divisions_company_idx" ON "divisions" USING btree ("company_id");
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_base_uom_id_uom_id_fk" FOREIGN KEY ("base_uom_id") REFERENCES "public"."uom"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_sales_uom_id_uom_id_fk" FOREIGN KEY ("sales_uom_id") REFERENCES "public"."uom"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_logistic_order_id_logistic_orders_id_fk" FOREIGN KEY ("logistic_order_id") REFERENCES "public"."logistic_orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_warehouse_id_pos_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."pos_warehouses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_taxes" ADD CONSTRAINT "accounting_taxes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "correspondences" ADD CONSTRAINT "correspondences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "freight_shipments" ADD CONSTRAINT "freight_shipments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD CONSTRAINT "logistic_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "products_company_idx" ON "products" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "suppliers_company_idx" ON "suppliers" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "customers_company_idx" ON "customers" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "purchase_doc_lines_doc_idx" ON "purchase_document_lines" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX "purchase_doc_lines_product_idx" ON "purchase_document_lines" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "purchase_docs_company_idx" ON "purchase_documents" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "purchase_docs_supplier_idx" ON "purchase_documents" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "purchase_docs_status_idx" ON "purchase_documents" USING btree ("status","kind");
--> statement-breakpoint
CREATE INDEX "accounting_entries_company_idx" ON "accounting_entries" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "accounting_entries_journal_idx" ON "accounting_entries" USING btree ("journal_id");
--> statement-breakpoint
CREATE INDEX "accounting_entries_date_idx" ON "accounting_entries" USING btree ("date");
--> statement-breakpoint
CREATE INDEX "entry_lines_entry_idx" ON "accounting_entry_lines" USING btree ("entry_id");
--> statement-breakpoint
CREATE INDEX "entry_lines_account_idx" ON "accounting_entry_lines" USING btree ("account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "journals_company_code_uniq" ON "accounting_journals" USING btree ("company_id","code");
--> statement-breakpoint
CREATE INDEX "accounting_payments_company_idx" ON "accounting_payments" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "accounting_payments_journal_idx" ON "accounting_payments" USING btree ("journal_id");
--> statement-breakpoint
CREATE INDEX "accounting_payments_date_idx" ON "accounting_payments" USING btree ("date");
--> statement-breakpoint
CREATE UNIQUE INDEX "coa_company_code_uniq" ON "chart_of_accounts" USING btree ("company_id","code");
--> statement-breakpoint
CREATE INDEX "correspondences_company_idx" ON "correspondences" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "expenses_company_idx" ON "expenses" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date");
--> statement-breakpoint
CREATE INDEX "logistic_orders_company_idx" ON "logistic_orders" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "logistic_orders_status_idx" ON "logistic_orders" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "logistic_orders_vendor_idx" ON "logistic_orders" USING btree ("approved_vendor_id");
--> statement-breakpoint
CREATE INDEX "drivers_company_idx" ON "drivers" USING btree ("company_id");
--> statement-breakpoint
ALTER TABLE "logistic_order_quotes" ADD CONSTRAINT "logistic_order_quotes_vendor_confirm_token_unique" UNIQUE("vendor_confirm_token");
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD CONSTRAINT "logistic_orders_customer_confirm_token_unique" UNIQUE("customer_confirm_token");
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD CONSTRAINT "logistic_orders_options_token_unique" UNIQUE("options_token");
--> statement-breakpoint
ALTER TABLE "logistic_orders" ADD CONSTRAINT "logistic_orders_public_rfq_token_unique" UNIQUE("public_rfq_token");
