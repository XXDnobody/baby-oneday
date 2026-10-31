import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import pg from "pg";
import { loadEnvironment } from "./load-env";
import { captureRecoveryCheckpoint } from "../src/server/recovery-safety";

const config = loadEnvironment();
if (config.APP_ENV === "production") throw new Error("本工具只验证本地流程；生产外置流水与备份策略尚待落实");
const target = resolve(process.argv.find((v) => v.startsWith("--output="))?.slice(9) ?? ".local/recovery/latest-checkpoint.json");
if (!target.startsWith(resolve(".local") + sep)) throw new Error("含权限元数据的核对资料只能存放在忽略的 .local 内");
const client = new pg.Client({ connectionString: config.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const checkpoint = await captureRecoveryCheckpoint(client, config.AUTH_SECRET);
  await client.query("COMMIT");
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, JSON.stringify(checkpoint, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ capturedAt: checkpoint.payload.capturedAt, highWatermark: checkpoint.payload.highWatermark, events: checkpoint.payload.events.length, signed: true, includesBodiesOrCredentials: false, note: "本机受控核对资料；5 分钟内用于隔离副本。最终核对前须停止源 Web 与 worker；历史检查点不能证明最后写入。" }, null, 2));
} finally { await client.end(); }
