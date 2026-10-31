import { z } from "zod";

export const foodRestrictionItem = z.object({
  kind: z.enum(["allergy", "avoid", "unspecified"]),
  food: z.string().trim().min(1, "请填写食物名称或原有说明。").max(1000),
  note: z.string().trim().max(200, "每项备注最多 200 字。").default(""),
}).strict().refine((item) => item.kind === "unspecified" || item.food.length <= 100, "食物名称最多 100 字。");

export const foodRestrictionItems = z.array(foodRestrictionItem).max(20, "最多添加 20 项食物过敏或忌口。").refine(
  (items) => new Set(items.map((item) => item.food.toLowerCase())).size === items.length,
  "同一种食物请只添加一次，可在备注中补充说明。",
);

export type FoodRestrictionItem = z.infer<typeof foodRestrictionItem>;
export const foodRestrictionLabels: Record<FoodRestrictionItem["kind"], string> = {
  allergy: "过敏", avoid: "其他忌口", unspecified: "原有记录，待分类",
};

export function formatFoodRestrictions(items: FoodRestrictionItem[]) {
  return items.map((item) => {
    const description = item.kind === "unspecified" ? item.food : foodRestrictionLabels[item.kind] + "：" + item.food;
    return description + (item.note ? "；备注：" + item.note : "");
  }).join("\n");
}
