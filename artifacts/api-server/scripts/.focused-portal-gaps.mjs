import pg from 'pg';
import { randomUUID } from 'node:crypto';

const API = process.env.PROOF_API_URL ?? 'http://127.0.0.1:18444';
const marker = `FOCUSED-PORTAL-GAPS-${randomUUID()}`;
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_MIGRATION_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const created = { customers: [], ocean: [], rfqs: [], portalOrders: [] };
let customerA;
let customerB;
let internalCookie = '';

function log(name, ok, detail = '') {
  if (!ok) throw new Error(`${name}: ${detail || 'assertion failed'}`);
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
}

async function db(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function http(path, { method = 'GET', headers = {}, body } = {}, expected = [200]) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!expected.includes(response.status)) throw new Error(`${method} ${path} => ${response.status}: ${text.slice(0, 500)}`);
  return { status: response.status, body: parsed, headers: response.headers };
}
function auth(token) { return { authorization: `Bearer ${token}` }; }
function fixturePhone(label) {
  let hash = 2166136261;
  for (const ch of `${marker}:${label}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return `08${String(hash >>> 0).padStart(10, '0')}`;
}
async function signup(label) {
  const result = await http('/api/portal/auth/signup', { method: 'POST', body: {
    name: `${marker} ${label}`,
    email: `${label.toLowerCase()}-${marker.toLowerCase()}@example.invalid`,
    password: 'FocusedProof!2026',
    phone: fixturePhone(label),
    customerType: 'individual',
  } }, [201]);
  const id = Number(result.body?.user?.id ?? result.body?.profile?.id);
  const token = String(result.body?.token ?? '');
  created.customers.push(id);
  log(`${label} customer fixture`, Boolean(token) && id > 0, `customer=${id}`);
  return { id, token };
}
async function ensureInternalCookie() {
  const devUsers = await http('/api/dev-users');
  const configured = String(process.env.ADMIN_EMAIL ?? '').split(',').map(x => x.trim()).find(Boolean);
  const seeded = (devUsers.body?.users ?? []).find(u => ['admin', 'super_admin', 'logistics', 'operations'].includes(u?.role) && typeof u?.email === 'string')?.email;
  const login = await http('/api/dev-login', { method: 'POST', body: { email: configured ?? seeded ?? 'audit-admin@example.invalid' } });
  internalCookie = login.headers.get('set-cookie') ?? '';
  log('Internal admin session', Boolean(internalCookie));
}
async function readSse(token, timeoutMs) {
  const response = await fetch(`${API}/api/portal/notifications/events`, { headers: auth(token) });
  if (response.status !== 200 || !response.body) throw new Error(`SSE connect failed: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const timer = new Promise(resolve => setTimeout(() => resolve(''), timeoutMs));
  const read = reader.read().then(({ value }) => value ? new TextDecoder().decode(value) : '');
  const value = await Promise.race([read, timer]);
  await reader.cancel().catch(() => {});
  return String(value);
}
async function countOwnedNotification(customerId, orderId) {
  const rows = await db(`SELECT event_key, COUNT(*)::int AS count
    FROM portal_customer_notifications
    WHERE portal_customer_id = $1
      AND payload::text LIKE $2
    GROUP BY event_key`, [customerId, `%"orderId":${orderId}%`]);
  return rows;
}
async function marketplacePayload() {
  const catalog = await http('/api/portal/marketplace');
  const items = Array.isArray(catalog.body) ? catalog.body : (catalog.body?.items ?? catalog.body?.data ?? []);
  const item = items.find(x => Number.isInteger(Number(x?.id)));
  log('Marketplace catalog available', Boolean(item?.id), `item=${item?.id}`);
  return { itemId: Number(item.id), body: {
    buyer_name: `${marker} Marketplace`,
    email: `marketplace-${marker.toLowerCase()}@example.invalid`,
    phone: '081234567890',
    quantity: 1,
    destination: `${marker} Destination`,
    notes: marker,
  }};
}
async function submitQuote(itemId, body, key) {
  return http(`/api/portal/marketplace/${itemId}/quote`, {
    method: 'POST', headers: { ...auth(customerA.token), 'Idempotency-Key': key }, body,
  }, [200, 201, 409]);
}
async function cleanup() {
  const marketplaceRfqs = (await db('SELECT id FROM mkt_rfqs WHERE notes LIKE $1 OR buyer_name LIKE $1', [`%${marker}%`])).map(r => Number(r.id));
  const marketplacePortalOrders = marketplaceRfqs.length
    ? (await db('SELECT portal_order_id FROM mkt_dual_write_log WHERE mkt_rfq_id = ANY($1::int[]) AND portal_order_id IS NOT NULL', [marketplaceRfqs])).map(r => Number(r.portal_order_id)).filter(Number.isInteger)
    : [];
  const roots = {
    portal_customers: created.customers,
    mkt_rfqs: marketplaceRfqs,
    portal_product_orders: marketplacePortalOrders,
    ocean_freight_orders: (await db('SELECT id FROM ocean_freight_orders WHERE customer_name LIKE $1 OR notes LIKE $1', [`%${marker}%`])).map(r => Number(r.id)),
  };
  const entries = Object.entries(roots).filter(([, ids]) => ids.length);
  const client = await pool.connect();
  let deleted = 0;
  try {
    await client.query('BEGIN');
    const dual = await client.query(`DELETE FROM mkt_dual_write_log
      WHERE mkt_rfq_id = ANY($1::int[]) OR portal_order_id = ANY($2::int[])
         OR idempotency_key LIKE $3 OR payload::text LIKE $3 OR buyer_email LIKE $3
         OR buyer_name LIKE $3 OR shipping_address LIKE $3`, [roots.mkt_rfqs, roots.portal_product_orders, `%${marker}%`]);
    deleted += dual.rowCount ?? 0;
    if (roots.portal_customers.length) await client.query('DELETE FROM portal_customer_notifications WHERE portal_customer_id = ANY($1::int[])', [roots.portal_customers]);
    const edges = [];
    const queue = entries.map(([table, ids]) => ({ table, ids, depth: 0 }));
    const visited = new Set(queue.map(x => `${x.table}:${x.ids.join(',')}`));
    while (queue.length) {
      const current = queue.shift();
      const refs = await client.query(`SELECT child.relname AS child_table, child_att.attname AS child_column
        FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
        JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
        JOIN LATERAL unnest(c.conkey) WITH ORDINALITY ck(attnum,ord) ON TRUE
        JOIN LATERAL unnest(c.confkey) WITH ORDINALITY pk(attnum,ord) ON pk.ord=ck.ord
        JOIN pg_attribute child_att ON child_att.attrelid=child.oid AND child_att.attnum=ck.attnum
        WHERE c.contype='f' AND cardinality(c.conkey)=1 AND cardinality(c.confkey)=1
          AND child_ns.nspname='public' AND parent_ns.nspname='public' AND parent.relname=$1`, [current.table]);
      for (const ref of refs.rows) {
        const table = `"${ref.child_table.replaceAll('"', '""')}"`;
        const column = `"${ref.child_column.replaceAll('"', '""')}"`;
        let result;
        try { result = await client.query(`SELECT * FROM ${table} WHERE ${column}=ANY($1::int[])`, [current.ids]); } catch { continue; }
        if (!result.rows.length) continue;
        edges.push({ ...ref, parentIds: current.ids, depth: current.depth + 1 });
        const childIds = result.rows.map(r => Number(r.id)).filter(Number.isInteger);
        if (childIds.length) {
          const key = `${ref.child_table}:${childIds.join(',')}`;
          if (!visited.has(key)) { visited.add(key); queue.push({ table: ref.child_table, ids: childIds, depth: current.depth + 1 }); }
        }
      }
    }
    for (const edge of edges.sort((a, b) => b.depth - a.depth)) {
      const table = `"${edge.child_table.replaceAll('"', '""')}"`;
      const column = `"${edge.child_column.replaceAll('"', '""')}"`;
      await client.query(`DELETE FROM ${table} WHERE ${column}=ANY($1::int[])`, [edge.parentIds]);
    }
    for (const [table, ids] of entries) await client.query(`DELETE FROM "${table}" WHERE id=ANY($1::int[])`, [ids]);
    await client.query(`DELETE FROM admin_notifications WHERE payload::text LIKE $1 OR order_number LIKE $1 OR customer_name LIKE $1 OR company_name LIKE $1 OR body LIKE $1`, [`%${marker}%`]);
    await client.query('COMMIT');
    deleted += edges.length;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  const checks = [
    ['portal_customers', `SELECT COUNT(*)::int AS count FROM portal_customers WHERE name LIKE $1 OR email LIKE $1 OR phone LIKE $1`],
    ['portal_customer_notifications', `SELECT COUNT(*)::int AS count FROM portal_customer_notifications WHERE payload::text LIKE $1 OR event_key LIKE $1`],
    ['admin_notifications', `SELECT COUNT(*)::int AS count FROM admin_notifications WHERE payload::text LIKE $1 OR order_number LIKE $1 OR customer_name LIKE $1 OR company_name LIKE $1 OR body LIKE $1`],
    ['mkt_rfqs', `SELECT COUNT(*)::int AS count FROM mkt_rfqs WHERE notes LIKE $1 OR buyer_name LIKE $1`],
    ['mkt_dual_write_log', `SELECT COUNT(*)::int AS count FROM mkt_dual_write_log WHERE idempotency_key LIKE $1 OR payload::text LIKE $1 OR buyer_email LIKE $1 OR buyer_name LIKE $1 OR shipping_address LIKE $1`],
    ['portal_product_orders', `SELECT COUNT(*)::int AS count FROM portal_product_orders WHERE order_number LIKE $1 OR buyer_name LIKE $1 OR notes LIKE $1`],
    ['ocean_freight_orders', `SELECT COUNT(*)::int AS count FROM ocean_freight_orders WHERE customer_name LIKE $1 OR notes LIKE $1`],
  ];
  const residuals = {};
  for (const [name, sql] of checks) residuals[name] = Number((await db(sql, [`%${marker}%`]))[0].count);
  const total = Object.values(residuals).reduce((a, b) => a + b, 0);
  log('Focused DEV cleanup residual', total === 0, JSON.stringify(residuals));
  return { deleted, residuals };
}

try {
  customerA = await signup('OwnerA');
  customerB = await signup('OtherB');
  await ensureInternalCookie();

  const ocean = await http('/api/ocean-freight/inquiry', { method: 'POST', headers: auth(customerA.token), body: {
    customer_name: `${marker} Ocean`, customer_phone: '081234567890', customer_email: `ocean-${marker.toLowerCase()}@example.invalid`,
    customer_company: 'Focused Proof Company', origin_port: 'CNSHA', destination_port: 'IDJKT', origin_city: 'Shanghai', destination_city: 'Jakarta',
    trade_type: 'import', service_mode: 'port_to_port', shipment_type: 'FCL', container_type: '20GP', container_qty: 1,
    gross_weight: 1000, koli: 10, commodity: `${marker} Cargo`, notes: marker,
  } }, [201]);
  const oceanId = Number(ocean.body?.id); created.ocean.push(oceanId); log('Canonical owner event fixture', oceanId > 0, `ocean=${oceanId}`);

  const aStream = fetch(`${API}/api/portal/notifications/events`, { headers: auth(customerA.token) });
  const bStream = fetch(`${API}/api/portal/notifications/events`, { headers: auth(customerB.token) });
  const [aResponse, bResponse] = await Promise.all([aStream, bStream]);
  log('Owner SSE connected', aResponse.status === 200 && Boolean(aResponse.body));
  log('Other customer SSE connected', bResponse.status === 200 && Boolean(bResponse.body));
  const aReader = aResponse.body.getReader(); const bReader = bResponse.body.getReader();
  const read = (reader, timeout) => Promise.race([
    reader.read().then(({ value }) => value ? new TextDecoder().decode(value) : ''),
    new Promise(resolve => setTimeout(() => resolve(''), timeout)),
  ]);
  const action = await http(`/api/ocean-freight/${oceanId}/status`, { method: 'PATCH', headers: { cookie: internalCookie }, body: { status: 'approved' } }, [200]);
  log('Canonical notification action', action.status === 200);
  const [aEvent, bEvent] = await Promise.all([read(aReader, 3000), read(bReader, 700)]);
  await aReader.cancel().catch(() => {}); await bReader.cancel().catch(() => {});
  log('NOTIFICATION_OWNERSHIP', aEvent.includes('customer_notification') && aEvent.includes(String(oceanId)) && !bEvent.includes('customer_notification'), `ownerBytes=${aEvent.length}, otherBytes=${bEvent.length}`);
  const ownerList = await http('/api/portal/notifications?limit=100', { headers: auth(customerA.token) });
  const otherList = await http('/api/portal/notifications?limit=100', { headers: auth(customerB.token) });
  const ownerHas = (ownerList.body?.items ?? []).some(x => Number(x.payload?.orderId) === oceanId);
  const otherHas = (otherList.body?.items ?? []).some(x => Number(x.payload?.orderId) === oceanId);
  log('Persisted notification owner visibility', ownerHas && !otherHas, `owner=${ownerHas}, other=${otherHas}`);
  const before = await countOwnedNotification(customerA.id, oceanId);
  const retryStream = fetch(`${API}/api/portal/notifications/events`, { headers: auth(customerA.token) });
  const retryResponse = await retryStream; const retryReader = retryResponse.body.getReader();
  await http(`/api/ocean-freight/${oceanId}/status`, { method: 'PATCH', headers: { cookie: internalCookie }, body: { status: 'approved' } }, [200, 409, 422]);
  const retryEvent = await read(retryReader, 900); await retryReader.cancel().catch(() => {});
  const after = await countOwnedNotification(customerA.id, oceanId);
  log('NOTIFICATION_DEDUPE', JSON.stringify(before) === JSON.stringify(after) && !retryEvent.includes('customer_notification'), `before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);

  const { itemId, body: quoteBody } = await marketplacePayload();
  const sameKey = `${marker}:same-key`;
  const same = await Promise.all([submitQuote(itemId, quoteBody, sameKey), submitQuote(itemId, quoteBody, sameKey)]);
  const sameIds = same.map(x => Number(x.body?.rfqId ?? x.body?.rfq?.id)).filter(Number.isInteger);
  const sameRows = await db('SELECT id FROM mkt_rfqs WHERE notes LIKE $1 AND buyer_name LIKE $2', [`%${marker}%`, `${marker} Marketplace`]);
  const sameIdSet = new Set(sameIds);
  log('Marketplace same-key retry/concurrency guard', sameIds.length === 2 && sameIds[0] > 0 && sameIdSet.size === 1 && sameRows.length === 1, `responses=${same.map(x => x.status).join(',')}, ids=${sameIds.join(',')}`);
  const diff1 = await submitQuote(itemId, quoteBody, `${marker}:different-a`);
  const diff2 = await submitQuote(itemId, quoteBody, `${marker}:different-b`);
  const diffIds = [Number(diff1.body?.rfqId ?? diff1.body?.rfq?.id), Number(diff2.body?.rfqId ?? diff2.body?.rfq?.id)];
  log('Marketplace different-key submissions remain distinct', diffIds[0] > 0 && diffIds[1] > 0 && diffIds[0] !== diffIds[1], `ids=${diffIds.join(',')}`);
  const allRows = await db('SELECT id FROM mkt_rfqs WHERE notes LIKE $1 AND buyer_name LIKE $2', [`%${marker}%`, `${marker} Marketplace`]);
  log('DUPLICATE_ORDER_GUARD', allRows.length === 3, `canonicalRfqs=${allRows.length}`);
  console.log(JSON.stringify({ marker, verdict: 'PASS', focused: ['notification_ownership', 'sse', 'notification_dedupe', 'marketplace_idempotency'] }, null, 2));
} finally {
  try { const result = await cleanup(); console.log(`CLEANUP deleted=${result.deleted}`); } finally { await pool.end(); }
}
