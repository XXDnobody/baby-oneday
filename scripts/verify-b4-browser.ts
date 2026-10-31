import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import type { Day, DeviceSession, Household } from "../src/shared/contracts";
import type { RecordEntry } from "../src/shared/b2";
import { chooseDate } from "./browser-date";

const f = JSON.parse(await readFile(".local/b4-browser-fixture.json", "utf8"));
const origin = "http://127.0.0.1:3001", root = "households/" + f.householdId, out = "output/b4-local-2026-10-31";
const checks: Array<Record<string, unknown>> = [], errors: string[] = [];
const identityTrace: Array<Record<string, unknown>> = [];
let completed = false;
await mkdir(out, { recursive: true }); await mkdir("output/playwright", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function request<T = Record<string, unknown>>(page: Page, path: string, method = "GET", data?: unknown) {
  return page.evaluate(async ({ path, method, data }) => {
    const headers: Record<string, string> = {};
    if (method !== "GET") { const csrf = await (await fetch("/api/v1/auth/csrf")).json(); headers["X-CSRF-Token"] = csrf.data.csrfToken; headers["Content-Type"] = "application/json"; headers["Idempotency-Key"] = crypto.randomUUID(); }
    const r = await fetch("/api/v1/" + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), cache: "no-store" });
    return { status: r.status, body: await r.json() };
  }, { path, method, data }) as Promise<{ status: number; body: { data: T; error?: { code: string; message: string } } }>;
}
async function login(page: Page, who: "owner" | "member") {
  await page.goto(origin); await page.getByLabel("邮箱", { exact: true }).fill(f.accounts[who]); await page.getByLabel("密码", { exact: true }).fill(f.password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.getByRole("heading", { name: "今天怎么过" }).waitFor(); await selectFamily(page, f.householdId);
}
async function selectFamily(page: Page, h: string) {
  const select = page.locator("#household-select");
  if (await select.inputValue() !== h) {
    const response = page.waitForResponse((r) => r.url().includes("/households/" + h + "/today?") && r.status() === 200);
    await select.selectOption(h); await response;
  }
  await page.getByRole("button", { name: "添加安排", exact: true }).waitFor();
}
async function nav(page: Page, label: string) { const name = label === "每日安排" && await page.locator(".tablet-mode").count() ? "平板主页" : label; await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name, exact: true }).click(); }
async function shot(page: Page, name: string) { await page.screenshot({ path: "output/playwright/b4-" + name + ".png", fullPage: true }); }
function passed(name: string, details: Record<string, unknown> = {}) { checks.push({ name, ...details, passed: true }); console.log("通过：" + name); }
async function layout(page: Page, viewport: string, screen: string) {
  const metrics = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth, buttonsTooSmall: [...document.querySelectorAll("button")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43; }).map((e) => ({ text: e.textContent?.slice(0, 50), height: e.getBoundingClientRect().height })) }));
  assert(metrics.content <= metrics.width + 1, viewport + "/" + screen + " overflow " + JSON.stringify(metrics));
  assert.equal(metrics.buttonsTooSmall.length, 0, viewport + "/" + screen + " touch targets " + JSON.stringify(metrics.buttonsTooSmall));
  passed(viewport + "/" + screen, metrics);
}
async function mailCode(address: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const inbox = await (await fetch("http://127.0.0.1:8025/api/v1/messages?limit=100")).json() as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
    const mail = inbox.messages.find((m) => m.To.some((to) => to.Address.toLowerCase() === address));
    if (mail) { const body = await (await fetch("http://127.0.0.1:8025/api/v1/message/" + mail.ID)).json() as { Text: string }; const code = body.Text.match(/\b\d{6}\b/)?.[0]; if (code) return code; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mailpit 未收到本轮隔离测试验证码");
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) identityTrace.push({ event: "navigation", path: new URL(frame.url()).pathname, at: Date.now() }); });
  page.on("response", (response) => { if (response.url().endsWith("/api/v1/me")) void response.json().then((body) => identityTrace.push({ event: "identity", userId: body.data?.user?.id, households: body.data?.households.map((h: { id: string }) => h.id), at: Date.now() })).catch(() => {}); });
  await login(page, "owner"); await context.storageState({ path: ".local/b4-owner-browser-state.json" });
  const startingTitle = (await request<Day>(page, root + "/today?date=" + f.today)).body.data.plan!.items.find((i) => i.id === f.itemId)!.title;
  identityTrace.push({ event: "selected", household: await page.locator("#household-select").inputValue(), expected: f.householdId, at: Date.now() });
  const peerContext = await browser.newContext(), peer = await peerContext.newPage(); peer.on("pageerror", (e) => errors.push(e.message)); await login(peer, "member");

  // Two invitation registrations exercise real Mailpit and UI, with one revoked
  // after email verification. No development-account credential is touched.
  for (const revoked of [false, true]) {
    const invite = await request<{ id: string; url: string }>(page, root + "/invites", "POST", { role: "member" }); assert.equal(invite.status, 201);
    const signupContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), signup = await signupContext.newPage(); signup.on("pageerror", (e) => errors.push(e.message));
    await signup.goto(invite.body.data.url); await signup.getByRole("button", { name: "还没有账号？验证邮箱并加入", exact: true }).click();
    const email = "b4-browser-" + randomUUID() + "@example.test";
    await signup.getByLabel("邮箱", { exact: true }).fill(email); await signup.getByRole("button", { name: "发送验证码", exact: true }).click();
    await signup.getByLabel("邮箱验证码", { exact: true }).fill(await mailCode(email)); await signup.getByRole("button", { name: "验证邮箱", exact: true }).click();
    await signup.getByLabel("家人怎么称呼你", { exact: true }).fill("B4浏览器测试家人"); await signup.getByLabel("新密码", { exact: true }).fill("B4-browser-registration-password");
    if (revoked) assert.equal((await request(page, root + "/invites/" + invite.body.data.id, "DELETE")).status, 200);
    await signup.getByRole("button", { name: "完成注册", exact: true }).click();
    if (revoked) { await signup.getByRole("alert").filter({ hasText: "邀请已使用、撤销或过期" }).waitFor(); assert.equal((await request(signup, "me")).status, 401); }
    else { await signup.getByText("注册成功，请登录。", { exact: true }).waitFor(); assert.equal((await request(signup, "me")).status, 401); await signup.getByLabel("密码", { exact: true }).fill("B4-browser-registration-password"); await signup.getByRole("button", { name: "登录", exact: true }).click(); await signup.getByRole("button", { name: "添加安排", exact: true }).waitFor(); }
    await shot(signup, revoked ? "verified-invite-revoked" : "registered-member"); passed(revoked ? "UI verified invite revoked before registration" : "UI email verification, self-set password, login and household"); await signupContext.close();
    identityTrace.push({ event: "after-signup", revoked, household: await page.locator("#household-select").inputValue(), expected: f.householdId, at: Date.now() });
  }

  await page.getByRole("button", { name: "调整 " + startingTitle, exact: true }).click(); const editor = page.getByRole("dialog", { name: "调整这项安排", exact: true });
  const draft = "B4离线保留并核对后的输入"; await editor.getByLabel("安排名称", { exact: true }).fill(draft);
  await page.locator(".sync-status").filter({ hasText: "最后同步" }).waitFor(); await context.setOffline(true);
  await page.locator(".sync-status").filter({ hasText: "连接中断" }).waitFor(); await editor.getByRole("button", { name: "保存并共享", exact: true }).click(); await editor.getByRole("alert").filter({ hasText: "暂时无法连接" }).waitFor();
  assert.equal(await editor.getByLabel("安排名称", { exact: true }).inputValue(), draft); await shot(page, "offline-preserved-input");
  const current = (await request<Day>(peer, root + "/today?date=" + f.today)).body.data.plan!.items.find((i) => i.id === f.itemId)!;
  assert.equal((await request(peer, root + "/plan-items/" + current.id, "PATCH", { kind: current.kind, title: "B4家人联网保存的最新安排", time: current.time, notes: current.notes, caregiverId: current.caregiverId, contentId: current.contentId, contentVersion: current.contentVersion, scene: current.scene, expectedRevision: current.revision })).status, 200);
  await context.setOffline(false); await page.locator(".sync-status").filter({ hasText: "最后同步" }).waitFor();
  await editor.getByRole("button", { name: "保存并共享", exact: true }).click(); await editor.getByText("家人保存的最新内容", { exact: true }).waitFor(); await editor.getByText(/B4家人联网保存的最新安排/).waitFor();
  assert.equal(await editor.getByLabel("安排名称", { exact: true }).inputValue(), draft); await shot(page, "reconnected-conflict-review");
  await editor.getByRole("button", { name: "已核对，保留我的输入继续", exact: true }).click(); await editor.getByRole("button", { name: "保存并共享", exact: true }).click(); await editor.waitFor({ state: "hidden" });
  assert.equal((await request<Day>(page, root + "/today?date=" + f.today)).body.data.plan!.items.filter((i) => i.title === draft).length, 1); passed("offline draft, re-authentication, concurrent update, explicit conflict review and retry");

  let lost = false;
  await page.route("**/records", async (route) => { if (route.request().method() === "POST" && !lost) { lost = true; await route.fetch(); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: "记录 " + draft, exact: true }).click(); const recordEditor = page.getByRole("dialog", { name: "记一下这次发生", exact: true });
  const recordText = "B4响应丢失后重试仍只有一次的文字记录 " + randomUUID().slice(0, 8); await recordEditor.getByRole("textbox", { name: "想记下的话", exact: true }).fill(recordText); await recordEditor.getByRole("button", { name: "保存这一次记录", exact: true }).click();
  await recordEditor.getByRole("alert").filter({ hasText: "暂时无法连接" }).waitFor(); assert.equal(await recordEditor.getByRole("textbox", { name: "想记下的话", exact: true }).inputValue(), recordText);
  await recordEditor.getByRole("button", { name: "保存这一次记录", exact: true }).click(); await recordEditor.waitFor({ state: "hidden" }); await page.unrouteAll({ behavior: "wait" });
  const records = (await request<{ items: RecordEntry[] }>(page, root + "/records?from=" + f.today + "&to=" + f.today)).body.data.items.filter((r) => r.text === recordText); assert.equal(records.length, 1); assert.equal(records[0].authorId, f.ownerId); passed("record response lost after commit and retried once; original author retained");
  const recordCount = (await request<{ items: RecordEntry[] }>(page, root + "/records?from=" + f.today + "&to=" + f.today)).body.data.items.length;
  await nav(page, "统一日历"); await page.getByRole("button", { name: new RegExp("^" + f.today + "，计划 1，记录 " + recordCount) }).waitFor(); await shot(page, "calendar-plan-record"); await nav(page, "每日安排");
  await chooseDate(page, "安排日期", f.tomorrow); await page.getByText("这一天还没发生，先留好计划。", { exact: true }).waitFor(); await chooseDate(page, "安排日期", f.today); await page.getByRole("button", { name: "调整 " + draft, exact: true }).waitFor(); passed("future, today and actual record remain distinct");

  await page.getByRole("button", { name: "调整 " + draft, exact: true }).click(); await editor.getByRole("button", { name: "删除至回收站", exact: true }).click(); await editor.getByRole("button", { name: "确认删除这项安排", exact: true }).click(); await editor.waitFor({ state: "hidden" });
  assert.equal((await request<RecordEntry>(page, root + "/records/" + records[0].id)).body.data.planSnapshot?.title, draft);
  await nav(page, "回收站"); await page.getByRole("button", { name: "预览恢复安排", exact: true }).click(); await page.getByRole("button", { name: "确认恢复原安排", exact: true }).click(); await page.getByText("暂时没有可恢复内容", { exact: true }).waitFor(); await nav(page, "每日安排"); await page.getByRole("button", { name: "调整 " + draft, exact: true }).waitFor(); passed("calendar, record snapshot, delete, restore preview and original item recovery");

  await page.getByRole("button", { name: "生成当日打印快照", exact: true }).click(); const printPromise = context.waitForEvent("page"); await page.getByRole("link", { name: "打开固定打印快照", exact: true }).click(); const print = await printPromise;
  await print.getByRole("button", { name: "打印 A4 黑白版", exact: true }).waitFor(); await print.getByText(draft, { exact: true }).waitFor(); await print.emulateMedia({ media: "print" }); await shot(print, "print-media-fixed-snapshot"); await print.emulateMedia({ media: "screen" }); passed("browser print media, date and version; physical paper remains unverified");

  for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "tablet-portrait", width: 834, height: 1194 }, { name: "tablet-landscape", width: 1194, height: 834 }, { name: "desktop", width: 1440, height: 1000 }]) {
    const c = await browser.newContext({ viewport, storageState: ".local/b4-owner-browser-state.json", hasTouch: viewport.name !== "desktop", isMobile: viewport.name === "mobile" }), v = await c.newPage(); v.on("pageerror", (e) => errors.push(e.message));
    await v.goto(origin); await selectFamily(v, f.householdId); if (viewport.name.startsWith("tablet")) await v.getByRole("button", { name: "平板大字", exact: true }).click();
    for (const [label, screen] of [["每日安排", "today"], ["统一日历", "calendar"], ["文字记录", "records"], ["食材偏好", "pantry"], ["菜谱活动", "content"], ["回收站", "trash"], ["我的家庭", "family"], ["AI 助手", "ai"]]) {
      await nav(v, label); await v.locator(".panel").first().waitFor();
      // Wait for the requested module's observable loaded state, not an empty shell.
      if (screen === "calendar") await v.locator(".calendar-cell").first().waitFor();
      if (screen === "records") await v.getByText(recordText, { exact: true }).waitFor();
      if (screen === "family") await v.getByRole("heading", { name: "修改密码", exact: true }).waitFor();
      if (screen === "ai") { await v.getByRole("navigation", { name: "我的私有讨论" }).getByRole("button").first().waitFor(); }
      await layout(v, viewport.name, screen); await shot(v, viewport.name + "-" + screen);
    }
    await nav(v, "每日安排"); await v.getByRole("button", { name: "调整 " + draft, exact: true }).click(); await v.getByRole("dialog", { name: "调整这项安排" }).waitFor(); await layout(v, viewport.name, "editor"); await shot(v, viewport.name + "-editor"); await v.getByRole("button", { name: "关闭编辑", exact: true }).click();
    await c.close();
  }

  await page.getByRole("button", { name: "添加安排", exact: true }).click(); await page.getByLabel("安排名称", { exact: true }).fill("B4_NO_CROSS_IDENTITY_DRAFT");
  const cookieTab = await context.newPage(); await cookieTab.goto(origin); assert.equal((await request(cookieTab, "auth/session", "POST", { email: f.accounts.member, password: f.password, remember: true })).status, 200);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow"))); await page.waitForFunction(() => !document.body.innerText.includes("B4_NO_CROSS_IDENTITY_DRAFT") && !document.querySelector("dialog[open]"));
  assert.equal((await request(page, root + "/ai-conversations/" + f.privateConversationId)).status, 404); assert.equal((await request(page, root + "/jobs/" + f.privateJobId)).status, 404);
  await nav(page, "AI 助手"); assert(!(await page.locator("body").innerText()).includes("B4_OWNER_PRIVATE_SENTINEL")); await nav(page, "我的家庭"); assert.equal(await page.getByRole("button", { name: "修改宝宝资料", exact: true }).count(), 0); passed("same browser cookie identity switch removes unsaved input, private AI and administrator controls");

  const adminContext = await browser.newContext({ storageState: ".local/b4-owner-browser-state.json" }), admin = await adminContext.newPage(); await admin.goto(origin); await selectFamily(admin, f.householdId);
  const relation = (await request<Household>(admin, root)).body.data.members.find((m) => m.userId === f.memberId)!;
  assert.equal((await request(admin, root + "/members/" + relation.id, "DELETE", { expectedRevision: relation.revision })).status, 200);
  await page.waitForFunction((h) => (document.querySelector("#household-select") as HTMLSelectElement | null)?.value !== h, f.householdId);
  assert.equal((await request(page, root + "/today?date=" + f.today)).status, 404); await print.reload();
  await print.getByRole("alert").filter({ hasText: "家庭不存在或已无访问权限" }).waitFor(); assert(!(await print.locator("body").innerText()).includes(draft)); assert(await print.getByRole("button", { name: "打印 A4 黑白版", exact: true }).isDisabled()); passed("membership revoked while connected; SSE, household cache and print body stop access");
  const sessions = (await request<DeviceSession[]>(page, "auth/sessions")).body.data; const session = sessions.find((s) => s.current)!; assert.equal((await request(cookieTab, "auth/sessions/" + session.id, "DELETE")).status, 200);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow"))); await page.getByRole("button", { name: "登录", exact: true }).waitFor(); assert.equal((await request(page, "me")).status, 401); passed("current session revoked: private workspace clears and requires login");

  await nav(admin, "我的家庭"); const passwordForm = admin.locator("section").filter({ has: admin.getByRole("heading", { name: "修改密码", exact: true }) }).first();
  await passwordForm.getByLabel("当前密码", { exact: true }).fill(f.password); await passwordForm.getByLabel("新密码", { exact: true }).fill("B4-browser-new-password-after-trial"); await passwordForm.getByLabel("再次输入新密码", { exact: true }).fill("B4-browser-new-password-after-trial");
  await passwordForm.getByRole("button", { name: "修改密码并退出所有设备", exact: true }).click(); await admin.getByRole("button", { name: "登录", exact: true }).waitFor(); assert.equal((await request(admin, "me")).status, 401); passed("self-service password UI requires old password and logs out all devices");
  await adminContext.close(); await peerContext.close(); await context.close();
  assert.deepEqual(errors, []); completed = true;
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page && !page.isClosed()) {
    await shot(page, "failure");
    await writeFile(out + "/browser-failure.json", JSON.stringify({ ...(await page.evaluate(() => ({ selectedHousehold: (document.querySelector("#household-select") as HTMLSelectElement | null)?.value, text: document.body.innerText }))), identityTrace }, null, 2));
  }
  throw error;
} finally {
  await writeFile(out + "/browser-verification.json", JSON.stringify({ verifiedAt: new Date().toISOString(), browser: browser.version(), environment: "3001 / 5433 / real browser / explicit loopback fixture services", realServices: false, physicalDevices: false, paperPrinter: false, checks, identityTrace, pageErrors: errors, passed: completed && errors.length === 0 }, null, 2)); await browser.close();
}
console.log("B4 浏览器验证通过：" + checks.length + " 项。");
