import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AiOperation, Automation, Conversation, Job, ServiceStatus, WeatherLocation, WeatherView } from "../src/shared/b3";
import type { ContentFields, ContentSettings, ContentVersion, Pantry, Preference } from "../src/shared/b2";
import type { Day, Household, ItemFields, Me, PlanItem } from "../src/shared/contracts";
import { query, closeDatabase } from "../src/server/db";
import { hashPassword } from "../src/server/crypto";
import { localDate } from "../src/server/households";
import { instant, shiftDate } from "../src/server/b3-time";
import { serviceConfig, serviceStatus } from "../src/server/services";
import { claimJob, purgeWeatherBodies, runOneJob } from "../src/server/b3-jobs";
import { scheduleAutomatic } from "../src/server/automatic-plans";
import { purgeExpiredTrash } from "../src/server/retention";
import { testClient } from "./http-client";
import { startB3TestServices } from "./b3-services";

const owner = testClient(), member = testClient(), peer = testClient(), other = testClient();
const suffix = randomUUID().slice(0, 8), password = "B3-test-only-password-" + suffix;
const accounts = { owner: "b3-owner-" + suffix + "@example.test", member: "b3-member-" + suffix + "@example.test", peer: "b3-peer-" + suffix + "@example.test", other: "b3-other-" + suffix + "@example.test" };
const today = localDate(), tomorrow = shiftDate(today, 1), p = (h: string) => "households/" + h;
let householdId: string, otherHouseholdId: string, ownerId: string, memberId: string, peerId: string;
let fixture: Awaited<ReturnType<typeof startB3TestServices>>;
const routine = (title = "测试生活作息", time = "09:00"): ItemFields => ({ title, time, kind: "routine", notes: "仅测试", caregiverId: null, contentId: null, contentVersion: null, scene: "either" });
function reviewed(kind: "recipe" | "activity", title: string, scene: "indoor" | "outdoor" = "indoor"): ContentFields {
  return { kind, title, summary: "B3 虚拟测试材料", ingredients: kind === "recipe" ? [{ name: title, amountText: "测试用量", formText: "测试切配" }] : [], steps: ["虚拟测试步骤"], tips: [], materials: "虚拟测试材料", scene, purpose: "测试互动", observations: "测试观察", variation: "测试调整", minAgeMonths: 12, maxAgeMonths: 30, applicability: "仅测试适用条件", preparation: "仅测试切配依据", quantityBasis: "仅测试用量依据", source: { title: "虚拟出处", author: "测试人", url: "", edition: "2026-test", locator: "虚拟测试第一条", summary: "只验证工程行为", adaptation: "测试改编", verification: "checked", professionalReview: "not_performed", professionalNote: "" }, familyConfirmed: true, applicabilityConfirmed: true, ingredientsConfirmed: kind === "recipe", foodProfileRevision: kind === "recipe" ? 1 : null, reviewIssues: [] };
}
async function freshFamily(foodStatus = "none", slots: unknown[] = []) {
  const id = (await query<{ id: string }>("INSERT INTO households(name,city,setup_complete) VALUES ('B3隔离虚拟家庭','上海',true) RETURNING id"))[0].id;
  await query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,'admin'),($1,$3,'member'),($1,$4,'member')", [id, ownerId, memberId, peerId]);
  await query("INSERT INTO children(household_id,name,age_months,age_as_of,food_status) VALUES ($1,'B3虚拟宝宝',17,$2,$3)", [id, today, foodStatus]);
  await query("INSERT INTO household_templates(household_id,kind,slots) VALUES ($1,'weekday',$2),($1,'weekend',$2)", [id, JSON.stringify(slots)]); return id;
}
async function createContent(h: string, fields: ContentFields) {
  const r = await owner.request<{ id: string }>(p(h) + "/content", "POST", fields, randomUUID()); expect(r.status, r.error?.message).toBe(201);
  return (await owner.request<ContentVersion>(p(h) + "/content/" + r.data.id)).data;
}
async function enable(h: string, contents: ContentVersion[]) {
  const settings = (await owner.request<ContentSettings>(p(h) + "/content-settings")).data;
  expect((await owner.request(p(h) + "/content-settings", "PUT", { expectedRevision: settings.revision, enabled: contents.map((v) => ({ id: v.id, version: v.version })) }, randomUUID())).status).toBe(200);
}
async function day(h: string, date = tomorrow) { return (await owner.request<Day>(p(h) + "/today?date=" + date)).data; }
async function add(h: string, fields: ItemFields, date = tomorrow) {
  const plan = (await owner.request<{ id: string }>(p(h) + "/plans", "POST", { date }, randomUUID())).data;
  const d = await day(h, date);
  const r = await member.request<PlanItem>(p(h) + "/plans/" + plan.id + "/items", "POST", { ...fields, expectedRevision: d.plan!.revision }, randomUUID()); expect(r.status, r.error?.message).toBe(201); return r.data;
}
async function queueAuto(h: string) { const r = await owner.request<{ jobId: string }>(p(h) + "/automatic-plans", "POST", { date: tomorrow }, randomUUID()); expect(r.status, r.error?.message).toBe(202); return r.data.jobId; }
async function job(h: string, id: string, browser = owner) { return (await browser.request<Job>(p(h) + "/jobs/" + id)).data; }
async function setLocation(h: string, input = {}) {
  const current = (await owner.request<WeatherLocation | null>(p(h) + "/weather-location")).data;
  const r = await owner.request<WeatherLocation>(p(h) + "/weather-location", "PUT", { expectedRevision: current?.revision ?? 1, label: "上海家庭确认地点", latitude: 31.234, longitude: 121.474, provenance: "虚拟测试坐标，非真实家庭确认", ...input }, randomUUID()); expect(r.status, r.error?.message).toBe(200); return r.data;
}
const weatherQuery = (date = tomorrow) => "/weather?date=" + date + "&startTime=09:00&endTime=11:00&scene=outdoor";
async function refreshWeather(h: string) { const r = await member.request<{ jobId: string }>(p(h) + "/weather", "POST", { date: tomorrow, startTime: "09:00", endTime: "11:00", scene: "outdoor" }, randomUUID()); expect(r.status, r.error?.message).toBe(202); await runOneJob(r.data.jobId); return r.data.jobId; }
async function discussion(h: string, from = tomorrow, to = shiftDate(from, 2), browser = owner) { const r = await browser.request<{ id: string }>(p(h) + "/ai-conversations", "POST", { from, to }, randomUUID()); expect(r.status, r.error?.message).toBe(201); return r.data.id; }
async function send(h: string, id: string, text = "请给出这几天的安排预览", browser = owner) {
  const c = (await browser.request<Conversation>(p(h) + "/ai-conversations/" + id)).data;
  const r = await browser.request<{ jobId: string }>(p(h) + "/ai-conversations/" + id + "/messages", "POST", { expectedRevision: c.revision, text }, randomUUID()); expect(r.status, r.error?.message).toBe(202); return r.data.jobId;
}
async function propose(h: string, operations: unknown[], browser = owner, from = tomorrow, to = shiftDate(from, 2)) {
  fixture.state.output = { answer: "仅本人可见的 B3 测试方案", operations }; fixture.state.aiMode = "ok";
  const id = await discussion(h, from, to, browser); const jobId = await send(h, id, undefined, browser); await runOneJob(jobId);
  const c = (await browser.request<Conversation>(p(h) + "/ai-conversations/" + id)).data;
  return { ...c, jobId, proposal: c.proposals[0] };
}
async function confirm(h: string, c: Awaited<ReturnType<typeof propose>>, browser = owner, key = randomUUID()) { return browser.request(p(h) + "/ai-proposals/" + c.proposal.id + "/confirm", "POST", { turn: c.proposal.turn }, key); }
async function eventCount(h: string) { return (await query<{ count: number }>("SELECT count(*)::int AS count FROM household_events WHERE household_id=$1", [h]))[0].count; }
beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [kind, browser] of Object.entries({ owner, member, peer, other })) {
    const email = accounts[kind as keyof typeof accounts]; await query("INSERT INTO users(email,email_key,display_name,password_hash) VALUES ($1,$1,$2,$3)", [email, "B3测试" + kind, hash]);
    expect((await browser.request("auth/session", "POST", { email, password, remember: true })).status).toBe(200);
  }
  ownerId = (await owner.request<Me>("me")).data.user.id; memberId = (await member.request<Me>("me")).data.user.id; peerId = (await peer.request<Me>("me")).data.user.id;
  householdId = await freshFamily(); otherHouseholdId = await freshFamily();
  await query("UPDATE memberships SET revoked_at=now() WHERE household_id=$1 AND user_id IN ($2,$3,$4)", [otherHouseholdId, ownerId, memberId, peerId]);
  await query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,'admin')", [otherHouseholdId, (await other.request<Me>("me")).data.user.id]);
  fixture = await startB3TestServices(); Object.assign(process.env, fixture.env);
});
afterAll(async () => { await query("DROP TRIGGER IF EXISTS b3_fail_write ON plan_items"); await query("DROP FUNCTION IF EXISTS b3_write_failure()"); await fixture.close(); await closeDatabase(); });

