import type { PoolClient } from "pg";
import type { ContentVersion, Preference } from "../shared/b2";
import type { PlanItem } from "../shared/contracts";
import { canonical, itemSelect, localDate, readChild, type Access } from "./households";
import { contentFieldsOnly, contentVersion, eligibility, readPantry } from "./content";
import { digest } from "./crypto";
import { dateAt, daysBetween } from "./b3-time";
import { readLocation } from "./weather";
import { ensure } from "./errors";

export interface Discussion { id: string; from: string; to: string; revision: number }
export const aiPolicyVersion = "2026-10-31-generated-suggestions-v1";
export type DatedItem = PlanItem & { date: string; planId: string };
export async function readDiscussion(db: PoolClient, householdId: string, ownerId: string, id: string): Promise<Discussion> {
  const row = (await db.query<Discussion>('SELECT id,from_date::text AS "from",to_date::text AS "to",revision FROM ai_conversations WHERE household_id=$1 AND owner_id=$2 AND id=$3', [householdId, ownerId, id])).rows[0];
  ensure(row, "NOT_FOUND", "讨论不存在。", 404); return row;
}
export async function readDatedItems(db: PoolClient, householdId: string, from: string, to: string) {
  return (await db.query<DatedItem>(itemSelect.replace("SELECT i.id,", 'SELECT p.plan_date::text AS date,i.plan_id AS "planId",i.id,') + "JOIN daily_plans p ON p.id=i.plan_id WHERE i.household_id=$1 AND p.plan_date BETWEEN $2 AND $3 AND i.deleted_at IS NULL ORDER BY p.plan_date,i.time,i.id", [householdId, from, to])).rows;
}
export async function contextBundle(db: PoolClient, access: Access, discussion: Discussion) {
  const householdId = access.id, child = await readChild(db, householdId); ensure(child && access.setupComplete, "SETUP_REQUIRED", "请先完成宝宝资料。", 409);
  const family = (await db.query("SELECT name,city,revision FROM households WHERE id=$1", [householdId])).rows[0];
  const pantry = await readPantry(db, householdId);
  const preferences = (await db.query<Preference>('SELECT id,kind,scope,text,starts_on::text AS "startsOn",ends_on::text AS "endsOn",ended,revision FROM recent_preferences WHERE household_id=$1 AND NOT ended AND starts_on<=$3 AND ends_on>=$2 ORDER BY id LIMIT 201', [householdId, discussion.from, discussion.to])).rows;
  const templates = (await db.query("SELECT kind,slots,revision FROM household_templates WHERE household_id=$1 ORDER BY kind", [householdId])).rows;
  const plans = (await db.query('SELECT id,plan_date::text AS date,revision FROM daily_plans WHERE household_id=$1 AND plan_date BETWEEN $2 AND $3 ORDER BY plan_date,id', [householdId, discussion.from, discussion.to])).rows;
  const items = await readDatedItems(db, householdId, discussion.from, discussion.to);
  const contentMeta = (await db.query<{ id: string; revision: number; version: number | null }>('SELECT id,revision,enabled_version AS version FROM content_items WHERE household_id=$1 ORDER BY id LIMIT 201', [householdId])).rows;
  ensure(preferences.length <= 200 && contentMeta.length <= 200 && items.length <= 400, "AI_CONTEXT_TOO_LARGE", "资料较多，请缩小讨论范围后重试。", 422);
  const contents: Array<{ content: ContentVersion; eligibleOn: string[] }> = [];
  for (const entry of contentMeta.filter((v) => v.version !== null)) {
    const content = await contentVersion(db, householdId, entry.id, entry.version!); const eligibleOn: string[] = [];
    for (const date of daysBetween(discussion.from, discussion.to)) if ((await eligibility(db, householdId, content, date)).eligible) eligibleOn.push(date);
    if (eligibleOn.length) contents.push({ content: { ...contentFieldsOnly(content), id: content.id, version: content.version, revision: content.revision, enabled: true, createdAt: content.createdAt } as ContentVersion, eligibleOn });
  }
  const readableItems = items.map((item) => {
    const available = !item.contentId || contents.some((v) => v.content.id === item.contentId && v.content.version === item.contentVersion && v.eligibleOn.includes(item.date));
    if (!available || item.status === "cancelled") return { id: item.id, date: item.date, time: item.time, kind: item.kind, status: item.status, title: item.status === "cancelled" ? "已取消的安排" : "原内容已不适用，需家人重新核对", revision: item.revision };
    // Never include historical content snapshots, deleted-record snapshots or another person's chat.
    const { contentSnapshot: _snapshot, ...readable } = item; void _snapshot; return readable;
  });
  const today = localDate(access.timezone);
  const ageReference = child.birthDate ?? child.ageAsOf;
  const [ageYear, ageMonth, ageDay] = ageReference.split("-").map(Number);
  const ageMonthsByDate = Object.fromEntries(daysBetween(discussion.from, discussion.to).map((date) => {
    const [year, month, day] = date.split("-").map(Number);
    const base = child.birthDate ? 0 : child.ageMonths;
    const months = base === null ? null : base + (year - ageYear) * 12 + month - ageMonth - (day < ageDay ? 1 : 0);
    return [date, months !== null && months >= 0 ? months : null];
  }));
  const records = (await db.query('SELECT id,occurred_on::text AS date,text,participation,interest,revision FROM activity_records WHERE household_id=$1 AND deleted_at IS NULL AND occurred_on BETWEEN $2 AND $3 AND occurred_on<=$4 ORDER BY occurred_on,id LIMIT 101', [householdId, discussion.from, discussion.to, today])).rows;
  ensure(records.length <= 100, "AI_CONTEXT_TOO_LARGE", "本次记录较多，请缩小讨论范围。", 422);
  const location = await readLocation(db, householdId);
  const weather = location ? (await db.query<{ id: string; product: string; usable: boolean; data: Array<{ at: string }>; [key: string]: unknown }>('SELECT DISTINCT ON (product) id,product,state,source_url AS source,attributions,fetched_at::text AS "fetchedAt",(state=\'available\' AND stale_after>clock_timestamp() AND purge_after>clock_timestamp()) AS usable,CASE WHEN stale_after>clock_timestamp() AND purge_after>clock_timestamp() THEN data ELSE NULL END AS data FROM weather_snapshots WHERE household_id=$1 AND location_revision=$2 ORDER BY product,fetched_at DESC,id DESC', [householdId, location.revision])).rows : [];
  const weatherModel = weather.map((w) => ({ ...w, data: w.usable ? w.data?.filter((p) => { const date = dateAt(new Date(p.at), access.timezone); return date >= discussion.from && date <= discussion.to; }) ?? null : null }));
  const members = (await db.query("SELECT id,revision,role,user_id FROM memberships WHERE household_id=$1 AND revoked_at IS NULL ORDER BY id", [householdId])).rows;
  const dependencyDigest = digest(canonical({ aiPolicyVersion, family, role: access.role, child, pantry, preferences, templates, plans, items, contentMeta, records, location, weather: weather.map(({ data: _data, ...w }) => { void _data; return w; }), members, today }));
  // The model needs date-specific age and weather, not the exact birthday or
  // location coordinates. Those still participate in the local revision guard.
  return { dependencyDigest, model: { household: { name: family.name, city: family.city, timezone: access.timezone }, child: { name: child.name, ageMonthsByDate, foodStatus: child.foodStatus, foodRestrictions: child.foodRestrictions, foodRestrictionItems: child.foodRestrictionItems, revision: child.revision }, from: discussion.from, to: discussion.to, today, pantry, preferences, templates, plans, items: readableItems, contents, records, weather: weatherModel, caregivers: members.map((m) => ({ id: m.id })) } };
}
