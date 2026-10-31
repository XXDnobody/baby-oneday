import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { loadEnvironment } from "./load-env";
import { serviceStatus } from "../src/server/services";

const config = loadEnvironment();
if (config.APP_ENV !== "local") throw new Error("仅核对本机开发库");
const out = "output/b4-local-2026-10-31";
await mkdir(out, { recursive: true });
const client = new pg.Client({ connectionString: config.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL timezone='UTC'");
  const tables = (await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const data: Array<{ table: string; rows: number; digest: string }> = [];
  for (const { tablename } of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error("未知表名");
    const summary = (await client.query<{ rows: number; digest: string }>(`SELECT count(*)::int AS rows,md5(COALESCE(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),'')) AS digest FROM "${tablename}" t`)).rows[0];
    data.push({ table: tablename, ...summary });
  }
  const registration = (await client.query("SELECT count(*)::int AS grants,count(consumed_by)::int AS consumed FROM bootstrap_grants")).rows[0];
  const users = (await client.query("SELECT count(*)::int AS count FROM users")).rows[0].count;
  const sessions = (await client.query("SELECT count(*)::int AS count,count(*) FILTER (WHERE revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now())::int AS active,count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked FROM sessions")).rows[0];
  const households = (await client.query("SELECT count(*)::int AS count,count(*) FILTER (WHERE setup_complete)::int AS initialized FROM households")).rows[0];
  const contents = (await client.query("SELECT kind,count(*)::int AS count,count(enabled_version)::int AS enabled FROM content_items GROUP BY kind ORDER BY kind")).rows;
  await client.query("COMMIT");
  const migrations: Record<string, string> = {};
  for (const name of (await readdir("migrations")).sort()) migrations[name] = createHash("sha256").update(await readFile("migrations/" + name)).digest("hex");
  const mode = process.argv.includes("--after") ? "after" : "before";
  const report = { checkedAt: new Date().toISOString(), environment: "development 5432; read-only", registration: { ...registration, users, linkFilePresent: !!await readFile(".local/first-registration-link.txt", "utf8").catch(() => ""), action: registration.consumed ? "use existing login" : "use existing controlled registration; no account created" }, sessions, households, contents, services: serviceStatus(), tables: data, migrations };
  await writeFile(`${out}/preflight-${mode}.json`, JSON.stringify(report, null, 2));
  if (mode === "after") {
    const before = JSON.parse(await readFile(`${out}/preflight-before.json`, "utf8")) as typeof report;
    const changedTables = before.tables.filter((a) => a.table !== "schema_migrations" && !data.some((b) => a.table === b.table && a.rows === b.rows && a.digest === b.digest)).map((a) => a.table);
    const changes = changedTables.filter((table) => table !== "sessions");
    const migrationChanges = Object.keys(before.migrations).filter((name) => migrations[name] !== before.migrations[name]);
    await writeFile(`${out}/development-data-preservation.json`, JSON.stringify({ checkedAt: report.checkedAt, originalTables: before.tables.length, comparedTables: before.tables.length - 1, expectedSchemaMigrationAppend: Object.keys(migrations).filter((name) => !(name in before.migrations)), changedTables, businessChanges: changes, operationalSessionChange: changedTables.includes("sessions") ? { beforeRows: before.tables.find((t) => t.table === "sessions")?.rows, afterRows: sessions.count, currentActive: sessions.active, currentRevoked: sessions.revoked, note: "会话逐行摘要变化，已有 Web 页面请求会更新最后活跃时间。本轮没有登录、重置或撤销开发账号；初始仅保存摘要，不能据此证明只有活跃时间变化。" } : null, originalMigrationChanges: migrationChanges, businessDataUnchanged: changes.length === 0, allOriginalRowsUnchanged: changedTables.length === 0, originalMigrationsUnchanged: migrationChanges.length === 0, contents }, null, 2));
    if (changes.length || migrationChanges.length) throw new Error("开发库或原迁移有变化，须核对报告");
  }
  console.log(JSON.stringify({ mode, registration: report.registration, households, contents, tableCount: data.length, servicesReady: { weather: report.services.weather.ready, ai: report.services.ai.ready } }, null, 2));
} finally { await client.end(); }
