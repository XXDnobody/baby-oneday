import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import pg from "pg";
import { readConfig } from "../src/server/config";

process.loadEnvFile(".env.test");
const config = readConfig();
if (config.APP_ENV !== "test") throw new Error("恢复演练只能使用独立测试环境");
const name = "baby_plan_restore_" + Date.now();
const source = new pg.Client({ connectionString: config.DATABASE_URL });
const restoredUrl = new URL(config.DATABASE_URL); restoredUrl.pathname = "/" + name;
const restored = new pg.Client({ connectionString: restoredUrl.toString() });
const control = new pg.Client({ connectionString: config.DATABASE_URL });
let created = false; let connected = false;
const report: Array<{ table: string; rows: number; matched: boolean }> = [];
await source.connect(); await control.connect();
try {
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await source.query("SET LOCAL timezone='UTC'");
  const snapshot = (await source.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot;
  const tables = (await source.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const dump = execFileSync("docker", ["exec", "baby-plan-postgres-test", "pg_dump", "-U", "baby_plan_test", "-Fc", "--snapshot=" + snapshot, "baby_plan_test"], { maxBuffer: 64 * 1024 * 1024 });
  await mkdir(".local/backups", { recursive: true, mode: 0o700 });
  await writeFile(".local/backups/" + name + ".dump", dump, { mode: 0o600 });
  await control.query('CREATE DATABASE "' + name + '" TEMPLATE template0'); created = true;
  execFileSync("docker", ["exec", "-i", "baby-plan-postgres-test", "pg_restore", "-U", "baby_plan_test", "--no-owner", "--exit-on-error", "-d", name], { input: dump, maxBuffer: 1024 * 1024 });
  await restored.connect(); connected = true;
  await restored.query("SET timezone='UTC'");
  for (const { tablename } of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error("未知表名");
    const sql = 'SELECT count(*)::int AS rows,md5(COALESCE(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),\'\')) AS digest FROM "' + tablename + '" t';
    const [a, b] = await Promise.all([source.query<{ rows: number; digest: string }>(sql), restored.query<{ rows: number; digest: string }>(sql)]);
    const matched = a.rows[0].rows === b.rows[0].rows && a.rows[0].digest === b.rows[0].digest;
    report.push({ table: tablename, rows: a.rows[0].rows, matched });
    if (!matched) throw new Error("恢复校验不一致：" + tablename);
  }
  await source.query("COMMIT");
} finally {
  if (connected) await restored.end();
  await source.end();
  if (created) await control.query('DROP DATABASE "' + name + '"');
  await control.end();
}
const reportPath = process.argv.find((v) => v.startsWith("--output="))?.slice("--output=".length) ?? "output/local-development-2026-10-31/backup-verification.json";
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ verifiedAt: new Date().toISOString(), source: "isolated test database", target: name, snapshotConsistent: true, tables: report, targetRemovedAfterCheck: true }, null, 2));
console.log("独立恢复演练通过：" + report.length + " 张表的行数和逐行内容摘要一致。恢复副本已关闭并移除，备份保留于忽略的 .local/backups。");
