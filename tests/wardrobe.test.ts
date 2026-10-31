import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Day, Me } from "../src/shared/contracts";
import type { WeatherView } from "../src/shared/b3";
import { garmentFields, outfitInput, type Garment, type GarmentFields, type OutfitInput, type OutfitResult, type Wardrobe } from "../src/shared/wardrobe";
import { matchOutfits } from "../src/shared/wardrobe-match";
import { closeDatabase, query } from "../src/server/db";
import { hashPassword } from "../src/server/crypto";
import { localDate } from "../src/server/households";
import { readConfig } from "../src/server/config";
import { handle } from "../src/server/http";
import { testClient } from "./http-client";

const fields: GarmentFields = { name: "测试上衣", category: "top", warmth: "medium", color: "米白", size: "90", scene: "either", activities: ["daily", "active", "quiet", "stroller"], status: "ready", waterproof: false, windproof: false, notes: "虚拟测试衣物" };
const input: OutfitInput = { date: localDate(), startTime: "09:00", endTime: "10:00", scene: "outdoor", activity: "daily" };
function garment(id: string, extra: Partial<Garment> = {}): Garment { return { ...fields, id, revision: 1, photoVersion: 1, photoUrl: "/test-" + id, updatedAt: new Date().toISOString(), updatedBy: "测试家人", ...extra }; }
function weather(temperature = 15, extras = {}): WeatherView {
  return { location: null, request: input, current: null, hourly: null, state: "available", reason: "测试预报", hours: [{ at: input.date + "T09:00:00+08:00", temperature, feelsLike: temperature, text: "测试天气", windSpeed: 0, precipitation: 0, probability: 0, ...extras }], outfit: null };
}
const basics = [garment("top"), garment("bottom", { category: "bottom" }), garment("coat", { category: "outerwear" }), garment("shoes", { category: "shoes" })];
describe("真实库存与天气搭配规则", () => {
  test("适用上下装、外套和鞋子组成一套，每件均来自实际库存", () => {
    const r = matchOutfits(basics, weather(), input); expect(r.outfits).toHaveLength(1); expect(r.outfits[0].missing).toEqual([]);
    expect(r.outfits[0].items.map((i) => i.garment.id)).toEqual(["top", "bottom", "coat", "shoes"]);
  });
  test("只有连体衣时不重复要求上衣和裤装，连体衣与分体衣有独立组合", () => {
    const r = matchOutfits([...basics, garment("one", { category: "onepiece" })], weather(), input);
    expect(r.outfits).toHaveLength(2); expect(r.outfits[1].items.some((i) => i.garment.id === "one")).toBe(true); expect(r.outfits[1].missing).toEqual([]);
  });
  test.each(["laundry", "small", "archived"] as const)("%s 衣物不参加搭配，缺裤装明确列出", (status) => {
    const r = matchOutfits(basics.map((i) => i.id === "bottom" ? { ...i, status } : i), weather(), input);
    expect(r.outfits[0].items.some((i) => i.garment.id === "bottom")).toBe(false); expect(r.outfits[0].missing).toContain("缺少适用的裤装或连体衣");
  });
  test("场景、活动和厚薄不符时不填入看似完整的组合", () => {
    const clothes = [garment("indoor", { scene: "indoor" }), garment("onlyQuiet", { activities: ["quiet"] }), garment("winter", { warmth: "warm" })];
    const r = matchOutfits(clothes, weather(28), input); expect(r.state).toBe("empty"); expect(r.outfits[0].items).toEqual([]); expect(r.outfits[0].missing).toHaveLength(3);
  });
  test("雨风天气优先带有对应标记的外套，并保留防雨缺项提醒", () => {
    const r = matchOutfits([...basics, garment("rain", { category: "outerwear", waterproof: true, windproof: true })], weather(22, { precipitation: 1, windSpeed: 6 }), input);
    expect(r.outfits[0].items.find((i) => i.garment.category === "outerwear")?.garment.id).toBe("rain");
    expect(matchOutfits(basics, weather(22, { precipitation: 1 }), input).reminders.some((s) => s.includes("没有适用且标记防水"))).toBe(true);
  });
  test("炎热天气排除保暖层，寒冷天气不拿轻薄衣物填充缺口", () => {
    expect(matchOutfits([garment("winter", { warmth: "warm" })], weather(30), input).outfits[0].items).toEqual([]);
    expect(matchOutfits([garment("summer", { warmth: "light" })], weather(4), input).outfits[0].items).toEqual([]);
    expect(matchOutfits([garment("summer", { warmth: "light" })], weather(4), { ...input, activity: "active" }).outfits[0].items).toEqual([]);
    expect(matchOutfits([...basics, garment("hat", { category: "hat" })], weather(15, { windSpeed: 6 }), input).outfits[0].items.some((i) => i.garment.id === "hat")).toBe(true);
  });
  test("室内与推车模式的提醒各自对应真实所选场景", () => {
    const inside = matchOutfits(basics, weather(), { ...input, scene: "indoor", activity: "quiet" });
    expect(inside.reminders.some((s) => s.includes("室内实际温度"))).toBe(true);
    expect(matchOutfits(basics, weather(), { ...input, activity: "stroller" }).reminders.some((s) => s.includes("久坐体感"))).toBe(true);
  });
  test.each(["missing", "stale", "timeout"])("%s 天气没有任何气温搭配，不能用旧衣物组合冒充当前结果", (state) => {
    const r = matchOutfits(basics, { ...weather(), state }, input); expect(r.state).toBe("weather_unavailable"); expect(r.outfits).toEqual([]);
  });
  test("库中为空时显示具体衣物缺项，不生成假照片和假单品", () => {
    const r = matchOutfits([], weather(), input); expect(r.state).toBe("empty"); expect(r.outfits[0].items).toEqual([]); expect(r.outfits[0].missing).toContain("缺少适用的外套");
  });
  test("候选组合最多三套且不重复，不把多件上衣叠成一套", () => {
    const r = matchOutfits([...basics, ...[1, 2, 3, 4].map((i) => garment("top" + i))], weather(), input);
    expect(r.outfits).toHaveLength(3); expect(new Set(r.outfits.map((s) => s.id)).size).toBe(3);
    expect(r.outfits.every((s) => s.items.filter((i) => i.garment.category === "top").length === 1)).toBe(true);
  });
  test("非法活动、空活动、重复活动与反向时间被契约拒绝", () => {
    expect(garmentFields.safeParse({ ...fields, activities: [] }).success).toBe(false);
    expect(garmentFields.safeParse({ ...fields, activities: ["daily", "daily"] }).success).toBe(false);
    expect(outfitInput.safeParse({ ...input, activity: "unknown" }).success).toBe(false);
    expect(outfitInput.safeParse({ ...input, endTime: "08:00" }).success).toBe(false);
  });
});

