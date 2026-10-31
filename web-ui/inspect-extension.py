"""Visual and runtime inspection of the selected A extension."""
import json,importlib.util
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'screenshots'/'v2'
URL='http://127.0.0.1:63460/web-ui/index.html'
spec=importlib.util.spec_from_file_location('lint','/Users/jackx/.codex/skills/huashu-design/scripts/design_lint.py')
lint=importlib.util.module_from_spec(spec);spec.loader.exec_module(lint)
reports=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    for w,h in [(1440,900),(375,812)]:
        c=browser.new_context(viewport={'width':w,'height':h})
        page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        cases=[('today','today'),('calendar','calendar'),('calendar-past','calendar/2026-10-25'),('record-new','record/new'),('record-detail','record/demo-blocks'),('activities','activities'),('assistant-empty','assistant'),('assistant-proposal','assistant')]
        for name,route in cases:
            errors.clear();page.goto(URL+'#'+route,wait_until='networkidle')
            if name=='assistant-proposal':
                page.locator('[data-p-action=prompt-today]').click()
                if w==375:page.locator('[data-p-action=assistant-tab][data-value=proposal]').click()
            page.evaluate(f'window.__MIN_BODY={16 if w==375 else 14};window.__MIN_LABEL=12')
            page.screenshot(path=str(OUT/f'{name}-{w}.png'))
            page.screenshot(path=str(OUT/f'{name}-{w}-full.png'),full_page=True)
            facts=page.evaluate(lint.COLLECT_JS);facts['errors']=errors[:]
            red,yellow=lint.judge(facts)
            m=page.evaluate('''() => {const v=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'};return {overflow:document.documentElement.scrollWidth>innerWidth,smallControls:[...document.querySelectorAll('button,select,input:not([type=radio]):not([type=checkbox]):not([type=file]),summary,label.photo-input,.record-options label,.change-row')].filter(v).filter(e=>{const r=e.getBoundingClientRect();return r.width<43.5||r.height<43.5}).map(e=>({text:(e.textContent||e.getAttribute('aria-label')||e.name).trim().slice(0,35),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}}''')
            result={'page':name,'width':w,'errors':errors[:],'red':red,'yellow':yellow,**m};reports.append(result)
            print(json.dumps(result,ensure_ascii=False),flush=True)
        c.close()
    browser.close()
(ROOT/'extension-inspection.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
