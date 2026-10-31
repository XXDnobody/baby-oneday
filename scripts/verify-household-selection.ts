import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.BP_BROWSER_ORIGIN ?? "http://127.0.0.1:3001";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const trace: Array<Record<string, unknown>> = [];
try {
  const context = await browser.newContext({ storageState: ".local/b3-owner-browser-state.json" }), page = await context.newPage();
  page.on("console", (m) => { if (/Fast Refresh|reload/.test(m.text())) trace.push({ event: "console", text: m.text(), at: Date.now() }); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) trace.push({ event: "navigation", path: new URL(f.url()).pathname, at: Date.now() }); });
  await page.goto(origin); await page.locator("#household-select").waitFor();
  const families = await page.evaluate(async () => (await (await fetch("/api/v1/me")).json()).data.households as Array<{ id: string; role: string }>);
  const target = families.filter((f) => f.role === "admin").at(-1)!.id;
  await page.locator("#household-select").selectOption(target); await page.getByRole("button", { name: "添加安排", exact: true }).waitFor();
  trace.push({ event: "selected", selected: await page.locator("#household-select").inputValue(), target, at: Date.now() });
  const url = await page.evaluate(async (id) => {
    const csrf = (await (await fetch("/api/v1/auth/csrf")).json()).data.csrfToken;
    const r = await fetch("/api/v1/households/" + id + "/invites", { method: "POST", headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ role: "member" }) });
    const body = await r.json(); if (!r.ok) throw new Error(body.error.code); return body.data.url as string;
  }, target);
  const second = await browser.newContext(), signup = await second.newPage(); await signup.goto(url); await signup.getByRole("button", { name: "还没有账号？验证邮箱并加入", exact: true }).waitFor(); await second.close();
  let stable = true;
  for (let i = 0; i < 40; i++) { const selected = await page.locator("#household-select").inputValue(); if (selected !== target) { stable = false; trace.push({ event: "reverted", selected, target, at: Date.now() }); break; } await new Promise((resolve) => setTimeout(resolve, 100)); }
  const out = process.argv.find((v) => v.startsWith("--output="))?.slice(9) ?? "output/b4-local-2026-10-31/household-selection.json";
  await writeFile(out, JSON.stringify({ origin, passed: stable, trace }, null, 2));
  console.log(JSON.stringify({ origin, passed: stable, trace }, null, 2)); assert(stable, "selected household must remain after first invite page opens");
} finally { await browser.close(); }
