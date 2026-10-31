import type { Pantry, ShoppingNeed } from "./b2";
import type { PlanItem } from "./contracts";
export function shoppingNeeds(items: PlanItem[], pantry: Pantry): ShoppingNeed[] {
  return items.filter((i) => i.status === "active" && i.contentSnapshot?.kind === "recipe").flatMap((item) => item.contentSnapshot!.ingredients.flatMap((ingredient) => {
    const entry = pantry.items.find((p) => p.name.toLowerCase() === ingredient.name.toLowerCase());
    if (entry?.status === "available" && entry.quantity === "enough") return [];
    return [{ name: ingredient.name, amountText: ingredient.amountText, recipeTitle: item.contentSnapshot!.title, recipeVersion: item.contentSnapshot!.version, status: entry?.status === "missing" ? "missing" : entry?.status === "available" ? "check-amount" : "unknown", confirmedAt: entry?.confirmedAt ?? null } satisfies ShoppingNeed];
  }));
}
