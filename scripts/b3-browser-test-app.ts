import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { startBuiltServer } from "./built-server";
import { readConfig } from "../src/server/config";
import { startB3TestServices } from "../tests/b3-services";
process.loadEnvFile(".env.test");
if (readConfig().APP_ENV !== "test") throw new Error("Browser fixture app is test-only");
const built = process.argv.includes("--built");
if (built) await access(".next/BUILD_ID");
const fixture = await startB3TestServices(); Object.assign(process.env, fixture.env, { APP_URL: "http://127.0.0.1:3001", NEXT_DIST_DIR: built ? ".next" : ".next-test" });
fixture.state.respondToPrompt = (messages) => {
  const source = messages.find((m) => m.content.startsWith("当前获授权的资料："));
  const data = JSON.parse(source!.content.slice("当前获授权的资料：".length));
  const last = messages.filter((m) => m.role === "user").at(-1)!.content;
  if (last.includes("多日测试")) return { answer: "专用测试模型：按当前依赖重新生成多日前后值预览。", operations: [[data.from, "09:00", "测试浏览器第一天"], [data.to, "10:00", "测试浏览器第二天"]].map(([date, time, title]) => {
    const existing = data.items.find((i: { date: string; time: string }) => i.date === date && i.time === time);
    const item = { kind: "routine", title, time, notes: "显式测试服务的多日方案", scene: "either", caregiverId: null, contentId: null, contentVersion: null };
    return existing ? { type: "plan.update", itemId: existing.id, item } : { type: "plan.add", date, item };
  }) };
  const existing = data.items.find((i: { date: string; time: string }) => i.date === data.from && i.time === "14:00");
  const item = { kind: "routine", title: last.includes("再改") ? "浏览器讨论后的最终安排" : "浏览器讨论生成的安排", time: "14:00", notes: "显式测试模型返回，仅用于浏览器验证。", scene: "either", caregiverId: null, contentId: null, contentVersion: null };
  return { answer: "专用测试模型：讨论日期为 " + data.from + " 至 " + data.to + "。请核对下面的最终预览。", operations: last.includes("只查询") ? [] : [existing ? { type: "plan.update", itemId: existing.id, item } : { type: "plan.add", date: data.from, item }] };
};
const web = built ? await startBuiltServer(3001) : spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3001"], { env: process.env, stdio: "inherit" });
const worker = spawn(process.execPath, ["--import", "tsx", "scripts/worker.ts", "--test"], { env: process.env, stdio: "inherit" });
let closing = false;
async function close() { if (closing) return; closing = true; web.kill("SIGTERM"); worker.kill("SIGTERM"); await fixture.close(); }
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void close(); });
web.on("exit", () => { void close(); }); worker.on("exit", () => { void close(); });
console.log("B3 显式测试应用：3001 / PostgreSQL 5433 / loopback 天气及模型 / " + (built ? "已构建版本，无开发热更新" : "开发热更新模式") + "；不代表真实服务接入。");
