import type { PoolClient } from "pg";
import type { z } from "zod";
import type * as c from "../shared/b2";
import { audit } from "./content";
import { authorPermission, recordVersion } from "./records";
import { expected, idempotent, version, withHousehold } from "./households";
import { ensure } from "./errors";

type Kind = "plan-item" | "record";
interface DeletedRow { id: string; revision: number; authorId?: string; planId?: string; kind?: string; time?: string; deletedAt: string | null; restoreUntil: string | null; expired: boolean }
async function target(db: PoolClient, householdId: string, id: string, kind: Kind) {
  const result = await db.query<DeletedRow>(kind === "record"
    ? 'SELECT id,revision,author_id AS "authorId",deleted_at::text AS "deletedAt",restore_until::text AS "restoreUntil",(restore_until<=clock_timestamp()) AS expired FROM activity_records WHERE household_id=$1 AND id=$2 FOR UPDATE'
    : 'SELECT id,revision,plan_id AS "planId",kind,time,deleted_at::text AS "deletedAt",restore_until::text AS "restoreUntil",(restore_until<=clock_timestamp()) AS expired FROM plan_items WHERE household_id=$1 AND id=$2 FOR UPDATE', [householdId, id]);
  ensure(result.rowCount, "NOT_FOUND", "内容不存在。", 404); return result.rows[0];
}
function withinWindow(v: DeletedRow) { ensure(!v.expired, "RESTORE_WINDOW_EXPIRED", "30 天恢复期限已过，内容不可读取或恢复。", 410); }
export async function remove(raw: string | undefined, householdId: string, id: string, kind: Kind, input: z.infer<typeof c.expectedInput>, key: string | undefined) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    const old = await target(db, householdId, id, kind);
    if (kind === "record") authorPermission(actor, access, old.authorId!);
    withinWindow(old);
    return idempotent(db, actor, householdId + ":delete:" + kind + ":" + id, key, input, async () => {
      if (old.deletedAt) return { id, deleted: true, revision: old.revision, restoreUntil: old.restoreUntil! };
      expected(old.revision, input.expectedRevision);
      const table = kind === "record" ? "activity_records" : "plan_items";
      const result = await db.query<{ revision: number; restoreUntil: string }>(`WITH stamp AS (SELECT clock_timestamp() AS at) UPDATE ${table} SET deleted_at=stamp.at,restore_until=stamp.at+interval '30 days',deleted_by=$3,revision=revision+1,updated_by=$3,updated_at=stamp.at FROM stamp WHERE household_id=$1 AND id=$2 RETURNING revision,restore_until::text AS "restoreUntil"`, [householdId, id, actor.id]);
      if (kind === "plan-item") await db.query("UPDATE daily_plans SET revision=revision+1,updated_at=now() WHERE id=$1", [old.planId]);
      await audit(db, householdId, actor, kind, id, "delete", result.rows[0].revision);
      return { id, deleted: true, ...result.rows[0] };
    }, async () => { ensure(old.deletedAt, "REVISION_CONFLICT", "此内容已经恢复，请刷新后核对。", 409); });
  }, true);
}
export async function cancelItem(raw: string | undefined, householdId: string, id: string, input: z.infer<typeof c.expectedInput>, key: string | undefined, resume = false) {
  return withHousehold(raw, householdId, async (db, actor) => {
    const old = await target(db, householdId, id, "plan-item"); ensure(!old.deletedAt, "NOT_FOUND", "安排已删除。", 404);
    return idempotent(db, actor, householdId + ":" + (resume ? "resume:" : "cancel:") + id, key, input, async () => {
      expected(old.revision, input.expectedRevision);
      await db.query("UPDATE plan_items SET status=$3,revision=revision+1,updated_by=$4,updated_at=now() WHERE household_id=$1 AND id=$2", [householdId, id, resume ? "active" : "cancelled", actor.id]);
      await db.query("UPDATE daily_plans SET revision=revision+1,updated_at=now() WHERE id=$1", [old.planId]);
      const saved = await version(db, householdId, id, actor.id);
      await audit(db, householdId, actor, "plan-item", id, resume ? "resume" : "cancel", saved.revision);
      return saved;
    });
  }, true);
}
async function planPreview(db: PoolClient, old: DeletedRow, householdId: string) {
  const plan = await db.query<{ revision: number }>("SELECT revision FROM daily_plans WHERE household_id=$1 AND id=$2 FOR UPDATE", [householdId, old.planId]);
  const clashes = await db.query("SELECT id FROM plan_items WHERE household_id=$1 AND plan_id=$2 AND id<>$3 AND deleted_at IS NULL AND status='active' AND kind=$4 AND time=$5", [householdId, old.planId, old.id, old.kind, old.time]);
  return { planRevision: plan.rows[0].revision, hasConflict: !!clashes.rowCount, time: old.time, message: clashes.rowCount ? "原时段已有同类安排，请先调整新安排再重新预览恢复。" : "恢复原条目，不改动当天其他安排。" };
}
export async function restorePreview(raw: string | undefined, householdId: string, id: string, input: z.infer<typeof c.expectedInput>) {
  return withHousehold(raw, householdId, async (db) => {
    const old = await target(db, householdId, id, "plan-item"); withinWindow(old);
    ensure(old.deletedAt, "REVISION_CONFLICT", "此安排已经恢复或未删除。", 409); expected(old.revision, input.expectedRevision);
    return planPreview(db, old, householdId);
  }, true);
}
export async function restore(raw: string | undefined, householdId: string, id: string, kind: Kind, input: z.infer<typeof c.expectedInput> | z.infer<typeof c.restoreInput>, key: string | undefined) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    const old = await target(db, householdId, id, kind);
    if (kind === "record") authorPermission(actor, access, old.authorId!);
    withinWindow(old);
    return idempotent(db, actor, householdId + ":restore:" + kind + ":" + id, key, input, async () => {
      ensure(old.deletedAt, "REVISION_CONFLICT", "此内容已经恢复或未删除。", 409); expected(old.revision, input.expectedRevision);
      if (kind === "plan-item") {
        const preview = await planPreview(db, old, householdId);
        ensure(!preview.hasConflict && preview.planRevision === (input as z.infer<typeof c.restoreInput>).expectedPlanRevision, "RESTORE_CONFLICT", "当天安排已变化或原时段已有新安排，请重新预览，不会覆盖家人后来保存的内容。", 409);
      }
      // Recheck the actual server clock after locks/preview, including the exact cutoff instant.
      const table = kind === "record" ? "activity_records" : "plan_items";
      const saved = await db.query<{ revision: number }>(`UPDATE ${table} SET deleted_at=NULL,deleted_by=NULL,restore_until=NULL,revision=revision+1,updated_by=$3,updated_at=now() WHERE household_id=$1 AND id=$2 AND restore_until>clock_timestamp() RETURNING revision`, [householdId, id, actor.id]);
      ensure(saved.rowCount, "RESTORE_WINDOW_EXPIRED", "30 天恢复期限已过。", 410);
      if (kind === "plan-item") {
        await db.query("UPDATE daily_plans SET revision=revision+1,updated_at=now() WHERE id=$1", [old.planId]);
        await version(db, householdId, id, actor.id);
      } else await recordVersion(db, householdId, id, actor, "从回收站恢复原记录及快照");
      await audit(db, householdId, actor, kind, id, "restore", saved.rows[0].revision);
      return { id, restored: true, revision: saved.rows[0].revision };
    }, async (saved) => { ensure(!old.deletedAt && old.revision >= saved.revision, "REVISION_CONFLICT", "此内容后来又被删除，请按最新版本处理。", 409); });
  }, true);
}
export async function trash(raw: string | undefined, householdId: string, cursor?: string) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    const found = await db.query<c.TrashItem>(`SELECT * FROM (
      SELECT i.id,'plan-item'::text AS kind,i.title,p.plan_date::text AS date,i.revision,i.deleted_at::text AS "deletedAt",i.restore_until::text AS "restoreUntil" FROM plan_items i JOIN daily_plans p ON p.id=i.plan_id WHERE i.household_id=$1 AND i.deleted_at IS NOT NULL AND i.restore_until>clock_timestamp()
      UNION ALL
      SELECT r.id,'record'::text AS kind,COALESCE(NULLIF(left(r.text,100),''),'参与／兴趣记录') AS title,r.occurred_on::text AS date,r.revision,r.deleted_at::text AS "deletedAt",r.restore_until::text AS "restoreUntil" FROM activity_records r WHERE r.household_id=$1 AND r.deleted_at IS NOT NULL AND r.restore_until>clock_timestamp() AND ($3::boolean OR r.author_id=$2)
    ) t WHERE ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT 51`, [householdId, actor.id, access.role === "admin", cursor ?? null]);
    return { items: found.rows.slice(0, 50), nextCursor: found.rows.length > 50 ? found.rows[49].id : null };
  });
}
