import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>baby-plan-env</title><h1>ok</h1>");
  const title = await page.title();
  if (title !== "baby-plan-env") {
    console.error("浏览器页面标题不符合预期。");
    process.exit(1);
  }
} finally {
  await browser.close();
}
console.log("Playwright Chromium 已启动并完成一次页面检查。");
