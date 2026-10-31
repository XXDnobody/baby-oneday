import type { PoolClient } from "pg";
import type { z } from "zod";
import { b3Limits, type Automation, type WeatherView, automationInput } from "../shared/b3";
import type { ItemFields } from "../shared/contracts";
import { admin, expected, idempotent, localDate, publish, readChild, withHousehold, type Access } from "./households";
import { audit, contentVersion, eligibility, readPantry, readPreferences } from "./content";
import { readWeather } from "./weather";
import { ensure } from "./errors";
import { writePlanItem } from "./plan-write";
import type { Actor } from "./auth";
import { enqueueJob } from "./job-store";
import { dateAt, shiftDate, timeAt } from "./b3-time";
import { transaction } from "./db";

export async function readAutomation(db: PoolClient, householdId: string): Promise<Automation> {
  return (await db.query<Automation>('SELECT enabled,run_time AS "runTime",revision FROM household_automation WHERE household_id=$1', [householdId])).rows[0] ?? { enabled: false, runTime: b3Limits.defaultRunTime, revision: 1 };
}
export async function automation(raw: string | undefined, householdId: string, input?: z.infer<typeof automationInput>, key?: string) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    if (!input) return readAutomation(db, householdId); admin(access);
    return idempotent(db, actor, householdId + ":automation", key, input, async () => {
      const old = await readAutomation(db, householdId); expected(old.revision, input.expectedRevision);
      await db.query("INSERT INTO household_automation(household_id,enabled,run_time,configured_by,revision) VALUES ($1,$2,$3,$4,2) ON CONFLICT(household_id) DO UPDATE SET enabled=excluded.enabled,run_time=excluded.run_time,configured_by=excluded.configured_by,revision=household_automation.revision+1", [householdId, input.enabled, input.runTime, actor.id]);
      await audit(db, householdId, actor, "automation", householdId, "configure", old.revision + 1); return readAutomation(db, householdId);
    });
  }, !!input);
}
export async function requestAutomatic(raw: string | undefined, householdId: string, date: string, key?: string) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    admin(access); const today = localDate(access.timezone);
    ensure(date === today || date === shiftDate(today, 1), "INVALID_INPUT", "自动准备仅用于今天或次日；多日安排请通过 AI 预览。", 422);
    return idempotent(db, actor, householdId + ":automatic", key, { date }, () => enqueueJob(db, householdId, "automatic", householdId + ":automatic:" + date, { date, reason: "manual-request" }));
  }, true);
}
export async function scheduleAutomatic(now = new Date()) {
  // A morning restart catches the missed previous night for today, then enqueues tomorrow when due.
  return transaction(async (db) => {
    const families = (await db.query<{ id: string; timezone: string; runTime: string }>('SELECT h.id,h.timezone,a.run_time AS "runTime" FROM households h JOIN household_automation a ON a.household_id=h.id WHERE a.enabled AND h.setup_complete ORDER BY h.id')).rows;
    const jobs: string[] = [];
    for (const family of families) {
      const today = dateAt(now, family.timezone);
      const dates = timeAt(now, family.timezone) >= family.runTime ? [today, shiftDate(today, 1)] : [today];
      for (const date of dates) jobs.push((await enqueueJob(db, family.id, "automatic", family.id + ":automatic:" + date, { date, reason: "scheduled" })).id);
    }
    return jobs;
  });
}
interface Slot { label: string; time: string; kind?: ItemFields["kind"]; scene?: ItemFields["scene"] }
export function slotKind(slot: Slot): ItemFields["kind"] { return slot.kind ?? (/餐|饭|辅食/.test(slot.label) ? "meal" : /玩|活动|散步|绘本/.test(slot.label) ? "activity" : "routine"); }
function hourEnd(time: string) { const hour = Number(time.slice(0, 2)); return hour === 23 ? "23:59" : String(hour + 1).padStart(2, "0") + time.slice(2); }
export async function generateAutomatic(db: PoolClient, actor: Actor, access: Access, payload: { date: string; reason: string }) {
  const h = access.id; const setting = await readAutomation(db, h);
  ensure(setting.enabled || ["initial", "manual-request"].includes(payload.reason), "AUTOMATION_DISABLED", "自动生成已关闭，保留既有安排。", 409);
  const today = localDate(access.timezone); ensure(payload.date >= today, "AUTOMATION_EXPIRED", "任务日期已过去，不回填历史安排。", 409);
  const child = await readChild(db, h); ensure(child && access.setupComplete, "SETUP_REQUIRED", "宝宝资料尚未完成。", 409);
  const weekend = [0, 6].includes(new Date(payload.date + "T12:00:00Z").getUTCDay()); const kind = weekend ? "weekend" : "weekday";
  const template = (await db.query<{ slots: Slot[]; revision: number }>("SELECT slots,revision FROM household_templates WHERE household_id=$1 AND kind=$2", [h, kind])).rows[0];
  await db.query("INSERT INTO daily_plans(household_id,child_id,plan_date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [h, child.id, payload.date]);
  const candidates = (await db.query<{ id: string; version: number }>("SELECT id,enabled_version AS version FROM content_items WHERE household_id=$1 AND enabled_version IS NOT NULL ORDER BY id", [h])).rows;
  const results: Array<{ time: string; status: string; reason: string; itemId?: string }> = [];
  for (const slot of template?.slots ?? []) {
    const guarded = await db.query("SELECT time FROM plan_slot_guards WHERE household_id=$1 AND child_id=$2 AND plan_date=$3 AND time=$4 UNION ALL SELECT i.time FROM plan_items i JOIN daily_plans p ON p.id=i.plan_id WHERE i.household_id=$1 AND p.plan_date=$3 AND i.time=$4", [h, child.id, payload.date, slot.time]);
    if (guarded.rowCount) { results.push({ time: slot.time, status: "protected", reason: "已有安排、人工留空、取消或删除标记；此时段不补入。" }); continue; }
    const type = slotKind(slot); let reason = "沿用" + (weekend ? "周末" : "工作日") + "作息模板版本 " + template.revision; let weather: WeatherView | null = null;
    if (type === "activity") weather = await readWeather(db, h, { date: payload.date, startTime: slot.time, endTime: hourEnd(slot.time), scene: slot.scene ?? "either" }, access.timezone);
    const wet = weather?.hours.some((p) => p.windSpeed >= 5 || p.precipitation > 0 || (p.probability ?? 0) >= 0.5);
    const eligible = [];
    if (type !== "routine") for (const entry of candidates) {
      const v = await contentVersion(db, h, entry.id, entry.version);
      if (v.kind !== (type === "meal" ? "recipe" : "activity")) continue;
      const candidate = await eligibility(db, h, v, payload.date, slot.scene ?? "either");
      if (candidate.eligible && !(v.scene === "outdoor" && (weather?.state !== "available" || wet))) eligible.push(candidate);
    }
    eligible.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)); const chosen = eligible[0];
    const pending = type !== "routine" && !chosen;
    if (chosen) reason += "；采用已启用且适用的版本，按现有食材及有效偏好排序（分数 " + chosen.score + "）";
    if (pending) reason += type === "meal" && child.foodStatus === "unknown" ? "；食物过敏与忌口未知，饮食待安排。" : "；没有符合条件的已启用内容，保留待安排。";
    if (weather) reason += "；活动时段天气：" + weather.reason + (wet ? " 预报有风或降水，户外内容等待家人确认。" : "") + (weather.hourly ? " 天气依据 " + weather.hourly.id : "");
    const fields: ItemFields = { kind: type, title: chosen?.title ?? (type === "routine" ? slot.label : type === "meal" ? "饮食待安排" : "活动待安排"), time: slot.time, notes: reason, caregiverId: null, contentId: chosen?.id ?? null, contentVersion: chosen?.version ?? null, scene: slot.scene ?? chosen?.scene ?? "either" };
    const saved = await writePlanItem(db, actor, h, payload.date, fields, "automatic");
    results.push({ time: slot.time, status: pending ? "pending" : "filled", reason, itemId: saved.id });
  }
  const plan = (await db.query<{ id: string; revision: number }>("SELECT id,revision FROM daily_plans WHERE household_id=$1 AND child_id=$2 AND plan_date=$3", [h, child.id, payload.date])).rows[0];
  await publish(db, h, "day-plan", plan.id, plan.revision);
  return { date: payload.date, template: { kind, revision: template?.revision ?? 1 }, childRevision: child.revision, pantryRevision: (await readPantry(db, h)).revision, preferences: (await readPreferences(db, h, payload.date)).filter((p) => p.active).map((p) => ({ id: p.id, revision: p.revision })), slots: results, reason: !template?.slots.length ? "尚未配置此类作息时段，保持待安排。" : "只补允许补缺的位置；既有安排保持原样。" };
}
