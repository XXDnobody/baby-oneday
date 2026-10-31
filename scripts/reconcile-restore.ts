import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import pg from "pg";
import { loadEnvironment } from "./load-env";
import { assertRestoreDatabase, reconcileRecovery } from "../src/server/recovery-safety";

const config = loadEnvironment();
if (config.APP_ENV !== "test") throw new Error("仅允许 5433 的独立恢复副本，必须加 --test");
const name = process.argv.find((v) => v.startsWith("--database="))?.slice(11) ?? "";
assertRestoreDatabase(name);
const checkpointPath = process.argv.find((v) => v.startsWith("--checkpoint="))?.slice(13);
if (!checkpointPath) throw new Error("缺少最后写入后的核对资料；保持副本隔离");
const url = new URL(config.DATABASE_URL); url.pathname = "/" + name;
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  const result = await reconcileRecovery(client, JSON.parse(await readFile(checkpointPath, "utf8")), config.AUTH_SECRET, process.argv.includes("--confirm-source-frozen"));
  const output = process.argv.find((v) => v.startsWith("--output="))?.slice(9) ?? "output/b4-local-2026-10-31/reconciliation.json";
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, dataGaps: result.dataGaps.length }, null, 2));
} finally { await client.end(); }
