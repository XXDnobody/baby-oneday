import { chooseDate } from "./browser-date";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const fixture = JSON.parse(await readFile(".local/b3-browser-fixture.json", "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks: Array<Record<string, unknown>> = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, storageState: ".local/b3-owner-browser-state.json" });
    const page = await context.newPage();
    try {
      await page.route("**/weather?**", async (route) => {
        try {
          const response = await route.fetch(); const body = await response.json();
          if (body.data?.current) body.data.current.attributions.push("Current product additional attribution test");
          if (body.data?.hourly) body.data.hourly.attributions.push("Hourly product additional attribution test");
          await route.fulfill({ response, json: body });
        } catch (error) { if (!page.isClosed()) throw error; }
      });
      await page.goto("http://127.0.0.1:3001"); await page.getByRole("button", { name: "添加安排", exact: true }).waitFor();
      await page.locator("#household-select").selectOption(fixture.householdId); await chooseDate(page, "安排日期", fixture.tomorrow);
      await page.getByText("Current product additional attribution test", { exact: true }).waitFor(); await page.getByText("Hourly product additional attribution test", { exact: true }).waitFor(); await page.getByText("专用测试服务 · 非真实天气", { exact: true }).waitFor();
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); assert(noOverflow);
      checks.push({ viewport, bothProductAttributionsVisible: true, testMarkerVisible: true, noOverflow });
    } finally {
      // Drain interceptors before disposal; the workspace also polls weather in the background.
      await page.unrouteAll({ behavior: "wait" }); await context.close();
    }
  }
} finally { await browser.close(); }
await writeFile((process.env.BP_EVIDENCE_DIR ?? "output/b3-local-2026-10-31") + "/weather-attribution-verification.json", JSON.stringify({ verifiedAt: new Date().toISOString(), purpose: "Distinct current/hourly metadata credits both remain visible", testOnly: true, checks, passed: checks.length === 2 }, null, 2));
console.log("两个视口均展示 current 与 hourly 的全部归因，测试标记保持可见。");
