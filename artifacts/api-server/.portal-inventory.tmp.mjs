import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import WebSocket from 'ws';

const envName = process.argv[2] ?? 'development';
const url = envName === 'development'
  ? (process.env.SUPABASE_URL_DEV ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)
  : (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
const key = envName === 'development'
  ? (process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? process.env.SUPABASE_SERVICE_ROLE_KEY)
  : process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = envName === 'development'
  ? (process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL)
  : (process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL);
if (!url || !key) throw new Error(`missing storage credentials for ${envName}`);
if (!dbUrl) throw new Error(`missing database URL for ${envName}`);
const normalizedUrl = String(url).replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const host = new URL(normalizedUrl).hostname;
const projectRef = host.endsWith('.supabase.co') ? host.split('.')[0] : host;
const sb = createClient(normalizedUrl, key, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket } });

async function listAll(client, bucket, prefix = '', seen = new Set()) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      const isFolder = item.id == null && !item.metadata;
      if (isFolder) {
        if (!seen.has(path)) { seen.add(path); out.push(...await listAll(client, bucket, path, seen)); }
      } else {
        out.push({ path, id: item.id ?? null, size: Number(item.metadata?.size ?? item.metadata?.contentLength ?? 0) || 0, mime: item.metadata?.mimetype ?? item.metadata?.contentType ?? null, createdAt: item.created_at ?? null, updatedAt: item.updated_at ?? null });
      }
    }
    if (data.length < 1000) break;
  }
  return out;
}

function safeObject(o) {
  const base = o.path.split('/');
  const name = base.at(-1) ?? '';
  const safeName = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(name.replace(/\.[a-z0-9]+$/i, ''))
    ? '<uuid>' + (name.includes('.') ? name.slice(name.lastIndexOf('.')) : '')
    : name.length > 80 ? `${name.slice(0, 20)}…` : name;
  return { ...o, path: [...base.slice(0, -1), safeName].join('/') };
}

const bucketsResult = await sb.storage.listBuckets();
if (bucketsResult.error) throw bucketsResult.error;
const bucketNames = (bucketsResult.data ?? []).map(b => ({ name: b.name, public: b.public, id: b.id }));
const relevantNames = bucketNames.filter(b => /public-assets|private-assets|portal|catalog|media|avatar|vehicle|document/i.test(b.name));
const bucketObjects = {};
for (const b of relevantNames) bucketObjects[b.name] = await listAll(sb, b.name);

const pool = new pg.Pool({ connectionString: dbUrl, max: 1, connectionTimeoutMillis: 30000, idleTimeoutMillis: 5000 });
const q = async (text, params=[]) => (await pool.query(text, params)).rows;
const tables = await q(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') AND (table_name ILIKE '%portal%' OR table_name ILIKE '%catalog%' OR table_name ILIKE '%vendor%' OR table_name ILIKE '%supplier%' OR table_name ILIKE '%content%' OR table_name ILIKE '%media%' OR table_name ILIKE '%product%') ORDER BY table_schema, table_name`);
const selected = [];
for (const t of tables) {
  const ident = `${t.table_schema}.${t.table_name}`;
  const cols = await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [t.table_schema, t.table_name]);
  let count = null;
  try { count = (await q(`SELECT count(*)::bigint AS count FROM \"${t.table_schema.replaceAll('"','""')}\".\"${t.table_name.replaceAll('"','""')}\"`))[0]?.count ?? null; } catch (e) { count = `error:${e.message}`; }
  const assetCols = cols.filter(c => /image|logo|avatar|photo|media|asset|hero|background|banner|favicon|url|path|document|ocr/i.test(c.column_name)).map(c => c.column_name);
  if (assetCols.length || /portal|content|catalog|media/i.test(t.table_name)) selected.push({ table: ident, rowCount: count, assetColumns: assetCols, columnCount: cols.length });
}
const candidates = [];
for (const t of selected) {
  if (!/^(public\.)?(portal_content|portal_content_overrides|vendor_catalog_items|vendor_profiles|supplier_profiles|portal_products|products|categories)$/i.test(t.table)) continue;
  const [schema, table] = t.table.split('.');
  const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name IN ('hero_bg','background_image','logo','logo_url','image_url','image','media_url','media','avatar_url','profile_image','thumbnail_url','images','product_images','catalog_media','image_urls')`, [schema, table]);
  if (!cols.length) continue;
  const projections = cols.map(c => `\"${c.column_name}\"`).join(',');
  try {
    const rows = await q(`SELECT ${projections} FROM \"${schema}\".\"${table}\" LIMIT 500`);
    candidates.push({ table: t.table, rows: rows.map(row => { const x={}; for (const [k,v] of Object.entries(row)) { if (typeof v === 'string' && v.length > 500) x[k]=v.slice(0,500); else x[k]=v; } return x; }) });
  } catch (e) { candidates.push({ table: t.table, error: e.message }); }
}
await pool.end();
const summary = { env: envName, projectFingerprint: projectRef, supabaseHost: host, buckets: bucketNames, relevantBuckets: relevantNames.map(x=>x.name), objects: Object.fromEntries(Object.entries(bucketObjects).map(([name, arr]) => [name, { count: arr.length, totalBytes: arr.reduce((n,x)=>n+x.size,0), items: arr.map(safeObject) }])), tables: selected, referenceCandidates: candidates };
console.log(JSON.stringify(summary, null, 2));
