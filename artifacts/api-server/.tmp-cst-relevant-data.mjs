import pg from 'pg'; const {Client}=pg; const c=new Client({connectionString:process.env.SUPABASE_DATABASE_URL,ssl:{rejectUnauthorized:false}}); await c.connect();
try {
 const q=async(s,p=[]) => (await c.query(s,p)).rows;
 console.log('ASSIGNMENTS',JSON.stringify(await q(`SELECT vca.id,vca.vendor_id,vca.company_id,s.name vendor_name,COALESCE(c.company_name,c.name) company_name FROM vendor_company_assignments vca LEFT JOIN suppliers s ON s.id=vca.vendor_id LEFT JOIN companies c ON c.id=vca.company_id ORDER BY vca.id`)));
 console.log('SERVICE_TABLES',JSON.stringify(await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%status%history%' ORDER BY table_name`)));
 for (const n of ['supplier_status_history','supplier_status_histories','vendor_status_history']) console.log(n,JSON.stringify(await q(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[n])));
 console.log('VENDOR_EXAMPLES',JSON.stringify(await q(`SELECT id,name,company_id,status,is_active,is_verified,marketplace_status,public_slug,service_type FROM suppliers WHERE marketplace_status='published' ORDER BY id LIMIT 10`)));
 console.log('CATALOG_EXAMPLES',JSON.stringify(await q(`SELECT id,vendor_id,vendor_name,type,template_kind,category_key,service_type,template_id,template_version,name,description,unit,price_base,markup_pct,price_sell,currency,stock_status,moq,status,is_published,is_active,template_snapshot,spec_values FROM vendor_catalog_items WHERE is_published=true ORDER BY id LIMIT 8`)));
} finally {await c.end()}
