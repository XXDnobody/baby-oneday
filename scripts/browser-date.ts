import type { Page } from "playwright";

export async function chooseDate(page: Page, label: string, value: string) {
  const [year, month, day] = value.split("-").map(Number);
  await page.getByRole("button", { name: label, exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "选择" + label, exact: true });
  for (const [field, next] of [["选择年份", String(year)], ["选择月份", String(month) + "月"]]) {
    const select = calendar.getByRole("combobox", { name: field, exact: true });
    await select.fill(next); await select.press("Enter");
  }
  await calendar.getByRole("button", { name: `选择 ${year}年${month}月${day}日`, exact: true }).click();
}
