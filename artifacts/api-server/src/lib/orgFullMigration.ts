import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const COMPANIES = [
  { id: 1, company_name: "PT Cahaya Sejati Teknologi", company_code: "CST" },
  { id: 2, company_name: "PT Wangsamas", company_code: "WGS" },
  { id: 3, company_name: "PT Diva Servis", company_code: "DVS" },
  { id: 4, company_name: "PT Elmira Ratu Abadi", company_code: "ERA" },
];

interface SeededRow { id: number }

async function insertIfNotExists(
  table: string,
  uniqueCol: string,
  uniqueVal: string | number,
  insertSql: string,
): Promise<number> {
  const safeVal = String(uniqueVal).replace(/'/g, "''");
  const existing = await db.execute(
    sql.raw(`SELECT id FROM ${table} WHERE ${uniqueCol} = '${safeVal}' LIMIT 1`),
  );
  if ((existing.rows[0] as unknown as SeededRow | undefined)?.id) {
    return (existing.rows[0] as unknown as SeededRow).id;
  }
  const inserted = await db.execute(sql.raw(insertSql));
  return (inserted.rows[0] as unknown as SeededRow).id;
}

export async function runOrgFullMigration(): Promise<void> {
  try {
    // ─── 1. sections table ────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sections (
        id            SERIAL PRIMARY KEY,
        company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        name          TEXT NOT NULL,
        code          TEXT,
        description   TEXT,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS sections_company_idx    ON sections(company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS sections_department_idx ON sections(department_id)`);

    // ─── 2. Add FK columns to users table ────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS division_id  INTEGER REFERENCES divisions(id)   ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS section_id   INTEGER REFERENCES sections(id)    ON DELETE SET NULL
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_company_idx    ON users(company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_branch_idx     ON users(branch_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_division_id_idx ON users(division_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS users_dept_id_idx    ON users(department_id)`);

    // ─── 3. Ensure companies table has name/code aliases ────────────────────
    await db.execute(sql`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS is_holding BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS parent_company_id INTEGER
    `);
    // Back-fill name/code from company_name/company_code
    await db.execute(sql`
      UPDATE companies SET name = company_name WHERE name = '' OR name IS NULL
    `);
    await db.execute(sql`
      UPDATE companies SET code = company_code WHERE code = '' OR code IS NULL
    `);

    // ─── 4. Ensure branches/divisions/departments tables exist ───────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS branches (
        id         SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        code       TEXT,
        address    TEXT,
        phone      TEXT,
        is_active  BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS branches_company_idx ON branches(company_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS divisions (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        code        TEXT,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS divisions_company_idx ON divisions(company_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS departments (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        division_id INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
        name        TEXT NOT NULL,
        code        TEXT,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS departments_company_idx  ON departments(company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS departments_division_idx ON departments(division_id)`);

    // ─── 5. Seed branches ────────────────────────────────────────────────────
    const branchSeed: Array<{ company_id: number; name: string; code: string; address: string }> = [
      // CST
      { company_id: 1, name: "Kantor Pusat CST",     code: "KP-CST",  address: "Jakarta Pusat" },
      { company_id: 1, name: "Cabang Jakarta Utara", code: "JKU-CST", address: "Jakarta Utara" },
      { company_id: 1, name: "Cabang Surabaya",      code: "SBY-CST", address: "Surabaya" },
      // WGS
      { company_id: 2, name: "Kantor Pusat WGS",     code: "KP-WGS",  address: "Jakarta Selatan" },
      { company_id: 2, name: "Cabang Bandung",        code: "BDG-WGS", address: "Bandung" },
      // DVS
      { company_id: 3, name: "Kantor Pusat DVS",     code: "KP-DVS",  address: "Jakarta Timur" },
      // ERA
      { company_id: 4, name: "Kantor Pusat ERA",     code: "KP-ERA",  address: "Tangerang" },
      { company_id: 4, name: "Cabang Bekasi",         code: "BKS-ERA", address: "Bekasi" },
    ];
    for (const b of branchSeed) {
      const existing = await db.execute(
        sql`SELECT id FROM branches WHERE company_id = ${b.company_id} AND code = ${b.code} LIMIT 1`,
      );
      if (!(existing.rows[0] as unknown as SeededRow | undefined)?.id) {
        await db.execute(sql`
          INSERT INTO branches (company_id, name, code, address)
          VALUES (${b.company_id}, ${b.name}, ${b.code}, ${b.address})
        `);
      }
    }

    // ─── 6. Seed divisions ───────────────────────────────────────────────────
    const divisionDefs: Array<{ company_id: number; name: string; code: string; desc: string }> = [
      // CST
      { company_id: 1, name: "Operasional",  code: "OPS-CST", desc: "Divisi Operasional & Logistik" },
      { company_id: 1, name: "Keuangan",     code: "FIN-CST", desc: "Divisi Keuangan & Akuntansi" },
      { company_id: 1, name: "SDM",          code: "HRD-CST", desc: "Sumber Daya Manusia" },
      { company_id: 1, name: "Teknologi",    code: "IT-CST",  desc: "Teknologi Informasi" },
      { company_id: 1, name: "Penjualan",    code: "SAL-CST", desc: "Sales & Marketing" },
      // WGS
      { company_id: 2, name: "Operasional",  code: "OPS-WGS", desc: "Divisi Operasional" },
      { company_id: 2, name: "Keuangan",     code: "FIN-WGS", desc: "Divisi Keuangan" },
      { company_id: 2, name: "Penjualan",    code: "SAL-WGS", desc: "Divisi Penjualan" },
      // DVS
      { company_id: 3, name: "Operasional",  code: "OPS-DVS", desc: "Divisi Operasional" },
      { company_id: 3, name: "Keuangan",     code: "FIN-DVS", desc: "Divisi Keuangan" },
      // ERA
      { company_id: 4, name: "Operasional",  code: "OPS-ERA", desc: "Divisi Operasional" },
      { company_id: 4, name: "Keuangan",     code: "FIN-ERA", desc: "Divisi Keuangan" },
      { company_id: 4, name: "Penjualan",    code: "SAL-ERA", desc: "Divisi Penjualan" },
    ];

    const divisionIdMap: Record<string, number> = {};
    for (const d of divisionDefs) {
      const existing = await db.execute(
        sql`SELECT id FROM divisions WHERE company_id = ${d.company_id} AND code = ${d.code} LIMIT 1`,
      );
      let divId: number;
      if ((existing.rows[0] as unknown as SeededRow | undefined)?.id) {
        divId = (existing.rows[0] as unknown as SeededRow).id;
      } else {
        const ins = await db.execute(sql`
          INSERT INTO divisions (company_id, name, code, description)
          VALUES (${d.company_id}, ${d.name}, ${d.code}, ${d.desc})
          RETURNING id
        `);
        divId = (ins.rows[0] as unknown as SeededRow).id;
      }
      divisionIdMap[d.code] = divId;
    }

    // ─── 7. Seed departments ─────────────────────────────────────────────────
    const deptDefs: Array<{ division_code: string; company_id: number; name: string; code: string }> = [
      // CST OPS
      { division_code: "OPS-CST", company_id: 1, name: "Logistik",          code: "LOG-CST" },
      { division_code: "OPS-CST", company_id: 1, name: "Freight",            code: "FRT-CST" },
      { division_code: "OPS-CST", company_id: 1, name: "Ekspedisi",          code: "EXP-CST" },
      // CST FIN
      { division_code: "FIN-CST", company_id: 1, name: "Akuntansi",          code: "ACC-CST" },
      { division_code: "FIN-CST", company_id: 1, name: "Pajak",              code: "TAX-CST" },
      { division_code: "FIN-CST", company_id: 1, name: "Treasury",           code: "TRS-CST" },
      // CST HRD
      { division_code: "HRD-CST", company_id: 1, name: "Rekrutmen",          code: "RKT-CST" },
      { division_code: "HRD-CST", company_id: 1, name: "Pelatihan & Pengembangan", code: "PLT-CST" },
      // CST IT
      { division_code: "IT-CST",  company_id: 1, name: "Pengembangan Sistem",code: "DEV-CST" },
      { division_code: "IT-CST",  company_id: 1, name: "Infrastruktur",      code: "INF-CST" },
      // CST SAL
      { division_code: "SAL-CST", company_id: 1, name: "Penjualan Domestik", code: "DOM-CST" },
      { division_code: "SAL-CST", company_id: 1, name: "Penjualan Ekspor",   code: "EXI-CST" },
      // WGS
      { division_code: "OPS-WGS", company_id: 2, name: "Operasional",        code: "OPS1-WGS" },
      { division_code: "FIN-WGS", company_id: 2, name: "Akuntansi",          code: "ACC-WGS" },
      { division_code: "SAL-WGS", company_id: 2, name: "Penjualan",          code: "SAL1-WGS" },
      // DVS
      { division_code: "OPS-DVS", company_id: 3, name: "Servis",             code: "SRV-DVS" },
      { division_code: "FIN-DVS", company_id: 3, name: "Akuntansi",          code: "ACC-DVS" },
      // ERA
      { division_code: "OPS-ERA", company_id: 4, name: "Operasional",        code: "OPS1-ERA" },
      { division_code: "FIN-ERA", company_id: 4, name: "Akuntansi",          code: "ACC-ERA" },
      { division_code: "SAL-ERA", company_id: 4, name: "Penjualan",          code: "SAL1-ERA" },
    ];

    const deptIdMap: Record<string, number> = {};
    for (const d of deptDefs) {
      const divId = divisionIdMap[d.division_code];
      if (!divId) continue;
      const existing = await db.execute(
        sql`SELECT id FROM departments WHERE company_id = ${d.company_id} AND code = ${d.code} LIMIT 1`,
      );
      let deptId: number;
      if ((existing.rows[0] as unknown as SeededRow | undefined)?.id) {
        deptId = (existing.rows[0] as unknown as SeededRow).id;
      } else {
        const ins = await db.execute(sql`
          INSERT INTO departments (company_id, division_id, name, code)
          VALUES (${d.company_id}, ${divId}, ${d.name}, ${d.code})
          RETURNING id
        `);
        deptId = (ins.rows[0] as unknown as SeededRow).id;
      }
      deptIdMap[d.code] = deptId;
    }

    // ─── 8. Seed sections (CST only as example) ──────────────────────────────
    const sectionDefs: Array<{ dept_code: string; company_id: number; name: string; code: string }> = [
      { dept_code: "LOG-CST", company_id: 1, name: "Tim Pengiriman Laut",  code: "SEA-LOG-CST" },
      { dept_code: "LOG-CST", company_id: 1, name: "Tim Pengiriman Udara", code: "AIR-LOG-CST" },
      { dept_code: "LOG-CST", company_id: 1, name: "Tim Pengiriman Darat", code: "LND-LOG-CST" },
      { dept_code: "FRT-CST", company_id: 1, name: "Tim FCL",              code: "FCL-FRT-CST" },
      { dept_code: "FRT-CST", company_id: 1, name: "Tim LCL",              code: "LCL-FRT-CST" },
      { dept_code: "DEV-CST", company_id: 1, name: "Tim Frontend",         code: "FE-DEV-CST" },
      { dept_code: "DEV-CST", company_id: 1, name: "Tim Backend",          code: "BE-DEV-CST" },
    ];
    for (const s of sectionDefs) {
      const deptId = deptIdMap[s.dept_code];
      if (!deptId) continue;
      const existing = await db.execute(
        sql`SELECT id FROM sections WHERE company_id = ${s.company_id} AND code = ${s.code} LIMIT 1`,
      );
      if (!(existing.rows[0] as unknown as SeededRow | undefined)?.id) {
        await db.execute(sql`
          INSERT INTO sections (company_id, department_id, name, code)
          VALUES (${s.company_id}, ${deptId}, ${s.name}, ${s.code})
        `);
      }
    }

    // ─── 9. Activate all existing org records ────────────────────────────────
    await db.execute(sql`UPDATE companies   SET is_active = TRUE WHERE is_active = FALSE OR is_active IS NULL`);
    await db.execute(sql`UPDATE branches    SET is_active = TRUE WHERE is_active = FALSE OR is_active IS NULL`);
    await db.execute(sql`UPDATE divisions   SET is_active = TRUE WHERE is_active = FALSE OR is_active IS NULL`);
    await db.execute(sql`UPDATE departments SET is_active = TRUE WHERE is_active = FALSE OR is_active IS NULL`);
    await db.execute(sql`UPDATE sections    SET is_active = TRUE WHERE is_active = FALSE OR is_active IS NULL`);
    // suppliers has CHECK constraint: is_active = (status = 'active').
    // Blanket SET TRUE violates it for archived rows (status='archived', is_active=false).
    // Derive is_active from status instead. IS DISTINCT FROM is NULL-safe.
    await db.execute(sql`
      UPDATE suppliers
      SET is_active = (status = 'active')
      WHERE is_active IS DISTINCT FROM (status = 'active')
    `);

    logger.info("Org full migration: selesai (sections, users FK columns, branches, divisions, departments, sections seeded)");
  } catch (err) {
    logger.error({ err }, "Org full migration failed");
    throw err;
  }
}
