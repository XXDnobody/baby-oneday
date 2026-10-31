import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const fixture = JSON.parse(await readFile(".local/b3-browser-fixture.json", "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, storageState: ".local/b3-owner-browser-state.json" });
  const page = await context.newPage(); await page.goto("http://127.0.0.1:3001");
  await page.locator("#household-select").selectOption(fixture.householdId); await page.getByRole("button", { name: "平板大字", exact: true }).click(); await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的家庭", exact: true }).click();
  await page.getByLabel("作息名称 1", { exact: true }).waitFor();
  const metrics = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => ({ tag: e.tagName, class: e.className, right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width, minWidth: getComputedStyle(e).minWidth, grid: getComputedStyle(e).gridTemplateColumns, text: e instanceof HTMLInputElement ? e.getAttribute("aria-label") : e.textContent?.slice(0, 45) })) }));
  const output = process.argv.find((v) => v.startsWith("--output="))?.slice(9) ?? "output/b4-local-2026-10-31/family-layout-verification.json";
  await writeFile(output, JSON.stringify({ ...metrics, passed: metrics.content <= metrics.width + 1 }, null, 2));
  await page.screenshot({ path: "output/playwright/b4-family-layout.png", fullPage: true });
  console.log(JSON.stringify(metrics, null, 2)); assert(metrics.content <= metrics.width + 1, "loaded tablet family page must not overflow horizontally");
} finally { await browser.close(); }
