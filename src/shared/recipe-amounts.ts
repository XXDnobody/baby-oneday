import type { AiSuggestion } from "./b3";

export type Ingredient = AiSuggestion["ingredients"][number];
export const basisLabels = { raw: "生重／可食部", cooked: "熟重", as_purchased: "购入量", count: "按个计" };
const numberText = (value: number) => String(Math.round((value + Number.EPSILON) * 100) / 100);
export function ingredientAmount(ingredient: Ingredient) {
  return ingredient.quantity !== undefined && ingredient.unit ? numberText(ingredient.quantity) + " " + ingredient.unit : ingredient.amountText || "用量待补充";
}
export interface PrepEntry { name: string; quantity: number | null; unit: string; basis: string; details: string[]; meals: string[]; approximate: boolean }
// Only explicit quantities are added. Text such as 少许 or 一小段 stays text;
// raw/cooked weights and pieces/grams are never silently converted or merged.
export function dailyPrep(meals: Array<{ title: string; suggestion?: AiSuggestion }>): PrepEntry[] {
  const result = new Map<string, PrepEntry>();
  for (const meal of meals) for (const ingredient of meal.suggestion?.ingredients ?? []) {
    let quantity = ingredient.quantity ?? null; let unit = ingredient.unit ?? "";
    let basis = ingredient.basis ?? "unspecified"; let approximate = false;
    if (quantity === null) {
      const match = ingredient.amountText.trim().match(/^(约\s*)?(\d+(?:\.\d+)?)\s*(kg|g|克|千克|ml|毫升|L|升|个|片|块|根|份|包|盒)\s*$/i);
      if (match) { quantity = Number(match[2]); unit = match[3]; approximate = !!match[1]; }
    }
    if (["kg", "千克"].includes(unit)) { unit = "g"; if (quantity !== null) quantity *= 1000; }
    if (unit === "克") unit = "g";
    if (["L", "升"].includes(unit)) { unit = "ml"; if (quantity !== null) quantity *= 1000; }
    if (unit === "毫升") unit = "ml";
    if (basis === "unspecified" && quantity !== null && !["g", "ml"].includes(unit)) basis = "count";
    const key = ingredient.name.normalize("NFKC").trim().toLowerCase() + "|" + unit + "|" + basis + (quantity === null ? "|text" : "");
    const entry = result.get(key) ?? { name: ingredient.name, quantity: quantity === null ? null : 0, unit, basis, details: [], meals: [], approximate: false };
    if (quantity !== null && entry.quantity !== null) entry.quantity += quantity;
    else if (!entry.details.includes(ingredient.amountText || "用量待补充")) entry.details.push(ingredient.amountText || "用量待补充");
    if (!entry.meals.includes(meal.title)) entry.meals.push(meal.title);
    entry.approximate ||= approximate;
    result.set(key, entry);
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.basis.localeCompare(b.basis));
}
export function prepAmount(entry: PrepEntry) {
  return entry.quantity === null ? entry.details.join("；") : (entry.approximate ? "约 " : "") + numberText(entry.quantity) + " " + entry.unit;
}
