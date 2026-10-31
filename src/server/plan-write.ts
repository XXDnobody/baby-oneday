import type { PoolClient } from "pg";
import type { ItemFields } from "../shared/contracts";
import type { Actor } from "./auth";
import { caregiver, readChild, version } from "./households";
import { selection } from "./content";
import { ensure } from "./errors";
import type { AiSuggestion } from "../shared/b3";

// Callers hold the household FOR UPDATE lock; these functions never open a nested transaction.
export async function writePlanItem(db: PoolClient, actor: Actor, householdId: string, date: string, fields: ItemFields, source: "ai" | "automatic", itemId?: string, suggestion?: AiSuggestion) {
  const child = await readChild(db, householdId); ensure(child, "SETUP_REQUIRED", "请先完成宝宝资料。", 409);
  await db.query("INSERT INTO daily_plans(household_id,child_id,plan_date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [householdId, child.id, date]);
  const plan = (await db.query<{ id: string }>("SELECT id FROM daily_plans WHERE household_id=$1 AND child_id=$2 AND plan_date=$3 FOR UPDATE", [householdId, child.id, date])).rows[0];
  const name = await caregiver(db, householdId, fields.caregiverId);
  const content = await selection(db, householdId, fields.contentId, fields.contentVersion, fields.kind, date, fields.scene);
  const values = [householdId, child.id, plan.id, fields.kind, fields.title, fields.time, fields.notes, fields.caregiverId, name, actor.id, fields.contentId, fields.contentVersion, content ? JSON.stringify(content) : null, fields.scene, source, source === "ai", suggestion ? JSON.stringify(suggestion) : null];
  if (!itemId) itemId = (await db.query<{ id: string }>("INSERT INTO plan_items(household_id,child_id,plan_id,kind,title,time,notes,caregiver_id,caregiver_name,updated_by,content_id,content_version,content_snapshot,scene,source,protected,ai_suggestion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id", values)).rows[0].id;
  else {
    const updated = await db.query("UPDATE plan_items SET kind=$4,title=$5,time=$6,notes=$7,caregiver_id=$8,caregiver_name=$9,updated_by=$10,content_id=$11,content_version=$12,content_snapshot=$13,scene=$14,source=$15,protected=$16,ai_suggestion=$17,revision=revision+1,updated_at=now() WHERE id=$18 AND household_id=$1 AND child_id=$2 AND plan_id=$3 AND deleted_at IS NULL AND status='active'", [...values, itemId]);
    ensure(updated.rowCount, "REVISION_CONFLICT", "原安排已变化，请重新讨论。", 409);
  }
  await db.query("UPDATE daily_plans SET revision=revision+1,updated_at=now() WHERE id=$1", [plan.id]);
  const item = await version(db, householdId, itemId, actor.id);
  await db.query("INSERT INTO business_audit(household_id,resource_type,resource_id,action,revision,actor_id) VALUES ($1,'plan-item',$2,$3,$4,$5)", [householdId, itemId, source, item.revision, actor.id]);
  return { id: itemId, revision: item.revision };
}
