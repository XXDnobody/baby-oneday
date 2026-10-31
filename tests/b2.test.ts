import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import drafts from "../src/data/recipe-drafts.json";
import type { Agreements, CalendarDay, ContentFields, ContentLibrary, ContentSettings, ContentVersion, ImportResult, Pantry, Preference, PrintSnapshot, RecordEntry, RecordRevision, TrashItem } from "../src/shared/b2";
import reviewedDrafts from "../output/reuse-review-2026-10-30/recipe-drafts.json";
import type { Day, Household, ItemFields, Me, PlanItem } from "../src/shared/contracts";
import { closeDatabase, query } from "../src/server/db";
import { hashPassword } from "../src/server/crypto";
import { localDate } from "../src/server/households";
import { contentFieldsOnly } from "../src/server/content";
import { purgeExpiredTrash } from "../src/server/retention";
import { testClient } from "./http-client";

const owner = testClient(), member = testClient(), peer = testClient(), other = testClient();
const suffix = randomUUID().slice(0, 8); const password = "B2-test-only-password-" + suffix;
const accounts = { owner: "b2-owner-" + suffix + "@example.test", member: "b2-member-" + suffix + "@example.test", peer: "b2-peer-" + suffix + "@example.test", other: "b2-other-" + suffix + "@example.test" };
const today = localDate(); const shifted = (days: number) => new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
let householdId: string, otherHouseholdId: string, path: string, otherPath: string, ownerId: string, memberId: string, peerId: string;
let recipe: ContentVersion, activity: ContentVersion, linked: PlanItem, record: RecordEntry, planId: string, printId: string, longPrintId: string;
const recipeIds = drafts.drafts.map((d) => d.reviewId);
function content(kind: "recipe" | "activity" = "recipe", foodRevision = 1): ContentFields {
  return { kind, title: kind === "recipe" ? "测试南瓜饭" : "测试绘本共读", summary: "虚拟测试内容，不作真实饮食建议", ingredients: kind === "recipe" ? [{ name: "南瓜", amountText: "适量", formText: "按家庭确认处理" }] : [], steps: ["测试步骤一，按家庭核对版本准备。", "测试步骤二，跟随当天情况结束。"], tips: ["虚拟测试材料"], materials: "测试绘本和家中安静位置", scene: "indoor", purpose: "测试互动说明", observations: "测试观察说明", variation: "按当天兴趣调整", minAgeMonths: 12, maxAgeMonths: 30, applicability: "虚拟测试适用条件", preparation: "家庭核对的切配与软硬说明（测试）", quantityBasis: "虚拟测试原用量，不作营养推断", source: { title: "虚拟家庭做法记录", author: "测试家人", url: "", edition: "2026-10-31-test", locator: "虚拟测试资料第 1 条", summary: "用于测试的明确出处记录", adaptation: "仅测试改编", verification: "checked", professionalReview: "not_performed", professionalNote: "" }, familyConfirmed: true, applicabilityConfirmed: true, ingredientsConfirmed: kind === "recipe", foodProfileRevision: kind === "recipe" ? foodRevision : null, reviewIssues: [] };
}
async function enable(...entries: ContentVersion[]) {
  const settings = (await owner.request<ContentSettings>(path + "/content-settings")).data;
  const old = settings.enabled.filter((i) => !entries.some((e) => e.id === i.id));
  const result = await owner.request<ContentSettings>(path + "/content-settings", "PUT", { expectedRevision: settings.revision, enabled: [...old, ...entries.map((v) => ({ id: v.id, version: v.version }))] }, randomUUID());
  expect(result.status, result.error?.message).toBe(200);
}
async function create(v: ContentFields) {
  const saved = await owner.request<{ id: string }>(path + "/content", "POST", v, randomUUID()); expect(saved.status, saved.error?.message).toBe(201);
  return (await owner.request<ContentVersion>(path + "/content/" + saved.data.id)).data;
}
async function day() { return (await owner.request<Day>(path + "/today?date=" + today)).data; }
async function add(input: Partial<ItemFields> = {}) {
  const d = await day();
  const result = await member.request<PlanItem>(path + "/plans/" + planId + "/items", "POST", { kind: "activity", title: "测试共读", time: "10:00", notes: "仅测试", caregiverId: null, ...input, expectedRevision: d.plan!.revision }, randomUUID());
  expect(result.status, result.error?.message).toBe(201); return result.data;
}
async function newRecord(extra = {}, browser = member) {
  const result = await browser.request<RecordEntry>(path + "/records", "POST", { occurredOn: today, text: "这次愿意一起翻页", ...extra }, randomUUID()); expect(result.status, result.error?.message).toBe(201); return result.data;
}
beforeAll(async () => {
  const encoded = await hashPassword(password);
  for (const [kind, browser] of Object.entries({ owner, member, peer, other })) {
    const email = accounts[kind as keyof typeof accounts];
    await query("INSERT INTO users(email,email_key,display_name,password_hash,can_create_household) VALUES ($1,$1,$2,$3,$4)", [email, "B2测试" + kind, encoded, kind === "owner" || kind === "other"]);
    expect((await browser.request("auth/session", "POST", { email, password, remember: true })).status).toBe(200);
  }
  householdId = (await owner.request<{ id: string }>("households", "POST", { name: "B2虚拟家庭", city: "上海" }, randomUUID())).data.id;
  otherHouseholdId = (await other.request<{ id: string }>("households", "POST", { name: "B2另一家庭", city: "杭州" }, randomUUID())).data.id;
  path = "households/" + householdId; otherPath = "households/" + otherHouseholdId;
  ownerId = (await owner.request<Me>("me")).data.user.id; memberId = (await member.request<Me>("me")).data.user.id; peerId = (await peer.request<Me>("me")).data.user.id;
  for (const userId of [memberId, peerId]) await query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,'member')", [householdId, userId]);
  for (const [p, browser] of [[path, owner], [otherPath, other]] as const) expect((await browser.request(p + "/setup", "PUT", { expectedRevision: 1, child: { name: "B2虚拟宝宝", birthDate: null, ageMonths: 17, foodStatus: "unknown", foodRestrictions: "" } })).status).toBe(200);
  planId = (await owner.request<{ id: string }>(path + "/plans", "POST", { date: today }, randomUUID())).data.id;
});
afterAll(async () => { await query("DROP TRIGGER IF EXISTS b2_fail_import ON content_items"); await query("DROP FUNCTION IF EXISTS b2_import_failure()"); await closeDatabase(); });

