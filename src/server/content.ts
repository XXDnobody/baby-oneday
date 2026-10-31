import type { PoolClient } from "pg";
import type { z } from "zod";
import drafts from "../data/recipe-drafts.json";
import * as c from "../shared/b2";
import type { Actor } from "./auth";
import { admin, expected, idempotent, localDate, publish, readChild, withHousehold } from "./households";
import { ensure } from "./errors";

export async function audit(db: PoolClient, householdId: string, actor: Actor, type: string, objectId: string, action: string, revision: number) {
  await db.query("INSERT INTO business_audit(household_id,resource_type,resource_id,action,revision,actor_id) VALUES ($1,$2,$3,$4,$5,$6)", [householdId, type, objectId, action, revision, actor.id]);
  await publish(db, householdId, type, objectId, revision);
}
export async function readPantry(db: PoolClient, householdId: string): Promise<c.Pantry> {
  return (await db.query<c.Pantry>('SELECT revision,items,confirmed_at::text AS "confirmedAt" FROM pantry_snapshots WHERE household_id=$1', [householdId])).rows[0] ?? { revision: 1, items: [], confirmedAt: null };
}
export async function pantry(raw: string | undefined, householdId: string, input?: z.infer<typeof c.pantryInput>, key?: string) {
  return withHousehold(raw, householdId, async (db, actor) => {
    if (!input) return readPantry(db, householdId);
    return idempotent(db, actor, householdId + ":pantry", key, input, async () => {
      await db.query("INSERT INTO pantry_snapshots(household_id) VALUES ($1) ON CONFLICT DO NOTHING", [householdId]);
      const old = await readPantry(db, householdId); expected(old.revision, input.expectedRevision);
      const stamp = (await db.query<{ at: string }>("SELECT clock_timestamp()::text AS at")).rows[0].at;
      const items = input.items.map((i) => ({ ...i, quantity: i.status === "available" ? i.quantity : "unknown", priority: i.status === "available" && i.priority, confirmedAt: stamp }));
      await db.query("UPDATE pantry_snapshots SET items=$2,revision=revision+1,confirmed_at=$3,updated_by=$4 WHERE household_id=$1", [householdId, JSON.stringify(items), stamp, actor.id]);
      await audit(db, householdId, actor, "pantry", householdId, "confirm", old.revision + 1);
      return readPantry(db, householdId);
    });
  }, !!input);
}
export async function readPreferences(db: PoolClient, householdId: string, date: string): Promise<c.Preference[]> {
  return (await db.query<c.Preference>('SELECT id,kind,scope,text,starts_on::text AS "startsOn",ends_on::text AS "endsOn",ended,revision,(NOT ended AND starts_on<=$2 AND ends_on>=$2) AS active FROM recent_preferences WHERE household_id=$1 ORDER BY updated_at DESC,id LIMIT 200', [householdId, date])).rows;
}
export async function preferences(raw: string | undefined, householdId: string, date: string) {
  return withHousehold(raw, householdId, (db) => readPreferences(db, householdId, date));
}
export async function savePreference(raw: string | undefined, householdId: string, input: z.infer<typeof c.preferenceInput> | z.infer<typeof c.preferenceEdit> | z.infer<typeof c.expectedInput>, key: string | undefined, preferenceId?: string, ending = false) {
  return withHousehold(raw, householdId, (db, actor) => idempotent(db, actor, householdId + ":preference:" + (preferenceId ?? "new") + ":" + ending, key, input, async () => {
    if (preferenceId) {
      const found = await db.query<{ revision: number }>("SELECT revision FROM recent_preferences WHERE household_id=$1 AND id=$2", [householdId, preferenceId]);
      ensure(found.rowCount, "NOT_FOUND", "偏好不存在。", 404);
      expected(found.rows[0].revision, (input as z.infer<typeof c.preferenceEdit>).expectedRevision);
    }
    let result;
    if (ending) result = await db.query<{ id: string; revision: number }>("UPDATE recent_preferences SET ended=true,revision=revision+1,updated_by=$3,updated_at=now() WHERE household_id=$1 AND id=$2 RETURNING id,revision", [householdId, preferenceId, actor.id]);
    else {
      const v = input as z.infer<typeof c.preferenceInput>;
      ensure((Date.parse(v.endsOn) - Date.parse(v.startsOn)) / 86400000 <= 90, "INVALID_INPUT", "近期偏好每次最多持续 91 天，可以随时调整。");
      const values = [householdId, v.kind, v.scope, v.text, v.startsOn, v.endsOn, actor.id];
      result = preferenceId
        ? await db.query<{ id: string; revision: number }>("UPDATE recent_preferences SET kind=$2,scope=$3,text=$4,starts_on=$5,ends_on=$6,updated_by=$7,revision=revision+1,updated_at=now() WHERE household_id=$1 AND id=$8 RETURNING id,revision", [...values, preferenceId])
        : await db.query<{ id: string; revision: number }>("INSERT INTO recent_preferences(household_id,kind,scope,text,starts_on,ends_on,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,revision", values);
    }
    const saved = result.rows[0]; await audit(db, householdId, actor, "preference", saved.id, ending ? "end" : "save", saved.revision); return saved;
  }), true);
}
export function reviewProblems(v: c.ContentFields): string[] {
  const issues = [...v.reviewIssues];
  if (!v.familyConfirmed) issues.push("家庭实际用法尚未确认");
  if (!v.applicabilityConfirmed || v.minAgeMonths === null || !v.applicability) issues.push("适用条件尚未核对");
  if (v.source.verification !== "checked" || !v.source.title || !v.source.edition || !v.source.locator || !v.source.summary) issues.push("出处、版本或具体位置尚未核对");
  if (v.source.professionalReview === "reviewed" && !v.source.professionalNote) issues.push("专业审核依据未填写");
  if (v.kind === "recipe" && (!v.ingredientsConfirmed || !v.ingredients.length || !v.quantityBasis || !v.preparation)) issues.push("实际原料、用量依据或切配要求尚未核对");
  if (v.kind === "activity" && (!v.materials || !v.purpose || !v.observations || !v.variation)) issues.push("材料、目的、观察点或调整方式待补充");
  return issues;
}
export async function contentVersion(db: PoolClient, householdId: string, contentId: string, version?: number): Promise<c.ContentVersion> {
  const found = await db.query<{ id: string; revision: number; version: number; enabled: boolean; snapshot: c.ContentFields; createdAt: string }>('SELECT i.id,i.revision,v.version,(i.enabled_version=v.version) AS enabled,v.snapshot,v.created_at::text AS "createdAt" FROM content_items i JOIN content_versions v ON v.household_id=i.household_id AND v.content_id=i.id AND v.version=COALESCE($3,i.current_version) WHERE i.household_id=$1 AND i.id=$2', [householdId, contentId, version ?? null]);
  ensure(found.rowCount, "NOT_FOUND", "内容或版本不存在。", 404);
  const { snapshot, ...meta } = found.rows[0]; return { ...snapshot, ...meta, enabled: !!meta.enabled };
}
export async function eligibility(db: PoolClient, householdId: string, v: c.ContentVersion, date: string, scene = "either", preferenceOverride?: c.Preference[]): Promise<c.Candidate> {
  const reasons = reviewProblems(v);
  if (!v.enabled) reasons.push("此版本未启用");
  const child = await readChild(db, householdId);
  let age: number | null = null;
  if (child?.birthDate) {
    const [y, m, d] = date.split("-").map(Number); const [by, bm, bd] = child.birthDate.split("-").map(Number);
    age = (y - by) * 12 + m - bm - (d < bd ? 1 : 0);
  } else if (child?.ageMonths !== null && child?.ageMonths !== undefined) {
    const start = new Date(child.ageAsOf + "T00:00:00Z"); const end = new Date(date + "T00:00:00Z");
    age = child.ageMonths + (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() - (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
  }
  if (age === null || v.minAgeMonths === null || age < v.minAgeMonths || (v.maxAgeMonths !== null && age > v.maxAgeMonths)) reasons.push("当前月龄与适用范围不匹配或仍未知");
  if (scene !== "either" && v.scene !== "either" && v.scene !== scene) reasons.push("活动场景不匹配");
  if (v.kind === "recipe") {
    if (!child || child.foodStatus === "unknown") reasons.push("当前食物过敏与忌口未知，请管理员核对；暂不推荐餐食");
    else if (v.foodProfileRevision !== child.revision) reasons.push("尚未针对当前食物过敏与忌口版本核对");
  }
  let score = 0;
  const pantry = await readPantry(db, householdId);
  const preferences = (preferenceOverride ?? await readPreferences(db, householdId, date)).filter((p) => p.active && (p.scope === "all" || p.scope === (v.kind === "recipe" ? "meal" : "activity")));
  const text = [v.title, v.summary, ...v.ingredients.map((i) => i.name), v.materials].join(" ").toLowerCase();
  for (const p of preferences) {
    if (!text.includes(p.text.toLowerCase())) continue;
    if (p.kind === "avoid") reasons.push("近期暂避：" + p.text + "（至 " + p.endsOn + "，与禁忌分开）");
    if (p.kind === "like") score += 3;
  }
  for (const i of v.ingredients) {
    const match = pantry.items.find((p) => p.name.toLowerCase() === i.name.toLowerCase());
    if (match?.status === "available") score += match.priority ? 3 : 1;
  }
  return { ...v, eligible: reasons.length === 0, reasons, score };
}
export async function selection(db: PoolClient, householdId: string, contentId: string | null, version: number | null, kind: string, date: string, scene: string, preferenceOverride?: c.Preference[]) {
  ensure((contentId === null) === (version === null), "INVALID_INPUT", "内容标识和版本需同时填写。");
  if (!contentId || !version) return null;
  const v = await contentVersion(db, householdId, contentId, version);
  ensure((kind === "meal" && v.kind === "recipe") || (kind === "activity" && v.kind === "activity"), "CONTENT_NOT_ELIGIBLE", "安排类型与内容不一致。", 422);
  const candidate = await eligibility(db, householdId, v, date, scene, preferenceOverride);
  ensure(candidate.eligible, "CONTENT_NOT_ELIGIBLE", candidate.reasons.join("；"), 422);
  return { ...v, selectionEvidence: { date, pantry: await readPantry(db, householdId), preferences: (await readPreferences(db, householdId, date)).filter((p) => p.active), basis: "仅按已核对月龄、食物过敏与忌口版本、场景与近期偏好筛选；库存用于排序，不自动扣减，也不代表新鲜度。" } };
}
export async function listContent(raw: string | undefined, householdId: string, date: string, kind?: string, cursor?: string, scene = "either"): Promise<c.ContentLibrary> {
  return withHousehold(raw, householdId, async (db) => {
    const found = await db.query<{ id: string }>("SELECT id FROM content_items WHERE household_id=$1 AND ($2::text IS NULL OR kind=$2) AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT 51", [householdId, kind ?? null, cursor ?? null]);
    const items: c.Candidate[] = [];
    for (const { id } of found.rows.slice(0, 50)) items.push(await eligibility(db, householdId, await contentVersion(db, householdId, id), date, scene));
    return { items, nextCursor: found.rows.length > 50 ? found.rows[49].id : null };
  });
}
export async function getContent(raw: string | undefined, householdId: string, id: string, version?: number) {
  return withHousehold(raw, householdId, (db) => contentVersion(db, householdId, id, version));
}
async function insertContent(db: PoolClient, actor: Actor, householdId: string, v: c.ContentFields, importKey?: string) {
  const found = await db.query<{ id: string }>("INSERT INTO content_items(household_id,kind,import_key) VALUES ($1,$2,$3) RETURNING id", [householdId, v.kind, importKey ?? null]);
  const id = found.rows[0].id;
  await db.query("INSERT INTO content_versions(household_id,content_id,version,snapshot,created_by) VALUES ($1,$2,1,$3,$4)", [householdId, id, JSON.stringify(v), actor.id]);
  await audit(db, householdId, actor, "content", id, "create-draft", 1); return { id, revision: 1, version: 1 };
}
export async function saveContent(raw: string | undefined, householdId: string, v: c.ContentFields, key: string | undefined, id?: string, expectedRevision?: number) {
  return withHousehold(raw, householdId, (db, actor) => idempotent(db, actor, householdId + ":content:" + (id ?? "new"), key, { v, expectedRevision }, async () => {
    if (!id) return insertContent(db, actor, householdId, v);
    const old = await contentVersion(db, householdId, id); expected(old.revision, expectedRevision!);
    ensure(old.kind === v.kind, "INVALID_INPUT", "内容类型不能更改。");
    const next = old.version + 1;
    await db.query("INSERT INTO content_versions(household_id,content_id,version,snapshot,created_by) VALUES ($1,$2,$3,$4,$5)", [householdId, id, next, JSON.stringify(v), actor.id]);
    await db.query("UPDATE content_items SET current_version=$3,enabled_version=NULL,revision=revision+1 WHERE household_id=$1 AND id=$2", [householdId, id, next]);
    await db.query("INSERT INTO content_settings(household_id) VALUES ($1) ON CONFLICT DO NOTHING", [householdId]);
    await db.query("UPDATE content_settings SET revision=revision+1 WHERE household_id=$1", [householdId]);
    await audit(db, householdId, actor, "content", id, "new-version-unenabled", old.revision + 1);
    return { id, version: next, revision: old.revision + 1 };
  }), true);
}
export async function contentSettings(raw: string | undefined, householdId: string, input?: z.infer<typeof c.contentSettingsInput>, key?: string) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    if (input) {
      admin(access);
      await idempotent(db, actor, householdId + ":content-settings", key, input, async () => {
        await db.query("INSERT INTO content_settings(household_id) VALUES ($1) ON CONFLICT DO NOTHING", [householdId]);
        const current = await db.query<{ revision: number }>("SELECT revision FROM content_settings WHERE household_id=$1", [householdId]); expected(current.rows[0].revision, input.expectedRevision);
        ensure(new Set(input.enabled.map((v) => v.id)).size === input.enabled.length, "INVALID_INPUT", "启用列表不能重复。");
        for (const entry of input.enabled) {
          const v = await contentVersion(db, householdId, entry.id);
          expected(v.version, entry.version);
          const problems = reviewProblems(v); ensure(!problems.length, "CONTENT_NOT_ELIGIBLE", problems.join("；"), 422);
        }
        await db.query("UPDATE content_items SET enabled_version=NULL WHERE household_id=$1", [householdId]);
        for (const v of input.enabled) await db.query("UPDATE content_items SET enabled_version=$3 WHERE household_id=$1 AND id=$2", [householdId, v.id, v.version]);
        await db.query("UPDATE content_settings SET revision=revision+1 WHERE household_id=$1", [householdId]);
        await audit(db, householdId, actor, "content-settings", householdId, "set-enabled-scope", input.expectedRevision + 1);
        return { saved: true };
      });
    }
    const result = await db.query<{ revision: number }>("SELECT revision FROM content_settings WHERE household_id=$1", [householdId]);
    const enabled = await db.query<{ id: string; version: number }>("SELECT id,enabled_version AS version FROM content_items WHERE household_id=$1 AND enabled_version IS NOT NULL ORDER BY id", [householdId]);
    return { revision: result.rows[0]?.revision ?? 1, enabled: enabled.rows } satisfies c.ContentSettings;
  }, !!input);
}
function draftContent(importKey: string): c.ContentFields {
  const empty = { summary: "", ingredients: [], steps: ["待补充"], tips: [], materials: "", scene: "either", purpose: "", observations: "", variation: "", minAgeMonths: null, maxAgeMonths: null, applicability: "待家庭核对实际适用条件", preparation: "", quantityBasis: "", source: { title: "", author: "", url: "", edition: "", locator: "", summary: "", adaptation: "", verification: "pending", professionalReview: "not_performed", professionalNote: "" }, familyConfirmed: false, applicabilityConfirmed: false, ingredientsConfirmed: false, foodProfileRevision: null, reviewIssues: [] };
  if (importKey.startsWith("A")) {
    const reading = importKey === "A01";
    return { ...empty, kind: "activity", title: reading ? "一起翻一本绘本" : "跟着宝宝指向散步", summary: "本地整理的待核对活动草稿", materials: reading ? "家里已有的绘本" : "适合同行的场地，出门准备由家人确认", scene: reading ? "indoor" : "outdoor", purpose: "创造共同关注和来回交流的机会", observations: "观察宝宝愿意停留、指向或回应的时刻，不评价正确率", variation: "跟随宝宝兴趣；疲倦或不愿继续时结束", steps: reading ? ["由宝宝选择家里已有的一本绘本。", "跟着宝宝翻页与指向，用一句短话描述后等待回应。", "愿意时重复熟悉的页，兴趣转移时结束。"] : ["家人先确认当天场地、天气和出门条件。", "跟随宝宝停留和指向，简短命名，再等待回应。", "累了或兴趣转移时缩短或结束。"], source: { ...empty.source, title: "家庭互动活动整理草稿", edition: "2026-10-31", locator: reading ? "本地整理 A01" : "本地整理 A02", adaptation: "本产品整理的待核对玩法；没有完成外部资料或专业审核" }, reviewIssues: ["月龄、实际能力、场地及具体出处仍待家庭核对"], illustration: reading ? "/activities/reading.svg" : "/activities/walk.svg" } as c.ContentFields;
  }
  const d = drafts.drafts.find((v) => v.reviewId === importKey); ensure(d, "INVALID_INPUT", "导入条目不存在。");
  return { ...empty, kind: "recipe", title: d.title, summary: "旧家庭菜谱审阅草稿；原用量、步骤和提示完整保留", ingredients: [...d.linkedIngredients.map((i) => ({ name: ("formText" in i.original ? i.original.formText : "") || i.catalogName, amountText: i.original.amountText, formText: "formText" in i.original ? i.original.formText : "" })), ...d.freeformIngredients.map((i) => ({ name: i.original.rawName, amountText: i.original.amountText, formText: i.mappingReview.formText ?? "" }))], steps: d.originalSteps, tips: d.originalTips, quantityBasis: [d.legacyPreparedWeightText, d.legacyServingText].filter(Boolean).join("；"), source: { ...empty.source, title: "旧家庭菜谱整理", edition: drafts.reviewDate, locator: importKey + "｜首批资料复用清单", summary: d.sourceReview.linkPresent ? "旧字段记有来源，外部链接尚未重开核对" : "旧资料未记录外部来源", adaptation: "保留原文，候选原料映射未采纳为确认事实" }, reviewIssues: [...d.commonReviewIssues, ...d.specificReviewIssues], legacy: d } as c.ContentFields;
}
export async function importContent(raw: string | undefined, householdId: string, input: z.infer<typeof c.importInput>, key: string | undefined) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    admin(access);
    return idempotent(db, actor, householdId + ":content-import", key, input, async () => {
      const results: c.ImportResult[] = [];
      for (const importKey of [...new Set(input.ids)]) {
        const old = await db.query<{ id: string }>("SELECT id FROM content_items WHERE household_id=$1 AND import_key=$2", [householdId, importKey]);
        const prior = await db.query<{ attempts: number }>("SELECT attempts FROM content_import_results WHERE household_id=$1 AND import_key=$2", [householdId, importKey]);
        const attempts = (prior.rows[0]?.attempts ?? 0) + 1;
        if (old.rowCount) { results.push({ importKey, status: "existing", contentId: old.rows[0].id, attempts: prior.rows[0]?.attempts ?? 1 }); continue; }
        await db.query("SAVEPOINT import_row");
        try {
          const content = draftContent(importKey); c.contentFields.parse(contentFieldsOnly(content));
          const saved = await insertContent(db, actor, householdId, content, importKey);
          await db.query("INSERT INTO content_import_results(household_id,import_key,status,content_id,attempts) VALUES ($1,$2,'imported',$3,$4) ON CONFLICT(household_id,import_key) DO UPDATE SET status='imported',content_id=excluded.content_id,error=NULL,attempts=excluded.attempts,updated_at=now()", [householdId, importKey, saved.id, attempts]);
          results.push({ importKey, status: "imported", contentId: saved.id, attempts });
        } catch {
          await db.query("ROLLBACK TO SAVEPOINT import_row");
          const error = "此条导入失败，已保留其他成功项。可以单独重试；不会覆盖人工编辑。";
          await db.query("INSERT INTO content_import_results(household_id,import_key,status,error,attempts) VALUES ($1,$2,'failed',$3,$4) ON CONFLICT(household_id,import_key) DO UPDATE SET status='failed',error=excluded.error,attempts=excluded.attempts,updated_at=now()", [householdId, importKey, error, attempts]);
          results.push({ importKey, status: "failed", error, attempts });
        } finally { await db.query("RELEASE SAVEPOINT import_row"); }
      }
      return results;
    });
  }, true);
}
export function contentFieldsOnly(v: c.ContentFields) {
  // Do not accept import metadata, legacy flags, or view-only fields as editable input.
  return Object.fromEntries(Object.keys(c.contentFields.shape).map((key) => [key, v[key as keyof c.ContentFields]]));
}
export async function importResults(raw: string | undefined, householdId: string) {
  return withHousehold(raw, householdId, async (db, _actor, access) => {
    admin(access);
    return (await db.query<c.ImportResult>('SELECT import_key AS "importKey",status,content_id AS "contentId",error,attempts FROM content_import_results WHERE household_id=$1 ORDER BY import_key', [householdId])).rows;
  });
}
export const allRecipeIds = drafts.drafts.map((d) => d.reviewId);
export const contentToday = localDate;
