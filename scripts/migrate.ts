import { readdir, readFile } from "node:fs/promises";
import { digest } from "../src/server/crypto";
import { database, closeDatabase } from "../src/server/db";
import { loadEnvironment } from "./load-env";

export async function migrate() {
  const db = await database().connect();
  try {
    await db.query("SELECT pg_advisory_lock(84172930)");
    await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const files = (await readdir("migrations")).filter((p) => p.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = await readFile("migrations/" + file, "utf8");
      const checksum = digest(sql);
      const applied = await db.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE name=$1", [file]);
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) throw new Error("已应用的迁移内容发生变化：" + file);
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO schema_migrations(name, checksum) VALUES ($1,$2)", [file, checksum]);
        await db.query("COMMIT");
        console.log("已应用迁移：" + file);
      } catch (error) { await db.query("ROLLBACK"); throw error; }
    }
  } finally { await db.query("SELECT pg_advisory_unlock(84172930)"); db.release(); }
}

if (process.argv[1]?.endsWith("/migrate.ts")) {
  loadEnvironment();
  try { await migrate(); } finally { await closeDatabase(); }
}
