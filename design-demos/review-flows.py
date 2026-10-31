"""Independent smoke review of candidate UI flows and the comparison viewer."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "screenshots"
results = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    for variant in (1, 2, 3):
        context = browser.new_context(viewport={"width":1440, "height":900}, device_scale_factor=2)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e:errors.append(str(e)))
        page.goto((ROOT/f"dir-{variant}.html").as_uri(),wait_until="networkidle")
        before = page.locator("body").inner_text()
        assert "蒸南瓜" in before and "午睡" in before
        if variant == 1:
            page.locator("#replace-dinner").click()
            expect(page.locator("#detail-dialog")).to_be_visible()
            page.screenshot(path=str(OUT/"dir-1-replace.png"))
            page.locator('[data-action="confirm-dinner"]').click()
            expect(page.locator("#dinner-heading")).to_have_text("番茄鸡蛋软饭")
            page.locator('[data-action="activity-detail"]').click()
            expect(page.locator("#detail-dialog")).to_be_visible()
            page.keyboard.press("Escape")
            page.locator('.toolbar [data-action="display"]').click()
            display = page.locator("#display-dialog")
            expect(display).to_be_visible()
            assert display.locator("button").count() == 1
            page.keyboard.press("Escape")
            page.locator('.toolbar [data-action="print"]').click()
            expect(page.locator("#print-dialog")).to_be_visible()
            assert "2026 年 10 月 28 日" in page.locator("#print-dialog").inner_text()
            assert "番茄鸡蛋软饭" in page.locator("#print-dialog").inner_text()
        elif variant == 2:
            page.locator("#dinner-replace").click()
            expect(page.locator("#modal")).to_be_visible()
            page.screenshot(path=str(OUT/"dir-2-replace.png"))
            page.locator("#dinner-confirm").click()
            page.keyboard.press("Escape")
            assert "番茄鸡蛋软饭" in page.locator("body").inner_text()
            page.locator('[data-action="activity-detail"]').click()
            expect(page.locator("#modal")).to_be_visible()
            page.keyboard.press("Escape")
            page.locator("#big-preview").click()
            display = page.locator("#display-modal")
            expect(display).to_be_visible()
            assert display.locator("button").count() == 1
            page.keyboard.press("Escape")
            page.locator("#print-preview").click()
            expect(page.locator("#modal")).to_be_visible()
            assert "2026-10-28" in page.locator("#print-sheet").inner_text()
            assert "番茄鸡蛋软饭" in page.locator("#print-sheet").inner_text()
        else:
            page.locator('.main-nav [data-open="meals"]').click()
            page.locator('#dialog [data-open="replace"]').click()
            page.screenshot(path=str(OUT/"dir-3-replace.png"))
            page.locator("#confirm-dinner").click()
            expect(page.locator("#dinner-value")).to_have_text("番茄鸡蛋软饭")
            page.keyboard.press("Escape")
            page.locator('.main-nav [data-open="activity"]').click()
            expect(page.locator("#dialog")).to_be_visible()
            page.keyboard.press("Escape")
            page.locator('.top-actions [data-open="display"]').click()
            display = page.locator("#dialog")
            expect(display).to_be_visible()
            assert display.locator("button").count() == 1
            page.keyboard.press("Escape")
            page.locator('.top-actions [data-open="print"]').click()
            expect(page.locator("#dialog")).to_be_visible()
            assert "2026-10-28" in page.locator("#print-sheet").inner_text()
            assert "番茄鸡蛋软饭" in page.locator("#print-sheet").inner_text()
        page.keyboard.press("Escape")
        after = page.locator("body").inner_text()
        assert "蒸南瓜" in after and "午睡" in after
        assert not errors, errors
        results.append({"direction":variant,"dinnerReplaced":True,"snackAndNapPreserved":True,"activityDialog":True,"displayReadOnly":True,"printCurrentSnapshot":True,"errors":errors})
        context.close()
    context = browser.new_context(viewport={"width":1440,"height":1050}, device_scale_factor=2)
    page = context.new_page()
    gallery_errors=[]
    page.on("pageerror",lambda e:gallery_errors.append(str(e)))
    page.goto((ROOT/"index.html").as_uri(),wait_until="networkidle")
    for v in (1,2,3):
        page.locator(f'[data-dir="{v}"]').click()
        assert page.locator("#frame").get_attribute("src")==f"dir-{v}.html"
    page.locator('[data-device="mobile"]').click()
    assert page.locator("#frame").evaluate("e=>e.style.width")=='375px'
    page.locator("#compareBtn").click()
    page.wait_for_timeout(200)
    assert page.locator("#compare").is_visible()
    assert page.locator(".card img").evaluate_all("els=>els.every(e=>e.complete&&e.naturalWidth>0)")
    page.screenshot(path=str(OUT/"comparison.png"),full_page=True)
    assert not gallery_errors, gallery_errors
    results.append({"viewer":"index.html","switchDirections":True,"mobilePreview":True,"comparisonImages":True,"errors":gallery_errors})
    context.close()
    browser.close()
(ROOT/"review-flow-report.json").write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
