import { describe, expect, test } from "vitest";
import { birthdayParts, birthdayValue, changeBirthday, dateError, dateLabel, dateString, daysInMonth, parseDate } from "../src/shared/date-inputs";

describe("日期选择的真实日期与边界", () => {
  test.each(["2025-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-1", "invalid"])("拒绝无效日期 %s", (value) => {
    expect(parseDate(value)).toBeUndefined();
    expect(dateError(value)).toBe("请选择有效日期。");
  });
  test.each(["2024-02-29", "2000-02-29", "2026-10-31", "0099-12-31"])("日期 %s 在时区转换后保持原日历日", (value) => {
    const originalTimezone = process.env.TZ;
    try {
      for (const zone of ["Asia/Shanghai", "America/Los_Angeles", "Pacific/Auckland"]) {
        process.env.TZ = zone;
        expect(dateString(parseDate(value)!)).toBe(value);
        expect(birthdayValue(birthdayParts(value))).toBe(value);
      }
    } finally { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; }
  });
  test("换到平年或小月时清空无效的日，不把宝宝生日悄悄改为别的日期", () => {
    expect(changeBirthday(birthdayParts("2024-02-29"), "year", "2025", "2026-10-31")).toEqual({ year: "2025", month: "2", day: "" });
    expect(changeBirthday(birthdayParts("2025-01-31"), "month", "4", "2026-10-31")).toEqual({ year: "2025", month: "4", day: "" });
    expect(daysInMonth(2000, 2)).toBe(29); expect(daysInMonth(1900, 2)).toBe(28);
  });
  test("生日换到今年时清空未来月份，并保留仍有效的日期", () => {
    expect(changeBirthday(birthdayParts("2025-12-25"), "year", "2026", "2026-10-31")).toEqual({ year: "2026", month: "", day: "" });
    expect(changeBirthday(birthdayParts("2025-10-31"), "year", "2026", "2026-10-31")).toEqual({ year: "2026", month: "10", day: "31" });
    expect(changeBirthday(birthdayParts("2025-10-31"), "year", "2026", "2026-10-20")).toEqual({ year: "2026", month: "10", day: "" });
  });
  test("生日选填允许全部清除，但不把半填日期或不存在的日期序列化", () => {
    expect(birthdayValue({ year: "2025", month: "5", day: "" })).toBe("");
    expect(birthdayValue({ year: "2025", month: "2", day: "29" })).toBe("");
    expect(changeBirthday(birthdayParts("2025-05-01"), "year", "", "2026-10-31")).toEqual({ year: "", month: "", day: "" });
    expect(dateError("")).toBe(""); expect(dateError("", { required: true })).toBe("请选择日期。");
  });
  test("最早、最晚日期包含边界；范围改变后旧值仍须通过校验", () => {
    const range = { min: "2026-10-20", max: "2026-10-31" };
    expect(dateError(range.min, range)).toBe(""); expect(dateError(range.max, range)).toBe("");
    expect(dateError("2026-10-19", range)).toBe("日期不能早于2026年10月20日。");
    expect(dateError("2026-11-01", range)).toBe("日期不能晚于2026年10月31日。");
    expect(dateLabel("2025-05-01")).toBe("2025年5月1日");
  });
});
