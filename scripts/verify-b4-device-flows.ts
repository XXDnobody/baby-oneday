import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import type { Day } from "../src/shared/contracts";
import type { RecordEntry } from "../src/shared/b2";

const f = JSON.parse(await readFile(".local/b3-browser-fixture.json", "utf8"));
const root = "households/" + f.householdId, checks: Array<Record<string, unknown>> = [], errors: string[] = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
let completed = false;
async function read<T>(page: Page, path: string) { return page.evaluate(async (path) => (await (await fetch("/api/v1/" + path, { cache: "no-store" })).json()).data as T, path); }
try {
  for (const [index, viewport] of [{ name: "mobile", width: 390, height: 844 }, { name: "tablet-portrait", width: 834, height: 1194 }, { name: "tablet-landscape", width: 1194, height: 834 }].entries()) {
    const context = await browser.newContext({ viewport, storageState: ".local/b3-owner-browser-state.json", isMobile: viewport.name === "mobile", hasTouch: true }), page = await context.newPage(); page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:3001"); await page.locator("#household-select").selectOption(f.householdId); await page.getByRole("button", { name: "添加安排", exact: true }).waitFor();
    if (viewport.name.startsWith("tablet")) await page.getByRole("button", { name: "平板大字", exact: true }).click();
    const suffix = randomUUID().slice(0, 6), title = "B4" + viewport.name + "手动安排" + suffix, text = "B4" + viewport.name + "实际记录" + suffix;
    const occupied = new Set((await read<Day>(page, root + "/today?date=" + f.today)).plan?.items.map((i) => i.time) ?? []);
    let minute = 420 + index;
    const formatTime = (value: number) => String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
    while (occupied.has(formatTime(minute))) minute++;
    await page.getByRole("button", { name: "添加安排", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "添加一项安排", exact: true }); await editor.getByLabel("安排名称", { exact: true }).fill(title); await editor.getByLabel("时间", { exact: true }).fill(formatTime(minute));
    await editor.getByRole("button", { name: "保存并共享", exact: true }).click(); await editor.waitFor({ state: "hidden" }); await page.getByRole("button", { name: "记录 " + title, exact: true }).click();
    const record = page.getByRole("dialog", { name: "记一下这次发生", exact: true }); await record.getByRole("textbox", { name: "想记下的话", exact: true }).fill(text); await record.getByRole("combobox", { name: "参与情况", exact: true }).selectOption("joined");
    await record.getByRole("button", { name: "保存这一次记录", exact: true }).click(); await record.waitFor({ state: "hidden" });
    const before = (await read<Day>(page, root + "/today?date=" + f.today)).plan!.items.find((i) => i.title === title)!; assert(before);
    const actual = (await read<{ items: RecordEntry[] }>(page, root + "/records?from=" + f.today + "&to=" + f.today)).items.filter((r) => r.text === text); assert.equal(actual.length, 1); assert.equal(actual[0].planSnapshot?.id, before.id);
    await page.getByRole("button", { name: "调整 " + title, exact: true }).click(); const adjust = page.getByRole("dialog", { name: "调整这项安排", exact: true });
    await adjust.getByRole("button", { name: "删除至回收站", exact: true }).click(); await adjust.getByRole("button", { name: "确认删除这项安排", exact: true }).click(); await adjust.waitFor({ state: "hidden" });
    assert.equal((await read<RecordEntry>(page, root + "/records/" + actual[0].id)).planSnapshot?.title, title);
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "回收站", exact: true }).click();
    const row = page.locator(".trash-list article").filter({ has: page.getByRole("heading", { name: title, exact: true }) }); await row.getByRole("button", { name: "预览恢复安排", exact: true }).click(); await page.getByRole("button", { name: "确认恢复原安排", exact: true }).click(); await row.waitFor({ state: "hidden" });
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: viewport.name.startsWith("tablet") ? "平板主页" : "每日安排", exact: true }).click(); await page.getByRole("button", { name: "调整 " + title, exact: true }).waitFor();
    assert.equal((await read<Day>(page, root + "/today?date=" + f.today)).plan!.items.filter((i) => i.id === before.id).length, 1);
    await page.getByRole("button", { name: "生成当日打印快照", exact: true }).click(); const printPromise = context.waitForEvent("page"); await page.getByRole("link", { name: "打开固定打印快照", exact: true }).click(); const print = await printPromise; await print.getByText(title, { exact: true }).waitFor(); assert(await print.getByRole("button", { name: "打印 A4 黑白版", exact: true }).isEnabled());
    await page.screenshot({ path: "output/playwright/b4-" + viewport.name + "-manual-record-recovered.png", fullPage: true });
    checks.push({ viewport, manualSave: true, record: true, modalScrollActionsReachable: true, deletedPlanKeepsRecordSnapshot: true, restorePreservesId: true, printSnapshot: true, passed: true }); console.log("通过：" + viewport.name + " 手动保存／记录／长表单删除／恢复／打印"); await context.close();
  }
  assert.deepEqual(errors, []); completed = true;
} finally {
  await writeFile("output/b4-local-2026-10-31/device-flows.json", JSON.stringify({ verifiedAt: new Date().toISOString(), browser: browser.version(), environment: "built standalone / 3001 / 5433 / viewport emulation, not hardware", physicalDevices: false, paperPrinter: false, checks, pageErrors: errors, passed: completed }, null, 2)); await browser.close();
}
