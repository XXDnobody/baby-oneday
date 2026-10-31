import { describe, expect, test } from "vitest";
import { parseModelJson } from "../src/server/model-json";

describe("模型 JSON 中的文案转义", () => {
  test("真实 DeepSeek 文案里的 Markdown 加号转义不应丢弃整个菜单方案", () => {
    const raw = String.raw`{"answer":"软面条\+西兰花。\n下一餐。","operations":[]}`;
    expect(parseModelJson(raw)).toEqual({ answer: "软面条+西兰花。\n下一餐。", operations: [] });
  });
  test("合法的 JSON 转义及原本的字面反斜杠完整保留", () => {
    const value = { answer: '保留 \\+、"引号"、换行\n和 Unicode 字符', operations: [] };
    expect(parseModelJson(JSON.stringify(value))).toEqual(value);
  });
  test.each([
    String.raw`{"answer":"未完成\+",`,
    String.raw`{"answer":"错误 Unicode \uQQQQ","operations":[]}`,
    String.raw`{"answer":"错误转义 \q","operations":[]}`,
    '{"answer":"缺少分隔" "operations":[]}',
  ])("不修补截断、Unicode、非 Markdown 转义或对象结构：%s", (raw) => {
    expect(() => parseModelJson(raw)).toThrow();
  });
});
