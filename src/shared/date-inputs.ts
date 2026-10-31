export type BirthdayParts = { year: string; month: string; day: string };

export function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(12, 0, 0, 0);
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day ? result : undefined;
}

export function dateString(value: Date): string {
  return [String(value.getFullYear()).padStart(4, "0"), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

export function dateLabel(value: string): string {
  const parsed = parseDate(value);
  return parsed ? `${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日` : "请选择日期";
}

export function daysInMonth(year: number, month: number): number {
  const result = new Date(0);
  result.setFullYear(year, month, 0);
  return result.getDate();
}

export function birthdayParts(value: string): BirthdayParts {
  const parsed = parseDate(value);
  return parsed ? { year: String(parsed.getFullYear()), month: String(parsed.getMonth() + 1), day: String(parsed.getDate()) } : { year: "", month: "", day: "" };
}

export function birthdayValue(parts: BirthdayParts): string {
  if (!parts.year || !parts.month || !parts.day) return "";
  const value = [parts.year.padStart(4, "0"), parts.month.padStart(2, "0"), parts.day.padStart(2, "0")].join("-");
  return parseDate(value) ? value : "";
}

export function changeBirthday(parts: BirthdayParts, part: keyof BirthdayParts, value: string, max: string): BirthdayParts {
  const next = { ...parts, [part]: value };
  if (!next.year) return { year: "", month: "", day: "" };
  if (!next.month) return { ...next, day: "" };
  if (next.year === String(Number(max.slice(0, 4))) && Number(next.month) > Number(max.slice(5, 7))) return { ...next, month: "", day: "" };
  if (next.day && (Number(next.day) > daysInMonth(Number(next.year), Number(next.month)) || birthdayValue(next) > max)) next.day = "";
  return next;
}

export function dateError(value: string, { required = false, min, max }: { required?: boolean; min?: string; max?: string } = {}): string {
  if (!value) return required ? "请选择日期。" : "";
  if (!parseDate(value)) return "请选择有效日期。";
  if (min && value < min) return "日期不能早于" + dateLabel(min) + "。";
  if (max && value > max) return "日期不能晚于" + dateLabel(max) + "。";
  return "";
}
