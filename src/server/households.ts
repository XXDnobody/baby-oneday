import type { PoolClient } from "pg";
import type { z } from "zod";
import type { Child, Day, Household, Invite, Member, PlanItem, Role } from "../shared/contracts";
import type { householdInput, itemInput, setupInput, templateInput } from "../shared/contracts";
import { withUser, type Actor } from "./auth";
import { limits, readConfig } from "./config";
import { digest, token } from "./crypto";
import { query } from "./db";
import { ensure } from "./errors";
import { contentVersion, eligibility, readPantry, selection } from "./content";
import { shoppingNeeds } from "../shared/shopping";
import { formatFoodRestrictions } from "../shared/food-restrictions";
import { enqueueJob } from "./job-store";

export interface Access { id: string; role: Role; revision: number; setupComplete: boolean; timezone: string }
export function localDate(timezone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export async function withHousehold<T>(raw: string | undefined, householdId: string, fn: (db: PoolClient, actor: Actor, access: Access) => Promise<T>, exclusive = false) {
  return withUser(raw, async (db, actor) => {
    const rows = await db.query<Access>(
      'SELECT id,revision,setup_complete AS "setupComplete",timezone FROM households WHERE id=$1 ' + (exclusive ? "FOR UPDATE" : "FOR SHARE"), [householdId],
    );
    const member = await db.query<{ role: Role }>("SELECT role FROM memberships WHERE household_id=$1 AND user_id=$2 AND revoked_at IS NULL", [householdId, actor.id]);
    ensure(rows.rowCount && member.rowCount, "NOT_FOUND", "家庭不存在或已无访问权限。", 404);
    return fn(db, actor, { ...rows.rows[0], role: member.rows[0].role });
  });
}
export function admin(access: Access) { ensure(access.role === "admin", "FORBIDDEN", "这项设置需要家庭管理员修改。", 403); }
export function expected(actual: number, wanted: number) { ensure(actual === wanted, "REVISION_CONFLICT", "家人已更新此内容。你的输入仍保留，请核对最新版本后再保存。", 409); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
export async function idempotent<T>(db: PoolClient, actor: Actor, scope: string, key: string | undefined, input: unknown, fn: () => Promise<T>, replay?: (result: T) => Promise<void>): Promise<T> {
  ensure(key && /^[a-zA-Z0-9_-]{16,128}$/.test(key), "INVALID_INPUT", "此操作需要有效的 Idempotency-Key。");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [actor.id + ":" + scope + ":" + key]);
  const fingerprint = digest(canonical(input));
  const found = await db.query<{ fingerprint: string; result: T }>("SELECT fingerprint,result FROM idempotency_requests WHERE user_id=$1 AND scope=$2 AND key=$3", [actor.id, scope, key]);
  if (found.rowCount) {
    ensure(found.rows[0].fingerprint === fingerprint, "IDEMPOTENCY_MISMATCH", "同一请求凭证的内容已改变，请重新提交。", 409);
    await replay?.(found.rows[0].result);
    return found.rows[0].result;
  }
  const result = await fn();
  await db.query("INSERT INTO idempotency_requests(user_id,scope,key,fingerprint,result) VALUES ($1,$2,$3,$4,$5)", [actor.id, scope, key, fingerprint, JSON.stringify(result)]);
  return result;
}
export async function publish(db: PoolClient, householdId: string, type: string, objectId: string, revision: number) {
  await db.query("INSERT INTO household_events(household_id,resource_type,resource_id,revision) VALUES ($1,$2,$3,$4)", [householdId, type, objectId, revision]);
}
async function bumpHousehold(db: PoolClient, householdId: string) {
  const result = await db.query<{ revision: number }>("UPDATE households SET revision=revision+1 WHERE id=$1 RETURNING revision", [householdId]);
  await publish(db, householdId, "household", householdId, result.rows[0].revision);
}

export async function createHousehold(raw: string | undefined, input: z.infer<typeof householdInput>, key: string | undefined) {
  return withUser(raw, async (db, actor) => idempotent(db, actor, "create-household", key, input, async () => {
    // Serialize the single controlled household entitlement across different idempotency keys.
    const entitled = await db.query<{ id: string }>("UPDATE users SET can_create_household=false WHERE id=$1 AND can_create_household=true RETURNING id", [actor.id]);
    ensure(entitled.rowCount, "FORBIDDEN", "当前账号没有新建家庭资格，请使用家庭邀请。", 403);
    const result = await db.query<{ id: string }>("INSERT INTO households(name,city,timezone) VALUES ($1,$2,$3) RETURNING id", [input.name, input.city, input.timezone]);
    const householdId = result.rows[0].id;
    await db.query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,'admin')", [householdId, actor.id]);
    await db.query("INSERT INTO household_templates(household_id,kind) VALUES ($1,'weekday'),($1,'weekend')", [householdId]);
    await publish(db, householdId, "household", householdId, 1);
    return { id: householdId };
  }), true);
}

