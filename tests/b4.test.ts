import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { ContentFields, ContentLibrary, ContentSettings, ContentVersion, PrintSnapshot, RecordEntry, RecordRevision } from "../src/shared/b2";
import type { Conversation, WeatherView } from "../src/shared/b3";
import type { Day, Household, ItemFields, Me, PlanItem } from "../src/shared/contracts";
import { closeDatabase, query } from "../src/server/db";
import { digest, hashPassword } from "../src/server/crypto";
import { localDate } from "../src/server/households";
import { shiftDate } from "../src/server/b3-time";
import { runOneJob } from "../src/server/b3-jobs";
import { startB3TestServices } from "./b3-services";
import { testClient } from "./http-client";

const owner = testClient(), member = testClient(), outsider = testClient();
const suffix = randomUUID().slice(0, 8), password = "B4-isolated-password-" + suffix;
const accounts = { owner: "b4-owner-" + suffix + "@example.test", member: "b4-member-" + suffix + "@example.test", outsider: "b4-outsider-" + suffix + "@example.test" };
const today = localDate(), tomorrow = shiftDate(today, 1), p = (id: string) => "households/" + id;
let ownerId: string, memberId: string, fixture: Awaited<ReturnType<typeof startB3TestServices>>;
const routine = (title = "B4虚拟安排", time = "09:00"): ItemFields => ({ title, time, kind: "routine", notes: "隔离回归", scene: "either", caregiverId: null, contentId: null, contentVersion: null });
function reviewed(title = "B4虚拟米饭"): ContentFields {
  return { kind: "recipe", title, summary: "仅工程夹具", ingredients: [{ name: "虚拟测试米", amountText: "测试用量", formText: "测试切配" }], steps: ["隔离测试步骤一", "隔离测试步骤二"], tips: [], materials: "", scene: "indoor", purpose: "", observations: "", variation: "", minAgeMonths: 12, maxAgeMonths: 30, applicability: "仅工程适用条件", preparation: "虚拟切配", quantityBasis: "虚拟用量", source: { title: "虚拟出处", author: "测试作者", url: "", edition: "test", locator: "虚拟第一条", summary: "仅测试", adaptation: "虚拟改编", verification: "checked", professionalReview: "not_performed", professionalNote: "" }, familyConfirmed: true, applicabilityConfirmed: true, ingredientsConfirmed: true, foodProfileRevision: 1, reviewIssues: [] };
}
async function createUser(email: string, browser = testClient()) {
  const id = (await query<{ id: string }>("INSERT INTO users(email,email_key,display_name,password_hash) VALUES ($1,$1,'B4虚拟身份',$2) RETURNING id", [email, await hashPassword(password)]))[0].id;
  expect((await browser.request("auth/session", "POST", { email, password, remember: true })).status).toBe(200); return { id, browser, email };
}
async function family() {
  const h = (await query<{ id: string }>("INSERT INTO households(name,city,setup_complete) VALUES ('B4隔离家庭','上海',true) RETURNING id"))[0].id;
  await query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,'admin'),($1,$3,'member')", [h, ownerId, memberId]);
  await query("INSERT INTO children(household_id,name,age_months,age_as_of,food_status) VALUES ($1,'B4虚拟宝宝',17,$2,'none')", [h, today]);
  await query("INSERT INTO household_templates(household_id,kind,slots) VALUES ($1,'weekday','[{\"label\":\"午餐\",\"time\":\"12:00\",\"kind\":\"meal\",\"scene\":\"indoor\"}]'),($1,'weekend','[{\"label\":\"周末午餐\",\"time\":\"12:00\",\"kind\":\"meal\",\"scene\":\"indoor\"}]')", [h]); return h;
}
async function day(h: string, date = today) { return (await owner.request<Day>(p(h) + "/today?date=" + date)).data; }
async function add(h: string, item = routine(), date = today) {
  const plan = (await owner.request<{ id: string }>(p(h) + "/plans", "POST", { date }, randomUUID())).data;
  const d = await day(h, date); const saved = await member.request<PlanItem>(p(h) + "/plans/" + plan.id + "/items", "POST", { ...item, expectedRevision: d.plan!.revision }, randomUUID());
  expect(saved.status, saved.error?.message).toBe(201); return saved.data;
}
async function content(h: string) {
  const c = (await owner.request<{ id: string }>(p(h) + "/content", "POST", reviewed(), randomUUID())).data;
  const v = (await owner.request<ContentVersion>(p(h) + "/content/" + c.id)).data; await enable(h, [{ id: v.id, version: v.version }]); return v;
}
async function enable(h: string, enabled: Array<{ id: string; version: number }>) {
  const s = (await owner.request<ContentSettings>(p(h) + "/content-settings")).data;
  expect((await owner.request(p(h) + "/content-settings", "PUT", { expectedRevision: s.revision, enabled }, randomUUID())).status).toBe(200);
}
async function proposal(h: string, operations: unknown[], browser = owner) {
  fixture.state.output = { answer: "B4显式测试模型的私有预览", operations };
  const c = (await browser.request<{ id: string }>(p(h) + "/ai-conversations", "POST", { from: today, to: shiftDate(today, 5) }, randomUUID())).data;
  const job = await browser.request<{ jobId: string }>(p(h) + "/ai-conversations/" + c.id + "/messages", "POST", { expectedRevision: 1, text: "B4私有讨论，不含真实家庭信息" }, randomUUID());
  await runOneJob(job.data.jobId);
  const result = (await browser.request<Conversation>(p(h) + "/ai-conversations/" + c.id)).data;
  expect(result.proposals.length).toBe(1); return result;
}
async function confirm(h: string, c: Conversation, browser = owner) { return browser.request(p(h) + "/ai-proposals/" + c.proposals[0].id + "/confirm", "POST", { turn: c.proposals[0].turn }, randomUUID()); }

