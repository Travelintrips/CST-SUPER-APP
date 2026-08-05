/**
 * sseEvents.ts — Canonical SSE Event Name Constants
 *
 * RULES:
 *  - All SSE event names MUST be defined here.
 *  - No string literals in route files — import from this module.
 *  - Adding a new event = add it here first, then use the constant.
 */

// ─── Admin / BizPortal events ─────────────────────────────────────────────────
/** New marketplace order (product, logistic, or ecommerce) */
export const SSE_NEW_ORDER = "new_order";
/** New ecommerce order */
export const SSE_NEW_ECOMMERCE_ORDER = "new_ecommerce_order";
/** New logistic order */
export const SSE_NEW_LOGISTIC_ORDER = "new_logistic_order";
/** Order status updated from admin side */
export const SSE_ORDER_STATUS_UPDATE = "order_status_update";
/** Product order status updated */
export const SSE_PRODUCT_ORDER_STATUS_UPDATE = "product_order_status_update";
/** Sales order / document created */
export const SSE_SALES_DOC_CREATED = "sales_doc_created";
/** Sales order updated */
export const SSE_SALES_ORDER_UPDATE = "sales_order_update";
/** Purchase document created */
export const SSE_PURCHASE_DOC_CREATED = "purchase_doc_created";
/** Purchase document confirmed */
export const SSE_PURCHASE_DOC_CONFIRMED = "purchase_doc_confirmed";
/** Admin notification broadcast */
export const SSE_ADMIN_NOTIFICATION = "admin_notification";
/** Admin approved/rejected a vendor or order */
export const SSE_ADMIN_APPROVAL = "admin_approval";
/** Admin updated a record */
export const SSE_ADMIN_UPDATE = "admin_update";
/** Admin marks order as pickup-ready */
export const SSE_ADMIN_MARK_PICKUP = "admin_mark_pickup";
/** Admin confirmed vendor assignment */
export const SSE_ADMIN_VENDOR_CONFIRMED = "admin_vendor_confirmed";
/** Admin shipment RFQ event */
export const SSE_ADMIN_SHIPMENT_RFQ = "admin_shipment_rfq";
/** Admin RFQ blast to vendors */
export const SSE_ADMIN_BLAST = "admin_blast";
/** Payment confirmed */
export const SSE_PAYMENT_CONFIRMED = "payment_confirmed";

// ─── Quick quote events ───────────────────────────────────────────────────────
/** Quick quote saved (saveAndBroadcast key) */
export const SSE_QUICK_QUOTE = "quick_quote";
/** Quick quote new (broadcastToAdmins key) */
export const SSE_QUICK_QUOTE_NEW = "quick_quote_new";

// ─── Vendor events ────────────────────────────────────────────────────────────
/** Vendor submitted a quote in response to RFQ */
export const SSE_VENDOR_QUOTE_RECEIVED = "vendor_quote_received";
/** Vendor accepted a purchase order */
export const SSE_VENDOR_PO_ACCEPTED = "vendor_po_accepted";
/** Vendor responded (generic) */
export const SSE_VENDOR_RESPONSE = "vendor_response";

// ─── Freight events ───────────────────────────────────────────────────────────
/** Freight shipment created */
export const SSE_FREIGHT_SHIPMENT_CREATED = "freight_shipment_created";
/** Freight shipment status updated */
export const SSE_FREIGHT_SHIPMENT_STATUS = "freight_shipment_status";
/** Freight stage updated */
export const SSE_FREIGHT_STAGE_UPDATE = "freight_stage_update";
/** Freight rates synced */
export const SSE_FREIGHT_RATES = "freight_rates";
/** Logistics rates synced */
export const SSE_LOGISTICS_RATES = "logistics_rates";
/** Trucking rates synced */
export const SSE_TRUCKING_RATES = "trucking_rates";
/** Price sync event */
export const SSE_PRICE_SYNC = "price_sync";

// ─── Driver events ────────────────────────────────────────────────────────────
/** Driver location update */
export const SSE_DRIVER_LOCATION_UPDATE = "driver_location_update";
/** Driver photo uploaded */
export const SSE_DRIVER_PHOTO_UPLOADED = "driver_photo_uploaded";
/** Driver job status changed */
export const SSE_DRIVER_JOB_STATUS_CHANGED = "driver_job_status_changed";
/** Job status changed (generic driver event) */
export const SSE_JOB_STATUS_CHANGED = "job_status_changed";

// ─── Geofence events ─────────────────────────────────────────────────────────
/** Geofence alert triggered */
export const SSE_GEOFENCE_ALERT = "geofence_alert";
/** Geofence alert updated */
export const SSE_GEOFENCE_ALERT_UPDATE = "geofence_alert_update";
/** Geofence alert resolved */
export const SSE_GEOFENCE_RESOLVED = "geofence_resolved";

// ─── Logistic order events ───────────────────────────────────────────────────
/** Logistic order status changed */
export const SSE_LOGISTIC_ORDER_STATUS_CHANGED = "logistic_order_status_changed";
/** Order progress event added */
export const SSE_PROGRESS_EVENT_ADDED = "progress_event_added";
