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
function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
async function relationExists(table) {
  const rows = await db(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists
  `, [table]);
  return Boolean(rows[0]?.exists);
}
async function tableColumns(table) {
  if (!await relationExists(table)) return [];
  const rows = await db(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [table]);
  return rows.map(row => row.column_name);
}
async function idsByMarker(table, markerValue) {
  if (!await relationExists(table)) return [];
  const rows = await db(
    `SELECT t.id FROM ${quoteIdent(table)} AS t WHERE to_jsonb(t)::text LIKE $1`,
    [`%${markerValue}%`],
  );
  return rows.map(row => Number(row.id)).filter(Number.isInteger);
}
async function countRowsByMarker(table, markerValue) {
  if (!await relationExists(table)) return 0;
  const rows = await db(
    `SELECT COUNT(*)::int AS count FROM ${quoteIdent(table)} AS t WHERE to_jsonb(t)::text LIKE $1`,
    [`%${markerValue}%`],
  );
  return Number(rows[0]?.count ?? 0);
}
async function findFocusedMarkers() {
  const pattern = 'FOCUSED-PORTAL-GAPS-[0-9a-f-]+';
  const tables = [
    'portal_customers',
    'portal_customer_notifications',
    'admin_notifications',
    'mkt_rfqs',
    'mkt_dual_write_log',
    'portal_product_orders',
    'ocean_freight_orders',
  ];
  const found = new Set();
  for (const table of tables) {
    if (!await relationExists(table)) continue;
    const rows = await db(`
      SELECT DISTINCT (regexp_matches(to_jsonb(t)::text, $1, 'g'))[1] AS marker
      FROM ${quoteIdent(table)} AS t
      WHERE to_jsonb(t)::text ~ $1
    `, [pattern]);
    for (const row of rows) if (row.marker) found.add(row.marker);
  }
  return [...found];
}
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
      AND payload->>'orderId' = $2
    GROUP BY event_key`, [customerId, String(orderId)]);
  return rows;
}
async function readSseEvent(reader, timeoutMs) {
  const timeout = Symbol('sse-timeout');
  const deadline = Date.now() + timeoutMs;
  let text = '';
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader.read(),
      new Promise(resolve => setTimeout(() => resolve(timeout), remaining)),
    ]);
    if (result === timeout || result.done) return text;
    if (result.value) {
      text += new TextDecoder().decode(result.value);
      if (text.includes('event: customer_notification')) return text;
    }
  }
  return text;
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
async function cleanup(markerToClean) {
  const roots = {};
  for (const table of ['portal_customers', 'mkt_rfqs', 'portal_product_orders', 'ocean_freight_orders']) {
    roots[table] = await idsByMarker(table, markerToClean);
  }
  const dualColumns = await tableColumns('mkt_dual_write_log');
  if (roots.mkt_rfqs.length && dualColumns.includes('mkt_rfq_id') && dualColumns.includes('portal_order_id')) {
    const linkedOrders = await db(
      'SELECT portal_order_id FROM mkt_dual_write_log WHERE mkt_rfq_id = ANY($1::int[]) AND portal_order_id IS NOT NULL',
      [roots.mkt_rfqs],
    );
    roots.portal_product_orders.push(
      ...linkedOrders.map(row => Number(row.portal_order_id)).filter(Number.isInteger),
    );
    roots.portal_product_orders = [...new Set(roots.portal_product_orders)];
  }
  const entries = Object.entries(roots).filter(([, ids]) => ids.length);
  const markerLike = `%${markerToClean}%`;
  const client = await pool.connect();
  let deleted = 0;
  try {
    await client.query('BEGIN');
    if (dualColumns.length) {
      const dualPredicates = ['to_jsonb(t)::text LIKE $1'];
      const params = [markerLike];
      if (dualColumns.includes('mkt_rfq_id')) {
        dualPredicates.push(`t.${quoteIdent('mkt_rfq_id')} = ANY($2::int[])`);
        params.push(roots.mkt_rfqs);
      }
      if (dualColumns.includes('portal_order_id')) {
        dualPredicates.push(`t.${quoteIdent('portal_order_id')} = ANY($${params.length + 1}::int[])`);
        params.push(roots.portal_product_orders);
      }
      const dual = await client.query(
        `DELETE FROM ${quoteIdent('mkt_dual_write_log')} AS t WHERE ${dualPredicates.join(' OR ')}`,
        params,
      );
      deleted += dual.rowCount ?? 0;
    }
    if (await relationExists('portal_customer_notifications')) {
      const notificationColumns = await tableColumns('portal_customer_notifications');
      const predicates = ['to_jsonb(t)::text LIKE $1'];
      const params = [markerLike];
      if (notificationColumns.includes('portal_customer_id')) {
        predicates.push(`t.${quoteIdent('portal_customer_id')} = ANY($2::int[])`);
        params.push(roots.portal_customers);
      }
      const notifications = await client.query(
        `DELETE FROM ${quoteIdent('portal_customer_notifications')} AS t WHERE ${predicates.join(' OR ')}`,
        params,
      );
      deleted += notifications.rowCount ?? 0;
    }
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
        const table = quoteIdent(ref.child_table);
        const column = quoteIdent(ref.child_column);
        let result;
        try { result = await client.query(`SELECT * FROM ${table} WHERE ${column}=ANY($1::int[])`, [current.ids]); } catch { continue; }
        if (!result.rows.length) continue;
        edges.push({ ...ref, parentIds: current.ids, depth: current.depth + 1 });
        const childIds = result.rows.map(row => Number(row.id)).filter(Number.isInteger);
        if (childIds.length) {
          const key = `${ref.child_table}:${childIds.join(',')}`;
          if (!visited.has(key)) { visited.add(key); queue.push({ table: ref.child_table, ids: childIds, depth: current.depth + 1 }); }
        }
      }
    }
    for (const edge of edges.sort((a, b) => b.depth - a.depth)) {
      await client.query(`DELETE FROM ${quoteIdent(edge.child_table)} WHERE ${quoteIdent(edge.child_column)}=ANY($1::int[])`, [edge.parentIds]);
    }
    for (const [table, ids] of entries) {
      await client.query(`DELETE FROM ${quoteIdent(table)} WHERE id=ANY($1::int[])`, [ids]);
    }
    if (await relationExists('admin_notifications')) {
      const admin = await client.query(
        `DELETE FROM ${quoteIdent('admin_notifications')} AS t WHERE to_jsonb(t)::text LIKE $1`,
        [markerLike],
      );
      deleted += admin.rowCount ?? 0;
    }
    await client.query('COMMIT');
    deleted += edges.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const residuals = {};
  for (const table of [
    'portal_customers',
    'portal_customer_notifications',
    'admin_notifications',
    'mkt_rfqs',
    'mkt_dual_write_log',
    'portal_product_orders',
    'ocean_freight_orders',
  ]) {
    residuals[table] = await countRowsByMarker(table, markerToClean);
  }
  const total = Object.values(residuals).reduce((sum, count) => sum + count, 0);
  log(`Focused DEV cleanup residual (${markerToClean})`, total === 0, JSON.stringify(residuals));
  return { deleted, residuals };
}

