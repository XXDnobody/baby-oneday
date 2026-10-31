import { describe, expect, test } from "vitest";
import { dailyPrep, ingredientAmount, prepAmount } from "../src/shared/recipe-amounts";
import type { AiSuggestion } from "../src/shared/b3";

function meal(title: string, ingredients: AiSuggestion["ingredients"]) { return { title, suggestion: { ingredients, steps: ["测试步骤"], materials: "", assumptions: [], weatherCondition: "", indoorAlternative: "" } }; }
describe("每天的参考备料量", () => {
  test("合并同口径克数及毫升，生重和熟重分别保留", () => {
    const rows = dailyPrep([
      meal("午餐", [{ name: "大米", amountText: "30g", formText: "", quantity: 30, unit: "g", basis: "raw" }, { name: "牛奶", amountText: "100ml", formText: "", quantity: 100, unit: "ml", basis: "as_purchased" }]),
      meal("晚餐", [{ name: "大米", amountText: "0.05kg", formText: "", quantity: .05, unit: "kg", basis: "raw" }, { name: "牛奶", amountText: "0.12L", formText: "", quantity: .12, unit: "L", basis: "as_purchased" }, { name: "大米", amountText: "100g熟饭", formText: "", quantity: 100, unit: "g", basis: "cooked" }]),
    ]);
    expect(rows.find((row) => row.name === "大米" && row.basis === "raw")?.quantity).toBe(80);
    expect(rows.find((row) => row.name === "大米" && row.basis === "cooked")?.quantity).toBe(100);
    expect(rows.find((row) => row.name === "牛奶")?.quantity).toBe(220);
  });
  test("按个计和克数不互换，少许和一小段不假装精确数字", () => {
    const rows = dailyPrep([meal("早餐", [{ name: "鸡蛋", amountText: "1个", formText: "" }, { name: "胡萝卜", amountText: "一小段", formText: "" }]), meal("晚餐", [{ name: "鸡蛋", amountText: "2个", formText: "" }, { name: "鸡蛋", amountText: "50g", formText: "", quantity: 50, unit: "g", basis: "raw" }, { name: "胡萝卜", amountText: "少许", formText: "" }])]);
    expect(rows.filter((row) => row.name === "鸡蛋")).toHaveLength(2);
    expect(rows.find((row) => row.unit === "个")?.quantity).toBe(3);
    expect(rows.find((row) => row.name === "胡萝卜")?.quantity).toBeNull();
    expect(prepAmount(rows.find((row) => row.name === "胡萝卜")!)).toBe("一小段；少许");
  });
  test("量化字段作为备料口径，保留旧菜谱的约数与文字", () => {
    expect(ingredientAmount({ name: "南瓜", quantity: 40, unit: "g", basis: "raw", amountText: "一小段", formText: "" })).toBe("40 g");
    const [entry] = dailyPrep([meal("午餐", [{ name: "南瓜", amountText: "约20g", formText: "" }]), meal("晚餐", [{ name: "南瓜", amountText: "约30g", formText: "" }])]);
    expect(prepAmount(entry)).toBe("约 50 g");
  });
});
