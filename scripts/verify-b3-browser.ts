import { chooseDate } from "./browser-date";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import type { Conversation } from "../src/shared/b3";
import type { Day } from "../src/shared/contracts";

const evidenceDirectory = process.env.BP_EVIDENCE_DIR ?? "output/b3-local-2026-10-31";
const screenshotPrefix = process.env.BP_SCREENSHOT_PREFIX ?? "b3-";
const fixture = JSON.parse(await readFile(".local/b3-browser-fixture.json", "utf8"));
const origin = "http://127.0.0.1:3001", root = "households/" + fixture.householdId;
const report: Array<Record<string, unknown>> = [], errors: string[] = [];
let completed = false;
await mkdir("output/playwright", { recursive: true }); await mkdir(evidenceDirectory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function request<T = Record<string, unknown>>(page: Page, path: string, method = "GET", data?: unknown) {
  return page.evaluate(async ({ path, method, data }) => {
    const headers: Record<string, string> = {};
    if (method !== "GET") { const c = await (await fetch("/api/v1/auth/csrf")).json(); headers["X-CSRF-Token"] = c.data.csrfToken; headers["Content-Type"] = "application/json"; headers["Idempotency-Key"] = crypto.randomUUID(); }
    const r = await fetch("/api/v1/" + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) }); return { status: r.status, body: await r.json() };
  }, { path, method, data }) as Promise<{ status: number; body: { data: T; error?: { code: string } } }>;
}
async function login(page: Page, who: "owner" | "member", navigate = true) {
  if (navigate) await page.goto(origin); await page.getByLabel("邮箱", { exact: true }).fill(fixture.accounts[who]); await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/session") && r.request().method() === "POST"); await page.getByRole("button", { name: "登录", exact: true }).click(); assert.equal((await response).status(), 200, "UI login response");
  await page.getByRole("heading", { name: "今天怎么过" }).waitFor();
  const family = page.locator("#household-select"); if (await family.count()) await family.selectOption(fixture.householdId);
  await page.getByRole("button", { name: "添加安排", exact: true }).waitFor();
}
async function nav(page: Page, tab: string) { const name = tab === "每日安排" && await page.locator(".app-shell.tablet-mode").count() ? "平板主页" : tab; await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name, exact: true }).click(); }
async function freshProposal(page: Page, id: string, revision: number) {
  for (let i = 0; i < 60; i++) { const c = (await request<Conversation>(page, root + "/ai-conversations/" + id)).body.data; if (c.revision >= revision && c.proposals[0]?.turn === c.revision && c.proposals[0]?.state === "pending") return c.proposals[0]; await new Promise((r) => setTimeout(r, 200)); }
  throw new Error("New proposal was not prepared for the latest turn");
}
async function layout(page: Page, viewport: string, screen: string) {
  const result = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth, buttonsTooSmall: [...document.querySelectorAll("button")].filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43).length }));
  assert(result.content <= result.width + 1, viewport + "/" + screen + " horizontal page overflow " + JSON.stringify(result));
  assert.equal(result.buttonsTooSmall, 0, viewport + "/" + screen + " touch button height"); report.push({ kind: "layout", viewport, screen, ...result, passed: true });
}
async function shot(page: Page, name: string) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: "output/playwright/" + screenshotPrefix + name + ".png", fullPage: true }); }
try {
  const viewports = [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }, { name: "tablet-portrait", width: 834, height: 1194 }];
  for (const [index, viewport] of viewports.entries()) {
    const context = await browser.newContext({ viewport, isMobile: viewport.name === "mobile", hasTouch: viewport.name !== "desktop" }); const page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
    await login(page, "owner"); if (viewport.name === "desktop") await context.storageState({ path: ".local/b3-owner-browser-state.json" }); if (viewport.name.startsWith("tablet")) await page.getByRole("button", { name: "平板大字", exact: true }).click();
    await chooseDate(page, "安排日期", fixture.tomorrow); const weather = page.locator(".weather-panel"); await weather.getByText("活动时段预报", { exact: false }).waitFor(); await weather.getByRole("button", { name: "刷新天气" }).click(); await weather.getByText("已完成", { exact: false }).waitFor();
    await weather.getByText("衣物类别参考", { exact: true }).waitFor(); await weather.getByText("专用测试服务 · 非真实天气", { exact: true }).waitFor(); await layout(page, viewport.name, "weather"); await shot(page, viewport.name + "-weather");
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "AI 助手", exact: true }).click(); if (await page.locator("details.ai-discussions").getAttribute("open") === null) await page.locator("details.ai-discussions > summary").click();
    const entry = fixture.proposals[index]; await page.getByRole("navigation", { name: "我的私有讨论" }).getByRole("button", { name: entry.from + " 至 " + entry.to, exact: true }).click();
    const priorRevision = (await request<Conversation>(page, root + "/ai-conversations/" + entry.id)).body.data.revision;
    await page.getByLabel("继续讨论这段日期").fill("多日测试：请基于刚刷新的天气重新生成完整方案预览"); await page.getByRole("button", { name: "发送，先讨论与预览" }).click();
    await page.getByText("专用测试模型：按当前依赖重新生成多日前后值预览。", { exact: true }).last().waitFor({ state: "attached" });
    const fresh = await freshProposal(page, entry.id, priorRevision + 1);
    const confirmation = page.getByRole("button", { name: "确认采用，保存全部安排", exact: true }); await confirmation.waitFor(); assert.equal(await page.getByTestId("proposal-calendar").getByRole("table", { name: "待确认安排周历" }).locator("tbody button").count(), 2); await layout(page, viewport.name, "ai-preview"); await shot(page, viewport.name + "-ai-preview");
    if (viewport.name === "desktop") {
      let lost = false; await page.route("**/ai-proposals/**/confirm", async (route) => { if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); } else await route.continue(); });
      await confirmation.click(); await page.getByRole("alert").filter({ hasText: "暂时无法连接" }).waitFor(); await confirmation.click(); report.push({ kind: "flow", name: "successful-response-lost-then-retried", viewport: viewport.name, passed: true });
    } else await confirmation.click();
    await page.getByText("全部改动已保存并共享；家人只会看到正式结果。", { exact: true }).waitFor();
    const saved = await request<Day>(page, root + "/today?date=" + entry.from); assert.equal(saved.body.data.plan?.items.filter((i) => i.title === "测试浏览器第一天").length, 1);
    const retry = await request(page, root + "/ai-proposals/" + fresh.id + "/confirm", "POST", { turn: fresh.turn }); assert.equal(retry.status, 200); assert.deepEqual((await request<Day>(page, root + "/today?date=" + entry.from)).body.data, saved.body.data);
    await shot(page, viewport.name + "-ai-saved"); report.push({ kind: "flow", name: "multi-day-preview-confirm-and-replay", viewport: viewport.name, passed: true });
    for (const tab of ["每日安排", "菜谱活动", "食材偏好", "统一日历", "文字记录", "我的家庭", "回收站", "AI 助手"]) { await nav(page, tab); await page.locator("main h1").waitFor(); await layout(page, viewport.name, tab); }
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的家庭", exact: true }).click(); await page.getByRole("button", { name: "保存自动计划设置", exact: true }).waitFor(); await page.getByRole("button", { name: "添加时段", exact: true }).waitFor();
    if (viewport.name === "desktop") {
      if (!await page.getByLabel("作息名称 1", { exact: true }).count()) await page.getByRole("button", { name: "添加时段", exact: true }).click();
      await page.getByLabel("作息名称 1", { exact: true }).fill("浏览器测试午睡"); await page.getByLabel("作息时间 1", { exact: true }).fill("07:00"); await page.getByLabel("作息类型 1", { exact: true }).selectOption("routine"); await page.getByLabel("作息场景 1", { exact: true }).selectOption("indoor"); await page.getByRole("button", { name: "保存作息", exact: true }).click(); await page.getByText("作息已保存，已有日计划保持原样。", { exact: true }).waitFor(); report.push({ kind: "flow", name: "template-kind-scene-controls-save", passed: true });
    }
    await page.getByText("经纬度已确认", { exact: false }).waitFor(); await layout(page, viewport.name, "family-loaded-template-controls"); await shot(page, viewport.name + "-family");
    if (viewport.name === "desktop") await context.storageState({ path: ".local/b3-owner-browser-state.json" });
    if (viewport.name === "tablet-portrait") {
      await page.setViewportSize({ width: 1194, height: 834 }); for (const tab of ["每日安排", "AI 助手", "我的家庭", "菜谱活动", "食材偏好", "统一日历", "文字记录", "回收站"]) { await nav(page, tab); await layout(page, "tablet-landscape", tab); }
      await nav(page, "我的家庭"); await page.getByRole("button", { name: "保存自动计划设置", exact: true }).waitFor(); await page.getByLabel("作息名称 1", { exact: true }).waitFor(); await layout(page, "tablet-landscape", "family-loaded-template-controls"); await shot(page, "tablet-landscape-family");
      await nav(page, "每日安排"); await shot(page, "tablet-landscape-weather");
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message)); await login(page, "owner");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "AI 助手", exact: true }).click(); if (await page.locator("details.ai-discussions").getAttribute("open") === null) await page.locator("details.ai-discussions > summary").click();
  await chooseDate(page, "讨论开始日期", fixture.tomorrow); const next = new Date(Date.parse(fixture.tomorrow) + 86400000).toISOString().slice(0, 10); await chooseDate(page, "讨论结束日期", next); await page.getByRole("button", { name: "新建这段日期的讨论" }).click(); await page.getByText("例如：帮我安排这一周的菜单和户外活动，按宝宝 1 人份列出备料。", { exact: true }).waitFor();
  await page.getByLabel("继续讨论这段日期").fill("B3_OWNER_PRIVATE_BROWSER_SENTINEL 请给出预览"); await page.getByRole("button", { name: "发送，先讨论与预览" }).click(); await page.getByRole("button", { name: "确认采用，保存全部安排" }).waitFor();
  const list = await request<Array<{ id: string }>>(page, root + "/ai-conversations"); const conversationId = list.body.data[0].id; const old = await request<Conversation>(page, root + "/ai-conversations/" + conversationId); const oldProposal = old.body.data.proposals[0];
  await page.getByLabel("继续讨论这段日期").fill("再改一下，采用最后的方案"); await page.getByRole("button", { name: "发送，先讨论与预览" }).click(); await page.getByText("浏览器讨论后的最终安排", { exact: true }).last().waitFor();
  await freshProposal(page, conversationId, old.body.data.revision + 1); const superseded = await request(page, root + "/ai-proposals/" + oldProposal.id + "/confirm", "POST", { turn: oldProposal.turn }); assert.equal(superseded.status, 409); assert.equal(superseded.body.error?.code, "PROPOSAL_SUPERSEDED");
  await page.getByRole("button", { name: "确认采用，保存全部安排" }).click(); await page.getByText("全部改动已保存并共享；家人只会看到正式结果。", { exact: true }).waitFor(); await shot(page, "continued-final-proposal");
  const forbidden = await request(page, root + "/ai-conversations/" + fixture.memberPrivateConversationId); assert.equal(forbidden.status, 404); report.push({ kind: "flow", name: "continue-supersedes-old-preview-and-admin-cannot-read-member", passed: true });
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的家庭", exact: true }).click();
  const settings = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "次日自动计划", exact: true }) }); await settings.getByLabel("夜间准备时间").fill("20:10"); await settings.getByRole("button", { name: "保存自动计划设置", exact: true }).click(); await settings.getByText("自动计划设置已保存，已有安排保持原样。", { exact: true }).waitFor(); assert.equal((await request<{ runTime: string }>(page, root + "/automation")).body.data.runTime, "20:10");
  await page.getByRole("button", { name: "设置天气地点", exact: true }).click(); await page.getByLabel("纬度", { exact: true }).fill("31.24"); await page.getByRole("button", { name: "保存天气地点", exact: true }).click(); await page.getByText("天气地点已保存；已有活动保持原样。", { exact: true }).waitFor();
  await nav(page, "每日安排"); await page.getByRole("button", { name: "准备 " + fixture.tomorrow + " 安排", exact: true }).click(); await page.getByText("只补允许补缺的位置；既有安排保持原样。", { exact: false }).count();
  const preparation = page.locator("section").filter({ has: page.getByRole("heading", { name: "明天，提前一点准备", exact: true }) }).last(); await preparation.getByText("已完成", { exact: false }).waitFor(); report.push({ kind: "flow", name: "admin-settings-location-and-next-day-task", passed: true });
  await page.getByRole("button", { name: "退出登录", exact: true }).click(); await login(page, "member", false); await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "AI 助手", exact: true }).click(); if (await page.locator("details.ai-discussions").getAttribute("open") === null) await page.locator("details.ai-discussions > summary").click(); await page.getByRole("heading", { name: "先商量，再一起安排", exact: true }).waitFor(); assert(!(await page.locator("body").innerText()).includes("B3_OWNER_PRIVATE_BROWSER_SENTINEL"));
  assert.equal((await request(page, root + "/ai-conversations/" + conversationId)).status, 404); assert.equal((await request(page, root + "/jobs/" + old.body.data.jobs[0].id)).status, 404);
  await shot(page, "shared-device-member-private"); await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的家庭", exact: true }).click(); assert.equal(await page.getByRole("button", { name: "保存自动计划设置", exact: true }).count(), 0); report.push({ kind: "flow", name: "same-browser-identity-switch-private-cache-and-field-permissions", passed: true });
  await context.close(); assert.deepEqual(errors, []); completed = true;
} finally {
  await writeFile(evidenceDirectory + "/b3-browser-verification.json", JSON.stringify({ verifiedAt: new Date().toISOString(), browser: browser.version(), environment: "3001 / isolated PostgreSQL 5433 / explicit loopback fixture services", realDevices: false, realServices: false, passed: completed && report.every((r) => r.passed) && errors.length === 0, checks: report, pageErrors: errors }, null, 2)); await browser.close();
}
console.log("B3 浏览器检查通过：" + report.length + " 项流程／布局检查。");