beforeAll(async () => {
  ownerId = (await createUser(accounts.owner, owner)).id; memberId = (await createUser(accounts.member, member)).id; await createUser(accounts.outsider, outsider);
  fixture = await startB3TestServices(); Object.assign(process.env, fixture.env);
});
afterAll(async () => { await fixture.close(); await closeDatabase(); });

describe("B4 跨模块系统回归", () => {
  test("当前密码错误、未知字段和未登录修改均不改变凭证", async () => {
    const u = await createUser("b4-password-wrong-" + suffix + "@example.test");
    expect((await u.browser.request("auth/password", "PUT", { currentPassword: "wrong", password: "a-valid-new-password" })).error?.code).toBe("INVALID_PASSWORD");
    expect((await u.browser.request("auth/password", "PUT", { currentPassword: password, password: "a-valid-new-password", userId: ownerId })).status).toBe(422);
    expect((await testClient().request("auth/password", "PUT", { currentPassword: password, password: "a-valid-new-password" })).status).toBe(401);
    expect((await u.browser.request<Me>("me")).data.user.id).toBe(u.id);
  });
  test("主动修改密码撤销当前与其他设备及旧重置票据，保留用户和作者标识", async () => {
    const u = await createUser("b4-password-change-" + suffix + "@example.test"), other = testClient(), reset = randomUUID() + randomUUID();
    expect((await other.request("auth/session", "POST", { email: u.email, password, remember: true })).status).toBe(200);
    await query("INSERT INTO password_resets(user_id,token_hash,credential_version,expires_at) VALUES ($1,$2,1,now()+interval '10 minutes')", [u.id, digest(reset)]);
    expect((await u.browser.request("auth/password", "PUT", { currentPassword: password, password: "B4-new-password-after-change" })).data).toEqual({ changed: true, loginRequired: true });
    expect((await other.request("me")).status).toBe(401); expect((await u.browser.request("me")).status).toBe(401);
    expect((await testClient().request("auth/recovery/reset", "POST", { token: reset, password: "B4-replayed-reset-password" })).error?.code).toBe("INVALID_RESET");
    expect((await u.browser.request("auth/session", "POST", { email: u.email, password, remember: false })).status).toBe(401);
    expect((await u.browser.request("auth/session", "POST", { email: u.email, password: "B4-new-password-after-change", remember: true })).status).toBe(200);
    expect((await u.browser.request<Me>("me")).data.user.id).toBe(u.id);
  });
  test("两个设备并发改密码只有一个成功，不能把旧凭证覆盖回去", async () => {
    const u = await createUser("b4-password-race-" + suffix + "@example.test"), second = testClient();
    await second.request("auth/session", "POST", { email: u.email, password, remember: true });
    const results = await Promise.all([u.browser.request("auth/password", "PUT", { currentPassword: password, password: "B4-concurrent-password-one" }), second.request("auth/password", "PUT", { currentPassword: password, password: "B4-concurrent-password-two" })]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1); expect((await query<{ credential_version: number }>("SELECT credential_version FROM users WHERE id=$1", [u.id]))[0].credential_version).toBe(2);
  });
  test.each(["disabled", "new-version", "food-profile", "preference"])("%s 变化后旧计划、日历、记录与打印保持，新选择和 AI 确认重新检查", async (change) => {
    const h = await family(), v = await content(h), meal: ItemFields = { ...routine(v.title, "12:00"), kind: "meal", scene: "indoor", contentId: v.id, contentVersion: v.version };
    const item = await add(h, meal), record = (await member.request<RecordEntry>(p(h) + "/records", "POST", { occurredOn: today, text: "原安排的实际反馈", planItemId: item.id, planItemRevision: item.revision }, randomUUID())).data;
    const snap = (await owner.request<{ id: string }>(p(h) + "/print-snapshots", "POST", { kind: "day", date: today, expectedRevision: (await day(h)).plan!.revision, items: [{ id: item.id, revision: item.revision }] }, randomUUID())).data;
    const c = await proposal(h, [{ type: "plan.add", date: tomorrow, item: meal }]);
    if (change === "disabled") await enable(h, []);
    if (change === "new-version") expect((await owner.request(p(h) + "/content/" + v.id, "PATCH", { expectedRevision: v.revision, content: { ...reviewed("B4新版虚拟米饭"), familyConfirmed: false, source: { ...v.source, verification: "pending" } } }, randomUUID())).status).toBe(200);
    if (change === "food-profile") { const f = (await owner.request<Household>(p(h))).data; expect((await owner.request(p(h) + "/child", "PATCH", { expectedRevision: f.revision, child: { name: f.child!.name, ageMonths: 17, birthDate: null, foodStatus: "unknown", foodRestrictions: "" } })).status).toBe(200); }
    if (change === "preference") expect((await member.request(p(h) + "/preferences", "POST", { kind: "avoid", scope: "meal", text: v.title, startsOn: today, endsOn: tomorrow }, randomUUID())).status).toBe(201);
    expect((await confirm(h, c)).error?.code).toBe("REVISION_CONFLICT");
    const old = (await day(h)).plan!.items[0]; expect(old.id).toBe(item.id); expect(old.contentSnapshot?.title).toBe(v.title); expect(old.needsReview).toBe(true);
    const savedRecord = (await member.request<RecordEntry>(p(h) + "/records/" + record.id)).data; expect(savedRecord.authorId).toBe(memberId); expect(savedRecord.planSnapshot?.contentSnapshot?.title).toBe(v.title);
    expect((await owner.request<PrintSnapshot>(p(h) + "/print-snapshots/" + snap.id)).data.recipes[0].title).toBe(v.title);
    const library = (await member.request<ContentLibrary>(p(h) + "/content?kind=recipe&date=" + tomorrow + "&scene=indoor")).data; expect(library.items.some((i) => i.id === v.id && i.eligible)).toBe(false);
    const plan = (await owner.request<{ id: string; revision: number }>(p(h) + "/plans", "POST", { date: tomorrow }, randomUUID())).data;
    expect((await member.request(p(h) + "/plans/" + plan.id + "/items", "POST", { ...meal, expectedRevision: plan.revision }, randomUUID())).error?.code).toBe("CONTENT_NOT_ELIGIBLE");
    expect((await owner.request<Array<{ date: string; planCount: number; recordCount: number }>>(p(h) + "/calendar?from=" + today + "&to=" + tomorrow)).data.find((d) => d.date === today)).toMatchObject({ planCount: 1, recordCount: 1 });
  });
  test("有期限暂避到期只影响后续候选，自动补缺保留原人工待安排与库存快照", async () => {
    const h = await family(), v = await content(h), future = tomorrow;
    const input = { kind: "avoid", scope: "meal", text: v.title, startsOn: today, endsOn: today };
    expect((await member.request(p(h) + "/preferences", "POST", input, randomUUID())).status).toBe(201);
    const manual = await add(h, { ...routine("饮食待安排", "12:00"), kind: "meal", scene: "indoor" }, today);
    const pantry = (await member.request(p(h) + "/pantry")).data;
    for (const date of [today, future]) { const result = await owner.request<{ jobId: string }>(p(h) + "/automatic-plans", "POST", { date }, randomUUID()); expect(result.status, result.error?.message).toBe(202); await runOneJob(result.data.jobId); }
    expect((await day(h, today)).plan?.items[0].id).toBe(manual.id);
    expect((await day(h, future)).plan?.items[0].contentId).toBe(v.id); expect((await member.request(p(h) + "/pantry")).data).toEqual(pantry);
  });
  test("天气有效性改变后预览失效，旧安排与实际记录仍可读", async () => {
    const h = await family(), item = await add(h);
    await owner.request(p(h) + "/weather-location", "PUT", { expectedRevision: 1, label: "虚拟测试坐标", latitude: 31.23, longitude: 121.47, provenance: "仅隔离测试，非家庭确认" }, randomUUID());
    const j = (await member.request<{ jobId: string }>(p(h) + "/weather", "POST", { date: tomorrow, startTime: "09:00", endTime: "10:00", scene: "outdoor" }, randomUUID())).data; await runOneJob(j.jobId);
    const c = await proposal(h, [{ type: "plan.add", date: tomorrow, item: routine() }]);
    await query("UPDATE weather_snapshots SET stale_after=now()-interval '1 second' WHERE household_id=$1", [h]);
    expect((await confirm(h, c)).error?.code).toBe("REVISION_CONFLICT");
    expect((await day(h)).plan!.items[0].id).toBe(item.id); expect((await member.request<WeatherView>(p(h) + "/weather?date=" + tomorrow + "&startTime=09:00&endTime=10:00&scene=outdoor")).data.outfit).toBeNull();
  });
  test("成员撤销发生在模型响应期间，不落私有预览、不可确认或读取打印，作者仍保留", async () => {
    const h = await family(), item = await add(h), saved = (await member.request<RecordEntry>(p(h) + "/records", "POST", { occurredOn: today, text: "撤销前的记录", planItemId: item.id, planItemRevision: 1 }, randomUUID())).data;
    const c = await proposal(h, [{ type: "plan.add", date: tomorrow, item: routine() }], member);
    const next = (await member.request<{ jobId: string }>(p(h) + "/ai-conversations/" + c.id + "/messages", "POST", { expectedRevision: c.revision, text: "等待时撤销成员" }, randomUUID())).data;
    let started!: () => void, release!: () => void; const began = new Promise<void>((r) => { started = r; }), held = new Promise<void>((r) => { release = r; });
    fixture.state.onModel = async () => { started(); await held; }; const work = runOneJob(next.jobId); await began;
    const m = (await owner.request<Household>(p(h))).data.members.find((m) => m.userId === memberId)!;
    try { expect((await owner.request(p(h) + "/members/" + m.id, "DELETE", { expectedRevision: m.revision })).status).toBe(200); } finally { release(); await work; fixture.state.onModel = undefined; }
    expect((await member.request(p(h) + "/ai-conversations/" + c.id)).status).toBe(404); expect((await confirm(h, c, member)).status).toBe(404);
    expect((await owner.request<RecordEntry>(p(h) + "/records/" + saved.id)).data.authorId).toBe(memberId);
    expect((await query<{ state: string }>("SELECT state FROM b3_jobs WHERE id=$1", [next.jobId]))[0].state).toBe("failed");
  });
  test("同一客户端切换身份后私有会话与旧写请求重新授权；第二家庭与打印也隔离", async () => {
    const h = await family(), c = await proposal(h, [{ type: "plan.add", date: tomorrow, item: routine() }], member);
    const shared = testClient(); await shared.request("auth/session", "POST", { email: accounts.member, password, remember: true });
    expect((await shared.request(p(h) + "/ai-conversations/" + c.id)).status).toBe(200);
    await shared.request("auth/session", "DELETE"); await shared.request("auth/session", "POST", { email: accounts.owner, password, remember: true });
    expect((await shared.request(p(h) + "/ai-conversations/" + c.id)).status).toBe(404); expect((await confirm(h, c, shared)).status).toBe(404);
    const other = await family(); expect((await outsider.request(p(other) + "/today?date=" + today)).status).toBe(404);
    const print = (await owner.request<{ id: string }>(p(h) + "/print-snapshots", "POST", { kind: "recipe", date: today, contentId: (await content(h)).id, contentVersion: 1 }, randomUUID())).data;
    expect((await shared.request(p(other) + "/print-snapshots/" + print.id)).status).toBe(404);
  });
  test("删除恢复与内容版本、记录更正相连时保留原作者及快照，AI 已确认人工保护不被补回", async () => {
    const h = await family(), item = await add(h), r = (await member.request<RecordEntry>(p(h) + "/records", "POST", { occurredOn: today, text: "同一活动第一次", planItemId: item.id, planItemRevision: 1 }, randomUUID())).data;
    const c = await proposal(h, [{ type: "plan.update", itemId: item.id, item: routine("AI确认后的安排", "10:00") }]); expect((await confirm(h, c)).status).toBe(200);
    const current = (await day(h)).plan!.items[0];
    const deleted = (await member.request<{ revision: number }>(p(h) + "/plan-items/" + item.id, "DELETE", { expectedRevision: current.revision }, randomUUID())).data;
    const j = (await owner.request<{ jobId: string }>(p(h) + "/automatic-plans", "POST", { date: today }, randomUUID())).data; await runOneJob(j.jobId);
    expect((await day(h)).plan!.items.some((i) => i.time === "09:00" || i.time === "10:00")).toBe(false);
    const preview = (await member.request<{ planRevision: number }>(p(h) + "/plan-items/" + item.id + "/restore-preview", "POST", { expectedRevision: deleted.revision })).data;
    expect((await member.request(p(h) + "/plan-items/" + item.id + "/restore", "POST", { expectedRevision: deleted.revision, expectedPlanRevision: preview.planRevision }, randomUUID())).status).toBe(200);
    const original = (await member.request<RecordEntry>(p(h) + "/records/" + r.id)).data; expect(original.planSnapshot?.title).toBe(item.title); expect(original.authorId).toBe(memberId);
    expect((await owner.request(p(h) + "/records/" + r.id, "PATCH", { expectedRevision: r.revision, occurredOn: today, text: "管理员补充观察", correctionNote: "虚拟测试更正" }, randomUUID())).status).toBe(200);
    expect((await member.request<RecordRevision[]>(p(h) + "/records/" + r.id + "/revisions")).data.length).toBe(2);
  });
  test("为 B4 浏览器保留隔离双家庭、可重连编辑和可撤销会话夹具", async () => {
    const h = await family(), second = await family();
    const item = await add(h, routine("B4浏览器原安排", "09:00"));
    const c = await proposal(h, [{ type: "plan.add", date: tomorrow, item: routine("B4_OWNER_PRIVATE_SENTINEL", "14:00") }]);
    await mkdir(".local", { recursive: true, mode: 0o700 });
    await writeFile(".local/b4-browser-fixture.json", JSON.stringify({ householdId: h, secondHouseholdId: second, itemId: item.id, ownerId, memberId, accounts, password, today, tomorrow, privateConversationId: c.id, privateJobId: c.jobs[0].id }, null, 2), { mode: 0o600 });
    await mkdir("output/b4-local-2026-10-31", { recursive: true });
    await writeFile("output/b4-local-2026-10-31/integration-evidence.json", JSON.stringify({ verifiedAt: new Date().toISOString(), environment: "5433 / actual PostgreSQL + explicitly labelled loopback HTTP services", realServices: false, realFamilyData: false, cases: ["password change and concurrent devices", "content stop/version/food-profile/preference across plan-record-calendar-print-AI", "preference expiry and protected automatic gaps", "weather expiry", "membership revoked during model request", "same-client identity and household switching", "delete/restore with AI protection and original author"] }, null, 2));
  });
});
