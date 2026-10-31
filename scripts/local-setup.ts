import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadEnvironment } from "./load-env";
import { migrate } from "./migrate";
import { closeDatabase, query } from "../src/server/db";
import { digest, token } from "../src/server/crypto";

const config = loadEnvironment();
if (config.APP_ENV === "production") throw new Error("此脚本只用于本地开发或测试");
try {
  await migrate();
  await mkdir(".local", { recursive: true, mode: 0o700 });
  const target = config.APP_ENV === "test" ? ".local/test-registration-link.txt" : ".local/first-registration-link.txt";
  const existing = await query<{ token_hash: string; consumed_by: string | null }>("SELECT token_hash,consumed_by FROM bootstrap_grants");
  if (existing[0]?.consumed_by) {
    console.log("首位账号已建立。直接打开 " + config.origin + " 登录；不会新增或重置账号。");
  } else if (existing.length) {
    const saved = await readFile(target, "utf8").catch(() => "");
    const savedToken = saved ? new URL(saved.trim()).searchParams.get("token") : null;
    if (savedToken && digest(savedToken) === existing[0].token_hash) {
      console.log("一次性注册链接已保存在 " + target);
    } else {
      throw new Error("数据库已有未消费的初始化凭证，但本机链接文件缺失。请保留数据库并人工核查，不会自动重置准入。");
    }
  } else {
    const raw = token();
    await query("INSERT INTO bootstrap_grants(token_hash) VALUES ($1)", [digest(raw)]);
    await writeFile(target, config.origin + "/register?token=" + raw + "\n", { mode: 0o600 });
    console.log("本地初始化完成；一次性注册链接保存在 " + target);
  }
} finally { await closeDatabase(); }
