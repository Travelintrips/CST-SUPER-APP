import pg from 'pg'; const {Client}=pg; const c=new Client({connectionString:process.env.SUPABASE_DATABASE_URL,ssl:{rejectUnauthorized:false}}); await c.connect();
try {
 const qs={
  companies:`SELECT id,COALESCE(company_name,name) name,COALESCE(company_code,code) code,is_active FROM companies WHERE is_active ORDER BY id`,
  suppliers:`SELECT id,name,company_id,status,is_active,is_verified,marketplace_status,public_slug,service_type FROM suppliers ORDER BY id`,
  assignments:`SELECT vca.id,vca.vendor_id,vca.company_id,s.name vendor_name,COALESCE(c.company_name,c.name) company_name FROM vendor_company_assignments vca LEFT JOIN suppliers s ON s.id=vca.vendor_id LEFT JOIN companies c ON c.id=vca.company_id ORDER BY vca.id`,
  templates:`SELECT id,service_type,label,is_active,company_id FROM service_templates WHERE id=2 OR service_type='trucking'`,
  catalog:`SELECT id,vendor_id,vendor_name,type,template_kind,category_key,service_type,template_id,name,price_sell,is_active,is_published,status FROM vendor_catalog_items ORDER BY id`
 };
 for (const [k,s] of Object.entries(qs)) console.log(k,JSON.stringify((await c.query(s)).rows));
} finally {await c.end()}
