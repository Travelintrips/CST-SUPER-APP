import { db, apiResponseTimesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const MAX_ROWS_PER_PATH = 500;

export interface ResponseTimeEntry {
  timestamp: string;
  path: string;
  durationMs: number;
}

const _log: ResponseTimeEntry[] = [];
const MAX_MEMORY_ENTRIES = 100;

export function recordResponseTime(path: string, durationMs: number): void {
  const entry: ResponseTimeEntry = { timestamp: new Date().toISOString(), path, durationMs };
  _log.push(entry);
  if (_log.length > MAX_MEMORY_ENTRIES) _log.shift();

  void (async () => {
    try {
      await db.insert(apiResponseTimesTable).values({ path, durationMs });
      await db.execute(
        sql`DELETE FROM api_response_times WHERE id IN (
          SELECT id FROM api_response_times
          WHERE path = ${path}
          ORDER BY id DESC
          OFFSET ${MAX_ROWS_PER_PATH}
        )`
      );
    } catch {
    }
  })();
}

export async function getRecentResponseTimesFromDb(pathFragment?: string): Promise<ResponseTimeEntry[]> {
  try {
    const rows = pathFragment
      ? await db
          .select()
          .from(apiResponseTimesTable)
          .where(sql`path LIKE ${"%" + pathFragment + "%"}`)
          .orderBy(sql`id DESC`)
          .limit(50)
      : await db
          .select()
          .from(apiResponseTimesTable)
          .orderBy(sql`id DESC`)
          .limit(50);
    return rows
      .reverse()
      .map((r) => ({
        timestamp: r.timestamp.toISOString(),
        path: r.path,
        durationMs: r.durationMs,
      }));
  } catch {
    return getRecentResponseTimesMemory(pathFragment);
  }
}

export function getRecentResponseTimesMemory(pathFragment?: string): ResponseTimeEntry[] {
  const entries = pathFragment
    ? _log.filter((e) => e.path.includes(pathFragment))
    : [..._log];
  return entries.slice(-50);
}

export function getRecentResponseTimes(pathFragment?: string): ResponseTimeEntry[] {
  return getRecentResponseTimesMemory(pathFragment);
}