async function readMembers(db: PoolClient, householdId: string) {
  return (await db.query<Member>('SELECT m.id,m.user_id AS "userId",u.display_name AS "displayName",m.role,m.revision FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.household_id=$1 AND m.revoked_at IS NULL ORDER BY m.created_at,m.id', [householdId])).rows;
}
export async function readChild(db: PoolClient, householdId: string) {
  const child = (await db.query<Child>('SELECT id,name,birth_date::text AS "birthDate",age_months AS "ageMonths",age_as_of::text AS "ageAsOf",food_status AS "foodStatus",food_restrictions AS "foodRestrictions",food_restriction_items AS "foodRestrictionItems",revision FROM children WHERE household_id=$1', [householdId])).rows[0] ?? null;
  if (child?.foodStatus === "restricted" && !child.foodRestrictionItems.length && child.foodRestrictions) {
    child.foodRestrictionItems = [{ kind: "unspecified", food: child.foodRestrictions, note: "" }];
  }
  return child;
}
export async function getHousehold(raw: string | undefined, householdId: string): Promise<Household> {
  return withHousehold(raw, householdId, async (db, _actor, access) => {
    const rows = await db.query<{ name: string; city: string }>("SELECT name,city FROM households WHERE id=$1", [householdId]);
    return { ...access, ...rows.rows[0], child: await readChild(db, householdId), members: await readMembers(db, householdId) };
  });
}
function validateChild(input: z.infer<typeof setupInput>["child"], timezone: string) {
  ensure(input.birthDate || input.ageMonths !== null, "INVALID_INPUT", "请填写宝宝生日或当前月龄。");
  ensure(!input.birthDate || input.birthDate <= localDate(timezone), "INVALID_INPUT", "宝宝生日不能晚于今天。");
  ensure(input.foodStatus !== "restricted" || (input.foodRestrictionItems === undefined ? input.foodRestrictions.length > 0 : input.foodRestrictionItems.length > 0), "INVALID_INPUT", "请至少添加一项食物过敏或忌口。", 422);
}
export async function saveSetup(raw: string | undefined, householdId: string, input: z.infer<typeof setupInput>, editing = false) {
  return withHousehold(raw, householdId, async (db, _actor, access) => {
    admin(access);
    expected(access.revision, input.expectedRevision);
    ensure(editing || !access.setupComplete, "SETUP_COMPLETE", "初始化已完成，请从宝宝资料修改。", 409);
    validateChild(input.child, access.timezone);
    const c = input.child;
    const items = c.foodStatus === "restricted" ? c.foodRestrictionItems ?? [] : [];
    const restrictions = c.foodStatus !== "restricted" ? "" : c.foodRestrictionItems === undefined ? c.foodRestrictions : formatFoodRestrictions(items);
    await db.query("INSERT INTO children(household_id,name,birth_date,age_months,age_as_of,food_status,food_restrictions,food_restriction_items) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(household_id) DO UPDATE SET name=excluded.name,birth_date=excluded.birth_date,age_months=excluded.age_months,age_as_of=excluded.age_as_of,food_status=excluded.food_status,food_restrictions=excluded.food_restrictions,food_restriction_items=excluded.food_restriction_items,revision=children.revision+1",
      [householdId, c.name, c.birthDate, c.birthDate ? null : c.ageMonths, localDate(access.timezone), c.foodStatus, restrictions, JSON.stringify(items)]);
    await db.query("UPDATE households SET setup_complete=true WHERE id=$1", [householdId]);
    await bumpHousehold(db, householdId);
    if (!editing) await enqueueJob(db, householdId, "automatic", householdId + ":automatic:" + localDate(access.timezone), { date: localDate(access.timezone), reason: "initial" });
    return { saved: true, revision: access.revision + 1 };
  }, true);
}

