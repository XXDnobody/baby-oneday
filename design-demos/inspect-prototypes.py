"""Read-only local prototype inspection, not application/backend tests.

Run with huashu-design/scripts/local-run.sh python3 inspect-prototypes.py.
Captures default screens at two viewports, records console errors, overflow,
small clickable targets and missing image assets. Interaction review is separate.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "screenshots"
OUT.mkdir(exist_ok=True)
reports = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for name in ("dir-1", "dir-2", "dir-3"):
        if not (ROOT / f"{name}.html").exists():
            reports.append({"file": name, "status": "missing"})
            continue
        for width, height in ((1440, 900), (375, 812)):
            context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto((ROOT / f"{name}.html").as_uri(), wait_until="networkidle")
            page.wait_for_timeout(250)
            page.screenshot(path=str(OUT / f"{name}-{width}x{height}.png"))
            page.screenshot(path=str(OUT / f"{name}-{width}x{height}-full.png"), full_page=True)
            metrics = page.evaluate("""() => {
              const visible = e => {const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
              return {
                horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
                documentWidth:document.documentElement.scrollWidth,
                viewportWidth:innerWidth,
                smallControls:[...document.querySelectorAll('button,input:not([type=checkbox]):not([type=radio]),select')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.width<43.5||r.height<43.5}).map(e=>({text:(e.innerText||e.getAttribute('aria-label')||e.id).slice(0,60),width:Math.round(e.getBoundingClientRect().width),height:Math.round(e.getBoundingClientRect().height)})),
                brokenImages:[...document.images].filter(visible).filter(e=>!e.complete||!e.naturalWidth).map(e=>e.getAttribute('alt')),
                buttons:[...document.querySelectorAll('button')].filter(visible).map(e=>({text:(e.innerText||e.getAttribute('aria-label')||'').trim(),id:e.id,action:e.getAttribute('data-action')})),
                headings:[...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e=>e.textContent.trim())
              }
            }""")
            reports.append({"file": name, "viewport": f"{width}x{height}", "errors": errors, **metrics})
            context.close()
    browser.close()
(ROOT / "inspection-report.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2))
for item in reports:
    print(json.dumps({k:v for k,v in item.items() if k not in ('buttons','headings')}, ensure_ascii=False))
