import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const result = await db.execute(sql`
  SELECT
    c.id AS candidate_id,
    c.mutation_id,
    c.status,
    c.source_date,
    c.estimated_settlement_date,
    c.gross_amount,
    c.net_amount,
    item->>'paymentId' AS payment_id,
    item->>'expectedSettlementDate' AS expected_settlement_date
  FROM public.qris_mutation_batch_candidates c
  CROSS JOIN LATERAL jsonb_array_elements(c.payment_items) item
  WHERE (item->>'paymentId')::int IN (
    175, 279, 280, 294, 296, 297, 298, 301, 302, 303, 305, 308,
    314, 315, 323, 325, 326, 327, 331, 340, 347, 349, 351, 354, 355, 361
  )
  ORDER BY c.mutation_id, c.id DESC, (item->>'paymentId')::int
`);

console.log(JSON.stringify(result.rows, null, 2));