export async function invitePreview(rawToken: string) {
  const rows = await query<{ name: string; role: Role; expiresAt: string }>(
    'SELECT h.name,i.role,i.expires_at::text AS "expiresAt" FROM invites i JOIN households h ON h.id=i.household_id WHERE i.token_hash=$1 AND i.revoked_at IS NULL AND i.accepted_by IS NULL AND i.expires_at>now()', [digest(rawToken)],
  );
  ensure(rows.length, "INVALID_INVITE", "邀请已使用、撤销或过期，请联系家庭管理员。");
  return rows[0];
}
export async function createInvite(raw: string | undefined, householdId: string, role: Role, key: string | undefined) {
  // The raw invitation is intentionally returned once, never stored in the idempotency result.
  return withHousehold(raw, householdId, async (db, actor, access) => {
    admin(access);
    ensure(key, "INVALID_INPUT", "缺少请求凭证。");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [actor.id + ":invite:" + key]);
    const prior = await db.query<{ result: { id: string } }>("SELECT result FROM idempotency_requests WHERE user_id=$1 AND scope=$2 AND key=$3", [actor.id, householdId + ":invite", key]);
    ensure(!prior.rowCount, "INVITE_ALREADY_CREATED", "邀请已创建。链接只展示一次；如未收到，请撤销后重新创建。", 409);
    const rawToken = token();
    const expiresAt = new Date(Date.now() + limits.inviteDays * 86400000);
    const result = await db.query<{ id: string }>("INSERT INTO invites(household_id,token_hash,role,created_by,expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING id", [householdId, digest(rawToken), role, actor.id, expiresAt]);
    await db.query("INSERT INTO idempotency_requests(user_id,scope,key,fingerprint,result) VALUES ($1,$2,$3,$4,$5)", [actor.id, householdId + ":invite", key, digest(role), JSON.stringify({ id: result.rows[0].id })]);
    await publish(db, householdId, "invite", result.rows[0].id, 1);
    await bumpHousehold(db, householdId);
    return { id: result.rows[0].id, url: readConfig().origin + "/join?token=" + rawToken, expiresAt: expiresAt.toISOString() };
  }, true);
}
export async function listInvites(raw: string | undefined, householdId: string) {
  return withHousehold(raw, householdId, async (db, _actor, access) => {
    admin(access);
    return (await db.query<Invite>(
      'SELECT id,role,expires_at::text AS "expiresAt",CASE WHEN accepted_by IS NOT NULL THEN \'accepted\' WHEN revoked_at IS NOT NULL THEN \'revoked\' WHEN expires_at<=now() THEN \'expired\' ELSE \'active\' END AS status FROM invites WHERE household_id=$1 ORDER BY created_at DESC LIMIT 100', [householdId],
    )).rows;
  });
}
export async function revokeInvite(raw: string | undefined, householdId: string, inviteId: string) {
  return withHousehold(raw, householdId, async (db, _actor, access) => {
    admin(access);
    const result = await db.query("UPDATE invites SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND household_id=$2 AND accepted_by IS NULL RETURNING id", [inviteId, householdId]);
    ensure(result.rowCount, "NOT_FOUND", "邀请不存在或已经接受。", 404);
    await publish(db, householdId, "invite", inviteId, 2);
    await bumpHousehold(db, householdId);
    return { revoked: true };
  }, true);
}
export async function acceptInvite(raw: string | undefined, rawToken: string) {
  return withUser(raw, async (db, actor) => {
    const candidate = await db.query<{ household_id: string }>("SELECT household_id FROM invites WHERE token_hash=$1", [digest(rawToken)]);
    ensure(candidate.rowCount, "INVALID_INVITE", "邀请已失效。");
    const householdId = candidate.rows[0].household_id;
    await db.query("SELECT id FROM households WHERE id=$1 FOR UPDATE", [householdId]);
    const result = await db.query<{ id: string; role: Role; accepted_by: string | null; valid: boolean }>("SELECT id,role,accepted_by,(revoked_at IS NULL AND expires_at>now()) AS valid FROM invites WHERE token_hash=$1 FOR UPDATE", [digest(rawToken)]);
    const invite = result.rows[0];
    if (invite.accepted_by === actor.id) {
      const active = await db.query("SELECT id FROM memberships WHERE household_id=$1 AND user_id=$2 AND revoked_at IS NULL", [householdId, actor.id]);
      ensure(active.rowCount, "INVALID_INVITE", "此邀请已使用，成员关系已撤销，请申请新邀请。");
      return { householdId };
    }
    ensure(invite.valid && !invite.accepted_by, "INVALID_INVITE", "邀请已使用、撤销或过期。");
    // An invite may rejoin a revoked member, but cannot silently promote an existing member.
    await db.query("INSERT INTO memberships(household_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT(household_id,user_id) DO UPDATE SET revoked_at=NULL,role=CASE WHEN memberships.revoked_at IS NOT NULL THEN excluded.role ELSE memberships.role END,revision=memberships.revision+1", [householdId, actor.id, invite.role]);
    await db.query("UPDATE invites SET accepted_by=$2,accepted_at=now() WHERE id=$1", [invite.id, actor.id]);
    await bumpHousehold(db, householdId);
    return { householdId };
  });
}
export async function changeMember(raw: string | undefined, householdId: string, memberId: string, expectedRevision: number, role: Role | null) {
  return withHousehold(raw, householdId, async (db, _actor, access) => {
    admin(access);
    const rows = await db.query<Member>("SELECT id,role,revision FROM memberships WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL", [memberId, householdId]);
    ensure(rows.rowCount, "NOT_FOUND", "成员不存在。", 404);
    const member = rows.rows[0];
    expected(member.revision, expectedRevision);
    if (member.role === "admin" && role !== "admin") {
      const count = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM memberships WHERE household_id=$1 AND role='admin' AND revoked_at IS NULL", [householdId]);
      ensure(Number(count.rows[0].count) > 1, "LAST_ADMIN", "家庭至少需要一位管理员。", 409);
    }
    if (role) await db.query("UPDATE memberships SET role=$2,revision=revision+1 WHERE id=$1", [memberId, role]);
    else await db.query("UPDATE memberships SET revoked_at=now(),revision=revision+1 WHERE id=$1", [memberId]);
    await bumpHousehold(db, householdId);
    return { saved: true };
  }, true);
}

