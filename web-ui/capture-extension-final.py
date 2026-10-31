"""Final representative screens and a small integration check of the review host."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'screenshots'/'v2'
URL='http://127.0.0.1:63460/web-ui/'
with sync_playwright() as p:
    browser=p.chromium.launch()
    for width,height in [(1440,900),(375,812)]:
        c=browser.new_context(viewport={'width':width,'height':height});page=c.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        for name,route in [('calendar','calendar'),('record-detail','record/demo-blocks'),('record-new','activities'),('assistant-proposal','assistant')]:
            page.goto(URL+'index.html#'+route,wait_until='networkidle')
            if name=='record-new':
                page.locator('[data-p-action=new-record][data-linked=true]').click()
                expect(page.locator('#record-editor')).to_be_visible()
            if name=='assistant-proposal':
                page.locator('[data-p-action=prompt-today]').click()
                if width==375:page.locator('[data-p-action=assistant-tab][data-value=proposal]').click()
            page.screenshot(path=str(OUT/f'{name}-{width}.png'))
            page.screenshot(path=str(OUT/f'{name}-{width}-full.png'),full_page=True)
        # The core meal, family, read-only display and print routes still render.
        for route in ['meals','family','display','print']:
            page.goto(URL+'index.html#'+route,wait_until='networkidle')
            assert page.locator('#app').inner_text()
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        assert not errors,errors
        c.close()
    c=browser.new_context(viewport={'width':1440,'height':900});page=c.new_page()
    page.goto(URL+'index.html#assistant',wait_until='networkidle')
    page.locator('[data-p-action=prompt-today]').click()
    page.locator('#assistant-message').fill('明天先看看食材')
    page.locator('#assistant-composer button[type=submit]').click()
    assert page.evaluate('BabyPlanning.getProposal()') is None
    page.locator('#assistant-message').fill('只调整晚餐')
    page.locator('#assistant-composer button[type=submit]').click()
    proposal=page.evaluate('BabyPlanning.getProposal()')
    assert len(proposal['changes'])==1 and proposal['changes'][0]['date']=='2026-10-29'
    assert page.evaluate('state.meals.dinner')=='noodles'
    print('PASS switching discussion dates invalidates the previous preview and keeps today unchanged')
    page.goto(URL+'review.html?page=calendar',wait_until='networkidle')
    expect(page.frame_locator('#prototype').locator('h1')).to_have_text('日历')
    page.locator('#device').select_option('mobile')
    assert page.frame_locator('#prototype').locator('.nav-button').count()==5
    page.locator('#scenario').select_option('photo-fail')
    expect(page.frame_locator('#prototype').locator('#record-editor')).to_be_visible()
    page.locator('#scenario').select_option('normal');page.locator('#device').select_option('desktop')
    page.locator('#pages [data-route=calendar]').click();page.locator('aside').evaluate('(e)=>e.scrollTop=0')
    page.screenshot(path=str(OUT/'review-host-1440.png'))
    page.set_viewport_size({'width':1600,'height':1100})
    page.goto(URL+'extension-overview.html',wait_until='networkidle')
    assert page.locator('img').evaluate_all('(es)=>es.every(e=>e.complete&&e.naturalWidth>0)')
    page.screenshot(path=str(OUT/'extension-overview.png'),full_page=True)
    c.close();browser.close()
print('PASS final desktop/mobile screens, core-route smoke check, five-item nav, review host and overview')

(ROOT/'extension-final-report.json').write_text(json.dumps({'discussion_scope_invalidation':True,'core_routes_desktop_and_mobile':True,'five_item_navigation':True,'review_host':True,'overview_assets':True},ensure_ascii=False,indent=2))
