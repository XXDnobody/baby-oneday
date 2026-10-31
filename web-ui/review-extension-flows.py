"""Review the new local prototype journeys; no production-service claims."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'screenshots'/'v2'
URL='http://127.0.0.1:63460/web-ui/index.html'
checks=[]
def record(s):checks.append({'check':s,'passed':True});print('PASS '+s,flush=True)
def state(page):return page.evaluate('JSON.parse(JSON.stringify(state))')
def navigate(page,path):
    page.evaluate('(p)=>go(p)',path)
    page.wait_for_timeout(100)
def prompt(page):page.locator('[data-p-action=prompt-today]').click()
def wait_saved(page):page.wait_for_function('BabyPlanning.getProposal().status === "saved"')

with sync_playwright() as p:
    browser=p.chromium.launch();errors=[]
    def new_context(width=1440,height=900):
        c=browser.new_context(viewport={'width':width,'height':height})
        c.on('page',lambda t:t.on('pageerror',lambda e:errors.append(str(e))))
        return c
    c=new_context();page=c.new_page();page.goto(URL,wait_until='networkidle')
    before=state(page)
    page.locator('.toolbar [data-p-action=ai-open]').click()
    expect(page.locator('#assistant-dialog')).to_be_visible()
    prompt(page)
    assert state(page)==before
    page.locator('[data-p-action=assistant-tab][data-value=proposal]').click()
    page.screenshot(path=str(OUT/'assistant-drawer-1440.png'))
    page.locator('[data-p-action=assistant-tab][data-value=discussion]').click()
    page.locator('[data-p-action=prompt-dinner]').click()
    proposal=page.evaluate('BabyPlanning.getProposal()')
    assert len(proposal['changes'])==1 and proposal['changes'][0]['kind']=='meal'
    assert state(page)==before
    page.locator('[data-p-action=assistant-tab][data-value=proposal]').click()
    expect(page.locator('.old-proposals')).to_contain_text('已被替换')
    page.locator('[data-p-action=proposal-save]').dblclick()
    wait_saved(page)
    after=state(page)
    assert after['revision']==before['revision']+1
    assert after['meals']['dinner']=='rice' and after['activity']==before['activity']
    assert after['pantry']==before['pantry'] and after['records']==before['records']
    assert len(after['appliedProposals'])==1
    record('AI讨论与旧预览不改正式数据，只保存最终方案且重复点击只执行一次')
    page.screenshot(path=str(OUT/'assistant-saved-1440.png'))
    page.locator('[data-p-action=ai-close]').click()
    navigate(page,'activities')
    page.locator('[data-p-action=new-record][data-linked=true]').click()
    expect(page.locator('[name=title]')).to_have_value('找一找秋天的颜色')
    page.locator('[name=note]').fill('原型验证：留下一句观察，不填写参与和兴趣。')
    page.locator('#record-editor button[type=submit]').click()
    expect(page.locator('.record-detail')).to_be_visible()
    entry=state(page)['records'][-1];entry_id=entry['id']
    assert entry['participation'] is None and entry['interest'] is None
    assert entry['original']['mode']=='outdoor'
    assert entry['date']=='2026-10-28' and entry['createdAt']
    record('活动记录自动关联本次安排，单独写感想可保存且不推断完成或兴趣')
    navigate(page,'activities')
    page.locator('[data-p-action=new-record][data-linked=true]').click()
    page.locator('[name=participation][value="玩了一会儿"]').check()
    page.locator('#record-editor button[type=submit]').click()
    assert len(state(page)['records'])==len(before['records'])+2
    assert state(page)['records'][-1]['id']!=entry_id
    record('同一活动每次记录独立保存，参与情况可单独填写')
    navigate(page,'activities');page.locator('[data-action=choose-indoor]').last.click();page.locator('[data-action=apply-activity]').click()
    navigate(page,'record/'+entry_id)
    expect(page.locator('.original-plan')).to_contain_text('找一找秋天的颜色')
    assert next(r for r in state(page)['records'] if r['id']==entry_id)['original']==entry['original']
    record('后续替换活动保留已存记录及其当时版本')
    navigate(page,'calendar/2026-10-25')
    expect(page.locator('.day-tabs [data-value=records]')).to_have_attribute('aria-pressed','true')
    expect(page.locator('.record-tile')).to_contain_text('把积木送回家')
    page.locator('.past-plan summary').click()
    expect(page.locator('.past-plan .calendar-agenda')).to_be_visible()
    page.locator('[data-p-action=new-record]').last.click()
    page.locator('[name=title]').fill('补记一次临时外出')
    page.locator('#record-editor button[type=submit]').click()
    expect(page.locator('#record-error')).to_contain_text('填一项')
    page.locator('[name=note]').fill('原型验证：补记过去的独立事件。')
    page.locator('#record-editor button[type=submit]').click()
    r=state(page)['records'][-1]
    assert r['date']=='2026-10-25' and r['original'] is None
    record('过去日期优先显示记录，可展开当时安排；独立事件能补记且保留发生日')
    c.close()

    c=new_context();page=c.new_page();page.goto(URL+'#assistant',wait_until='networkidle')
    page.locator('[data-p-action=prompt-week]').click()
    page.locator('[data-p-action=prompt-exclude]').click()
    proposal=page.evaluate('BabyPlanning.getProposal()')
    assert proposal['dates'] and '2026-10-28' not in proposal['dates']
    assert all(c['date']>='2026-10-29' for c in proposal['changes'])
    assert not state(page)['appliedProposals']
    page.locator('[data-p-action=proposal-save]').click();wait_saved(page)
    assert state(page)['meals']['dinner']=='noodles'
    assert state(page)['dayPlans']['2026-10-29']['meals']['dinner']=='rice'
    record('本周方案按日预览，排除周三后只保存选中未来日期')
    c.close()

    for scenario in ['conflict','save-fail']:
        c=new_context();page=c.new_page();page.goto(URL+'?scenario='+scenario+'#assistant',wait_until='networkidle');prompt(page)
        before=state(page);page.locator('[data-p-action=proposal-save]').click()
        page.wait_for_function('BabyPlanning.getProposal().status === "'+('conflict' if scenario=='conflict' else 'failed')+'"')
        if scenario=='conflict':
            expect(page.locator('.proposal-alert')).to_contain_text('17:30')
            assert state(page)['meals']['dinner']=='noodles'
            page.screenshot(path=str(OUT/'ai-conflict-1440.png'))
            page.locator('[data-p-action=proposal-rebase]').click()
        else:
            assert state(page)==before
            expect(page.locator('.proposal-alert')).to_contain_text('没有保存成功')
        page.locator('[data-p-action=proposal-save]').click();wait_saved(page)
        if scenario=='conflict':assert next(x for x in state(page)['schedule'] if x['id']=='dinner')['time']=='17:30'
        assert len(state(page)['appliedProposals'])==1
        record('AI '+('并发冲突先核对最新版本，不覆盖其他时间调整' if scenario=='conflict' else '保存失败保留方案，重试不重复执行'))
        c.close()

    c=new_context(375,812);page=c.new_page();page.goto(URL+'?scenario=photo-fail#record/new',wait_until='networkidle')
    page.locator('[name=title]').fill('照片记录示例')
    page.locator('#record-photos').set_input_files(str(ROOT/'assets/record-example.png'))
    expect(page.locator('.photo-failed')).to_contain_text('保存失败')
    page.screenshot(path=str(OUT/'photo-retry-375.png'),full_page=True)
    page.locator('#record-editor button[type=submit]').click()
    expect(page.locator('.record-detail')).to_be_visible()
    r=state(page)['records'][-1];count=len(state(page)['records']);photo_id=r['photos'][0]['id']
    assert r['participation'] is None and r['interest'] is None and not r['note']
    page.locator('[data-p-action=retry-photo]').click()
    expect(page.locator('.photo-item')).to_contain_text('本机预览已就绪')
    assert len(state(page)['records'])==count and state(page)['records'][-1]['photos'][0]['id']==photo_id
    record('手机仅照片也能记录；失败照片单独重试，保留原记录且不推断完成')
    photo_record=state(page)['records'][-1];saved_schedule=state(page)['schedule']
    page.locator('[data-p-action=edit-record]').click()
    page.locator('[name=note]').fill('原型验证：之后补充的一句话。')
    page.locator('#record-editor button[type=submit]').click()
    assert state(page)['records'][-1]['id']==photo_record['id'] and len(state(page)['records'])==count
    assert len(state(page)['records'][-1]['photos'])==1
    page.locator('[data-p-action=delete-record]').click()
    page.get_by_role('button',name='保留记录',exact=True).click()
    assert len(state(page)['records'])==count
    page.locator('[data-p-action=delete-record]').click()
    page.locator('[data-p-action=confirm-delete-record]').click()
    assert len(state(page)['records'])==count-1 and state(page)['schedule']==saved_schedule
    record('记录可以更正或单独删除，取消删除保留内容，不改当天安排')
    page.locator('[data-p-action=calendar-mode][data-value=week]').click()
    page.locator('[data-p-action=month-next]').click()
    assert page.evaluate('BabyPlanning.getSelectedDate()')=='2026-11-04'
    assert page.locator('.calendar-cell').count()==7
    record('周视图按周前进，与选中日和月份保持一致')
    navigate(page,'assistant');prompt(page)
    assert page.locator('#assistant-dialog').is_visible() is False
    page.locator('[data-p-action=assistant-tab][data-value=proposal]').click()
    expect(page.locator('[data-p-action=proposal-save]')).to_be_visible()
    record('手机使用完整助手页，方案确认按钮可直接找到')
    assert not errors,errors
    record('新增主要流程无脚本错误')
    c.close();browser.close()
(ROOT/'extension-flow-report.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