try {
  const staleMarkers = await findFocusedMarkers();
  for (const staleMarker of staleMarkers) {
    console.log(`Cleaning stale focused fixture ${staleMarker}`);
    await cleanup(staleMarker);
  }
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
  const ownerRow = await db(
    'SELECT portal_customer_id, customer_name, customer_email FROM ocean_freight_orders WHERE id = $1',
    [oceanId],
  );
  console.log(`Focused owner binding — ${JSON.stringify(ownerRow[0] ?? null)}`);

  const aStream = fetch(`${API}/api/portal/notifications/events`, { headers: auth(customerA.token) });
  const bStream = fetch(`${API}/api/portal/notifications/events`, { headers: auth(customerB.token) });
  const [aResponse, bResponse] = await Promise.all([aStream, bStream]);
  log('Owner SSE connected', aResponse.status === 200 && Boolean(aResponse.body));
  log('Other customer SSE connected', bResponse.status === 200 && Boolean(bResponse.body));
  const aReader = aResponse.body.getReader(); const bReader = bResponse.body.getReader();
  const action = await http(`/api/ocean-freight/${oceanId}/status`, { method: 'PATCH', headers: { cookie: internalCookie }, body: { status: 'approved' } }, [200]);
  log('Canonical notification action', action.status === 200);
  const persistedOwnerNotification = await db(
    'SELECT portal_customer_id, event_key, payload FROM portal_customer_notifications WHERE portal_customer_id = $1 AND payload->>\'orderId\' = $2',
    [customerA.id, String(oceanId)],
  );
  console.log(`Focused persisted notification — ${JSON.stringify(persistedOwnerNotification)}`);
  const [aEvent, bEvent] = await Promise.all([readSseEvent(aReader, 3000), readSseEvent(bReader, 700)]);
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
  const retryEvent = await readSseEvent(retryReader, 900); await retryReader.cancel().catch(() => {});
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
  try { const result = await cleanup(marker); console.log(`CLEANUP deleted=${result.deleted}`); } finally { await pool.end(); }
}
