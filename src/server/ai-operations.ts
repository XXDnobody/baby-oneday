import type { PoolClient } from "pg";
import type { ItemFields } from "../shared/contracts";
import type { Preference } from "../shared/b2";
import type { AiOperation, PreviewChange } from "../shared/b3";
import type { Actor } from "./auth";
import { audit, readPantry, readPreferences, selection } from "./content";
import { caregiver, type Access } from "./households";
import { ensure } from "./errors";
import { readDatedItems, type Discussion } from "./ai-context";
import { writePlanItem } from "./plan-write";
import { suggestionNotes } from "./ai-suggestions";

function inRange(date: string, discussion: Discussion) { ensure(date >= discussion.from && date <= discussion.to, "MODEL_OUTPUT_REJECTED", "模型返回了讨论日期范围以外的改动。", 422); }
function fieldsOnly(item: ItemFields): ItemFields { return { kind: item.kind, title: item.title, time: item.time, notes: item.notes, caregiverId: item.caregiverId, contentId: item.contentId, contentVersion: item.contentVersion, scene: item.scene }; }
function normalizedPantry(items: Extract<AiOperation, { type: "pantry.set" }>["items"]) { return items.map((i) => ({ ...i, quantity: i.status === "available" ? i.quantity : "unknown", priority: i.status === "available" && i.priority })); }
export async function previewOperations(db: PoolClient, actor: Actor, access: Access, discussion: Discussion, requested: AiOperation[]) {
  const h = access.id;
  const operations: AiOperation[] = structuredClone(requested).flatMap((operation): AiOperation[] => {
    if (operation.type !== "plan.add" || !operation.repeatOn?.length) return [operation];
    const { repeatOn, ...single } = operation;
    return [...new Set([single.date, ...repeatOn])].sort().map((date) => ({ ...structuredClone(single), date }));
  });
  ensure(operations.length <= 200, "MODEL_OUTPUT_REJECTED", "本次改动较多，请按周或缩小日期范围讨论。", 422);
  const preview: PreviewChange[] = []; const targets = new Set<string>();
  const dated = await readDatedItems(db, h, discussion.from, discussion.to);
  const basePrefs = await readPreferences(db, h, discussion.from);
  const ending = new Set(operations.flatMap((o) => o.type === "preference.end" ? [o.preferenceId] : []));
  const adding = operations.flatMap((o, i) => o.type === "preference.add" ? [{ ...o.preference, id: "proposed-" + i, revision: 1, ended: false, active: true } as Preference] : []);
  const finalPreferences = (date: string) => [...basePrefs.filter((p) => !ending.has(p.id)), ...adding].map((p) => ({ ...p, active: !p.ended && p.startsOn <= date && p.endsOn >= date }));
  for (const [index, operation] of operations.entries()) {
    let target: string, before: unknown = null, after: unknown, date: string | undefined, impact: string;
    if (operation.type === "plan.add" || operation.type === "plan.update") {
      const old = operation.type === "plan.update" ? dated.find((i) => i.id === operation.itemId && i.status === "active") : null;
      ensure(operation.type !== "plan.update" || old, "MODEL_OUTPUT_REJECTED", "模型指定的安排不属于可修改的当前家庭及日期范围。", 422);
      date = operation.type === "plan.add" ? operation.date : old!.date; inRange(date, discussion);
      const fields = operation.item;
      await caregiver(db, h, fields.caregiverId);
      const content = await selection(db, h, fields.contentId, fields.contentVersion, fields.kind, date, fields.scene, finalPreferences(date));
      if (operation.suggestion) {
        ensure(!content, "MODEL_OUTPUT_REJECTED", "新建议与内容库版本须分开展示。", 422);
        fields.notes = await suggestionNotes(db, h, fields, operation.suggestion, finalPreferences(date));
      } else if (fields.kind !== "routine") {
        ensure(content || fields.title === (fields.kind === "meal" ? "饮食待安排" : "活动待安排"), "MODEL_OUTPUT_REJECTED", "饮食与活动只能采用已启用且适用的内容，或明确保留待安排。", 422);
        fields.title = content?.title ?? fields.title;
        if (!content) fields.notes = "保留待安排；未采用未核对内容。";
      }
      ensure(!old || old.kind === fields.kind, "MODEL_OUTPUT_REJECTED", "请保留原安排类型，分别讨论新增其他安排。", 422);
      target = old?.id ?? date + " " + fields.time;
      if (!old) ensure(!dated.some((i) => i.date === date && i.time === fields.time && i.status === "active"), "MODEL_OUTPUT_REJECTED", "此时段已有家人安排，请明确预览修改原项。", 422);
      before = old ? fieldsOnly(old) : null; after = fields; impact = "仅此项正式安排；确认后受自动计划保护。";
      if (operation.suggestion) impact = "AI 生成的新建议；确认后仅保存本次安排，不自动加入或启用内容库。";
    } else if (operation.type === "pantry.set") {
      target = "pantry"; const old = await readPantry(db, h); before = old.items.map(({ name, status, quantity, priority }) => ({ name, status, quantity, priority }));
      operation.items = normalizedPantry(operation.items) as typeof operation.items; after = operation.items; impact = "替换本次食材快照；保存时记录确认时间，不按计划扣库存。";
    } else if (operation.type === "preference.add") {
      const p = operation.preference; inRange(p.startsOn, discussion); inRange(p.endsOn, discussion);
      ensure(Date.parse(p.endsOn) - Date.parse(p.startsOn) <= 90 * 86400000, "MODEL_OUTPUT_REJECTED", "偏好须有明确期限，每次最多 91 天。", 422);
      target = "preference-new-" + index; after = p; impact = "仅在 " + p.startsOn + " 至 " + p.endsOn + " 生效；不修改食物禁忌。";
    } else if (operation.type === "preference.end") {
      const old = basePrefs.find((p) => p.id === operation.preferenceId && !p.ended); ensure(old, "MODEL_OUTPUT_REJECTED", "模型指定的偏好不属于当前家庭的有效偏好。", 422);
      target = old.id; const values = { kind: old.kind, scope: old.scope, text: old.text, startsOn: old.startsOn, endsOn: old.endsOn, ended: false }; before = values; after = { ...values, ended: true }; impact = "提前结束此条偏好，不改变食物禁忌。";
    } else {
      target = "template-" + operation.kind;
      const old = (await db.query<{ slots: unknown[] }>("SELECT slots FROM household_templates WHERE household_id=$1 AND kind=$2", [h, operation.kind])).rows[0]; ensure(old, "MODEL_OUTPUT_REJECTED", "作息模板不存在。", 422);
      before = old.slots; after = operation.slots; impact = "更新基础作息，不重写已有日计划。";
    }
    ensure(!targets.has(target), "MODEL_OUTPUT_REJECTED", "同一方案不能重复修改同一目标，请合并后重新讨论。", 422); targets.add(target);
    preview.push({ type: operation.type, target, ...(date ? { date } : {}), before, after, impact, ...((operation.type === "plan.add" || operation.type === "plan.update") && operation.suggestion ? { suggestion: operation.suggestion } : {}) });
  }
  return { operations, preview };
}
export async function applyOperations(db: PoolClient, actor: Actor, access: Access, discussion: Discussion, operations: AiOperation[]) {
  const results: Array<{ type: string; id: string; revision: number }> = [];
  // Apply household inputs first, so selections and evidence use the final pantry/preferences.
  for (const o of operations.filter((o) => o.type !== "plan.add" && o.type !== "plan.update")) {
    const h = access.id;
    if (o.type === "pantry.set") {
      await db.query("INSERT INTO pantry_snapshots(household_id) VALUES ($1) ON CONFLICT DO NOTHING", [h]);
      const at = (await db.query<{ at: string }>("SELECT clock_timestamp()::text AS at")).rows[0].at;
      const items = normalizedPantry(o.items).map((i) => ({ ...i, confirmedAt: at }));
      const r = (await db.query<{ revision: number }>("UPDATE pantry_snapshots SET items=$2,revision=revision+1,confirmed_at=$3,updated_by=$4 WHERE household_id=$1 RETURNING revision", [h, JSON.stringify(items), at, actor.id])).rows[0];
      await audit(db, h, actor, "pantry", h, "confirm", r.revision); results.push({ type: o.type, id: h, revision: r.revision });
    } else if (o.type === "preference.add") {
      const p = o.preference;
      const r = (await db.query<{ id: string; revision: number }>("INSERT INTO recent_preferences(household_id,kind,scope,text,starts_on,ends_on,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,revision", [h, p.kind, p.scope, p.text, p.startsOn, p.endsOn, actor.id])).rows[0];
      await audit(db, h, actor, "preference", r.id, "save", r.revision); results.push({ type: o.type, ...r });
    } else if (o.type === "preference.end") {
      const r = (await db.query<{ revision: number }>("UPDATE recent_preferences SET ended=true,revision=revision+1,updated_by=$3,updated_at=now() WHERE household_id=$1 AND id=$2 RETURNING revision", [h, o.preferenceId, actor.id])).rows[0];
      ensure(r, "REVISION_CONFLICT", "偏好已变化。", 409); await audit(db, h, actor, "preference", o.preferenceId, "end", r.revision); results.push({ type: o.type, id: o.preferenceId, revision: r.revision });
    } else if (o.type === "template.set") {
      const r = (await db.query<{ revision: number }>("UPDATE household_templates SET slots=$3,revision=revision+1 WHERE household_id=$1 AND kind=$2 RETURNING revision", [h, o.kind, JSON.stringify(o.slots)])).rows[0];
      await audit(db, h, actor, "template", h, "save", r.revision); results.push({ type: o.type, id: h, revision: r.revision });
    }
  }
  const dated = await readDatedItems(db, access.id, discussion.from, discussion.to);
  for (const o of operations) {
    if (o.type !== "plan.add" && o.type !== "plan.update") continue;
    const date = o.type === "plan.add" ? o.date : dated.find((i) => i.id === o.itemId)!.date;
    const saved = await writePlanItem(db, actor, access.id, date, o.item, "ai", o.type === "plan.update" ? o.itemId : undefined, o.suggestion);
    results.push({ type: o.type, ...saved });
  }
  return results;
}
