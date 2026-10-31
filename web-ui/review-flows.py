"""Exercise the authorized local prototype flows and save review evidence."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'screenshots'
URL='http://127.0.0.1:63460/web-ui/index.html'
checks=[]
def record(name):
    checks.append({'check':name,'passed':True})
    print('PASS '+name,flush=True)
def state(page):
    return page.evaluate('() => JSON.parse(JSON.stringify(state))')
def route(page,r):
    page.evaluate('(r) => location.hash=r',r)
    page.wait_for_function('(r) => currentRoute()===r && document.title.length>0',arg=r)
    page.wait_for_timeout(100)
def replace(page,choice='rice',scope='once'):
    page.locator('[data-action=replace][data-slot=dinner]').click()
    page.locator('#replace-form [name=recipe][value='+choice+']').check()
    page.locator('#replace-form [name=scope][value='+scope+']').check()
    page.locator('#replace-form button[type=submit]').click()

with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':1440,'height':900})
    page=context.new_page()
    errors=[]
    context.on('page',lambda tab:tab.on('pageerror',lambda e:errors.append(str(e))))
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL+'#pantry',wait_until='networkidle')
    before=state(page)
    page.locator('[name=priority-broccoli]').check()
    page.locator('#pantry-form button[type=submit]').click()
    expect(page.locator('#pantry-error')).to_contain_text('还没有标为家里有')
    assert state(page)==before
    page.locator('[name=present-broccoli]').check()
    page.locator('[name=amount-broccoli]').select_option('够一顿')
    page.locator('#pantry-form button[type=submit]').click()
    after=state(page)
    assert before['meals']==after['meals'] and before['schedule']==after['schedule']
    assert after['pantryAt']!=before['pantryAt']
    record('食材校验与确认只更新食材，不改餐食或日程')

    route(page,'meals')
    page.locator('[data-action=replace][data-slot=dinner]').click()
    page.locator('#replace-form [name=recipe][value=rice]').check()
    assert page.locator('#replace-form [name=recipe]').count()==1
    page.screenshot(path=str(OUT/'replace-drawer-1440.png'))
    page.get_by_role('button',name='保留原安排',exact=True).click()
    assert state(page)==after
    record('取消换餐不提交修改')

    display=context.new_page();display.goto(URL+'#display',wait_until='networkidle')
    printed=context.new_page();printed.goto(URL+'#print',wait_until='networkidle')
    print_before=printed.locator('#print-sheet').inner_text()
    replace(page,'rice','less-noodles')
    changed=state(page)
    assert changed['meals']['dinner']=='rice'
    assert changed['pantry']==after['pantry'] and changed['schedule']==after['schedule']
    assert {k:v for k,v in changed['meals'].items() if k!='dinner'}=={k:v for k,v in after['meals'].items() if k!='dinner'}
    display.wait_for_function('state.meals.dinner === "rice"')
    expect(printed.locator('.print-changed')).to_be_visible()
    assert printed.locator('#print-sheet').inner_text()==print_before
    printed.locator('[data-action=refresh-print]').first.click()
    expect(printed.locator('#print-sheet')).to_contain_text('番茄鸡蛋软饭')
    assert printed.locator('.print-changed').count()==0
    record('晚餐替换只改一餐；本机大屏联动；打印保留旧快照直到重新生成')

    replace(page,'noodles','once')
    assert state(page)['preference']=='less-noodles'
    record('单次换餐不会清除已有近期偏好')
    route(page,'activities')
    assert state(page)['feedback']=={'outdoor':None,'indoor':None}
    page.locator('summary').click()
    expect(page.locator('.guide-grid')).to_contain_text('活动目的')
    assert page.locator('.source-note a').get_attribute('href').startswith('https://www.unicef.org/')
    schedule=state(page)['schedule']
    page.locator('[data-action=choose-indoor]').last.click()
    page.locator('[data-action=apply-activity]').click()
    expect(display.locator('.display-details')).to_contain_text('把积木送回家')
    assert state(page)['feedback']['indoor'] is None
    assert [x for x in state(page)['schedule'] if x['id']!='play']==[x for x in schedule if x['id']!='play']
    page.locator('[data-action=feedback][data-value="喜欢"]').click()
    expect(page.locator('#feedback-status')).to_have_text('喜欢')
    page.locator('[data-action=feedback][data-value="喜欢"]').click()
    expect(page.locator('#feedback-status')).to_have_text('尚未反馈')
    record('活动解释可展开，换室内只改该活动，反馈可选且可取消')

    route(page,'meals')
    page.locator('[data-action=edit-time][data-id=dinner]').click()
    page.locator('#time-form [name=time]').fill('19:30')
    page.locator('#time-form button[type=submit]').click()
    expect(page.locator('#time-error')).to_contain_text('保持当天安排的先后顺序')
    page.locator('#time-form [name=time]').fill('17:10')
    page.locator('#time-form button[type=submit]').click()
    assert next(x for x in state(page)['schedule'] if x['id']=='dinner')['time']=='17:10'
    assert not any('完成' in x.get('status','') for x in state(page)['schedule'])
    record('时间调整校验先后顺序，不自动记录完成')

    route(page,'family')
    page.locator('[name=agreement][value=follow]').check()
    page.locator('#agreements-form button[type=submit]').click()
    expect(display.locator('.display-agreement')).to_contain_text('跟着兴趣，多一点回应')
    display.get_by_role('button',name='看大字菜谱',exact=True).click()
    expect(display.locator('.readonly-recipe')).to_be_visible()
    assert display.locator('[data-action=replace],[data-route=pantry],form').count()==0
    assert display.locator('.recipe-big').count()==1
    record('家庭提醒联动；大屏菜谱为只读大字布局')
    printed.locator('[data-action=refresh-print]').first.click()
    printed.pdf(path=str(ROOT/'print-sample.pdf'),format='A4',print_background=True,prefer_css_page_size=True)
    printed.emulate_media(media='print')
    printed.screenshot(path=str(OUT/'print-media-1440-full.png'),full_page=True)
    assert printed.locator('#print-sheet').is_visible()
    assert not printed.locator('.print-controls').is_visible()
    record('打印媒体只展示带日期与更新时间的纸张内容')

    conflict=context.new_page();conflict.goto(URL+'?scenario=conflict#meals',wait_until='networkidle')
    replace(conflict,'rice')
    expect(conflict.locator('#dialog-title')).to_have_text('保存前，有一项新改动')
    conflict.screenshot(path=str(OUT/'conflict-1440.png'))
    conflict.locator('[data-action=resolve-conflict]').click()
    expect(conflict.locator('#dialog-title')).to_have_text('只调整这一餐')
    conflict.locator('#replace-form [name=recipe][value=rice]').check()
    conflict.locator('#replace-form button[type=submit]').click()
    assert next(x for x in state(conflict)['schedule'] if x['id']=='dinner')['time']=='17:30'
    assert state(conflict)['meals']['dinner']=='rice'
    record('并发修改先显示最新内容，重新确认后保留对方的时间改动')

    offline=context.new_page();offline.goto(URL+'?scenario=offline#activities',wait_until='networkidle')
    offline_before=state(offline)
    offline.locator('[data-action=feedback][data-value="喜欢"]').click()
    expect(offline.locator('#toast')).to_contain_text('当前离线')
    assert state(offline)==offline_before
    offline.screenshot(path=str(OUT/'offline-1440.png'))
    revoked=context.new_page();revoked.goto(URL+'?scenario=revoked#display',wait_until='networkidle')
    assert revoked.locator('.display-main,.display-agreement').count()==0
    expect(revoked.locator('#app')).to_contain_text('重新授权')
    record('离线提交不改状态，授权撤销示例不展示家庭内容')
    assert not errors,errors
    record('核心交互无脚本错误')
    context.close();browser.close()
(ROOT/'flow-report.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