describe("B2 真实隔离 PostgreSQL / HTTP", () => {
  test("日常成员确认三态食材、粗略余量、优先使用和服务端时间，重复提交幂等", async () => {
    const input = { expectedRevision: 1, items: [{ name: "南瓜", status: "available", quantity: "low", priority: true }, { name: "牛奶", status: "missing", quantity: "enough", priority: true }, { name: "鸡蛋", status: "unknown", quantity: "unknown", priority: false }] }; const key = randomUUID();
    const result = await member.request<Pantry>(path + "/pantry", "PUT", input, key); expect(result.status).toBe(200); expect(result.data.revision).toBe(2); expect(result.data.items.every((i) => !!i.confirmedAt)).toBe(true); expect(result.data.items[1]).toMatchObject({ quantity: "unknown", priority: false });
    expect((await member.request<Pantry>(path + "/pantry", "PUT", input, key)).data).toEqual(result.data);
    expect((await other.request(path + "/pantry")).status).toBe(404);
    expect((await member.request(path + "/pantry", "PUT", { ...input, items: [input.items[0], input.items[0]] }, randomUUID())).status).toBe(422);
  });
  test("食材并发确认只有一次成功，不静默覆盖", async () => {
    const v = (await owner.request<Pantry>(path + "/pantry")).data;
    const items = v.items.map(({ name, status, quantity, priority }) => ({ name, status, quantity, priority }));
    const results = await Promise.all([member.request(path + "/pantry", "PUT", { expectedRevision: v.revision, items }, randomUUID()), peer.request(path + "/pantry", "PUT", { expectedRevision: v.revision, items: [{ name: "南瓜", status: "available", quantity: "enough", priority: true }] }, randomUUID())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  test("近期偏好按起止日期生效和结束，不能变成永久禁忌", async () => {
    const dates = [[shifted(-1), shifted(-1), false], [today, today, true], [shifted(1), shifted(2), false]] as const;
    for (const [startsOn, endsOn] of dates) expect((await member.request(path + "/preferences", "POST", { kind: "like", scope: "activity", text: "绘本", startsOn, endsOn }, randomUUID())).status).toBe(201);
    const list = (await member.request<Preference[]>(path + "/preferences?date=" + today)).data;
    expect(list.filter((p) => p.active)).toHaveLength(1); const active = list.find((p) => p.active)!;
    expect((await peer.request(path + "/preferences/" + active.id, "PATCH", { kind: "note", scope: "all", text: "仅供家人参考", startsOn: today, endsOn: shifted(3), expectedRevision: 99 }, randomUUID())).status).toBe(409);
    expect((await member.request(path + "/preferences/" + active.id, "DELETE", { expectedRevision: active.revision }, randomUUID())).status).toBe(200);
    expect((await member.request<Preference[]>(path + "/preferences?date=" + today)).data.every((p) => !p.active)).toBe(true);
    expect((await owner.request<Household>(path)).data.child?.foodStatus).toBe("unknown");
  });
  test("导入 11 条草稿时单条数据库失败不回滚其余条目，失败可独立重试", async () => {
    await query("CREATE FUNCTION b2_import_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.import_key='R05' THEN RAISE EXCEPTION 'injected import failure'; END IF; RETURN NEW; END $$");
    await query("CREATE TRIGGER b2_fail_import BEFORE INSERT ON content_items FOR EACH ROW EXECUTE FUNCTION b2_import_failure()");
    const key = randomUUID(); const result = await owner.request<ImportResult[]>(path + "/content-imports", "POST", { ids: recipeIds }, key);
    expect(result.status).toBe(200); expect(result.data.filter((r) => r.status === "imported")).toHaveLength(10); expect(result.data.find((r) => r.importKey === "R05")?.status).toBe("failed");
    expect((await owner.request<ImportResult[]>(path + "/content-imports", "POST", { ids: recipeIds }, key)).data).toEqual(result.data);
    await query("DROP TRIGGER b2_fail_import ON content_items");
    const retry = await owner.request<ImportResult[]>(path + "/content-imports", "POST", { ids: ["R05"] }, randomUUID()); expect(retry.data[0]).toMatchObject({ status: "imported", attempts: 2 });
    expect((await member.request(path + "/content-imports", "POST", { ids: recipeIds }, randomUUID())).status).toBe(403);
  });
  test("全部 74 项原料、51 步、原提示及旧映射原文保留，默认未启用", async () => {
    expect(drafts).toEqual(reviewedDrafts);
    const results = (await owner.request<ImportResult[]>(path + "/content-imports")).data;
    let ingredients = 0, steps = 0;
    for (const original of drafts.drafts) {
      const result = results.find((r) => r.importKey === original.reviewId)!;
      const current = (await owner.request<ContentVersion>(path + "/content/" + result.contentId)).data;
      expect(current.legacy).toEqual(original); expect(current.steps).toEqual(original.originalSteps); expect(current.tips).toEqual(original.originalTips); expect(current.enabled).toBe(false);
      ingredients += current.ingredients.length; steps += current.steps.length;
    }
    expect(ingredients).toBe(74); expect(steps).toBe(51);
  });
  test("重复／并发导入不增加副本，不覆盖人工编辑，旧内容版本可读", async () => {
    const entries = (await owner.request<ImportResult[]>(path + "/content-imports")).data; const first = entries.find((r) => r.importKey === "R01")!;
    const v = (await owner.request<ContentVersion>(path + "/content/" + first.contentId)).data;
    const saved = await member.request(path + "/content/" + v.id, "PATCH", { expectedRevision: v.revision, content: { ...contentFieldsOnly(v), summary: "人工保留的修正" } }, randomUUID()); expect(saved.status).toBe(200);
    const outcomes = await Promise.all([owner.request<ImportResult[]>(path + "/content-imports", "POST", { ids: recipeIds }, randomUUID()), owner.request<ImportResult[]>(path + "/content-imports", "POST", { ids: recipeIds }, randomUUID())]);
    expect(outcomes.every((r) => r.data.every((i) => i.status === "existing"))).toBe(true);
    expect((await owner.request<ContentVersion>(path + "/content/" + v.id)).data.summary).toBe("人工保留的修正");
    expect((await owner.request<ContentVersion>(path + "/content/" + v.id + "/versions/1")).data.legacy).toEqual(drafts.drafts[0]);
    expect((await query<{ count: number }>("SELECT count(*)::int AS count FROM content_items WHERE household_id=$1", [householdId]))[0].count).toBe(11);
  });
  test("草稿不得启用，启用范围只有管理员可改，跨家庭具体版本不可读", async () => {
    const library = (await owner.request<ContentLibrary>(path + "/content")).data; const draft = library.items[0];
    const settings = (await owner.request<ContentSettings>(path + "/content-settings")).data;
    const input = { expectedRevision: settings.revision, enabled: [{ id: draft.id, version: draft.version }] };
    expect((await owner.request(path + "/content-settings", "PUT", input, randomUUID())).status).toBe(422);
    expect((await member.request(path + "/content-settings", "PUT", { ...input, enabled: [] }, randomUUID())).status).toBe(403);
    expect((await other.request(path + "/content/" + draft.id)).status).toBe(404);
    expect((await owner.request(otherPath + "/content/" + draft.id)).status).toBe(404);
  });
  test("启用菜谱也不把未知食物限制推断为适用，服务端阻止绕过候选", async () => {
    recipe = await create(content()); await enable(recipe);
    const list = (await member.request<ContentLibrary>(path + "/content?kind=recipe&date=" + today)).data;
    expect(list.items.find((v) => v.id === recipe.id)).toMatchObject({ eligible: false }); expect(list.items.find((v) => v.id === recipe.id)?.reasons.join(";")).toContain("未知");
    const d = await day();
    expect((await member.request(path + "/plans/" + planId + "/items", "POST", { kind: "meal", title: "测试", time: "12:00", contentId: recipe.id, contentVersion: recipe.version, expectedRevision: d.plan!.revision }, randomUUID())).status).toBe(422);
  });
  test("食物资料更新后须针对新版本核对；管理员重启用后才进入候选", async () => {
    const h = (await owner.request<Household>(path)).data;
    expect((await owner.request(path + "/child", "PATCH", { expectedRevision: h.revision, child: { name: h.child!.name, birthDate: null, ageMonths: 17, foodStatus: "none", foodRestrictions: "" } })).status).toBe(200);
    const changed = await member.request(path + "/content/" + recipe.id, "PATCH", { expectedRevision: recipe.revision, content: content("recipe", 2) }, randomUUID()); expect(changed.status).toBe(200);
    recipe = (await owner.request<ContentVersion>(path + "/content/" + recipe.id)).data; expect(recipe.enabled).toBe(false); await enable(recipe);
    const list = (await member.request<ContentLibrary>(path + "/content?kind=recipe&date=" + today)).data; expect(list.items.find((v) => v.id === recipe.id)?.eligible).toBe(true);
  });
  test("内容选择按月龄、场景和期限偏好筛选，库存仅用于有据排序", async () => {
    activity = await create(content("activity")); await enable(activity);
    const outdoor = (await member.request<ContentLibrary>(path + "/content?kind=activity&scene=outdoor&date=" + today)).data; expect(outdoor.items.find((v) => v.id === activity.id)?.eligible).toBe(false);
    const pantry = (await member.request<Pantry>(path + "/pantry")).data; const candidates = (await member.request<ContentLibrary>(path + "/content?kind=recipe&date=" + today)).data;
    expect(candidates.items.find((v) => v.id === recipe.id)?.score).toBeGreaterThan(0);
    const preference = await member.request<{ id: string }>(path + "/preferences", "POST", { kind: "avoid", scope: "meal", text: "南瓜", startsOn: today, endsOn: today }, randomUUID());
    expect((await member.request<ContentLibrary>(path + "/content?kind=recipe&date=" + today)).data.items.find((v) => v.id === recipe.id)?.eligible).toBe(false);
    expect((await member.request<ContentLibrary>(path + "/content?kind=recipe&date=" + shifted(1))).data.items.find((v) => v.id === recipe.id)?.eligible).toBe(true);
    await member.request(path + "/preferences/" + preference.data.id, "DELETE", { expectedRevision: 1 }, randomUUID());
    linked = await add({ title: activity.title, contentId: activity.id, contentVersion: activity.version, scene: "indoor" });
    await add({ kind: "meal", title: recipe.title, time: "12:00", contentId: recipe.id, contentVersion: recipe.version });
    expect((await member.request<Pantry>(path + "/pantry")).data).toEqual(pantry);
  });
  test("当天采购需求随单餐和库存快照派生，缺货、未知与余量核对分开，不修改计划", async () => {
    const old = await day(); const p = (await member.request<Pantry>(path + "/pantry")).data;
    for (const [status, quantity, expectedStatus] of [["missing", "unknown", "missing"], ["unknown", "unknown", "unknown"], ["available", "low", "check-amount"], ["available", "enough", null]] as const) {
      const current = (await member.request<Pantry>(path + "/pantry")).data;
      expect((await member.request(path + "/pantry", "PUT", { expectedRevision: current.revision, items: [{ name: "南瓜", status, quantity, priority: false }] }, randomUUID())).status).toBe(200);
      const d = await day(); expect(d.plan).toEqual(old.plan);
      expect(d.shopping?.find((n) => n.name === "南瓜")?.status ?? null).toBe(expectedStatus);
    }
    const current = (await member.request<Pantry>(path + "/pantry")).data;
    await member.request(path + "/pantry", "PUT", { expectedRevision: current.revision, items: p.items.map(({ name, status, quantity, priority }) => ({ name, status, quantity, priority })) }, randomUUID());
  });
  test("记录至少一项实际反馈、不能填未来，不能夹带作者或跨家庭计划", async () => {
    expect((await member.request(path + "/records", "POST", { occurredOn: today, text: "  " }, randomUUID())).status).toBe(422);
    expect((await member.request(path + "/records", "POST", { occurredOn: shifted(1), text: "未来不能记完成" }, randomUUID())).status).toBe(400);
    expect((await member.request(path + "/records", "POST", { occurredOn: today, text: "伪造作者", authorId: ownerId }, randomUUID())).status).toBe(422);
    expect((await other.request(otherPath + "/records", "POST", { occurredOn: today, text: "跨家关联", planItemId: linked.id, planItemRevision: linked.revision }, randomUUID())).status).toBe(404);
    expect((await member.request(path + "/records", "POST", { occurredOn: today, text: "旧计划版本", planItemId: linked.id, planItemRevision: 99 }, randomUUID())).status).toBe(409);
  });
  test("同一活动多次独立保存，重复提交同键仅一条，参与或兴趣可单独记录", async () => {
    const input = { occurredOn: today, text: "这次愿意一起翻页", planItemId: linked.id, planItemRevision: linked.revision }; const key = randomUUID();
    const first = await member.request<RecordEntry>(path + "/records", "POST", input, key); expect(first.status).toBe(201); record = first.data;
    const duplicates = await Promise.all([member.request<RecordEntry>(path + "/records", "POST", input, key), member.request<RecordEntry>(path + "/records", "POST", input, key)]); expect(duplicates.every((r) => r.data.id === record.id)).toBe(true);
    expect((await newRecord({ planItemId: linked.id, planItemRevision: linked.revision })).id).not.toBe(record.id);
    await newRecord({ text: "", participation: "not_joined" }); await newRecord({ text: "", interest: "interested" }); await newRecord({ text: "仅感想" });
    expect((await peer.request<RecordEntry>(path + "/records/" + record.id)).data.authorId).toBe(memberId);
  });
  test("仅作者或管理员更正、删除；管理员说明必填，原作者与更正历史保持", async () => {
    const input = { occurredOn: today, text: "管理员补充更正", participation: null, interest: null, expectedRevision: record.revision, correctionNote: "补记家人当时的说明" };
    expect((await peer.request(path + "/records/" + record.id, "PATCH", input, randomUUID())).status).toBe(403);
    expect((await peer.request(path + "/records/" + record.id, "DELETE", { expectedRevision: record.revision }, randomUUID())).status).toBe(403);
    expect((await owner.request(path + "/records/" + record.id, "PATCH", { ...input, correctionNote: "" }, randomUUID())).status).toBe(400);
    const saved = await owner.request<RecordEntry>(path + "/records/" + record.id, "PATCH", input, randomUUID()); expect(saved.status).toBe(200); record = saved.data;
    expect(record.authorId).toBe(memberId); expect(record.updatedBy).toBe(ownerId);
    const history = (await peer.request<RecordRevision[]>(path + "/records/" + record.id + "/revisions")).data;
    expect(history.map((r) => r.revision)).toEqual([2, 1]); expect(history[1].snapshot.text).toBe("这次愿意一起翻页"); expect(history[0].correctionNote).toBe(input.correctionNote);
  });
  test("记录并发更正只有一方成功，跨家庭正文与历史均不可读", async () => {
    const r = await newRecord(); const input = { occurredOn: today, text: "作者更正", expectedRevision: 1 };
    const results = await Promise.all([member.request(path + "/records/" + r.id, "PATCH", input, randomUUID()), owner.request(path + "/records/" + r.id, "PATCH", { ...input, text: "管理员更正", correctionNote: "家人补充" }, randomUUID())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await other.request(path + "/records/" + record.id)).status).toBe(404); expect((await other.request(otherPath + "/records/" + record.id + "/revisions")).status).toBe(404);
  });
  test("改计划与内容版本不改既有记录快照，未来安排提示重新核对", async () => {
    const old = (await member.request<RecordEntry>(path + "/records/" + record.id)).data.planSnapshot;
    const updated = await member.request<PlanItem>(path + "/plan-items/" + linked.id, "PATCH", { ...contentItemFields(linked), title: "后来调整的共读", expectedRevision: linked.revision }, randomUUID()); expect(updated.status).toBe(200); linked = updated.data;
    const next = { ...content("activity"), title: "新版测试绘本" }; expect((await member.request(path + "/content/" + activity.id, "PATCH", { expectedRevision: activity.revision, content: next }, randomUUID())).status).toBe(200);
    expect((await member.request<RecordEntry>(path + "/records/" + record.id)).data.planSnapshot).toEqual(old);
    expect((await day()).plan?.items.find((i) => i.id === linked.id)?.needsReview).toBe(true);
    expect((await owner.request<ContentVersion>(path + "/content/" + activity.id + "/versions/1")).data.title).toBe("测试绘本共读");
  });
  test("统一日历区分未来计划、取消和实际记录，不因时间过去记完成", async () => {
    const cancelled = await member.request<PlanItem>(path + "/plan-items/" + linked.id + "/cancel", "POST", { expectedRevision: linked.revision }, randomUUID()); expect(cancelled.status).toBe(200); linked = cancelled.data;
    const tomorrow = await owner.request<{ id: string }>(path + "/plans", "POST", { date: shifted(1) }, randomUUID());
    expect((await member.request(path + "/plans/" + tomorrow.data.id + "/items", "POST", { kind: "routine", title: "明天待安排", time: "09:00", expectedRevision: 1 }, randomUUID())).status).toBe(201);
    const result = await member.request<CalendarDay[]>(path + "/calendar?from=" + shifted(-1) + "&to=" + shifted(1)); expect(result.status).toBe(200);
    expect(result.data[1].cancelledCount).toBe(1); expect(result.data[1].recordCount).toBeGreaterThan(0); expect(result.data[2]).toMatchObject({ planCount: 1, recordCount: 0 });
    expect((await member.request(path + "/calendar?from=2026-01-01&to=2026-12-31")).status).toBe(422);
    expect((await member.request<RecordEntry>(path + "/records/" + record.id)).data.planSnapshot?.status).toBe("active");
  });
  test("固定当日打印快照注明日期版本，后续改安排不改变旧快照", async () => {
    const d = await day(); const input = { kind: "day", date: today, expectedRevision: d.plan!.revision, items: d.plan!.items.map((i) => ({ id: i.id, revision: i.revision })) }; const key = randomUUID();
    const result = await member.request<{ id: string }>(path + "/print-snapshots", "POST", input, key); expect(result.status).toBe(201); printId = result.data.id;
    expect((await member.request<{ id: string }>(path + "/print-snapshots", "POST", input, key)).data.id).toBe(printId);
    const before = (await member.request<PrintSnapshot>(path + "/print-snapshots/" + printId)).data;
    const manual = await add({ title: "后加的手动安排", time: "16:00", kind: "routine" });
    expect((await member.request<PrintSnapshot>(path + "/print-snapshots/" + printId)).data).toEqual(before); expect(before.items.some((i) => i.id === manual.id)).toBe(false); expect(before.recipes[0].version).toBe(recipe.version);
    expect((await other.request(otherPath + "/print-snapshots/" + printId)).status).toBe(404);
  });
  test("管理员设置共同提醒，日常成员只读；快照保留当时已认可提醒", async () => {
    const input = { expectedRevision: 1, items: [{ text: "测试共同提醒，按当天实际情况调整", enabled: true }] };
    expect((await member.request(path + "/agreements", "PUT", input, randomUUID())).status).toBe(403);
    const saved = await owner.request<Agreements>(path + "/agreements", "PUT", input, randomUUID()); expect(saved.status).toBe(200);
    expect((await member.request<Agreements>(path + "/agreements")).data.items).toEqual(input.items);
    expect((await other.request(otherPath + "/agreements", "PUT", input, randomUUID())).status).toBe(200);
    const snapshot = (await member.request<{ id: string }>(path + "/print-snapshots", "POST", { kind: "recipe", date: today, contentId: recipe.id, contentVersion: recipe.version }, randomUUID())).data;
    await owner.request(path + "/agreements", "PUT", { expectedRevision: saved.data.revision, items: [] }, randomUUID());
    expect((await member.request<PrintSnapshot>(path + "/print-snapshots/" + snapshot.id)).data.reminders).toEqual([input.items[0].text]);
    await owner.request(path + "/agreements", "PUT", { expectedRevision: saved.data.revision + 1, items: input.items }, randomUUID());
  });
  test("取消与删除分开，重复删除不延长截止，普通查询及历史隐藏删除项", async () => {
    expect((await day()).plan?.items.some((i) => i.id === linked.id && i.status === "cancelled")).toBe(true);
    const key = randomUUID(); const input = { expectedRevision: linked.revision };
    const removed = await member.request<{ revision: number; restoreUntil: string }>(path + "/plan-items/" + linked.id, "DELETE", input, key); expect(removed.status).toBe(200);
    const again = await member.request<{ restoreUntil: string }>(path + "/plan-items/" + linked.id, "DELETE", input, randomUUID()); expect(again.data.restoreUntil).toBe(removed.data.restoreUntil);
    expect((await member.request(path + "/plan-items/" + linked.id + "/versions")).status).toBe(404);
    expect((await day()).plan?.items.some((i) => i.id === linked.id)).toBe(false);
    expect((await member.request<RecordEntry>(path + "/records/" + record.id)).data.planSnapshot?.title).toBe("测试绘本共读");
    expect((await member.request(path + "/print-snapshots/" + printId)).status).toBe(404);
    linked = { ...linked, revision: removed.data.revision };
  });
  test("恢复重新预览日计划版本，冲突不覆盖后来安排，重复恢复只一次", async () => {
    const preview = (await member.request<{ planRevision: number; hasConflict: boolean }>(path + "/plan-items/" + linked.id + "/restore-preview", "POST", { expectedRevision: linked.revision })).data;
    const clash = await add({ kind: linked.kind, title: "后来同一时段的新安排", time: linked.time });
    const restore = { expectedRevision: linked.revision, expectedPlanRevision: preview.planRevision };
    expect((await member.request(path + "/plan-items/" + linked.id + "/restore", "POST", restore, randomUUID())).error?.code).toBe("RESTORE_CONFLICT");
    expect((await day()).plan?.items.find((i) => i.id === clash.id)?.title).toBe(clash.title);
    await member.request(path + "/plan-items/" + clash.id, "DELETE", { expectedRevision: clash.revision }, randomUUID());
    expect((await member.request(path + "/plan-items/" + linked.id + "/restore", "POST", restore, randomUUID())).error?.code).toBe("RESTORE_CONFLICT");
    const fresh = (await member.request<{ planRevision: number }>(path + "/plan-items/" + linked.id + "/restore-preview", "POST", { expectedRevision: linked.revision })).data; const key = randomUUID(); const input = { expectedRevision: linked.revision, expectedPlanRevision: fresh.planRevision };
    const saved = await member.request<{ revision: number }>(path + "/plan-items/" + linked.id + "/restore", "POST", input, key); expect(saved.status).toBe(200); expect((await member.request(path + "/plan-items/" + linked.id + "/restore", "POST", input, key)).status).toBe(200);
    expect((await day()).plan?.items.filter((i) => i.id === linked.id)).toHaveLength(1); linked.revision = saved.data.revision;
  });
  test("记录回收站按当前作者权限过滤，重复删除不延期，删除后幂等重放不泄露正文", async () => {
    const input = { occurredOn: today, text: "删除后不从幂等缓存泄露" }; const key = randomUUID();
    const made = (await member.request<RecordEntry>(path + "/records", "POST", input, key)).data;
    const removed = await member.request<{ revision: number; restoreUntil: string }>(path + "/records/" + made.id, "DELETE", { expectedRevision: 1 }, randomUUID()); expect(removed.status).toBe(200);
    expect((await member.request<{ restoreUntil: string }>(path + "/records/" + made.id, "DELETE", { expectedRevision: 1 }, randomUUID())).data.restoreUntil).toBe(removed.data.restoreUntil);
    expect((await member.request(path + "/records", "POST", input, key)).status).toBe(404);
    expect((await member.request(path + "/records/" + made.id + "/revisions")).status).toBe(404);
    expect((await peer.request<{ items: TrashItem[] }>(path + "/trash")).data.items.some((r) => r.id === made.id)).toBe(false);
    expect((await owner.request<{ items: TrashItem[] }>(path + "/trash")).data.items.some((r) => r.id === made.id)).toBe(true);
    expect((await peer.request(path + "/records/" + made.id + "/restore", "POST", { expectedRevision: removed.data.revision }, randomUUID())).status).toBe(403);
    const restoreKey = randomUUID(); const restoreInput = { expectedRevision: removed.data.revision };
    expect((await member.request(path + "/records/" + made.id + "/restore", "POST", restoreInput, restoreKey)).status).toBe(200);
    expect((await member.request(path + "/records/" + made.id + "/restore", "POST", restoreInput, restoreKey)).status).toBe(200);
    expect((await member.request<RecordEntry>(path + "/records/" + made.id)).data.authorId).toBe(memberId);
  });
  test("撤销成员或撤掉管理员身份后，恢复及旧幂等请求仍重新授权", async () => {
    const own = await newRecord(); const removed = (await owner.request<{ revision: number }>(path + "/records/" + own.id, "DELETE", { expectedRevision: 1 }, randomUUID())).data;
    await query("UPDATE memberships SET role='member' WHERE household_id=$1 AND user_id=$2", [householdId, ownerId]);
    expect((await owner.request(path + "/records/" + own.id + "/restore", "POST", { expectedRevision: removed.revision }, randomUUID())).status).toBe(403);
    await query("UPDATE memberships SET role='admin' WHERE household_id=$1 AND user_id=$2", [householdId, ownerId]);
    const key = randomUUID(); const input = { occurredOn: today, text: "撤销后不可重放" }; expect((await member.request(path + "/records", "POST", input, key)).status).toBe(201);
    await query("UPDATE memberships SET revoked_at=now() WHERE household_id=$1 AND user_id=$2", [householdId, memberId]);
    expect((await member.request(path + "/records", "POST", input, key)).status).toBe(404); expect((await member.request(path + "/records/" + own.id + "/restore", "POST", { expectedRevision: removed.revision }, randomUUID())).status).toBe(404);
    await query("UPDATE memberships SET revoked_at=NULL WHERE household_id=$1 AND user_id=$2", [householdId, memberId]);
  });
  test("两位有权成员并发恢复一条记录，仅一次恢复成功且不会增加副本", async () => {
    const made = await newRecord(); const removed = (await member.request<{ revision: number }>(path + "/records/" + made.id, "DELETE", { expectedRevision: made.revision }, randomUUID())).data;
    const results = await Promise.all([member.request(path + "/records/" + made.id + "/restore", "POST", { expectedRevision: removed.revision }, randomUUID()), owner.request(path + "/records/" + made.id + "/restore", "POST", { expectedRevision: removed.revision }, randomUUID())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]); expect((await member.request<RecordEntry>(path + "/records/" + made.id)).data.revision).toBe(removed.revision + 1);
    expect(await query("SELECT id FROM activity_records WHERE id=$1", [made.id])).toHaveLength(1);
  });
  test("恢复截止前可恢复，截止时与之后不可读或恢复，即使物理行仍在", async () => {
    for (const boundary of ["before", "at", "after"] as const) {
      const r = await newRecord({ text: "期限边界 " + boundary }); const removed = (await member.request<{ revision: number }>(path + "/records/" + r.id, "DELETE", { expectedRevision: 1 }, randomUUID())).data;
      await query("UPDATE activity_records SET restore_until=clock_timestamp()+($2::int*interval '1 second') WHERE id=$1", [r.id, boundary === "before" ? 30 : boundary === "at" ? 0 : -1]);
      const reply = await member.request(path + "/records/" + r.id + "/restore", "POST", { expectedRevision: removed.revision }, randomUUID()); expect(reply.status).toBe(boundary === "before" ? 200 : 410);
      if (boundary !== "before") {
        expect((await member.request(path + "/records/" + r.id)).status).toBe(404); expect((await member.request(path + "/records/" + r.id + "/revisions")).status).toBe(404);
        expect((await member.request<{ items: TrashItem[] }>(path + "/trash")).data.items.some((t) => t.id === r.id)).toBe(false);
        expect((await query("SELECT text FROM activity_records WHERE id=$1", [r.id]))[0].text).toContain("期限边界");
        expect((await other.request(otherPath + "/records/" + r.id + "/restore", "POST", { expectedRevision: removed.revision }, randomUUID())).status).toBe(404);
      }
    }
    expect((await query<{ allowed: boolean }>("SELECT t>t AS allowed FROM (SELECT clock_timestamp() AS t) q"))[0].allowed).toBe(false);
  });
  test("计划过期同样不可读历史或恢复，关联记录保存独立历史快照", async () => {
    const old = (await member.request<RecordEntry>(path + "/records/" + record.id)).data.planSnapshot;
    const removed = (await member.request<{ revision: number }>(path + "/plan-items/" + linked.id, "DELETE", { expectedRevision: linked.revision }, randomUUID())).data;
    await query("UPDATE plan_items SET restore_until=clock_timestamp()-interval '1 second' WHERE id=$1", [linked.id]);
    expect((await member.request(path + "/plan-items/" + linked.id + "/restore-preview", "POST", { expectedRevision: removed.revision })).status).toBe(410);
    expect((await member.request(path + "/plan-items/" + linked.id + "/restore", "POST", { expectedRevision: removed.revision, expectedPlanRevision: 1 }, randomUUID())).status).toBe(410);
    expect((await member.request(path + "/plan-items/" + linked.id + "/versions")).status).toBe(404);
    expect((await member.request<RecordEntry>(path + "/records/" + record.id)).data.planSnapshot).toEqual(old);
  });
  test("长菜谱打印保存全部步骤和指定版本，更新内容仍可重印固定快照", async () => {
    const v = content(); v.title = "虚拟长菜谱打印测试"; v.steps = Array.from({ length: 65 }, (_, i) => `步骤 ${i + 1}：这是多页打印完整性测试。` + "保留这一条的完整文字、换行和实际说明。".repeat(8));
    const long = await create(v); const result = await owner.request<{ id: string }>(path + "/print-snapshots", "POST", { kind: "recipe", date: today, contentId: long.id, contentVersion: 1 }, randomUUID()); expect(result.status).toBe(201); longPrintId = result.data.id;
    const before = (await member.request<PrintSnapshot>(path + "/print-snapshots/" + longPrintId)).data;
    expect(before.recipes[0].steps).toEqual(v.steps); expect(before.date).toBe(today);
    expect((await owner.request(path + "/content/" + long.id, "PATCH", { expectedRevision: 1, content: { ...v, title: "后来的标题" } }, randomUUID())).status).toBe(200);
    expect((await member.request<PrintSnapshot>(path + "/print-snapshots/" + longPrintId)).data).toEqual(before);
  });
  test("到期清理正文、历史和幂等正文，不清理有效记录与关联独立快照", async () => {
    const before = (await member.request<RecordEntry>(path + "/records/" + record.id)).data;
    const activeOld = await newRecord({ occurredOn: shifted(-400), text: "长期保留的有效旧记录" });
    const notExpired = await newRecord({ text: "尚在恢复期限内的记录" }); await member.request(path + "/records/" + notExpired.id, "DELETE", { expectedRevision: 1 }, randomUUID());
    const counts = await purgeExpiredTrash(); expect(counts.records).toBeGreaterThan(0); expect(counts.planItems).toBeGreaterThan(0);
    expect((await query<{ text: string }>("SELECT text FROM activity_records WHERE id=$1", [notExpired.id]))[0].text).toBe("尚在恢复期限内的记录");
    expect((await member.request<RecordEntry>(path + "/records/" + activeOld.id)).data.text).toBe(activeOld.text);
    expect((await member.request<RecordEntry>(path + "/records/" + record.id)).data.planSnapshot).toEqual(before.planSnapshot);
    expect(await query("SELECT revision FROM plan_item_versions WHERE plan_item_id=$1", [linked.id])).toHaveLength(0);
    const expired = await query<{ body: string; title: string; snapshot: unknown }>("SELECT notes AS body,title,content_snapshot AS snapshot FROM plan_items WHERE id=$1", [linked.id]); expect(expired[0]).toEqual({ body: "", title: "已过期删除的安排", snapshot: null });
    expect((await query<{ count: number }>("SELECT count(*)::int AS count FROM activity_records WHERE body_purged_at IS NOT NULL AND (text<>'' OR plan_snapshot IS NOT NULL)", []))[0].count).toBe(0);
    expect((await purgeExpiredTrash()).records).toBe(0);
    expect((await member.request(path + "/print-snapshots/" + printId)).status).toBe(404);
  });
  test("所有 B2 通知只含资源标识与修订，不泄露记录正文；保留浏览器夹具", async () => {
    await owner.request(path + "/content-imports", "POST", { ids: ["A01", "A02"] }, randomUUID());
    const events = await query<{ resource_type: string; resource_id: string; revision: number }>("SELECT resource_type,resource_id,revision FROM household_events WHERE household_id=$1", [householdId]); expect(events.length).toBeGreaterThan(20);
    expect(events.every((e) => Object.keys(e).sort().join(",") === "resource_id,resource_type,revision")).toBe(true);
    await mkdir(".local", { recursive: true, mode: 0o700 });
    await writeFile(".local/browser-fixture-b2.json", JSON.stringify({ accounts, password, householdId, otherHouseholdId, memberId, ownerId, peerId, today, planId, recipeId: recipe.id, recipeVersion: recipe.version, activityId: activity.id, recordId: record.id, longPrintId }, null, 2), { mode: 0o600 });
    await mkdir("output/b2-local-2026-10-31", { recursive: true });
    await writeFile("output/b2-local-2026-10-31/integration-evidence.json", JSON.stringify({ verifiedAt: new Date().toISOString(), environment: "isolated PostgreSQL 5433 / HTTP contract", migration: "002_b2.sql", sourceDrafts: 11, ingredients: 74, steps: 51, fixtures: "synthetic only", expiry: "before / at / after; rows retained; ordinary read, history and restore guarded", restore: "current role, original author, expected plan revision and colliding slot verified", remaining: ["real family content confirmation", "physical devices", "paper printer", "B3"] }, null, 2));
  });
});
function contentItemFields(item: PlanItem): ItemFields { return { kind: item.kind, title: item.title, time: item.time, notes: item.notes, caregiverId: item.caregiverId, contentId: item.contentId, contentVersion: item.contentVersion, scene: item.scene }; }
