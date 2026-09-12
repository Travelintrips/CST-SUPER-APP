import pg from 'pg'; const {Client}=pg; const c=new Client({connectionString:process.env.SUPABASE_DATABASE_URL,ssl:{rejectUnauthorized:false}}); const q=async(s,p=[]) => (await c.query(s,p)).rows; await c.connect();
try {
for (const n of ['companies','suppliers','vendor_catalog_items','service_templates']) {
 console.log(n, JSON.stringify(await q(`SELECT column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[n])));
 console.log(n+'_constraints',JSON.stringify(await q(`SELECT c.conname,c.contype,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=r.relnamespace WHERE ns.nspname='public' AND r.relname=$1 ORDER BY c.conname`,[n])));
 console.log(n+'_indexes',JSON.stringify(await q(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`,[n])));
}
console.log('TABLE_NAMES',JSON.stringify(await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%tenant%' OR table_name ILIKE '%assign%') ORDER BY table_name`)));
console.log('SUPPLIER_CURRENT',JSON.stringify(await q(`SELECT id,name,company_id,service_type,is_active,is_verified,marketplace_status,created_at,updated_at FROM public.suppliers WHERE company_id=3 OR lower(name) LIKE '%diva servis%' ORDER BY id`)));
console.log('CATALOG_CURRENT',JSON.stringify(await q(`SELECT id,vendor_id,vendor_name,template_kind,category_key,service_type,template_id,name,price_sell,price_base,markup_pct,is_published,is_active,status,published_at FROM public.vendor_catalog_items WHERE vendor_id IN (SELECT id FROM public.suppliers WHERE company_id=3) OR lower(vendor_name) LIKE '%diva servis%' ORDER BY id`)));
} finally {await c.end()}
