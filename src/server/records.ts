import type { PoolClient } from "pg";
import type { z } from "zod";
import * as c from "../shared/b2";
import type { PlanItem } from "../shared/contracts";
import type { Actor } from "./auth";
import { audit } from "./content";
import { expected, idempotent, itemSelect, localDate, withHousehold, type Access } from "./households";
import { ensure } from "./errors";

export const recordSelect = 'SELECT r.id,r.occurred_on::text AS "occurredOn",r.occurred_time AS "occurredTime",r.text,r.participation,r.interest,r.author_id AS "authorId",r.author_name AS "authorName",r.updated_by AS "updatedBy",u.display_name AS "editorName",r.revision,r.created_at::text AS "createdAt",r.updated_at::text AS "updatedAt",r.plan_item_id AS "planItemId",r.plan_snapshot AS "planSnapshot" FROM activity_records r JOIN users u ON u.id=r.updated_by ';
export function authorPermission(actor: Actor, access: Access, authorId: string) {
  ensure(access.role === "admin" || actor.id === authorId, "FORBIDDEN", "只有原作者或家庭管理员可以更正、删除和恢复这条记录。", 403);
}
export async function readRecord(db: PoolClient, householdId: string, id: string) {
  const found = await db.query<c.RecordEntry>(recordSelect + "WHERE r.household_id=$1 AND r.id=$2 AND r.deleted_at IS NULL", [householdId, id]);
  ensure(found.rowCount, "NOT_FOUND", "记录不存在或已删除。", 404); return found.rows[0];
}
export async function recordVersion(db: PoolClient, householdId: string, id: string, actor: Actor, note = "") {
  const snapshot = await readRecord(db, householdId, id);
  await db.query("INSERT INTO record_revisions(household_id,record_id,revision,snapshot,changed_by,correction_note) VALUES ($1,$2,$3,$4,$5,$6)", [householdId, id, snapshot.revision, JSON.stringify(snapshot), actor.id, note]);
  await audit(db, householdId, actor, "record", id, "save", snapshot.revision); return snapshot;
}
export async function getRecord(raw: string | undefined, householdId: string, id: string, history = false) {
  return withHousehold(raw, householdId, async (db) => {
    const record = await readRecord(db, householdId, id);
    if (!history) return record;
    return (await db.query<c.RecordRevision>('SELECT v.revision,v.snapshot,u.display_name AS "editorName",v.correction_note AS "correctionNote",v.created_at::text AS "createdAt" FROM record_revisions v JOIN users u ON u.id=v.changed_by WHERE v.household_id=$1 AND v.record_id=$2 ORDER BY v.revision DESC LIMIT 100', [householdId, id])).rows;
  });
}
export async function listRecords(raw: string | undefined, householdId: string, range: z.infer<typeof c.rangeInput>, cursor?: string) {
  return withHousehold(raw, householdId, async (db) => {
    const result = await db.query<c.RecordEntry>(recordSelect + "WHERE r.household_id=$1 AND r.occurred_on BETWEEN $2 AND $3 AND r.deleted_at IS NULL AND ($4::uuid IS NULL OR r.id<$4) ORDER BY r.id DESC LIMIT 51", [householdId, range.from, range.to, cursor ?? null]);
    return { items: result.rows.slice(0, 50), nextCursor: result.rows.length > 50 ? result.rows[49].id : null };
  });
}
export async function createRecord(raw: string | undefined, householdId: string, v: z.infer<typeof c.recordInput>, key: string | undefined) {
  return withHousehold(raw, householdId, async (db, actor, access) => idempotent(db, actor, householdId + ":record:new", key, v, async () => {
    ensure(v.occurredOn <= localDate(access.timezone), "INVALID_INPUT", "实际记录不能填写未来日期。");
    ensure((v.planItemId === null) === (v.planItemRevision === null), "INVALID_INPUT", "关联计划及版本需同时填写。");
    const child = await db.query<{ id: string }>("SELECT id FROM children WHERE household_id=$1", [householdId]);
    ensure(child.rowCount, "SETUP_REQUIRED", "请先完成宝宝资料。", 409);
    let snapshot = null;
    if (v.planItemId) {
      const found = await db.query<PlanItem & { date: string; planRevision: number }>(itemSelect.replace(" FROM plan_items", ',p.plan_date::text AS date,p.revision AS "planRevision" FROM plan_items') + "JOIN daily_plans p ON p.id=i.plan_id WHERE i.household_id=$1 AND i.id=$2 AND i.deleted_at IS NULL FOR SHARE OF i,p", [householdId, v.planItemId]);
      ensure(found.rowCount, "NOT_FOUND", "关联安排已删除或不可访问。", 404);
      expected(found.rows[0].revision, v.planItemRevision!);
      ensure(found.rows[0].date <= localDate(access.timezone), "INVALID_INPUT", "未来安排尚未发生，可以先保存独立记录。");
      snapshot = found.rows[0];
    }
    const found = await db.query<{ id: string }>("INSERT INTO activity_records(household_id,child_id,occurred_on,occurred_time,text,participation,interest,author_id,author_name,updated_by,plan_item_id,plan_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$11) RETURNING id", [householdId, child.rows[0].id, v.occurredOn, v.occurredTime, v.text, v.participation, v.interest, actor.id, actor.displayName, v.planItemId, snapshot ? JSON.stringify(snapshot) : null]);
    return recordVersion(db, householdId, found.rows[0].id, actor);
  }, async (saved) => { await readRecord(db, householdId, saved.id); }), true);
}
export async function editRecord(raw: string | undefined, householdId: string, id: string, v: z.infer<typeof c.recordEdit>, key: string | undefined) {
  return withHousehold(raw, householdId, async (db, actor, access) => {
    const old = await readRecord(db, householdId, id); authorPermission(actor, access, old.authorId);
    return idempotent(db, actor, householdId + ":record:edit:" + id, key, v, async () => {
      expected(old.revision, v.expectedRevision);
      ensure(v.occurredOn <= localDate(access.timezone), "INVALID_INPUT", "实际记录不能填写未来日期。");
      ensure(actor.id === old.authorId || v.correctionNote.length > 0, "INVALID_INPUT", "管理员更正他人记录时，请填写更正说明。");
      await db.query("UPDATE activity_records SET occurred_on=$3,occurred_time=$4,text=$5,participation=$6,interest=$7,revision=revision+1,updated_by=$8,updated_at=now() WHERE household_id=$1 AND id=$2", [householdId, id, v.occurredOn, v.occurredTime, v.text, v.participation, v.interest, actor.id]);
      return recordVersion(db, householdId, id, actor, v.correctionNote);
    });
  }, true);
}
export async function calendar(raw: string | undefined, householdId: string, range: z.infer<typeof c.rangeInput>) {
  return withHousehold(raw, householdId, async (db) => (await db.query<c.CalendarDay>(
    `SELECT d::date::text AS date,
      (SELECT count(*)::int FROM plan_items i JOIN daily_plans p ON p.id=i.plan_id WHERE i.household_id=$1 AND p.plan_date=d::date AND i.deleted_at IS NULL AND i.status='active') AS "planCount",
      (SELECT count(*)::int FROM plan_items i JOIN daily_plans p ON p.id=i.plan_id WHERE i.household_id=$1 AND p.plan_date=d::date AND i.deleted_at IS NULL AND i.status='cancelled') AS "cancelledCount",
      (SELECT count(*)::int FROM activity_records r WHERE r.household_id=$1 AND r.occurred_on=d::date AND r.deleted_at IS NULL) AS "recordCount"
    FROM generate_series($2::date,$3::date,interval '1 day') d ORDER BY d`, [householdId, range.from, range.to],
  )).rows);
}
