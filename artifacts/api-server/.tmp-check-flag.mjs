import pg from 'pg';
const c=new pg.Client({connectionString:process.env.SUPABASE_DATABASE_URL,ssl:{rejectUnauthorized:false}}); await c.connect();
const r=await c.query(`SELECT key,value FROM app_config WHERE key='FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE'`); console.log(JSON.stringify(r.rows)); await c.end();
