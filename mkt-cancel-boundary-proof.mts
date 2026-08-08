import pg from "pg";
import { reviewMarketplacePayment, approveMarketplacePayment, markMarketplacePaymentTreasuryReady, startMarketplacePaymentExecution, cancelMarketplacePayment } from "./artifacts/api-server/src/lib/services/mktPaymentLifecycleService.ts";
const c = new pg.Client({ connectionString: process.env.SUPABASE_DATABASE_URL_DEV, ssl: { rejectUnauthorized: false } });
await c.connect();
const key = "S09B-CANCEL-BOUNDARY";
let id = 0;
try {
  id = Number((await c.query(`insert into payment_requests (pay_req_number,supplier_name,status,total_amount,paid_amount,currency,source_type,source_id,mkt_lifecycle_status,notes) values ($1,'Sprint 09B Proof Vendor','submitted','100000','0','IDR','marketplace_ap_preparation',99002,'payment_request_created','temporary cancellation boundary fixture') returning id`, [key])).rows[0].id);
  const actor = { actorId: "sprint-09b-proof", actorName: "Sprint 09B Proof" };
  for (const result of [await reviewMarketplacePayment(id, actor), await approveMarketplacePayment(id, actor), await markMarketplacePaymentTreasuryReady(id, actor)]) {
    if (!result.ok) throw new Error(`preparation transition failed: ${result.code}`);
  }
  const started = await startMarketplacePaymentExecution(id, "boundary-key-0001", actor);
  if (!started.ok || !started.attempt) throw new Error("execution start failed");
  const cancelled = await cancelMarketplacePayment(id, "boundary-cancel-001", "Too late to cancel", actor);
  if (cancelled.ok || cancelled.code !== "CANCELLATION_NOT_ALLOWED") throw new Error(`unexpected cancellation result: ${JSON.stringify(cancelled)}`);
  console.log(JSON.stringify({ ok: true, paymentRequestId: id, executionStatus: "processing", cancellation: cancelled.code }));
} finally {
  if (id) {
    await c.query("delete from mkt_notification_queue where payload_json->>'paymentRequestId' = $1", [String(id)]);
    await c.query("delete from activity_logs where (new_value->>'paymentRequestId')::int = $1", [id]);
    await c.query("delete from payment_requests where id = $1", [id]);
  }
  await c.end();
}
