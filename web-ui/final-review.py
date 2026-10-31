"""Final review of responsive dialogs, tablet display, account login and printed pages."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parent
URL='http://127.0.0.1:63460/web-ui/'
results=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    c=browser.new_context(viewport={'width':375,'height':812})
    page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL+'index.html#meals',wait_until='networkidle')
    page.locator('[data-action=replace][data-slot=dinner]').click()
    page.locator('#replace-form [name=recipe][value=rice]').check()
    assert page.locator('#ui-dialog').evaluate('(e)=>e.getBoundingClientRect().width')<=375
    page.screenshot(path=str(ROOT/'screenshots/replace-drawer-375.png'))
    page.keyboard.press('Escape');expect(page.locator('#ui-dialog')).not_to_be_visible()
    assert page.locator('[data-action=replace][data-slot=dinner]').evaluate('(e)=>e===document.activeElement')
    results.append({'check':'手机换餐抽屉、键盘关闭与焦点返回','passed':True})
    for route in ['today','meals','pantry','activities','family','recipe/noodles']:
        page.goto(URL+'index.html?text=large#'+route,wait_until='networkidle')
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),route
    results.append({'check':'手机大字模式核心页面无横向溢出','passed':True})
    page.set_viewport_size({'width':1280,'height':800})
    page.goto(URL+'index.html#display',wait_until='networkidle')
    page.screenshot(path=str(ROOT/'screenshots/display-1280.png'))
    assert page.locator('.display-bottom').bounding_box()['y']<800
    page.get_by_role('button',name='看大字菜谱',exact=True).click()
    page.screenshot(path=str(ROOT/'screenshots/tablet-recipe-1280.png'))
    results.append({'check':'1280×800平板操作与大字菜谱','passed':True})
    page.set_viewport_size({'width':1440,'height':900})
    page.goto(URL+'index.html#print',wait_until='networkidle')
    page.pdf(path=str(ROOT/'print-sample.pdf'),prefer_css_page_size=True,print_background=True)
    page.emulate_media(media='print')
    assert page.locator('#print-page-meta').count()==1
    page.screenshot(path=str(ROOT/'screenshots/print-media-1440-full.png'),full_page=True)
    page.emulate_media(media='screen')
    page.goto(URL+'review.html',wait_until='networkidle')
    page.locator('#pages [data-route=pantry]').click()
    page.locator('#device').select_option('mobile')
    frame=page.frame_locator('#prototype')
    expect(frame.locator('h1')).to_have_text('家里食材')
    page.locator('#scenario').select_option('login-expired')
    expect(frame.locator('#app')).to_contain_text('重新登录')
    page.locator('#scenario').select_option('normal')
    page.locator('#device').select_option('desktop')
    page.locator('#pages [data-route=today]').click()
    page.locator('#reset').click()
    page.wait_for_timeout(300)
    page.locator('aside').evaluate('(e)=>e.scrollTop=0')
    page.screenshot(path=str(ROOT/'screenshots/review-desktop.png'))
    results.append({'check':'评审入口设备切换、页面导航、状态预览和恢复初始示例','passed':True})
    page.set_viewport_size({'width':1600,'height':1100})
    page.goto(URL+'overview.html?summary',wait_until='networkidle')
    page.screenshot(path=str(ROOT/'screenshots/design-overview.png'),full_page=True)
    assert not errors,errors
    results.append({'check':'最终补充检查无脚本错误','passed':True})
    c.close();browser.close()
(ROOT/'final-review-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
for r in results:print('PASS '+r['check'])