const owner = testClient(), member = testClient(), other = testClient(), anonymous = testClient();
const suffix = randomUUID().slice(0, 8), password = "Wardrobe-test-only-" + suffix;
let householdId: string, otherId: string, ownerId: string, memberId: string, path: string, photo: string, item: Garment;
function editFields(g: Garment) { return Object.fromEntries(Object.keys(fields).map((key) => [key, g[key as keyof GarmentFields]])); }
async function rawRequest(browser: ReturnType<typeof testClient>, target: string, method = "GET", body?: string, headers: Record<string, string> = {}) {
  const url = new URL("/api/v1/" + target, readConfig().origin);
  const cookies = [...browser.cookies].map(([k, v]) => k + "=" + v).join("; ");
  return handle(new NextRequest(url, { method, headers: { Cookie: cookies, Origin: readConfig().origin, ...headers }, ...(body !== undefined ? { body } : {}) }), url.pathname.split("/").slice(3));
}
async function add(extra: Partial<GarmentFields> = {}, browser = member) {
  const result = await browser.request<Garment>(path, "POST", { ...fields, ...extra, photo }, randomUUID()); expect(result.status, result.error?.message).toBe(201); return result.data;
}
beforeAll(async () => {
  const encoded = await hashPassword(password);
  for (const [who, browser] of [["owner", owner], ["member", member], ["other", other]] as const) {
    const email = "wardrobe-" + who + "-" + suffix + "@example.test";
    await query("INSERT INTO users(email,email_key,display_name,password_hash,can_create_household) VALUES ($1,$1,$2,$3,$4)", [email, "衣物测试" + who, encoded, who !== "member"]);
    expect((await browser.request("auth/session", "POST", { email, password, remember: true })).status).toBe(200);
  }
  householdId = (await owner.request<{ id: string }>("households", "POST", { name: "衣物测试家庭", city: "上海" }, randomUUID())).data.id;
  otherId = (await other.request<{ id: string }>("households", "POST", { name: "衣物另一个家庭", city: "杭州" }, randomUUID())).data.id;
  ownerId = (await owner.request<Me>("me")).data.user.id; memberId = (await member.request<Me>("me")).data.user.id;
  await query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,'member')", [householdId, memberId]);
  path = "households/" + householdId + "/wardrobe";
  const png = await sharp({ create: { width: 1800, height: 1500, channels: 3, background: "#e9dec7" } }).withMetadata().png().toBuffer();
  photo = "data:image/png;base64," + png.toString("base64");
});
afterAll(closeDatabase);

