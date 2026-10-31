"""Capture and audit the selected high-fidelity prototype; no server/backend tests."""
import json
import importlib.util
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'screenshots'
OUT.mkdir(exist_ok=True)
URL = 'http://127.0.0.1:63460/web-ui/index.html'
spec=importlib.util.spec_from_file_location('design_lint','/Users/jackx/.codex/skills/huashu-design/scripts/design_lint.py')
lint=importlib.util.module_from_spec(spec);spec.loader.exec_module(lint)
reports = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(1440,900),(375,812)]:
        context = browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        for route in ['today','meals','pantry','activities','recipe/noodles','family','display','print']:
            errors.clear()
            page.goto(URL+'#'+route,wait_until='networkidle')
            page.locator('#app').wait_for()
            page.evaluate(f'window.__MIN_BODY={16 if width==375 else 14};window.__MIN_LABEL=12;')
            name=route.replace('/','-')
            page.screenshot(path=str(OUT/f'{name}-{width}.png'))
            page.screenshot(path=str(OUT/f'{name}-{width}-full.png'),full_page=True)
            metrics=page.evaluate('''() => {
              const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
              return {horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
                width:document.documentElement.scrollWidth,
                clippedToolbarLabels:[...document.querySelectorAll('.toolbar button')].filter(visible).filter(e=>{const range=document.createRange();range.selectNodeContents(e);const t=range.getBoundingClientRect(),b=e.getBoundingClientRect();return t.left<b.left-1||t.right>b.right+1}).map(e=>e.textContent.trim()),
                smallControls:[...document.querySelectorAll('button,select,input:not([type=radio]):not([type=checkbox]),label:has(input[type=radio]),label:has(input[type=checkbox])')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.width<43.5||r.height<43.5}).map(e=>({text:(e.innerText||e.name||e.getAttribute('aria-label')||'').slice(0,50),w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)})),
                headings:[...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e=>e.textContent),
                brokenImages:[...document.images].filter(e=>!e.complete||!e.naturalWidth).map(e=>e.src)}
            }''')
            facts=page.evaluate(lint.COLLECT_JS);facts['errors']=errors[:]
            red,yellow=lint.judge(facts)
            reports.append({'lintRed':red,'lintYellow':yellow,'route':route,'viewport':f'{width}x{height}','errors':errors[:],**metrics})
        context.close()
    browser.close()
(ROOT/'inspection-report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
for r in reports:print(json.dumps({k:v for k,v in r.items() if k!='headings'},ensure_ascii=False))
