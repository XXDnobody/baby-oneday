import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { migrate } from "./migrate";
import { startBuiltServer } from "./built-server";
import { startB3TestServices } from "../tests/b3-services";
import { readConfig } from "../src/server/config";
import { closeDatabase, query } from "../src/server/db";
import { hashPassword } from "../src/server/crypto";
import { login } from "../src/server/auth";
import * as household from "../src/server/households";
import { saveGarment } from "../src/server/wardrobe";
import { enqueueJob } from "../src/server/job-store";
import { runOneJob } from "../src/server/b3-jobs";
import type { GarmentCategory, GarmentFields } from "../src/shared/wardrobe";

process.loadEnvFile(".env.test");
if (readConfig().APP_ENV !== "test") throw new Error("衣物浏览器验证只能使用隔离测试库");
// Keep browser fixtures separate from other test runs, which reset public tables.
const schema = "wardrobe_browser_" + randomUUID().replaceAll("-", "");
await query('CREATE SCHEMA "' + schema + '"'); await closeDatabase();
const isolatedUrl = new URL(process.env.DATABASE_URL!); isolatedUrl.searchParams.set("options", "-c search_path=" + schema);
process.env.DATABASE_URL = isolatedUrl.toString();
const services = await startB3TestServices();
Object.assign(process.env, services.env, { APP_URL: "http://127.0.0.1:3002", NEXT_DIST_DIR: process.argv.includes("--built") ? ".next" : ".next-test/wardrobe" });
await migrate(); await mkdir(".local", { recursive: true }); await mkdir("output/playwright", { recursive: true });
const suffix = randomUUID().slice(0, 8), password = "wardrobe-browser-fixture-" + suffix;
const accounts = { owner: "wardrobe-browser-owner-" + suffix + "@example.test", member: "wardrobe-browser-member-" + suffix + "@example.test" };
const encoded = await hashPassword(password), userIds: string[] = [];
for (const [who, email] of Object.entries(accounts)) {
  const row = await query<{ id: string }>("INSERT INTO users(email,email_key,display_name,password_hash,can_create_household) VALUES ($1,$1,$2,$3,$4) RETURNING id", [email, who === "owner" ? "衣橱测试爸爸" : "衣橱测试家人", encoded, who === "owner"]); userIds.push(row[0].id);
}
const raw = (await login({ email: accounts.owner, password, remember: true }, "wardrobe-browser-fixture")).token;
const family = await household.createHousehold(raw, { name: "衣物浏览器测试家庭", city: "上海", timezone: "Asia/Shanghai" }, randomUUID());
await query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,'member')", [family.id, userIds[1]]);
await household.saveSetup(raw, family.id, { expectedRevision: 1, child: { name: "测试宝宝", birthDate: null, ageMonths: 17, foodStatus: "none", foodRestrictions: "" } });
await query("INSERT INTO weather_locations(household_id,label,latitude,longitude,provenance,confirmed_by) VALUES ($1,'上海 · 测试地点',31.23,121.47,'专用浏览器测试',$2)", [family.id, userIds[0]]);
const today = household.localDate(), tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
for (const date of [today, tomorrow]) {
  const plan = await household.createPlan(raw, family.id, date, randomUUID());
  await household.addItem(raw, family.id, plan.id, { expectedRevision: 1, kind: "activity", title: "公园里走一走", time: "09:00", scene: "outdoor", notes: "虚拟浏览器测试活动", caregiverId: null, contentId: null, contentVersion: null }, randomUUID());
}
async function image(category: GarmentCategory, color: string) {
  const shapes: Partial<Record<GarmentCategory, string>> = {
    top: '<path d="M97 54 68 66 35 110 65 130 85 105 84 227 216 227 215 105 235 130 265 110 232 66 203 54 179 68 121 68Z"/>',
    outerwear: '<path d="M100 46 62 68 29 146 67 162 85 120 82 245 218 245 215 120 233 162 271 146 238 68 200 46 170 65 130 65Z"/><path d="M150 65V245 M102 174H125 M176 174H199" fill="none" stroke="#7b8d77" stroke-width="3"/>',
    bottom: '<path d="M83 48H217L229 250H168L150 139 132 250H71Z"/><path d="M84 65H216 M150 65V139" fill="none" stroke="#a49982" stroke-width="3"/>',
    shoes: '<path d="M35 177 63 107 113 111 122 166 146 184 143 214H35Z M159 177 187 107 237 111 246 166 270 184 267 214H159Z"/><path d="M40 203H139 M164 203H263" stroke="#eee9dd" stroke-width="9"/>',
    onepiece: '<path d="M104 44 66 67 40 117 79 133 100 101 95 163 57 252H243L205 163 200 101 221 133 260 117 234 67 196 44 174 62H126Z"/>',
  };
  return sharp(Buffer.from('<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="300" fill="#f4f2ea"/><g fill="' + color + '" stroke="#b4b7a3" stroke-width="2" stroke-linejoin="round">' + (shapes[category] ?? shapes.top) + '</g></svg>')).png().toBuffer();
}
const base: GarmentFields = { name: "", category: "top", warmth: "medium", color: "", size: "90 cm", scene: "either", activities: ["daily", "active", "quiet", "stroller"], status: "ready", waterproof: false, windproof: false, notes: "仅供浏览器验证的虚拟衣物" };
for (const [name, category, color, status] of [["奶油色小卫衣", "top", "#e8dcc1", "ready"], ["鼠尾草绿长裤", "bottom", "#a4b49a", "ready"], ["挡风小外套", "outerwear", "#c4cdb9", "ready"], ["米色运动鞋", "shoes", "#cab99a", "ready"], ["蓝色小衬衫", "top", "#afc2cc", "ready"], ["粉色连体裙", "onepiece", "#d9bcb3", "ready"], ["待洗的浅色上衣", "top", "#e3decf", "laundry"]] as const) {
  await saveGarment(raw, family.id, { ...base, name, category, color, status, windproof: category === "outerwear", waterproof: category === "outerwear", photo: "data:image/png;base64," + (await image(category, color)).toString("base64") }, randomUUID());
}
await writeFile(".local/wardrobe-upload.png", await image("top", "#cbb7a4"));
await writeFile(".local/wardrobe-browser-fixture.json", JSON.stringify({ householdId: family.id, accounts, password, today, tomorrow, schema, origin: "http://127.0.0.1:3002", fixture: "synthetic only" }, null, 2));
const job = await household.withHousehold(raw, family.id, (db) => enqueueJob(db, family.id, "weather", family.id + ":wardrobe-fixture", { date: tomorrow, startTime: "09:00", endTime: "10:00", scene: "outdoor" })); await runOneJob(job.id);
await closeDatabase();
const web = process.argv.includes("--built") ? await startBuiltServer(3002) : spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3002"], { env: process.env, stdio: "inherit" });
const worker = spawn(process.execPath, ["--import", "tsx", "scripts/worker.ts", "--test"], { env: process.env, stdio: "inherit" });
let closing = false;
async function close() { if (closing) return; closing = true; web.kill("SIGTERM"); worker.kill("SIGTERM"); await services.close(); }
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void close(); });
web.on("exit", () => { void close(); }); worker.on("exit", () => { void close(); });
console.log("衣物浏览器验证：3002 / 隔离 PostgreSQL 5433 / 合成衣物和天气；不访问真实家庭数据。");
