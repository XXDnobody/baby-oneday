import type { PoolClient } from "pg";
import type { ItemFields } from "../shared/contracts";
import type { Preference } from "../shared/b2";
import type { AiSuggestion } from "../shared/b3";
import { readChild } from "./households";
import { readPantry } from "./content";
import { ensure } from "./errors";
import { ingredientAmount } from "../shared/recipe-amounts";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

// Generated suggestions are one-off family choices. They do not create, enable,
// or claim to be reviewed versions in the household's content library.
export async function suggestionNotes(db: PoolClient, householdId: string, item: ItemFields, suggestion: AiSuggestion, preferences: Preference[]) {
  ensure(item.kind !== "routine" && item.contentId === null && item.contentVersion === null, "MODEL_OUTPUT_REJECTED", "AI 新建议不能冒充内容库版本或生活作息。", 422);
  const lines = ["来源：AI 生成建议（非内容库条目）"];
  if (item.kind === "meal") {
    const child = await readChild(db, householdId);
    ensure(child && child.foodStatus !== "unknown", "MODEL_OUTPUT_REJECTED", "请先确认宝宝的食物过敏与忌口，再生成具体餐食；仍可讨论活动与作息。", 422);
    ensure(suggestion.ingredients.length > 0, "MODEL_OUTPUT_REJECTED", "新菜单须列出具体食材与切配方式，不能只给菜名。", 422);
    ensure(!child.foodRestrictionItems.some((r) => r.kind === "unspecified"), "MODEL_OUTPUT_REJECTED", "现有食物限制尚未分类，请先由管理员核对后再采用新菜单。", 422);
    const ingredients = suggestion.ingredients.map((i) => normalize(i.name));
    const restrictions = child.foodRestrictionItems.map((r) => normalize(r.food));
    ensure(!restrictions.some((food) => normalize(item.title).includes(food) || ingredients.some((name) => name.includes(food) || food.includes(name))), "MODEL_OUTPUT_REJECTED", "新菜单含有已记录的过敏或忌口食材，未生成可采用方案。", 422);
    const proposedText = normalize(item.title + " " + suggestion.ingredients.map((i) => i.name).join(" "));
    ensure(!preferences.some((p) => p.active && p.kind === "avoid" && ["all", "meal"].includes(p.scope) && proposedText.includes(normalize(p.text))), "MODEL_OUTPUT_REJECTED", "新菜单与当前有效的暂避偏好冲突。", 422);
    const pantry = await readPantry(db, householdId);
    const needs = suggestion.ingredients.filter((ingredient) => !pantry.items.some((entry) => normalize(entry.name) === normalize(ingredient.name) && entry.status === "available"));
    if (suggestion.servings) lines.push((suggestion.servingNote || "宝宝参考备料") + " · " + suggestion.servings + " 份" + (suggestion.yieldText ? " · " + suggestion.yieldText : ""));
    lines.push("食材：" + suggestion.ingredients.map((i) => i.name + " · " + ingredientAmount(i) + " · " + i.formText).join("；"));
    lines.push(needs.length ? "待采购或核对：" + needs.map((i) => i.name).join("、") : "已记录为现有食材；做之前仍需核对余量。");
  } else {
    ensure(suggestion.ingredients.length === 0, "MODEL_OUTPUT_REJECTED", "活动建议不能夹带未核对的餐食方案。", 422);
    if (suggestion.materials) lines.push("准备：" + suggestion.materials);
    if (item.scene !== "indoor") {
      ensure(suggestion.weatherCondition && suggestion.indoorAlternative, "MODEL_OUTPUT_REJECTED", "户外建议须说明出门条件并提供室内备选；天气未知不代表不能先做计划。", 422);
      lines.push("户外条件：" + suggestion.weatherCondition, "室内备选：" + suggestion.indoorAlternative);
    }
  }
  lines.push("做法：\n" + suggestion.steps.map((step, index) => (index + 1) + ". " + step).join("\n"));
  if (suggestion.assumptions.length) lines.push("假设与待核对：" + suggestion.assumptions.join("；"));
  const notes = lines.join("\n");
  if (notes.length <= 2000) return notes;
  // Full structured details are kept in the plan and preview, not truncated to
  // fit the small summary field used in timelines and older clients.
  return [lines[0], suggestion.servingNote || "", "食材：" + suggestion.ingredients.map((i) => i.name + " " + ingredientAmount(i)).join("；"), "完整切配、火候和制作步骤请打开「查看做法」。", suggestion.weatherCondition ? "户外条件：" + suggestion.weatherCondition : "", suggestion.indoorAlternative ? "室内备选：" + suggestion.indoorAlternative : ""].filter(Boolean).join("\n");
}