describe("B3 PostgreSQL / HTTP 与显式测试服务", () => {
  test("缺配置集中列出，测试适配器不能进入非测试环境，绝不回退为模拟成功", async () => {
    const saved = { ...process.env }; for (const key of Object.keys(fixture.env)) delete process.env[key];
    try { const status = serviceStatus(); expect(status.ai.ready).toBe(false); expect(status.weather.ready).toBe(false); expect(JSON.stringify(status)).not.toContain("test-fixture-not-a-real-key"); }
    finally { Object.assign(process.env, saved); }
    const status = (await owner.request<ServiceStatus>(p(householdId) + "/services")).data; expect(status.ai).toMatchObject({ ready: true, testService: true });
    process.env.APP_ENV = "local"; expect(() => serviceStatus()).toThrow(); process.env.APP_ENV = "test";
  });
  test("天气 Host 接受官方多级域名，并拒绝外部域名、协议、路径和无效标签", () => {
    const previous = process.env.QWEATHER_API_HOST;
    try {
      for (const host of ["example.qweatherapi.com", "h2a9cf3mhs.xy.qweatherapi.com", "Example.XY.QWeatherAPI.com"]) {
        process.env.QWEATHER_API_HOST = host;
        expect(serviceConfig().QWEATHER_API_HOST).toBe(host);
      }
      for (const host of ["qweatherapi.com", "qweatherapi.com.example.org", "example.org", "https://example.xy.qweatherapi.com", "example.xy.qweatherapi.com/weather/v1/current", "example.xy.qweatherapi.com:443", "user@example.xy.qweatherapi.com", "-example.qweatherapi.com", "example-.qweatherapi.com", "example..qweatherapi.com"]) {
        process.env.QWEATHER_API_HOST = host;
        expect(() => serviceConfig()).toThrow("天气 API Host 格式无效");
      }
    } finally {
      if (previous === undefined) delete process.env.QWEATHER_API_HOST;
      else process.env.QWEATHER_API_HOST = previous;
    }
  });
  test("地点管理员权限、归属、精度与来源，天气刷新不改家人所选活动", async () => {
    const h = householdId; const old = await add(h, routine("家人选择的安排"));
    const cityBefore = (await query<{ city: string }>("SELECT city FROM households WHERE id=$1", [h]))[0].city;
    expect((await member.request(p(h) + "/weather-location", "PUT", { expectedRevision: 1, label: "上海", latitude: 31.23, longitude: 121.47, provenance: "测试" }, randomUUID())).status).toBe(403);
    const location = await setLocation(h); expect(location).toMatchObject({ latitude: 31.23, longitude: 121.47, revision: 2 });
    expect((await query<{ city: string }>("SELECT city FROM households WHERE id=$1", [h]))[0].city).toBe(cityBefore);
    expect((await other.request(p(h) + "/weather-location")).status).toBe(404);
    await refreshWeather(h); expect((await day(h)).plan?.items.find((i) => i.id === old.id)).toEqual(old);
  });
  test("真实 HTTP 契约区分当前与逐小时，保存地点时段时间来源并可追溯解释穿搭", async () => {
    const value = (await owner.request<WeatherView>(p(householdId) + weatherQuery())).data;
    expect(value.state).toBe("available"); expect(value.current?.product).toBe("current"); expect(value.hourly?.product).toBe("hourly"); expect(value.current?.providerTime).toBeNull();
    expect(value.hours).toHaveLength(2); expect(value.outfit?.categories).toContain("长袖内层"); expect(value.outfit?.reminders.join(" ")).toContain("降水"); expect(value.outfit?.basis.join(" ")).toContain(value.hourly!.id);
    expect(value.hourly?.attributions).toContain("B3 deterministic test fixture"); expect(value.hourly?.testService).toBe(true);
    expect(fixture.state.paths.some((p) => p.includes("/weather/v1/hourly/31.23/121.47?lang=zh&hours=72"))).toBe(true);
    const far = (await owner.request<WeatherView>(p(householdId) + weatherQuery(shiftDate(today, 10)))).data;
    expect(far.state).toBe("missing"); expect(far.outfit).toBeNull(); expect(far.reason).toContain("不使用当前天气代替");
  });
  test("缺失、过时与完整覆盖缺口明确降级，仍可读既有计划", async () => {
    const empty = (await owner.request<WeatherView>(p(await freshFamily()) + weatherQuery())).data; expect(empty.state).toBe("missing"); expect(empty.outfit).toBeNull();
    await query("UPDATE weather_snapshots SET stale_after=now()-interval '1 second' WHERE household_id=$1", [householdId]);
    const stale = (await owner.request<WeatherView>(p(householdId) + weatherQuery())).data; expect(stale.state).toBe("stale"); expect(stale.outfit).toBeNull(); expect((await day(householdId)).plan?.items.length).toBe(1);
    await refreshWeather(householdId);
    const gap = (await query<{ id: string; data: Array<{ at: string }> }>("SELECT id,data FROM weather_snapshots WHERE household_id=$1 AND product='hourly' ORDER BY fetched_at DESC LIMIT 1", [householdId]))[0];
    await query("UPDATE weather_snapshots SET data=$2 WHERE id=$1", [gap.id, JSON.stringify(gap.data.filter((p) => Date.parse(p.at) !== +instant(tomorrow, "10:00", "Asia/Shanghai")))]);
    const incomplete = (await owner.request<WeatherView>(p(householdId) + weatherQuery())).data; expect(incomplete.state).toBe("missing"); expect(incomplete.outfit).toBeNull();
    expect((await owner.request(p(householdId) + "/weather?date=" + tomorrow + "&startTime=11:00&endTime=09:00")).status).toBe(422);
  });
  test.each(["timeout", "limited", "bad"])("天气 %s 失败记账并明确降级，活动和日计划保持原样", async (mode) => {
    fixture.state.weatherMode = mode; process.env.SERVICE_TIMEOUT_MS = "100"; const old = await day(householdId);
    const id = await refreshWeather(householdId); expect((await job(householdId, id, member)).state).toBe("failed");
    const value = (await member.request<WeatherView>(p(householdId) + weatherQuery())).data; expect(value.state).toBe(mode === "timeout" ? "timeout" : mode === "limited" ? "limited" : "unavailable"); expect(value.outfit).toBeNull(); expect(await day(householdId)).toEqual(old);
    fixture.state.weatherMode = "ok"; process.env.SERVICE_TIMEOUT_MS = "2000";
  });
  test("取数时地点改变会拒绝旧地点结果；外部请求不持有家庭事务锁", async () => {
    const h = await freshFamily(); await setLocation(h); let began!: () => void, release!: () => void;
    const started = new Promise<void>((r) => { began = r; }); const held = new Promise<void>((r) => { release = r; }); fixture.state.onWeather = async () => { began(); await held; };
    const r = await member.request<{ jobId: string }>(p(h) + "/weather", "POST", { date: tomorrow, startTime: "09:00", endTime: "10:00" }, randomUUID());
    const running = runOneJob(r.data.jobId); await started; await setLocation(h, { label: "杭州家庭确认地点", latitude: 30.27, longitude: 120.15 }); release(); await running; fixture.state.onWeather = undefined;
    expect((await job(h, r.data.jobId, member)).errorCode).toBe("REVISION_CONFLICT"); expect((await owner.request<WeatherView>(p(h) + weatherQuery())).data.hourly).toBeNull();
  });
  test("天气正文按本地 24 小时策略清理，读取即时遵守期限且保留最小溯源", async () => {
    await refreshWeather(householdId); await query("UPDATE weather_snapshots SET purge_after=now()-interval '1 second' WHERE household_id=$1", [householdId]);
    expect((await owner.request<WeatherView>(p(householdId) + weatherQuery())).data.hourly?.data).toBeNull(); await purgeWeatherBodies();
    expect((await query<{ count: number }>("SELECT count(*)::int AS count FROM weather_snapshots WHERE household_id=$1 AND data IS NOT NULL", [householdId]))[0].count).toBe(0);
  });
  test("自动设置仅管理员可改，20:00 是集中默认建议且更新使用修订", async () => {
    const h = await freshFamily(); const old = (await owner.request<Automation>(p(h) + "/automation")).data; expect(old).toEqual({ enabled: false, runTime: "20:00", revision: 1 });
    const input = { expectedRevision: old.revision, enabled: true, runTime: "20:15" };
    expect((await member.request(p(h) + "/automation", "PUT", input, randomUUID())).status).toBe(403);
    expect((await owner.request(p(h) + "/automation", "PUT", input, randomUUID())).status).toBe(200);
    expect((await owner.request(p(h) + "/automation", "PUT", input, randomUUID())).status).toBe(409);
    await owner.request(p(h) + "/automation", "PUT", { expectedRevision: 2, enabled: false, runTime: "20:15" }, randomUUID());
  });
  test("按家庭时区夜间准备、跨日补偿与任务业务去重，重跑不增加任务", async () => {
    const h = await freshFamily(); await owner.request(p(h) + "/automation", "PUT", { expectedRevision: 1, enabled: true, runTime: "20:00" }, randomUUID());
    await scheduleAutomatic(new Date(today + "T11:59:00Z"));
    let rows = await query<{ date: string }>("SELECT payload->>'date' AS date FROM b3_jobs WHERE household_id=$1", [h]); expect(rows.map((r) => r.date)).toEqual([today]);
    await scheduleAutomatic(new Date(today + "T12:00:00Z")); await scheduleAutomatic(new Date(today + "T12:01:00Z")); rows = await query("SELECT payload->>'date' AS date FROM b3_jobs WHERE household_id=$1 ORDER BY payload->>'date'", [h]); expect(rows.map((r) => r.date)).toEqual([today, tomorrow]);
    await query("UPDATE households SET timezone='Pacific/Honolulu' WHERE id=$1", [h]);
    await scheduleAutomatic(new Date(today + "T05:00:00Z")); expect((await query<{ count: number }>("SELECT count(*)::int AS count FROM b3_jobs WHERE household_id=$1", [h]))[0].count).toBe(3);
    await query("UPDATE household_automation SET enabled=false WHERE household_id=$1", [h]);
  });
  test("13 张未启用草稿不进入自动计划；食物资料未知及无适用内容保留待安排", async () => {
    const h = await freshFamily("unknown", [{ label: "早餐", time: "08:00", kind: "meal" }, { label: "陪玩", time: "10:00", kind: "activity" }, { label: "午睡", time: "12:00", kind: "routine" }]);
    expect((await owner.request(p(h) + "/content-imports", "POST", { ids: [...Array.from({ length: 11 }, (_, n) => "R" + String(n + 1).padStart(2, "0")), "A01", "A02"] }, randomUUID())).status).toBe(200);
    const id = await queueAuto(h); await runOneJob(id); expect((await job(h, id)).state).toBe("succeeded"); const d = await day(h); expect(d.plan?.items.map((i) => i.title)).toEqual(["饮食待安排", "活动待安排", "午睡"]); expect(d.plan?.items.every((i) => i.contentId === null)).toBe(true);
    expect(d.plan?.items[0].notes).toContain("食物过敏与忌口未知"); expect((await owner.request<ContentSettings>(p(h) + "/content-settings")).data.enabled).toEqual([]);
  });
  test("自动选择复用适用性、库存排序与期限偏好；恶劣或缺失天气排除户外候选", async () => {
    const h = await freshFamily("none", [{ label: "午餐", time: "12:00", kind: "meal" }, { label: "活动", time: "15:00", kind: "activity" }]);
    const first = await createContent(h, reviewed("recipe", "测试南瓜")), second = await createContent(h, reviewed("recipe", "测试米饭")), inside = await createContent(h, reviewed("activity", "测试室内绘本")), outside = await createContent(h, reviewed("activity", "测试户外散步", "outdoor")); await enable(h, [first, second, inside, outside]);
    await member.request(p(h) + "/pantry", "PUT", { expectedRevision: 1, items: [{ name: "测试南瓜", status: "available", quantity: "enough", priority: true }] }, randomUUID());
    await member.request(p(h) + "/preferences", "POST", { kind: "avoid", scope: "meal", text: "测试米饭", startsOn: tomorrow, endsOn: tomorrow }, randomUUID());
    const id = await queueAuto(h); await runOneJob(id); const d = await day(h); expect(d.plan?.items.map((i) => i.contentId)).toEqual([first.id, inside.id]); expect(d.plan?.items.every((i) => i.source === "automatic")).toBe(true);
    const again = await queueAuto(h); expect(again).toBe(id); expect(await runOneJob(id)).toBeNull(); expect(await day(h)).toEqual(d);
  });
  test("人工安排、主动留空、取消、删除及已确认 AI 结果均受保护，只有空位可补", async () => {
    const h = await freshFamily("none", ["09:00", "10:00", "11:00", "12:00", "14:00", "16:00"].map((time) => ({ label: "模板时段", time, kind: "routine" })));
    await add(h, routine("人工安排", "09:00")); await add(h, routine("主动留空，今天不安排", "10:00")); const cancelled = await add(h, routine("已取消", "11:00")), removed = await add(h, routine("已删除", "12:00"));
    await member.request(p(h) + "/plan-items/" + cancelled.id + "/cancel", "POST", { expectedRevision: cancelled.revision }, randomUUID());
    await member.request(p(h) + "/plan-items/" + removed.id, "DELETE", { expectedRevision: removed.revision }, randomUUID());
    const c = await propose(h, [{ type: "plan.add", date: tomorrow, item: routine("AI 已确认", "14:00") }]); expect((await confirm(h, c)).status).toBe(200);
    const id = await queueAuto(h); await runOneJob(id); const d = await day(h); expect(d.plan?.items.map((i) => i.title)).toEqual(["人工安排", "主动留空，今天不安排", "已取消", "AI 已确认", "模板时段"]);
    const ai = d.plan!.items.find((i) => i.title === "AI 已确认")!; expect(ai).toMatchObject({ source: "ai", protected: true });
    const automatic = d.plan!.items.find((i) => i.title === "模板时段")!;
    expect((await member.request(p(h) + "/plan-items/" + automatic.id, "PATCH", { ...routine("家人手动改动", "16:30"), expectedRevision: automatic.revision }, randomUUID())).status).toBe(200);
    expect((await day(h)).plan?.items.find((i) => i.id === automatic.id)).toMatchObject({ source: "manual", protected: true });
    expect((await query<{ count: number }>("SELECT count(*)::int AS count FROM plan_slot_guards WHERE household_id=$1 AND time IN ('12:00','16:00','16:30')", [h]))[0].count).toBe(3);
  });
  test("自动计划任一写入失败整批回滚，持久化失败任务可恢复且不会重复日计划", async () => {
    const h = await freshFamily("none", [{ label: "第一项", time: "09:00" }, { label: "触发自动失败", time: "10:00" }]);
    await query("CREATE FUNCTION b3_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='触发自动失败' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$");
    await query("CREATE TRIGGER b3_fail_write BEFORE INSERT ON plan_items FOR EACH ROW EXECUTE FUNCTION b3_write_failure()");
    const id = await queueAuto(h); await runOneJob(id); expect((await job(h, id)).state).toBe("retry"); expect((await day(h)).plan).toBeNull();
    await query("DROP TRIGGER b3_fail_write ON plan_items"); await query("DROP FUNCTION b3_write_failure()");
    await query("UPDATE b3_jobs SET available_at=now() WHERE id=$1", [id]); await runOneJob(id); expect((await job(h, id)).state).toBe("succeeded"); expect((await day(h)).plan?.items).toHaveLength(2);
    expect((await query<{ count: number }>("SELECT count(*)::int AS count FROM daily_plans WHERE household_id=$1", [h]))[0].count).toBe(1);
  });
  test("并发领取同一任务仅一个进程得到租约；过期租约可恢复，达到上限明确失败", async () => {
    const h = await freshFamily("none", [{ label: "休息", time: "09:00" }]); const id = await queueAuto(h);
    const claimed = await Promise.all([claimJob(id), claimJob(id)]); expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(await runOneJob(id)).toBeNull(); await query("UPDATE b3_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [id]); await runOneJob(id); expect((await job(h, id)).state).toBe("succeeded");
    const exhausted = await queueAuto(await freshFamily()); await query("UPDATE b3_jobs SET state='running',attempts=3,lease_until=now()-interval '1 second' WHERE id=$1", [exhausted]); await runOneJob(exhausted);
    expect((await query<{ state: string }>("SELECT state FROM b3_jobs WHERE id=$1", [exhausted]))[0].state).toBe("failed");
  });
  test("AI 会话、消息、预览及任务仅发起人可读，管理员无隐含读取权且跨家庭隔离", async () => {
    const c = await propose(householdId, [{ type: "plan.add", date: tomorrow, item: routine("成员私有草稿", "11:00") }], member);
    expect(c.proposal).toBeTruthy();
    for (const browser of [owner, peer, other]) {
      expect((await browser.request(p(householdId) + "/ai-conversations/" + c.id)).status).toBe(404);
      expect((await browser.request(p(householdId) + "/jobs/" + c.jobId)).status).toBe(404);
      expect((await confirm(householdId, c, browser)).status).toBe(404);
    }
    expect((await member.request(p(otherHouseholdId) + "/ai-conversations/" + c.id)).status).toBe(404);
    expect((await owner.request<Array<{ id: string }>>(p(householdId) + "/ai-conversations")).data.some((v) => v.id === c.id)).toBe(false);
    expect((await member.request<Job[]>(p(householdId) + "/jobs")).data.every((j) => j.kind !== "ai")).toBe(true);
    expect((await day(householdId)).plan?.items.some((i) => i.title === "成员私有草稿")).toBe(false);
  });
  test("模型上下文排除已删除、到期偏好、未启用及不适用内容，不混入其他人的私有讨论", async () => {
    const h = await freshFamily("unknown"); const removed = await add(h, routine("DELETED_PLAN_SENTINEL"), today);
    await member.request(p(h) + "/plan-items/" + removed.id, "DELETE", { expectedRevision: 1 }, randomUUID());
    const record = await member.request<{ id: string }>(p(h) + "/records", "POST", { occurredOn: today, text: "DELETED_RECORD_SENTINEL" }, randomUUID()); await member.request(p(h) + "/records/" + record.data.id, "DELETE", { expectedRevision: 1 }, randomUUID());
    await member.request(p(h) + "/preferences", "POST", { kind: "note", scope: "all", text: "EXPIRED_PREFERENCE_SENTINEL", startsOn: shiftDate(today, -2), endsOn: shiftDate(today, -1) }, randomUUID());
    await createContent(h, reviewed("activity", "UNENABLED_CONTENT_SENTINEL")); const unsuitable = await createContent(h, reviewed("recipe", "UNSUITABLE_CONTENT_SENTINEL")); await enable(h, [unsuitable]);
    const privateDiscussion = await discussion(h, today, tomorrow, member); await send(h, privateDiscussion, "OTHER_PRIVATE_SENTINEL", member);
    await propose(h, [], owner, today, tomorrow);
    const body = JSON.stringify(fixture.state.prompts.at(-1)); for (const word of ["DELETED_PLAN_SENTINEL", "DELETED_RECORD_SENTINEL", "EXPIRED_PREFERENCE_SENTINEL", "UNENABLED_CONTENT_SENTINEL", "UNSUITABLE_CONTENT_SENTINEL", "OTHER_PRIVATE_SENTINEL"]) expect(body).not.toContain(word);
    expect(body).toContain('foodStatus'); expect(body).not.toContain(accounts.owner);
  });
  test("模型得到目标日期的月龄，但不发送具体生日或天气坐标", async () => {
    const h = await freshFamily(); await setLocation(h);
    await query("UPDATE children SET birth_date='2025-05-01',age_months=NULL WHERE household_id=$1", [h]);
    await propose(h, [], owner, "2026-10-31", "2026-11-01");
    const birthdayContext = JSON.parse(fixture.state.prompts.at(-1)![1].content.replace("当前获授权的资料：", ""));
    expect(birthdayContext.child.ageMonthsByDate).toEqual({ "2026-10-31": 17, "2026-11-01": 18 });
    const serialized = JSON.stringify(birthdayContext);
    for (const hidden of ["2025-05-01", "latitude", "longitude", "weatherLocation"]) expect(serialized).not.toContain(hidden);
    await query("UPDATE children SET birth_date=NULL,age_months=17,age_as_of='2026-10-31' WHERE household_id=$1", [h]);
    await propose(h, [], owner, "2026-11-29", "2026-12-01");
    const manualContext = JSON.parse(fixture.state.prompts.at(-1)![1].content.replace("当前获授权的资料：", ""));
    expect(manualContext.child.ageMonthsByDate).toEqual({ "2026-11-29": 17, "2026-11-30": 17, "2026-12-01": 18 });
  });
  test("查询可直接回答；讨论、消息和未确认草稿均不改变正式资源及共享通知", async () => {
    const h = await freshFamily(); const before = await eventCount(h), d = await day(h);
    const c = await propose(h, []); expect(c.messages.map((m) => m.role)).toEqual(["user", "assistant"]); expect(c.proposals).toEqual([]); expect((await job(h, c.jobId)).state).toBe("succeeded"); expect(await eventCount(h)).toBe(before); expect(await day(h)).toEqual(d);
    const draft = await propose(h, [{ type: "plan.add", date: tomorrow, item: routine("尚未确认的正式改动", "10:00") }]); expect(draft.proposal.preview[0]).toMatchObject({ before: null, after: routine("尚未确认的正式改动", "10:00") }); expect(await day(h)).toEqual(d); expect(await eventCount(h)).toBe(before);
  });
  test("多日结构化方案有真实前后值及偏好期限，聊天本身不写入正式数据", async () => {
    const h = await freshFamily(); const old = await add(h, routine("原人工安排", "09:00"));
    const operations: AiOperation[] = [{ type: "plan.update", itemId: old.id, item: routine("讨论后的安排", "09:30") }, { type: "plan.add", date: shiftDate(tomorrow, 1), item: routine("第二天休息", "12:30") }, { type: "pantry.set", items: [{ name: "测试食材", status: "missing", quantity: "enough", priority: true }] }, { type: "preference.add", preference: { kind: "avoid", scope: "meal", text: "测试面条", startsOn: tomorrow, endsOn: shiftDate(tomorrow, 2) } }];
    const c = await propose(h, operations); expect(c.proposal.preview).toHaveLength(4); expect(c.proposal.preview[0]).toMatchObject({ before: routine("原人工安排", "09:00"), after: routine("讨论后的安排", "09:30") }); expect(c.proposal.preview[2].after).toEqual([{ name: "测试食材", status: "missing", quantity: "unknown", priority: false }]);
    expect((await day(h)).plan?.items[0].title).toBe("原人工安排"); expect((await owner.request<Pantry>(p(h) + "/pantry")).data.items).toEqual([]);
    expect((await confirm(h, c)).status).toBe(200); expect((await day(h)).plan?.items[0].title).toBe("讨论后的安排"); expect((await day(h, shiftDate(tomorrow, 1))).plan?.items[0].title).toBe("第二天休息");
    expect((await owner.request<Preference[]>(p(h) + "/preferences?date=" + tomorrow)).data[0]).toMatchObject({ startsOn: tomorrow, endsOn: shiftDate(tomorrow, 2) });
  });
  test("空内容库也能生成菜单与有条件的户外草案，确认后保存本次安排且不启用内容", async () => {
    const h = await freshFamily(); const secondDay = shiftDate(tomorrow, 1);
    const recipe = { ingredients: [{ name: "南瓜", amountText: "按家庭食量准备", formText: "蒸软切小块" }], steps: ["将南瓜蒸熟至软，切成适合宝宝的小块。"], materials: "", assumptions: ["尚未确认库存，先列为采购候选。"], weatherCondition: "", indoorAlternative: "" };
    const outdoor = { ingredients: [], steps: ["由成人陪同，在平整步道慢走，寻找不同颜色的叶子。"], materials: "饮水、合脚的鞋", assumptions: [], weatherCondition: "出门前查看当地天气，风雨或高温时改在室内进行。", indoorAlternative: "在家找不同颜色的积木并分类。" };
    const c = await propose(h, [
      { type: "plan.add", date: tomorrow, repeatOn: [secondDay], item: { ...routine("南瓜早餐", "07:30"), kind: "meal" }, suggestion: recipe },
      { type: "plan.add", date: tomorrow, repeatOn: [secondDay], item: { ...routine("公园找颜色", "09:00"), kind: "activity", scene: "outdoor" }, suggestion: outdoor },
    ]);
    expect((await job(h, c.jobId)).state).toBe("succeeded");
    expect(c.proposal.preview).toHaveLength(4); expect((await day(h)).plan).toBeNull();
    expect(c.proposal.preview.map((v) => v.date).sort()).toEqual([tomorrow, tomorrow, secondDay, secondDay].sort());
    expect(JSON.stringify(c.proposal.preview)).toContain("AI 生成建议");
    expect((await confirm(h, c)).status).toBe(200);
    for (const date of [tomorrow, secondDay]) {
      const saved = (await day(h, date)).plan!.items;
      expect(saved.map((i) => i.title)).toEqual(["南瓜早餐", "公园找颜色"]);
      expect(saved.every((i) => i.source === "ai" && i.contentId === null && i.contentSnapshot === null)).toBe(true);
      expect(saved[0].notes).toContain("待采购或核对：南瓜");
      expect(saved[1].notes).toContain("室内备选：在家找不同颜色的积木并分类。");
    }
    expect((await query<{ count: number }>("SELECT count(*)::int AS count FROM content_items WHERE household_id=$1", [h]))[0].count).toBe(0);
  });
  test("一周四餐两次活动可展开 42 项建议，整组确认与重复确认均不重复写入", async () => {
    const h = await freshFamily();
    const repeatOn = Array.from({ length: 6 }, (_, i) => shiftDate(tomorrow, i + 1));
    const recipe = { ingredients: [{ name: "测试南瓜", amountText: "测试用量", formText: "测试切配" }], steps: ["仅供接口测试的步骤。"], materials: "", assumptions: [], weatherCondition: "", indoorAlternative: "" };
    const activity = { ingredients: [], steps: ["仅供接口测试的步骤。"], materials: "", assumptions: [], weatherCondition: "出门前核对现场天气。", indoorAlternative: "在室内做同类颜色配对。" };
    const operations = ["07:30", "11:00", "15:00", "17:15"].map((time) => ({ type: "plan.add", date: tomorrow, repeatOn, item: { ...routine("测试菜单", time), kind: "meal" }, suggestion: recipe }));
    const c = await propose(h, [...operations, ...["09:00", "15:30"].map((time) => ({ type: "plan.add", date: tomorrow, repeatOn, item: { ...routine("测试户外", time), kind: "activity", scene: "outdoor" }, suggestion: activity }))], owner, tomorrow, repeatOn[5]);
    expect((await job(h, c.jobId)).state).toBe("succeeded"); expect(c.proposal.preview).toHaveLength(42);
    expect((await confirm(h, c)).status).toBe(200); const events = await eventCount(h);
    expect((await confirm(h, c)).status).toBe(200); expect(await eventCount(h)).toBe(events);
    for (const date of [tomorrow, ...repeatOn]) expect((await day(h, date)).plan?.items).toHaveLength(6);
  });
  test("生成菜单仍拒绝已记录的过敏食材，库存未知可列采购；不从聊天删除限制", async () => {
    const h = await freshFamily();
    await query("UPDATE children SET food_status='restricted',food_restrictions='过敏：苹果',food_restriction_items=$2 WHERE household_id=$1", [h, JSON.stringify([{ kind: "allergy", food: "苹果", note: "" }])]);
    const suggestion = { ingredients: [{ name: "苹果泥", amountText: "测试用量", formText: "测试切配" }], steps: ["仅测试。"], materials: "", assumptions: [], weatherCondition: "", indoorAlternative: "" };
    const c = await propose(h, [{ type: "plan.add", date: tomorrow, item: { ...routine("水果加餐"), kind: "meal" }, suggestion }]);
    expect((await job(h, c.jobId)).errorCode).toBe("MODEL_OUTPUT_REJECTED"); expect((await day(h)).plan).toBeNull();
    expect((await owner.request<Household>(p(h))).data.child?.foodRestrictionItems[0].food).toBe("苹果");
  });
  test("模型直接逐日返回 42 项时也能预览，不受旧 40 项输出上限阻挡", async () => {
    const h = await freshFamily();
    const dates = Array.from({ length: 7 }, (_, i) => shiftDate(tomorrow, i));
    const operations = dates.flatMap((date) => ["07:30", "09:00", "11:00", "15:00", "15:30", "17:15"].map((time) => ({ type: "plan.add", date, item: routine("逐日测试安排", time) })));
    const c = await propose(h, operations, owner, tomorrow, dates[6]);
    expect((await job(h, c.jobId)).state).toBe("succeeded"); expect(c.proposal.preview).toHaveLength(42);
    expect((await day(h)).plan).toBeNull();
  });
  test("补全菜谱保持日期时间不变，量化用量与详细步骤随正式安排及修订保留", async () => {
    const h = await freshFamily();
    const suggestion = { ingredients: [{ name: "测试南瓜", amountText: "一小段", formText: "测试切配" }], steps: ["原来只有一句测试步骤。"], materials: "", assumptions: [], weatherCondition: "", indoorAlternative: "" };
    const source = await propose(h, [{ type: "plan.add", date: tomorrow, repeatOn: [shiftDate(tomorrow, 1)], item: { ...routine("测试早餐", "07:30"), kind: "meal" }, suggestion }]);
    const calls = fixture.state.prompts.length;
    expect((await member.request(p(h) + "/ai-conversations/" + source.id + "/messages", "POST", { expectedRevision: source.revision, text: "补全", refineProposalId: source.proposal.id }, randomUUID())).status).toBe(404);
    expect(fixture.state.prompts.length).toBe(calls);
    fixture.state.respondToPrompt = (messages) => {
      const data = JSON.parse(messages.at(-1)!.content);
      return { answer: "已补全份数、备料和详细做法，日程保持原样。", recipes: data.recipes.map((r: { key: string; suggestion: typeof suggestion }) => ({ key: r.key, suggestion: { ...r.suggestion, servings: 1, servingNote: "宝宝1人份，参考备料", prepMinutes: 8, cookMinutes: 12, yieldText: "约50克成品", ingredients: r.suggestion.ingredients.map((i) => ({ ...i, quantity: 60, unit: "g", basis: "raw", amountText: "60g生重" })), steps: ["清洗并准备测试材料。", "按测试方式切配。", "按测试标记完成处理并检查。", "放温后核对测试结果。"] } })) };
    };
    try {
      const queued = await owner.request<{ jobId: string }>(p(h) + "/ai-conversations/" + source.id + "/messages", "POST", { expectedRevision: source.revision, text: "补全做法和用量", refineProposalId: source.proposal.id }, randomUUID());
      expect(queued.status).toBe(202); await runOneJob(queued.data.jobId);
      expect((await job(h, queued.data.jobId)).state).toBe("succeeded");
      const current = (await owner.request<Conversation>(p(h) + "/ai-conversations/" + source.id)).data;
      const refined = current.proposals[0]; expect(refined.preview).toHaveLength(2);
      expect(refined.preview.map((v) => [v.date, (v.after as ItemFields).time, (v.after as ItemFields).title])).toEqual(source.proposal.preview.map((v) => [v.date, (v.after as ItemFields).time, (v.after as ItemFields).title]));
      expect(refined.preview[0].suggestion?.ingredients[0]).toMatchObject({ quantity: 60, unit: "g", basis: "raw" });
      expect((await day(h)).plan).toBeNull();
      expect((await owner.request(p(h) + "/ai-proposals/" + refined.id + "/confirm", "POST", { turn: refined.turn }, randomUUID())).status).toBe(200);
      const saved = (await day(h)).plan!.items[0]; expect(saved.aiSuggestion?.steps).toHaveLength(4); expect(saved.aiSuggestion?.servings).toBe(1);
      const input = { kind: saved.kind, title: saved.title, time: "08:00", notes: saved.notes, scene: saved.scene, caregiverId: saved.caregiverId, contentId: null, contentVersion: null, expectedRevision: saved.revision };
      expect((await member.request(p(h) + "/plan-items/" + saved.id, "PATCH", input, randomUUID())).status).toBe(200);
      expect((await day(h)).plan!.items[0].aiSuggestion?.servings).toBe(1);
      expect((await member.request(p(h) + "/plan-items/" + saved.id, "PATCH", { ...input, expectedRevision: saved.revision + 1, title: "换成另一餐" }, randomUUID())).status).toBe(200);
      expect((await day(h)).plan!.items[0].aiSuggestion).toBeNull();
      const other = (await day(h, shiftDate(tomorrow, 1))).plan!.items[0];
      await member.request(p(h) + "/plan-items/" + other.id, "DELETE", { expectedRevision: other.revision }, randomUUID());
      await query("UPDATE plan_items SET restore_until=clock_timestamp()-interval '1 second' WHERE id=$1", [other.id]);
      await purgeExpiredTrash();
      expect((await query<{ ai_suggestion: unknown }>("SELECT ai_suggestion FROM plan_items WHERE id=$1", [other.id]))[0].ai_suggestion).toBeNull();
    } finally { fixture.state.respondToPrompt = undefined; }
  });
  test("菜谱补全拒绝漏项、重复 key 或缺少量化备料，不把半份更新写入正式安排", async () => {
    for (const mode of ["missing", "duplicate", "unmeasured"]) {
      const h = await freshFamily();
      const suggestion = { ingredients: [{ name: "测试南瓜", amountText: "一小段", formText: "测试切配" }], steps: ["原测试步骤。"], materials: "", assumptions: [], weatherCondition: "", indoorAlternative: "" };
      const source = await propose(h, [{ type: "plan.add", date: tomorrow, item: { ...routine("测试早餐"), kind: "meal" }, suggestion }]);
      fixture.state.respondToPrompt = () => ({ answer: "不完整测试返回", recipes: mode === "missing" ? [] : [{ key: "r1", suggestion }, ...(mode === "duplicate" ? [{ key: "r1", suggestion }] : [])] });
      try {
        const next = await owner.request<{ jobId: string }>(p(h) + "/ai-conversations/" + source.id + "/messages", "POST", { expectedRevision: source.revision, text: "补全", refineProposalId: source.proposal.id }, randomUUID());
        await runOneJob(next.data.jobId); expect((await job(h, next.data.jobId)).errorCode).toBe("MODEL_OUTPUT_REJECTED"); expect((await day(h)).plan).toBeNull();
      } finally { fixture.state.respondToPrompt = undefined; }
    }
  });
  test("食物限制未知时仍可生成活动；具体新菜单、无备选户外和跨日期重复均被拒绝", async () => {
    const h = await freshFamily("unknown");
    const recipe = { ingredients: [{ name: "测试南瓜", amountText: "测试用量", formText: "测试切配" }], steps: ["仅测试。"], materials: "", assumptions: [], weatherCondition: "", indoorAlternative: "" };
    const activity = { ingredients: [], steps: ["成人陪同找颜色。"], materials: "", assumptions: [], weatherCondition: "出门前核对现场天气。", indoorAlternative: "在家做颜色配对。" };
    const success = await propose(h, [{ type: "plan.add", date: tomorrow, item: { ...routine("找颜色"), kind: "activity", scene: "outdoor" }, suggestion: activity }]);
    expect((await job(h, success.jobId)).state).toBe("succeeded");
    for (const operation of [
      { type: "plan.add", date: tomorrow, item: { ...routine("新菜单"), kind: "meal" }, suggestion: recipe },
      { type: "plan.add", date: tomorrow, item: { ...routine("找颜色"), kind: "activity", scene: "outdoor" }, suggestion: { ...activity, indoorAlternative: "" } },
      { type: "plan.add", date: tomorrow, repeatOn: [shiftDate(tomorrow, 5)], item: { ...routine("找颜色"), kind: "activity", scene: "outdoor" }, suggestion: activity },
      { type: "plan.add", date: tomorrow, item: routine("把菜单伪装成作息"), suggestion: recipe },
    ]) {
      const rejected = await propose(h, [operation]);
      expect((await job(h, rejected.jobId)).errorCode).toBe("MODEL_OUTPUT_REJECTED"); expect((await day(h)).plan).toBeNull();
    }
  });
  test.each([
    { type: "sql", sql: "UPDATE users SET can_create_household=true" }, { type: "member.promote", userId: "forged" }, { type: "account.update", email: "other@example.test" }, { type: "billing.pay" }, { type: "record.delete", recordId: randomUUID() }, { type: "child.update", foodStatus: "none" }, { type: "automation.set", enabled: true }, { type: "content.enable", id: randomUUID() }, { type: "plan.add", date: tomorrow, item: { ...routine(), householdId: randomUUID(), updatedBy: randomUUID() } },
  ])("拒绝操作白名单以外的模型输出 $type", async (operation) => {
    const h = await freshFamily(); const c = await propose(h, [operation]); expect((await job(h, c.jobId)).errorCode).toBe("MODEL_OUTPUT_REJECTED"); expect(c.proposals).toEqual([]); expect(await eventCount(h)).toBe(0); expect((await day(h)).plan).toBeNull();
  });
  test("越权对象、日期范围与伪造未核对餐食不得生成可确认方案", async () => {
    const h = await freshFamily(); const foreign = await add(householdId, routine("另一个家庭条目", "18:00"));
    for (const operation of [
      { type: "plan.update", itemId: foreign.id, item: routine("越权改动") },
      { type: "plan.add", date: shiftDate(tomorrow, 5), item: routine() },
      { type: "plan.add", date: tomorrow, item: { ...routine(), caregiverId: (await owner.request<Household>(p(householdId))).data.members[0].id } },
      { type: "plan.add", date: tomorrow, item: { ...routine("AI 自造未核对餐食"), kind: "meal" } },
      { type: "preference.end", preferenceId: randomUUID() },
    ]) { const c = await propose(h, [operation]); expect(c.proposals).toEqual([]); expect((await job(h, c.jobId)).state).toBe("failed"); }
    expect((await day(h)).plan).toBeNull();
  });
  test("继续讨论产生新版本，即使新轮是查询或服务失败，旧预览也不能确认", async () => {
    const h = await freshFamily(); const c = await propose(h, [{ type: "plan.add", date: tomorrow, item: routine("第一版") }]);
    fixture.state.output = { answer: "新一轮只回答查询", operations: [] }; const second = await send(h, c.id, "先不要写入，解释一下"); await runOneJob(second); expect((await confirm(h, c)).error?.code).toBe("PROPOSAL_SUPERSEDED");
    const newer = await propose(h, [{ type: "plan.add", date: tomorrow, item: routine("第二个待确认方案") }]); fixture.state.aiMode = "limited"; const failed = await send(h, newer.id, "继续调整"); await runOneJob(failed); fixture.state.aiMode = "ok";
    expect((await confirm(h, newer)).error?.code).toBe("PROPOSAL_SUPERSEDED"); expect((await day(h)).plan).toBeNull();
  });
  test.each(["pantry", "template", "content", "child", "membership", "weather"])("确认前依赖 %s 改变时整组拒绝，不覆盖家人的新数据", async (dependency) => {
    const h = await freshFamily(); const content = await createContent(h, reviewed("activity", "依赖内容")); await enable(h, [content]); await setLocation(h); await refreshWeather(h);
    const c = await propose(h, [{ type: "plan.add", date: tomorrow, item: routine("待确认，依赖会变化", "10:00") }]); expect(c.proposal).toBeTruthy();
    if (dependency === "pantry") await member.request(p(h) + "/pantry", "PUT", { expectedRevision: 1, items: [] }, randomUUID());
    if (dependency === "template") await member.request(p(h) + "/templates/weekday", "PUT", { expectedRevision: 1, slots: [{ label: "新作息", time: "08:00" }] });
    if (dependency === "content") await enable(h, []);
    if (dependency === "child") { const family = (await owner.request<Household>(p(h))).data; await owner.request(p(h) + "/child", "PATCH", { expectedRevision: family.revision, child: { name: "更新后的宝宝资料", ageMonths: 18, birthDate: null, foodStatus: "none", foodRestrictions: "" } }); }
    if (dependency === "membership") await query("UPDATE memberships SET revision=revision+1 WHERE household_id=$1 AND user_id=$2", [h, memberId]);
    if (dependency === "weather") await query("UPDATE weather_snapshots SET stale_after=now()-interval '1 second' WHERE household_id=$1", [h]);
    expect((await confirm(h, c)).error?.code).toBe("REVISION_CONFLICT"); expect((await day(h)).plan).toBeNull();
  });
  test("模型调用期间家人可以保存食材，旧上下文结果被拒绝且实际用量仍记录", async () => {
    const h = await freshFamily(); fixture.state.output = { answer: "测试输出", operations: [{ type: "plan.add", date: tomorrow, item: routine() }] };
    const id = await discussion(h), jobId = await send(h, id); let began!: () => void, release!: () => void; const started = new Promise<void>((r) => { began = r; }), held = new Promise<void>((r) => { release = r; });
    fixture.state.onModel = async () => { began(); await held; }; const running = runOneJob(jobId); await started;
    expect((await member.request(p(h) + "/pantry", "PUT", { expectedRevision: 1, items: [] }, randomUUID())).status).toBe(200); release(); await running; fixture.state.onModel = undefined;
    expect((await job(h, jobId)).errorCode).toBe("REVISION_CONFLICT"); expect((await owner.request<Conversation>(p(h) + "/ai-conversations/" + id)).data.proposals).toEqual([]);
    expect((await query<{ input_tokens: number; output_tokens: number }>("SELECT input_tokens,output_tokens FROM service_calls WHERE job_id=$1", [jobId]))[0]).toEqual({ input_tokens: 123, output_tokens: 45 });
  });
  test("整组确认的后项数据库失败会回滚前项、修订、审计、事件和执行记录", async () => {
    const h = await freshFamily(); const c = await propose(h, [{ type: "pantry.set", items: [{ name: "回滚测试食材", status: "available", quantity: "enough", priority: false }] }, { type: "plan.add", date: tomorrow, item: routine("正常第一项", "09:00") }, { type: "plan.add", date: tomorrow, item: routine("触发整组失败", "10:00") }]);
    expect(c.proposal).toBeTruthy(); const events = await eventCount(h);
    await query("CREATE FUNCTION b3_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='触发整组失败' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$"); await query("CREATE TRIGGER b3_fail_write BEFORE INSERT ON plan_items FOR EACH ROW EXECUTE FUNCTION b3_write_failure()");
    expect((await confirm(h, c)).status).toBe(503); expect((await day(h)).plan).toBeNull(); expect((await owner.request<Pantry>(p(h) + "/pantry")).data).toMatchObject({ revision: 1, items: [] }); expect(await eventCount(h)).toBe(events);
    expect((await query<{ count: number }>("SELECT count(*)::int AS count FROM proposal_executions WHERE proposal_id=$1", [c.proposal.id]))[0].count).toBe(0);
    await query("DROP TRIGGER b3_fail_write ON plan_items"); await query("DROP FUNCTION b3_write_failure()"); expect((await confirm(h, c)).status).toBe(200);
  });
  test("重复确认、并发换键与成功响应丢失返回同一业务事实，永不重复写入", async () => {
    const h = await freshFamily(); const c = await propose(h, [{ type: "plan.add", date: tomorrow, item: routine("只保存一次") }, { type: "preference.add", preference: { kind: "note", scope: "all", text: "只新增一次的偏好", startsOn: tomorrow, endsOn: tomorrow } }]);
    const key = randomUUID(); const results = await Promise.all([confirm(h, c, owner, key), confirm(h, c, owner)]); expect(results.map((r) => r.status)).toEqual([200, 200]); expect(results[0].data).toEqual(results[1].data);
    const saved = await day(h), count = await eventCount(h); expect((await confirm(h, c, owner, key)).data).toEqual(results[0].data); expect((await confirm(h, c)).data).toEqual(results[0].data); expect(await day(h)).toEqual(saved); expect(await eventCount(h)).toBe(count);
    expect((await owner.request<Preference[]>(p(h) + "/preferences?date=" + tomorrow)).data).toHaveLength(1); expect(saved.plan?.items).toHaveLength(1);
    const events = await query<{ resource_id: string; resource_type: string }>("SELECT resource_id,resource_type FROM household_events WHERE household_id=$1", [h]); expect(events.some((e) => e.resource_id === c.proposal.id || e.resource_type.includes("ai"))).toBe(false);
  });
  test.each(["timeout", "limited", "bad", "truncated"])("模型服务 %s 明确失败、不写正式资源并记录耗时与可知用量", async (mode) => {
    const h = await freshFamily(); const id = await discussion(h); const jobId = await send(h, id); fixture.state.aiMode = mode; process.env.AI_TIMEOUT_MS = "100"; await runOneJob(jobId); fixture.state.aiMode = "ok"; process.env.AI_TIMEOUT_MS = "2000";
    const result = await job(h, jobId); expect(result.state).toBe("failed"); expect(result.durationMs).not.toBeNull(); expect((await day(h)).plan).toBeNull(); expect(await eventCount(h)).toBe(0);
    const calls = await query<{ usage_known: boolean; cost: string | null }>("SELECT usage_known,cost FROM service_calls WHERE job_id=$1", [jobId]); expect(calls).toHaveLength(1); expect(calls[0].cost).toBeNull(); expect(calls[0].usage_known).toBe(mode === "truncated");
  });
  test("DeepSeek 显式选择 Flash 与非思考 JSON，AI 超时独立于天气，生成仍不写正式安排", async () => {
    const h = await freshFamily();
    try {
      process.env.AI_PROVIDER = "deepseek"; process.env.AI_MODEL = "deepseek-flash";
      process.env.SERVICE_TIMEOUT_MS = "100"; process.env.AI_TIMEOUT_MS = "2000";
      fixture.state.onModel = () => new Promise((resolve) => setTimeout(resolve, 200));
      const result = await propose(h, [{ type: "plan.add", date: tomorrow, item: routine("DeepSeek 待确认建议") }]);
      expect((await job(h, result.jobId)).state).toBe("succeeded");
      expect(result.proposal.state).toBe("pending"); expect((await day(h)).plan).toBeNull();
      expect(fixture.state.modelOptions.at(-1)).toEqual({ model: "deepseek-flash", thinking: { type: "disabled" }, response_format: { type: "json_object" } });
      process.env.AI_THINKING_MODE = "enabled";
      await propose(h, []);
      expect(fixture.state.modelOptions.at(-1)?.thinking).toEqual({ type: "enabled" });
      process.env.AI_PROVIDER = fixture.env.AI_PROVIDER;
      await propose(h, []);
      expect(fixture.state.modelOptions.at(-1)?.thinking).toBeUndefined();
    } finally { Object.assign(process.env, fixture.env); fixture.state.onModel = undefined; }
  });
  test("日请求与 token 预算在外部调用前锁定，未知用量保留预留，不伪造免费费用", async () => {
    const h = await freshFamily(); const count = (await query<{ count: number }>("SELECT count(*)::int AS count FROM service_calls WHERE service='ai' AND provider=$1 AND started_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'", [process.env.AI_PROVIDER]))[0].count;
    const calls = fixture.state.prompts.length; process.env.AI_DAILY_REQUEST_LIMIT = String(count);
    const c = await propose(h, []); expect((await job(h, c.jobId)).errorCode).toBe("SERVICE_QUOTA_EXCEEDED"); expect(fixture.state.prompts.length).toBe(calls);
    process.env.AI_DAILY_REQUEST_LIMIT = fixture.env.AI_DAILY_REQUEST_LIMIT; process.env.AI_DAILY_TOKEN_LIMIT = "1";
    const token = await propose(h, []); expect((await job(h, token.jobId)).errorCode).toBe("SERVICE_QUOTA_EXCEEDED"); process.env.AI_DAILY_TOKEN_LIMIT = fixture.env.AI_DAILY_TOKEN_LIMIT;
    fixture.state.usage = null; const unknown = await propose(h, []); const usage = (await query<{ usage_known: boolean; reserved_tokens: number; cost: null }>("SELECT usage_known,reserved_tokens,cost FROM service_calls WHERE job_id=$1", [unknown.jobId]))[0]; expect(usage.usage_known).toBe(false); expect(usage.reserved_tokens).toBeGreaterThan(0); expect(usage.cost).toBeNull(); fixture.state.usage = { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 };
  });
  test("真实子进程在模型请求期间被终止，重启后恢复租约且只保留一份私有结果", async () => {
    const h = await freshFamily(); fixture.state.output = { answer: "重启恢复结果", operations: [{ type: "plan.add", date: tomorrow, item: routine("重启待确认") }] };
    const id = await discussion(h), jobId = await send(h, id); let began!: () => void, release!: () => void; const started = new Promise<void>((r) => { began = r; }), held = new Promise<void>((r) => { release = r; }); fixture.state.onModel = async () => { began(); await held; };
    const child = spawn(process.execPath, ["--import", "tsx", "tests/job-process.ts", "--test", "--job=" + jobId], { env: process.env, stdio: "ignore" });
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve())); await started; child.kill("SIGKILL"); await exited; release(); fixture.state.onModel = undefined;
    await query("UPDATE b3_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [jobId]);
    const restarted = spawn(process.execPath, ["--import", "tsx", "tests/job-process.ts", "--test", "--job=" + jobId], { env: process.env, stdio: "ignore" }); expect(await new Promise<number | null>((resolve) => restarted.once("close", resolve))).toBe(0);
    expect((await job(h, jobId)).state).toBe("succeeded"); const c = (await owner.request<Conversation>(p(h) + "/ai-conversations/" + id)).data; expect(c.proposals).toHaveLength(1); expect(c.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    const calls = await query<{ state: string; usage_known: boolean }>("SELECT state,usage_known FROM service_calls WHERE job_id=$1 ORDER BY started_at", [jobId]); expect(calls).toEqual([{ state: "interrupted", usage_known: false }, { state: "succeeded", usage_known: true }]);
    expect((await day(h)).plan).toBeNull();
  });
  test("过期预览与已取消或删除的原安排不能确认；撤销成员立即切断私有任务和草稿", async () => {
    const h = await freshFamily(); const c = await propose(h, [{ type: "plan.add", date: tomorrow, item: routine() }]); await query("UPDATE change_proposals SET expires_at=now() WHERE id=$1", [c.proposal.id]); expect((await confirm(h, c)).error?.code).toBe("PROPOSAL_EXPIRED");
    const original = await add(h, routine("原安排", "12:00")); const edit = await propose(h, [{ type: "plan.update", itemId: original.id, item: routine("改后的安排", "12:30") }]); await member.request(p(h) + "/plan-items/" + original.id + "/cancel", "POST", { expectedRevision: 1 }, randomUUID()); expect((await confirm(h, edit)).error?.code).toBe("REVISION_CONFLICT");
    const privateResult = await propose(h, [{ type: "plan.add", date: tomorrow, item: routine("私有待确认", "15:00") }], member); const family = (await owner.request<Household>(p(h))).data; const membership = family.members.find((m) => m.userId === memberId)!;
    await owner.request(p(h) + "/members/" + membership.id, "DELETE", { expectedRevision: membership.revision }); expect((await confirm(h, privateResult, member)).status).toBe(404); expect((await member.request(p(h) + "/jobs/" + privateResult.jobId)).status).toBe(404);
  });
  test("服务失败修复后本人可重试同一任务，新轮已替代的任务不能重试", async () => {
    const h = await freshFamily(); const id = await discussion(h); fixture.state.aiMode = "limited"; const jobId = await send(h, id); await runOneJob(jobId); fixture.state.aiMode = "ok"; fixture.state.output = { answer: "重试成功", operations: [] };
    expect((await owner.request(p(h) + "/jobs/" + jobId + "/retry", "POST", {})).status).toBe(202); await runOneJob(jobId); expect((await job(h, jobId)).state).toBe("succeeded");
    expect((await owner.request(p(h) + "/jobs/" + jobId + "/retry", "POST", {})).status).toBe(409); fixture.state.aiMode = "limited"; const old = await send(h, id); await runOneJob(old); fixture.state.aiMode = "ok"; await send(h, id); expect((await owner.request(p(h) + "/jobs/" + old + "/retry", "POST", {})).error?.code).toBe("PROPOSAL_SUPERSEDED");
  });
  test("首次完成初始化持久化准备今天的任务，重复初始化不重复创建", async () => {
    const h = (await query<{ id: string }>("INSERT INTO households(name,city) VALUES ('B3初始化测试','上海') RETURNING id"))[0].id; await query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,'admin')", [h, ownerId]); await query("INSERT INTO household_templates(household_id,kind,slots) VALUES ($1,'weekday','[{\"label\":\"上午休息\",\"time\":\"09:00\"}]'),($1,'weekend','[{\"label\":\"周末休息\",\"time\":\"09:00\"}]')", [h]);
    const input = { expectedRevision: 1, child: { name: "虚拟初始化宝宝", birthDate: null, ageMonths: 17, foodStatus: "unknown", foodRestrictions: "" } };
    expect((await owner.request(p(h) + "/setup", "PUT", input)).status).toBe(200); const jobs = await query<{ id: string; payload: { date: string; reason: string } }>("SELECT id,payload FROM b3_jobs WHERE household_id=$1", [h]); expect(jobs).toHaveLength(1); expect(jobs[0].payload).toEqual({ date: today, reason: "initial" });
    await runOneJob(jobs[0].id); expect((await day(h, today)).plan?.items).toHaveLength(1); expect((await owner.request(p(h) + "/setup", "PUT", { ...input, expectedRevision: 2 })).status).toBe(409);
  });
  test("自动计划按活动实际时段读取新天气，已预报风雨的户外模板保留待安排", async () => {
    const h = await freshFamily("none", [{ label: "户外活动", time: "15:00", kind: "activity", scene: "outdoor" }]); const outdoor = await createContent(h, reviewed("activity", "测试户外", "outdoor")); await enable(h, [outdoor]); await setLocation(h);
    const id = await queueAuto(h); await runOneJob(id); const d = await day(h); expect(d.plan?.items[0].title).toBe("活动待安排"); expect(d.plan?.items[0].notes).toContain("预报有风或降水"); expect(d.plan?.items[0].notes).toContain("天气依据");
    const prior = await add(h, { ...routine(outdoor.title, "17:00"), kind: "activity", scene: "outdoor", contentId: outdoor.id, contentVersion: outdoor.version }); const before = (await day(h)).plan?.items.find((i) => i.id === prior.id); await refreshWeather(h); expect((await day(h)).plan?.items.find((i) => i.id === prior.id)).toEqual(before);
  });
  test("整组方案按最终期限偏好重新校验内容；不能把计划与新暂避规则一起绕过", async () => {
    const h = await freshFamily(); const recipe = await createContent(h, reviewed("recipe", "组合测试米饭")); await enable(h, [recipe]);
    const preference = (await member.request<{ id: string }>(p(h) + "/preferences", "POST", { kind: "avoid", scope: "meal", text: recipe.title, startsOn: tomorrow, endsOn: tomorrow }, randomUUID())).data;
    const item = { ...routine(recipe.title, "12:00"), kind: "meal", contentId: recipe.id, contentVersion: recipe.version };
    const c = await propose(h, [{ type: "plan.add", date: tomorrow, item }, { type: "preference.end", preferenceId: preference.id }, { type: "template.set", kind: "weekday", slots: [{ label: "新午餐时段", time: "12:00", kind: "meal" }] }]); expect(c.proposal).toBeTruthy(); expect((await confirm(h, c)).status).toBe(200);
    expect((await day(h)).plan?.items[0].contentId).toBe(recipe.id);
    const blocked = await propose(h, [{ type: "preference.add", preference: { kind: "avoid", scope: "meal", text: recipe.title, startsOn: shiftDate(tomorrow, 1), endsOn: shiftDate(tomorrow, 1) } }, { type: "plan.add", date: shiftDate(tomorrow, 1), item }]); expect(blocked.proposals).toEqual([]); expect((await day(h, shiftDate(tomorrow, 1))).plan).toBeNull();
  });
  test("缺模型配置的任务明确失败且不进行 HTTP 调用，不生成假成功或正式资源", async () => {
    const h = await freshFamily(); const id = await discussion(h), jobId = await send(h, id), count = fixture.state.prompts.length;
    const key = process.env.AI_API_KEY; delete process.env.AI_API_KEY; try { await runOneJob(jobId); } finally { process.env.AI_API_KEY = key; }
    expect((await job(h, jobId)).errorCode).toBe("SERVICE_NOT_CONFIGURED"); expect(fixture.state.prompts.length).toBe(count); expect((await day(h)).plan).toBeNull();
  });
  test("任务取天气时人工可并发保存；提交时重读保护标记且发布实际计划修订", async () => {
    const h = await freshFamily("none", [{ label: "模板时段", time: "09:00", kind: "routine" }]); await setLocation(h); const id = await queueAuto(h);
    let began!: () => void, release!: () => void; const started = new Promise<void>((r) => { began = r; }), held = new Promise<void>((r) => { release = r; }); fixture.state.onWeather = async () => { began(); await held; };
    const running = runOneJob(id); await started; await add(h, routine("家人并发保存的安排", "09:00")); release(); await running; fixture.state.onWeather = undefined;
    const d = await day(h); expect(d.plan?.items).toHaveLength(1); expect(d.plan?.items[0].title).toBe("家人并发保存的安排"); expect((await job(h, id)).state).toBe("succeeded");
    const event = (await query<{ revision: number }>("SELECT revision FROM household_events WHERE household_id=$1 AND resource_type='day-plan' ORDER BY id DESC LIMIT 1", [h]))[0]; expect(event.revision).toBe(d.plan!.revision);
  });
  test("浏览器专用夹具保留多日待确认方案、测试天气与本人隔离的另一个成员", async () => {
    const h = householdId; await refreshWeather(h); const proposals = [];
    for (const days of [5, 9, 13]) { const from = shiftDate(today, days), to = shiftDate(from, 1); const c = await propose(h, [{ type: "plan.add", date: from, item: routine("测试浏览器第一天", "09:00") }, { type: "plan.add", date: to, item: routine("测试浏览器第二天", "10:00") }], owner, from, to); expect(c.proposal).toBeTruthy(); proposals.push({ id: c.id, from, to, proposalId: c.proposal.id }); }
    const privateDiscussion = await discussion(h, tomorrow, shiftDate(tomorrow, 1), member); await send(h, privateDiscussion, "B3_MEMBER_PRIVATE_BROWSER_SENTINEL", member);
    await mkdir(".local", { recursive: true }); await writeFile(".local/b3-browser-fixture.json", JSON.stringify({ accounts, password, householdId: h, otherHouseholdId, today, tomorrow, proposals, memberPrivateConversationId: privateDiscussion }, null, 2), { mode: 0o600 });
    await mkdir(process.env.BP_EVIDENCE_DIR ?? "output/b3-local-2026-10-31", { recursive: true }); await writeFile((process.env.BP_EVIDENCE_DIR ? process.env.BP_EVIDENCE_DIR + "/b3-integration-evidence.json" : "output/b3-local-2026-10-31/integration-evidence.json"), JSON.stringify({ checkedAt: new Date().toISOString(), database: "isolated PostgreSQL 5433", weather: "deterministic loopback HTTP fixture; not real QWeather", ai: "deterministic loopback HTTP fixture; not a real model", originalDraftsEnabled: 0, restart: "worker killed during HTTP request; lease expired under controlled test time; second OS process recovered", fixtureCalls: { weather: fixture.state.paths.filter((v) => v.includes("/weather/")).length, model: fixture.state.prompts.length }, realServicesVerified: false, browserFixturesPrepared: proposals.length }, null, 2));
  });
});