export const itemSelect = 'SELECT i.id,i.source,i.protected,i.kind,i.title,i.time,i.notes,i.scene,i.status,i.content_id AS "contentId",i.content_version AS "contentVersion",i.content_snapshot AS "contentSnapshot",i.ai_suggestion AS "aiSuggestion",i.caregiver_id AS "caregiverId",i.caregiver_name AS "caregiverName",i.revision,u.display_name AS "updatedBy",i.updated_at::text AS "updatedAt" FROM plan_items i JOIN users u ON u.id=i.updated_by ';
export async function getDay(raw: string | undefined, householdId: string, date: string): Promise<Day> {
  return withHousehold(raw, householdId, async (db, _actor, access) => {
    const rows = await db.query<{ id: string; date: string; revision: number }>('SELECT id,plan_date::text AS date,revision FROM daily_plans WHERE household_id=$1 AND plan_date=$2 FOR SHARE', [householdId, date]);
    const plan = rows.rows[0];
    if (!plan) return { date, plan: null, householdRevision: access.revision };
    const items = await db.query<PlanItem>(itemSelect + "WHERE i.household_id=$1 AND i.plan_id=$2 AND i.deleted_at IS NULL ORDER BY i.time,i.id", [householdId, plan.id]);
    if (date >= localDate(access.timezone)) for (const item of items.rows) {
      if (item.contentId && item.contentVersion) item.needsReview = !(await eligibility(db, householdId, await contentVersion(db, householdId, item.contentId, item.contentVersion), date, item.scene)).eligible;
    }
    return { date, plan: { ...plan, items: items.rows }, householdRevision: access.revision, shopping: shoppingNeeds(items.rows, await readPantry(db, householdId)) };
  });
}
export async function createPlan(raw: string | undefined, householdId: string, date: string, key: string | undefined) {
  return withHousehold(raw, householdId, async (db, actor, access) => idempotent(db, actor, householdId + ":plan", key, { date }, async () => {
    ensure(access.setupComplete, "SETUP_REQUIRED", "请先完成宝宝基本资料。", 409);
    const child = await readChild(db, householdId);
    ensure(child, "SETUP_REQUIRED", "请先完成宝宝基本资料。", 409);
    await db.query("INSERT INTO daily_plans(household_id,child_id,plan_date) VALUES ($1,$2,$3) ON CONFLICT(household_id,child_id,plan_date) DO NOTHING", [householdId, child.id, date]);
    const result = await db.query<{ id: string; revision: number }>("SELECT id,revision FROM daily_plans WHERE household_id=$1 AND child_id=$2 AND plan_date=$3", [householdId, child.id, date]);
    return result.rows[0];
  }));
}
export async function caregiver(db: PoolClient, householdId: string, id: string | null) {
  if (!id) return null;
  const found = await db.query<{ name: string }>("SELECT u.display_name AS name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$1 AND m.household_id=$2 AND m.revoked_at IS NULL", [id, householdId]);
  ensure(found.rowCount, "INVALID_INPUT", "照护者必须是当前家庭成员。");
  return found.rows[0].name;
}
export async function version(db: PoolClient, householdId: string, itemId: string, actorId: string) {
  const item = (await db.query<PlanItem>(itemSelect + "WHERE i.household_id=$1 AND i.id=$2", [householdId, itemId])).rows[0];
  await db.query("INSERT INTO plan_item_versions(household_id,child_id,plan_item_id,revision,snapshot,changed_by) SELECT household_id,child_id,id,revision,$2,$3 FROM plan_items WHERE id=$1", [itemId, JSON.stringify(item), actorId]);
  await publish(db, householdId, "plan-item", itemId, item.revision);
  return item;
}
export async function addItem(raw: string | undefined, householdId: string, planId: string, input: z.infer<typeof itemInput>, key: string | undefined) {
  return withHousehold(raw, householdId, async (db, actor) => idempotent(db, actor, householdId + ":add:" + planId, key, input, async () => {
    const found = await db.query<{ revision: number; child_id: string; date: string }>('SELECT revision,child_id,plan_date::text AS date FROM daily_plans WHERE id=$1 AND household_id=$2 FOR UPDATE', [planId, householdId]);
    ensure(found.rowCount, "NOT_FOUND", "日计划不存在。", 404);
    expected(found.rows[0].revision, input.expectedRevision);
    const caregiverName = await caregiver(db, householdId, input.caregiverId);
    const content = await selection(db, householdId, input.contentId, input.contentVersion, input.kind, found.rows[0].date, input.scene);
    const result = await db.query<{ id: string }>("INSERT INTO plan_items(household_id,child_id,plan_id,kind,title,time,notes,caregiver_id,caregiver_name,updated_by,content_id,content_version,content_snapshot,scene) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id", [householdId, found.rows[0].child_id, planId, input.kind, input.title, input.time, input.notes, input.caregiverId, caregiverName, actor.id, input.contentId, input.contentVersion, content ? JSON.stringify(content) : null, input.scene]);
    await db.query("UPDATE daily_plans SET revision=revision+1,updated_at=now() WHERE id=$1", [planId]);
    return version(db, householdId, result.rows[0].id, actor.id);
  }, async (item) => { await activeItem(db, householdId, item.id); }));
}
export async function editItem(raw: string | undefined, householdId: string, itemId: string, input: z.infer<typeof itemInput>, key: string | undefined) {
  return withHousehold(raw, householdId, async (db, actor) => idempotent(db, actor, householdId + ":edit:" + itemId, key, input, async () => {
    const candidate = await db.query<{ plan_id: string; date: string }>('SELECT i.plan_id,p.plan_date::text AS date FROM plan_items i JOIN daily_plans p ON p.id=i.plan_id WHERE i.id=$1 AND i.household_id=$2 AND i.deleted_at IS NULL', [itemId, householdId]);
    ensure(candidate.rowCount, "NOT_FOUND", "安排不存在。", 404);
    await db.query("SELECT id FROM daily_plans WHERE id=$1 FOR UPDATE", [candidate.rows[0].plan_id]);
    const found = await db.query<{ revision: number }>("SELECT revision FROM plan_items WHERE id=$1 FOR UPDATE", [itemId]);
    expected(found.rows[0].revision, input.expectedRevision);
    const caregiverName = await caregiver(db, householdId, input.caregiverId);
    const content = await selection(db, householdId, input.contentId, input.contentVersion, input.kind, candidate.rows[0].date, input.scene);
    await db.query("UPDATE plan_items SET ai_suggestion=CASE WHEN kind=$2 AND title=$3 AND content_id IS NOT DISTINCT FROM $9::uuid AND content_version IS NOT DISTINCT FROM $10::integer THEN ai_suggestion ELSE NULL END,kind=$2,title=$3,time=$4,notes=$5,caregiver_id=$6,caregiver_name=$7,revision=revision+1,updated_by=$8,updated_at=now(),content_id=$9,content_version=$10,content_snapshot=$11,scene=$12,source='manual',protected=true WHERE id=$1", [itemId, input.kind, input.title, input.time, input.notes, input.caregiverId, caregiverName, actor.id, input.contentId, input.contentVersion, content ? JSON.stringify(content) : null, input.scene]);
    await db.query("UPDATE daily_plans SET revision=revision+1,updated_at=now() WHERE id=$1", [candidate.rows[0].plan_id]);
    return version(db, householdId, itemId, actor.id);
  }, async () => { await activeItem(db, householdId, itemId); }));
}
export async function activeItem(db: PoolClient, householdId: string, itemId: string) {
  const found = await db.query("SELECT id FROM plan_items WHERE household_id=$1 AND id=$2 AND deleted_at IS NULL", [householdId, itemId]);
  ensure(found.rowCount, "NOT_FOUND", "安排不存在或已删除。", 404);
}
export async function itemVersions(raw: string | undefined, householdId: string, itemId: string) {
  return withHousehold(raw, householdId, async (db) => {
    await activeItem(db, householdId, itemId);
    const result = await db.query<{ revision: number; snapshot: PlanItem }>("SELECT revision,snapshot FROM plan_item_versions WHERE household_id=$1 AND plan_item_id=$2 ORDER BY revision DESC LIMIT 100", [householdId, itemId]);
    ensure(result.rowCount, "NOT_FOUND", "安排不存在。", 404);
    return result.rows;
  });
}
export async function templates(raw: string | undefined, householdId: string, kind?: string, input?: z.infer<typeof templateInput>) {
  return withHousehold(raw, householdId, async (db) => {
    if (kind && input) {
      const found = await db.query("UPDATE household_templates SET slots=$3,revision=revision+1 WHERE household_id=$1 AND kind=$2 AND revision=$4 RETURNING kind,slots,revision", [householdId, kind, JSON.stringify(input.slots), input.expectedRevision]);
      ensure(found.rowCount, "REVISION_CONFLICT", "作息已更新，请重新核对。", 409);
      await publish(db, householdId, "template", householdId, input.expectedRevision + 1);
      return found.rows;
    }
    return (await db.query("SELECT kind,slots,revision FROM household_templates WHERE household_id=$1 ORDER BY kind", [householdId])).rows;
  });
}
export async function events(raw: string | undefined, householdId: string, after: string) {
  return withHousehold(raw, householdId, async (db) => {
    const result = await db.query<{ id: string; resourceType: string; resourceId: string; revision: number; updatedAt: string }>(
      'SELECT id::text,resource_type AS "resourceType",resource_id AS "resourceId",revision,created_at::text AS "updatedAt" FROM household_events WHERE household_id=$1 AND id>$2 ORDER BY id LIMIT 101', [householdId, after],
    );
    const found = result.rows;
    return { events: found.slice(0, 100), cursor: found.at(-1)?.id ?? after, reset: found.length > 100 };
  });
}
