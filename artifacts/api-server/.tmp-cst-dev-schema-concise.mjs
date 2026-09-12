import pg from 'pg';
const { Client } = pg;
const c = new Client({connectionString:process.env.SUPABASE_DATABASE_URL,ssl:{rejectUnauthorized:false}});
const q=async(s,p=[]) => (await c.query(s,p)).rows;
await c.connect();
try {
 const names=['companies','suppliers','vendor_catalog_items','service_templates'];
 for (const n of names) {
  const cols=await q(`SELECT column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[n]);
  const cons=await q(`SELECT c.conname,c.contype,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=r.relnamespace WHERE ns.nspname='public' AND r.relname=$1 ORDER BY c.conname`,[n]);
  const idx=await q(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`,[n]);
  console.log(JSON.stringify({table:n,columns:cols,constraints:cons,indexes:idx}));
 }
 const candidateTables=await q(`SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%tenant%' OR table_name ILIKE '%assign%' OR table_name ILIKE '%vendor%') ORDER BY table_name`);
 console.log('CANDIDATE_TABLES',JSON.stringify(candidateTables));
 for (const t of candidateTables) {
  const cols=await q(`SELECT column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,[t.table_schema,t.table_name]);
  console.log('CANDIDATE_COLUMNS',JSON.stringify({table:`${t.table_schema}.${t.table_name}`,columns:cols}));
 }
} finally {await c.end()}
