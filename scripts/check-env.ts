import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { readConfig } from "../src/server/config";

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function databaseLabel(value: string) {
  const url = new URL(value);
  return `${url.hostname}:${url.port}${url.pathname}`;
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("postgres://") || message.includes("postgresql://") || message.includes("AUTH_SECRET")) {
    return "连接失败，详细信息已省略。";
  }
  return message;
}

function isRefused(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "ECONNREFUSED") return true;
  if ("errors" in error && Array.isArray(error.errors)) return error.errors.some((item) => isRefused(item));
  return error instanceof Error && error.message.includes("ECONNREFUSED");
}

async function queryDatabase(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ db: string }>("select current_database() as db");
    const row = result.rows[0];
    if (!row) throw new Error("数据库没有返回当前库名");
    return row.db;
  } finally {
    await client.end();
  }
}

try {
  const local = readConfig(loadEnvFile(".env.local"));
  const devDb = await queryDatabase(local.DATABASE_URL);
  console.log(`开发数据库已连接：${databaseLabel(local.DATABASE_URL)}，当前库 ${devDb}`);

  if (local.MAIL_TRANSPORT === "smtp") {
    const ready = await fetch(new URL("/readyz", local.MAILPIT_URL));
    if (!ready.ok) throw new Error(`Mailpit readyz 返回 ${ready.status}`);
    const info = await fetch(new URL("/api/v1/info", local.MAILPIT_URL));
    if (!info.ok) throw new Error(`Mailpit info 返回 ${info.status}`);
    const body = (await info.json()) as { Version?: string; version?: string };
    const version = body.Version ?? body.version ?? "unknown";
    console.log(`Mailpit 已就绪：SMTP ${local.SMTP_HOST}:${local.SMTP_PORT}，网页 ${local.MAILPIT_URL}，版本 ${version}`);
  }

  if (!existsSync(".env.test")) {
    console.log("未找到 .env.test，跳过测试数据库。");
  } else {
    try {
      const test = readConfig(loadEnvFile(".env.test"));
      const testDb = await queryDatabase(test.DATABASE_URL);
      console.log(`测试数据库已连接：${databaseLabel(test.DATABASE_URL)}，当前库 ${testDb}`);
    } catch (error) {
      if (!isRefused(error)) throw error;
      console.log("测试数据库未启动。需要时执行 npm run env:up:test。");
    }
  }
} catch (error) {
  console.error(safeMessage(error));
  process.exit(1);
}
