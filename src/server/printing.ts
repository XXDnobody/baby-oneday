import type { z } from "zod";
import type { PoolClient } from "pg";
import type * as c from "../shared/b2";
import type { PlanItem } from "../shared/contracts";
import { contentVersion, audit } from "./content";
import { expected, idempotent, itemSelect, withHousehold } from "./households";
import { ensure } from "./errors";
import { readAgreements } from "./agreements";

async function readPrint(db: PoolClient, householdId: string, id: string): Promise<c.PrintSnapshot> {
  const found = await db.query<{ snapshot: c.PrintSnapshot; blocked: boolean }>(`SELECT s.snapshot,EXISTS(SELECT 1 FROM plan_items i WHERE i.id=ANY(s.source_item_ids) AND i.deleted_at IS NOT NULL) AS blocked FROM print_snapshots s WHERE s.household_id=$1 AND s.id=$2`, [householdId, id]);
  ensure(found.rowCount, "NOT_FOUND", "打印快照不存在。", 404);
  ensure(!found.rows[0].blocked, "NOT_FOUND", "快照关联的安排已删除，无法读取这份打印正文。关联记录的历史快照仍保留。", 404);
  return { ...found.rows[0].snapshot, id };
}
export async function getPrint(raw: string | undefined, householdId: string, id: string) {
  return withHousehold(raw, householdId, (db) => readPrint(db, householdId, id));
}
export async function createPrint(raw: string | undefined, householdId: string, input: z.infer<typeof c.printInput>, key: string | undefined) {
  return withHousehold(raw, householdId, (db, actor) => idempotent(db, actor, householdId + ":print", key, input, async () => {
    const names = (await db.query<{ householdName: string; childName: string }>('SELECT h.name AS "householdName",c.name AS "childName" FROM households h JOIN children c ON c.household_id=h.id WHERE h.id=$1', [householdId])).rows[0];
    ensure(names, "SETUP_REQUIRED", "请先完成宝宝资料。", 409);
    const snapshot: Omit<c.PrintSnapshot, "id"> = { ...names, kind: input.kind, date: input.date, generatedAt: new Date().toISOString(), planRevision: null, items: [], recipes: [], reminders: (await readAgreements(db, householdId)).items.filter((i) => i.enabled).map((i) => i.text) };
    if (input.kind === "recipe") {
      const content = await contentVersion(db, householdId, input.contentId, input.contentVersion);
      ensure(content.kind === "recipe", "INVALID_INPUT", "请选择菜谱。"); snapshot.recipes = [content];
    } else {
      const plan = await db.query<{ id: string; revision: number }>("SELECT id,revision FROM daily_plans WHERE household_id=$1 AND plan_date=$2 FOR SHARE", [householdId, input.date]);
      ensure(plan.rowCount, "NOT_FOUND", "当天计划不存在。", 404); expected(plan.rows[0].revision, input.expectedRevision);
      ensure(new Set(input.items.map((i) => i.id)).size === input.items.length, "INVALID_INPUT", "打印条目不能重复。");
      snapshot.planRevision = plan.rows[0].revision;
      for (const selected of input.items) {
        const found = await db.query<PlanItem>(itemSelect + "WHERE i.household_id=$1 AND i.plan_id=$2 AND i.id=$3 AND i.deleted_at IS NULL", [householdId, plan.rows[0].id, selected.id]);
        ensure(found.rowCount, "NOT_FOUND", "所选安排已删除或不属于当天。", 404); expected(found.rows[0].revision, selected.revision);
        const item = found.rows[0]; snapshot.items.push(item);
        if (item.contentSnapshot?.kind === "recipe" && !snapshot.recipes.some((r) => r.id === item.contentSnapshot!.id && r.version === item.contentSnapshot!.version)) snapshot.recipes.push(item.contentSnapshot);
      }
      snapshot.items.sort((a, b) => a.time.localeCompare(b.time));
    }
    const result = await db.query<{ id: string }>("INSERT INTO print_snapshots(household_id,snapshot,source_item_ids,created_by) VALUES ($1,$2,$3,$4) RETURNING id", [householdId, JSON.stringify(snapshot), snapshot.items.map((i) => i.id), actor.id]);
    await audit(db, householdId, actor, "print", result.rows[0].id, "snapshot", 1); return result.rows[0];
  }, async (saved) => { await readPrint(db, householdId, saved.id); }));
}
