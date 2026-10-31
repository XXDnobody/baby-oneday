import pg, { type PoolClient, type QueryResultRow } from "pg";
import { readConfig } from "./config";

let pool: pg.Pool | undefined;
export function database() {
  pool ??= new pg.Pool({ connectionString: readConfig().DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
  return pool;
}
export async function query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  return (await database().query<T>(sql, values)).rows;
}
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await database().connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout = '5s'");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
export async function closeDatabase() { await pool?.end(); pool = undefined; }