describe("衣服库真实 PostgreSQL / HTTP", () => {
  test("成员上传照片和资料，重复请求不会重复入库，列表不包含原图数据", async () => {
    const key = randomUUID(), body = { ...fields, photo };
    const result = await member.request<Garment>(path, "POST", body, key); expect(result.status, result.error?.message).toBe(201); item = result.data;
    expect((await member.request<Garment>(path, "POST", body, key)).data).toEqual(item);
    expect((await member.request(path, "POST", { ...body, name: "另一个名字" }, key)).status).toBe(409);
    const list = (await owner.request<Wardrobe>(path)).data;
    expect(list.items).toHaveLength(1); expect(list.items[0]).toMatchObject({ name: fields.name, updatedBy: "衣物测试member" });
    expect(JSON.stringify(list)).not.toContain("base64");
  });
  test("照片已重新解码、缩小、移除 EXIF，响应按家庭鉴权且禁止缓存", async () => {
    const response = await rawRequest(owner, path + "/" + item.id + "/photo"); expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg"); expect(response.headers.get("Cache-Control")).toContain("no-store"); expect(response.headers.get("Vary")).toContain("Cookie"); expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata(); expect(metadata.format).toBe("jpeg"); expect(metadata.width).toBe(1200); expect(metadata.exif).toBeUndefined();
    expect((await rawRequest(anonymous, path + "/" + item.id + "/photo")).status).toBe(401);
    expect((await rawRequest(other, path + "/" + item.id + "/photo")).status).toBe(404);
    expect((await rawRequest(other, "households/" + otherId + "/wardrobe/" + item.id + "/photo")).status).toBe(404);
  });
  test("家庭隔离覆盖元数据、写入和搭配接口，拒绝后没有照片/事件新增", async () => {
    const count = (await query<{ count: number }>("SELECT count(*)::int AS count FROM wardrobe_items WHERE household_id=$1", [householdId]))[0].count;
    for (const target of [path, path + "/" + item.id, path + "/outfits?" + new URLSearchParams(input)]) expect((await other.request(target)).status).toBe(404);
    expect((await other.request(path, "POST", { ...fields, photo }, randomUUID())).status).toBe(404);
    expect((await other.request(path + "/" + item.id, "PATCH", { ...fields, expectedRevision: item.revision }, randomUUID())).status).toBe(404);
    expect((await query<{ count: number }>("SELECT count(*)::int AS count FROM wardrobe_items WHERE household_id=$1", [householdId]))[0].count).toBe(count);
  });
  test("写入必须验证 CSRF 和幂等凭证", async () => {
    expect((await rawRequest(owner, path, "POST", JSON.stringify({ ...fields, photo }), { "Content-Type": "application/json" })).status).toBe(403);
    expect((await owner.request(path, "POST", { ...fields, photo })).status).toBe(400);
  });
  test("伪图片、格式不符和超过上限都不会产生入库数据", async () => {
    const count = (await owner.request<Wardrobe>(path)).data.items.length;
    for (const invalid of ["data:image/png;base64," + Buffer.from("not a picture").toString("base64"), photo.replace("image/png", "image/jpeg"), "data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64"), "data:image/jpeg;base64," + Buffer.alloc(2 * 1024 * 1024 + 3, 255).toString("base64")]) {
      const r = await owner.request(path, "POST", { ...fields, photo: invalid }, randomUUID()); expect([413, 422]).toContain(r.status);
    }
    expect((await owner.request<Wardrobe>(path)).data.items).toHaveLength(count);
  });
  test("像素过大的图片被服务端拒绝", async () => {
    const oversized = "data:image/png;base64," + (await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer()).toString("base64");
    expect((await owner.request(path, "POST", { ...fields, photo: oversized }, randomUUID())).status).toBe(422);
  });
  test("请求体和衣物库容量均受限，达到上限后仍能编辑已有衣物", async () => {
    expect((await owner.request(path, "POST", { ...fields, photo, notes: "x".repeat(3 * 1024 * 1024) }, randomUUID())).status).toBe(413);
    const count = (await owner.request<Wardrobe>(path)).data.items.length;
    const inserted = await query<{ id: string }>("INSERT INTO wardrobe_items(household_id,fields,photo,updated_by) SELECT household_id,jsonb_set(fields,'{name}','\"容量测试\"'),photo,updated_by FROM wardrobe_items CROSS JOIN generate_series(1,$3::int) WHERE household_id=$1 AND id=$2 RETURNING id", [householdId, item.id, 200 - count]);
    try {
      const result = await owner.request(path, "POST", { ...fields, photo }, randomUUID()); expect(result.error?.code).toBe("WARDROBE_FULL");
      const changed = await owner.request<Garment>(path + "/" + item.id, "PATCH", { ...fields, expectedRevision: item.revision }, randomUUID()); expect(changed.status).toBe(200); item = changed.data;
    } finally { await query("DELETE FROM wardrobe_items WHERE household_id=$1 AND id=ANY($2::uuid[])", [householdId, inserted.map((i) => i.id)]); }
  });
  test("并发编辑只有一个成功，另一个保留冲突而不覆盖", async () => {
    const baseRevision = item.revision;
    const results = await Promise.all([owner.request<Garment>(path + "/" + item.id, "PATCH", { ...fields, name: "家人编辑一", expectedRevision: baseRevision }, randomUUID()), member.request<Garment>(path + "/" + item.id, "PATCH", { ...fields, name: "家人编辑二", expectedRevision: baseRevision }, randomUUID())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    item = (await owner.request<Garment>(path + "/" + item.id)).data; expect(item.revision).toBe(baseRevision + 1); expect(["家人编辑一", "家人编辑二"]).toContain(item.name);
  });
  test("待洗、不合身、收起和恢复可穿可逆；未更换照片不改变照片版本", async () => {
    for (const status of ["laundry", "small", "archived", "ready"] as const) {
      const r = await member.request<Garment>(path + "/" + item.id, "PATCH", { ...editFields(item), status, expectedRevision: item.revision }, randomUUID()); expect(r.status).toBe(200); item = r.data; expect(item.status).toBe(status); expect(item.photoVersion).toBe(1);
    }
    const replacement = await member.request<Garment>(path + "/" + item.id, "PATCH", { ...editFields(item), photo, expectedRevision: item.revision }, randomUUID()); expect(replacement.status).toBe(200); item = replacement.data; expect(item.photoVersion).toBe(2);
  });
  test("真实天气快照与库存形成搭配；查询不更改日计划，状态和时段变化立即生效", async () => {
    await query("INSERT INTO weather_locations(household_id,label,latitude,longitude,provenance,confirmed_by) VALUES ($1,'虚拟测试地点',31.23,121.47,'test',$2)", [householdId, ownerId]);
    await query("INSERT INTO weather_snapshots(household_id,location_revision,location,provider,product,state,valid_from,valid_to,stale_after,purge_after,data,source_url,test_service) VALUES ($1,1,'{}','test','hourly','available',$2,$3,now()+interval '1 hour',now()+interval '24 hours',$4,'https://example.test/weather',true)", [householdId, input.date + "T09:00:00+08:00", input.date + "T11:00:00+08:00", JSON.stringify(weather().hours)]);
    await add({ name: "测试裤子", category: "bottom" }); await add({ name: "测试外套", category: "outerwear" }); await add({ name: "测试鞋", category: "shoes" }); await add({ name: "待洗干扰衣物", status: "laundry" });
    const before = (await owner.request<Day>("households/" + householdId + "/today?date=" + input.date)).data;
    const r = await member.request<OutfitResult>(path + "/outfits?" + new URLSearchParams(input)); expect(r.status).toBe(200); expect(r.data.state).toBe("available"); expect(r.data.weather.hourly?.testService).toBe(true); expect(r.data.outfits[0].missing).toEqual([]);
    expect(r.data.outfits.flatMap((s) => s.items).some((g) => g.garment.status !== "ready")).toBe(false);
    expect((await owner.request<Day>("households/" + householdId + "/today?date=" + input.date)).data).toEqual(before);
    const future = (await owner.request<OutfitResult>(path + "/outfits?" + new URLSearchParams({ ...input, startTime: "12:00", endTime: "13:00" }))).data; expect(future.state).toBe("weather_unavailable"); expect(future.outfits).toEqual([]);
  });
  test("过时天气或地点修订变化后不能延用原搭配", async () => {
    await query("UPDATE weather_snapshots SET stale_after=now()-interval '1 second' WHERE household_id=$1", [householdId]);
    expect((await owner.request<OutfitResult>(path + "/outfits?" + new URLSearchParams(input))).data.outfits).toEqual([]);
    await query("UPDATE weather_locations SET revision=revision+1 WHERE household_id=$1", [householdId]);
    expect((await owner.request<OutfitResult>(path + "/outfits?" + new URLSearchParams(input))).data.state).toBe("weather_unavailable");
  });
  test("撤销成员后照片、元数据、搭配和写入同时失效", async () => {
    await query("UPDATE memberships SET revoked_at=now() WHERE household_id=$1 AND user_id=$2", [householdId, memberId]);
    expect((await member.request(path)).status).toBe(404); expect((await rawRequest(member, path + "/" + item.id + "/photo")).status).toBe(404);
    expect((await member.request(path + "/outfits?" + new URLSearchParams(input))).status).toBe(404);
    expect((await member.request(path, "POST", { ...fields, photo }, randomUUID())).status).toBe(404);
    expect((await member.request(path + "/" + item.id, "PATCH", { ...editFields(item), expectedRevision: item.revision }, randomUUID())).status).toBe(404);
    const events = await query<{ count: number }>("SELECT count(*)::int AS count FROM household_events WHERE household_id=$1 AND resource_type='wardrobe'", [householdId]); expect(events[0].count).toBeGreaterThan(0);
  });
});
