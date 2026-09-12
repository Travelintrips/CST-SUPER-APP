import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = async (sql, params=[]) => (await client.query(sql, params)).rows;
await client.connect();
try {
  const tables = await q(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public','sport_center') AND (table_name ILIKE '%supplier%' OR table_name ILIKE '%vendor%' OR table_name ILIKE '%catalog%' OR table_name ILIKE '%template%' OR table_name ILIKE '%tenant%' OR table_name='companies') ORDER BY table_schema, table_name`);
  console.log('TABLES', JSON.stringify(tables));
  for (const t of tables) {
    const full = `${t.table_schema}.${t.table_name}`;
    const cols = await q(`SELECT column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [t.table_schema,t.table_name]);
    console.log('COLUMNS', full, JSON.stringify(cols));
    const cons = await q(`SELECT c.conname,c.contype,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname=$1 AND r.relname=$2 ORDER BY c.conname`, [t.table_schema,t.table_name]);
    console.log('CONSTRAINTS', full, JSON.stringify(cons));
    const idx = await q(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 ORDER BY indexname`, [t.table_schema,t.table_name]);
    console.log('INDEXES', full, JSON.stringify(idx));
  }
  console.log('DIVA_COMPANIES', JSON.stringify(await q(`SELECT * FROM public.companies WHERE id=3 OR lower(name) LIKE '%diva servis%' ORDER BY id`)));
  console.log('TRUCKING_TEMPLATES', JSON.stringify(await q(`SELECT * FROM public.service_templates WHERE id=2 OR service_type='trucking'`)));
  console.log('DIVA_SUPPLIERS', JSON.stringify(await q(`SELECT * FROM public.suppliers WHERE company_id=3 OR lower(name) LIKE '%diva servis%' ORDER BY id`)));
} finally { await client.end(); }
