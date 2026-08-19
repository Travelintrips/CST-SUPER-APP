import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, max: 2, connectionTimeoutMillis: 15000, idleTimeoutMillis: 15000 });
try {
  const identity = await pool.query("SELECT current_user, session_user, current_database(), current_setting('row_security') AS row_security, has_table_privilege(current_user, 'public.startup_migration_state', 'SELECT') AS can_select, has_table_privilege(current_user, 'public.startup_migration_state', 'INSERT') AS can_insert, has_table_privilege(current_user, 'public.startup_migration_state', 'UPDATE') AS can_update");
  const policies = await pool.query("SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='startup_migration_state' ORDER BY policyname");
  const role = await pool.query("SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname=current_user");
  console.log(JSON.stringify({ identity: identity.rows, role: role.rows, policies: policies.rows }, null, 2));
} finally { await pool.end(); }
