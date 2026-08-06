import pg from "pg";
import { logger } from "./logger.js";
import { getAdminGroupWa } from "./adminWa.js";

const { Client } = pg;

const LOCAL_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;

async function getTableSet(connStr: string, ssl: boolean): Promise<Set<string>> {
  const client = new Client({
    connectionString: connStr,
    ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  try {
    const res = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    return new Set(res.rows.map((r) => r.table_name));
  } finally {
    await client.end();
  }
}

async function applyTableToSupabase(tableName: string, localUrl: string, supaUrl: string): Promise<boolean> {
  const localClient = new Client({ connectionString: localUrl });
  const supaClient = new Client({ connectionString: supaUrl, ssl: { rejectUnauthorized: false } });
  await localClient.connect();
  await supaClient.connect();
  try {
    const colRes = await localClient.query<{
      column_name: string; data_type: string; is_nullable: string;
      column_default: string | null; udt_name: string;
      character_maximum_length: number | null; numeric_precision: number | null; numeric_scale: number | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default, udt_name,
             character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    const pkRes = await localClient.query<{ column_name: string }>(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = $1
      ORDER BY kcu.ordinal_position
    `, [tableName]);

    const idxRes = await localClient.query<{ index_name: string; is_unique: boolean; columns: string | string[] }>(`
      SELECT i.relname AS index_name, ix.indisunique AS is_unique,
             array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE t.relname = $1 AND n.nspname = 'public' AND NOT ix.indisprimary
      GROUP BY i.relname, ix.indisunique
    `, [tableName]);

    function colType(col: typeof colRes.rows[0]): string {
      const m: Record<string, string> = {
        int4: "integer", int8: "bigint", int2: "smallint", float4: "real", float8: "double precision",
        bool: "boolean", timestamptz: "timestamp with time zone", timestamp: "timestamp without time zone",
        text: "text", jsonb: "jsonb", json: "json", uuid: "uuid", date: "date",
      };
      if (col.udt_name === "varchar" || col.udt_name === "bpchar") {
        return col.character_maximum_length ? `character varying(${col.character_maximum_length})` : "character varying";
      }
      if (col.udt_name === "numeric") {
        return col.numeric_precision != null && col.numeric_scale != null
          ? `numeric(${col.numeric_precision},${col.numeric_scale})`
          : "numeric";
      }
      return m[col.udt_name] || col.data_type || col.udt_name;
    }

    const sequences: string[] = [];
    const colDefs = colRes.rows.map((col) => {
      const type = colType(col);
      const nullable = col.is_nullable === "YES" ? "" : " NOT NULL";
      const defVal = col.column_default ?? "";
      const seqMatch = defVal.match(/nextval\('([^']+)'(?:::regclass)?\)/i);
      if (seqMatch) sequences.push(seqMatch[1]);
      const def = defVal ? ` DEFAULT ${defVal}` : "";
      return `  "${col.column_name}" ${type}${nullable}${def}`;
    });

    const pkCols = pkRes.rows.map((r) => r.column_name);
    if (pkCols.length > 0) {
      colDefs.push(`  PRIMARY KEY (${pkCols.map((c) => `"${c}"`).join(", ")})`);
    }

    for (const seq of sequences) {
      await supaClient.query(`CREATE SEQUENCE IF NOT EXISTS "${seq}"`).catch(() => {});
    }

    await supaClient.query(
      `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${colDefs.join(",\n")}\n)`
    );

    for (const idx of idxRes.rows) {
      const rawCols = idx.columns;
      const colArr: string[] = Array.isArray(rawCols)
        ? rawCols
        : typeof rawCols === "string"
          ? rawCols.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim()).filter(Boolean)
          : [];
      if (colArr.length === 0) continue;
      const cols = colArr.map((c) => `"${c}"`).join(", ");
      const unique = idx.is_unique ? "UNIQUE " : "";
      await supaClient.query(
        `CREATE ${unique}INDEX IF NOT EXISTS "${idx.index_name}" ON "${tableName}" (${cols})`
      ).catch(() => {});
    }

    return true;
  } catch (e: any) {
    logger.error({ table: tableName, err: e.message }, "[dbSyncWorker] Gagal apply tabel ke Supabase");
    return false;
  } finally {
    await localClient.end();
    await supaClient.end();
  }
}

export async function runDbSyncCheck(): Promise<{ missing: string[]; applied: string[]; failed: string[] }> {
  if (!LOCAL_URL || !SUPABASE_URL) {
    logger.warn("[dbSyncWorker] DATABASE_URL atau SUPABASE_DATABASE_URL tidak di-set — skip sync check");
    return { missing: [], applied: [], failed: [] };
  }

  let localTables: Set<string>;
  let supaTables: Set<string>;
  try {
    [localTables, supaTables] = await Promise.all([
      getTableSet(LOCAL_URL, false),
      getTableSet(SUPABASE_URL, true),
    ]);
  } catch (e: any) {
    logger.warn({ err: e.message }, "[dbSyncWorker] Gagal koneksi saat sync check");
    return { missing: [], applied: [], failed: [] };
  }

  const missing = [...localTables].filter((t) => !supaTables.has(t));
  if (missing.length === 0) {
    logger.info("[dbSyncWorker] Supabase sinkron — tidak ada tabel yang kurang");
    return { missing: [], applied: [], failed: [] };
  }

  logger.warn({ missing }, `[dbSyncWorker] ${missing.length} tabel missing di Supabase — mencoba auto-apply`);

  const applied: string[] = [];
  const failed: string[] = [];
  for (const table of missing) {
    const ok = await applyTableToSupabase(table, LOCAL_URL, SUPABASE_URL);
    if (ok) {
      applied.push(table);
      logger.info({ table }, "[dbSyncWorker] Tabel berhasil di-apply ke Supabase");
    } else {
      failed.push(table);
    }
  }

  return { missing, applied, failed };
}

export function startDbSyncWorker(): void {
  if (!LOCAL_URL || !SUPABASE_URL) return;

  setTimeout(async () => {
    try {
      const { missing, applied, failed } = await runDbSyncCheck();
      if (missing.length === 0) return;

      const lines: string[] = [
        `⚠️ *DB Sync Alert*`,
        `${missing.length} tabel ada di Replit tapi belum di Supabase.`,
        ``,
        `Applied: ${applied.length} OK${applied.length > 0 ? `\n${applied.map((t) => `  ✅ ${t}`).join("\n")}` : ""}`,
      ];
      if (failed.length > 0) {
        lines.push(`Gagal: ${failed.length}`);
        failed.forEach((t) => lines.push(`  ❌ ${t}`));
        lines.push(`\nJalankan: node scripts/db-sync-check.mjs --apply`);
      } else {
        lines.push(`\nSemua tabel sudah berhasil di-sync otomatis ✅`);
      }

      const message = lines.join("\n");
      try {
        const { sendViaService: sendWhatsApp } = await import("./waTransport.js");
        const adminGroup = await getAdminGroupWa();
        if (adminGroup) {
          await sendWhatsApp(adminGroup, message, { context: "db_sync_alert" });
        }
      } catch (e: any) {
        logger.warn({ err: e.message }, "[dbSyncWorker] Gagal kirim WA notif sync");
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, "[dbSyncWorker] Sync check error");
    }
  }, 90_000);
}
