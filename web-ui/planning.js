/* A-v2 extension. UI demonstration only; dates and historical entries are examples. */
(() => {
  'use strict';
  const TODAY = D.date;
  const PHOTO = 'assets/record-example.png';
  const DRAFT_KEY = KEY + '-assistant';
  const dayLabel = date => new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
  const shift = (date,n) => {const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const uid = () => crypto.randomUUID?.() || 'local-'+Date.now()+'-'+Math.random().toString(16).slice(2);
  const pBtn = (label,action,cls='',attrs='') => `<button type="button" class="btn ${cls}" data-p-action="${action}" ${attrs}>${label}</button>`;
  const pIcon = (name) => icon(name);
  const shortDate = date => date.slice(5).replace('-','月')+'日';
  const seedPlan = date => ({date,activity:'outdoor',meals:clone(initial.meals),schedule:clone(initial.schedule),version:1});
  const seedPlans = {};
  for(let n=-3;n<=5;n++){const date=shift(TODAY,n);seedPlans[date]=seedPlan(date);}
  seedPlans['2026-10-25'].activity='indoor';
  const exampleRecords = [
    {id:'demo-blocks',date:'2026-10-25',period:'下午',time:'',title:'把积木送回家',participation:'玩了一会儿',interest:'喜欢',note:'示例感想：先在旁边看了一会儿，再自己试着把积木放进篮子。下次准备少一点材料，留更多等待的时间。',author:'妈妈',createdAt:'2026-10-25 20:16（示例）',updatedAt:'2026-10-25 20:16（示例）',revision:1,isDemo:true,photos:[{id:'demo-photo',url:PHOTO,name:'积木场景示例.png',status:'ready',isDemo:true}],original:{date:'2026-10-25',id:'play',title:'把积木送回家',time:'15:30',mode:'indoor',version:1,steps:clone(D.activities.indoor.steps)}},
    {id:'demo-walk',date:'2026-10-27',period:'下午',time:'',title:'找一找秋天的颜色',participation:null,interest:null,note:'示例感想：今天没有按原来的顺序走，顺着感兴趣的方向多停留了一会儿。记录一下，下次再试。',author:'爸爸',createdAt:'2026-10-27 19:42（示例）',updatedAt:'2026-10-27 19:42（示例）',revision:1,isDemo:true,photos:[],original:{date:'2026-10-27',id:'play',title:'找一找秋天的颜色',time:'15:30',mode:'outdoor',version:1,steps:clone(D.activities.outdoor.steps)}}
  ];
  Object.assign(initial,{dayPlans:seedPlans,records:exampleRecords,appliedProposals:[],preferenceWindow:null});
  state={...clone(initial),...state};
  for(const key of ['dayPlans','records','appliedProposals','preferenceWindow'])if(state[key]===undefined)state[key]=clone(initial[key]);
  let selectedDate=TODAY,month=TODAY.slice(0,7),calendarMode='month',dayTab='plan';
  let editor=null,assistantTab='discussion',assistantOpener=null,proposalSaveFailed=false,proposalConflictInjected=false;
  const blankChat=()=>({scope:'today',date:TODAY,messages:[],proposal:null,previous:[],version:0,composer:''});
  let chat=blankChat();
  try{chat={...chat,...JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}')};}catch(e){}
  const saveChat=()=>{try{localStorage.setItem(DRAFT_KEY,JSON.stringify(chat));}catch(e){}};
  function planFor(date,s=state){
    if(date===TODAY)return {date,activity:s.activity,meals:s.meals,schedule:s.schedule,version:s.revision};
    return s.dayPlans?.[date]||null;
  }
  function recordsFor(date){return state.records.filter(r=>r.date===date).sort((a,b)=>(b.time||b.period).localeCompare(a.time||a.period));}
  function selectedPlanTitle(plan){return D.activities[plan?.activity||'outdoor'].name;}
  function activitySnapshot(date){const p=planFor(date);return p?{date,id:'play',title:selectedPlanTitle(p),time:p.schedule.find(x=>x.id==='play')?.time||'15:30',mode:p.activity,version:p.version,steps:clone(D.activities[p.activity].steps)}:null;}
  function applyDay(s,date,fn){
    if(date===TODAY){fn(s);return;}
    s.dayPlans[date]=clone(planFor(date,s)||seedPlan(date));fn(s.dayPlans[date]);s.dayPlans[date].version=(s.dayPlans[date].version||1)+1;
  }
  function persist(next,label){
    next.revision=state.revision+1;next.updatedAt=stamp();next.updatedBy='你';next.recent=[label,...state.recent].slice(0,5);
    try{localStorage.setItem(KEY,JSON.stringify(next));}catch(e){toast('本机空间不足，尚未保存。已填写内容保留在当前页面。');return false;}
    state=next;formDirty=false;return true;
  }
  function recordSummary(r){return [r.participation||'参与情况未填写',r.interest||'兴趣未填写',r.photos.length?'含照片':''].filter(Boolean).join('，');}
  function calendarCard(r){return `<button class="record-tile" data-p-action="view-record" data-id="${esc(r.id)}"><div class="record-tile-top"><span>${esc(r.time||r.period||'当天')}，${esc(r.author)}</span>${r.isDemo?'<span class="status-pill neutral">示例记录</span>':''}</div><h3>${esc(r.title)}</h3><p>${esc(r.note||recordSummary(r))}</p><div class="record-tile-foot"><span>${esc(r.participation||'参与未填写')}</span><span>${r.photos.length?pIcon('camera')+' '+r.photos.length+' 张照片':'文字记录'}</span>${pIcon('chevron')}</div></button>`;}
  function dayDetails(){
    const past=selectedDate<TODAY,future=selectedDate>TODAY,p=planFor(selectedDate),entries=recordsFor(selectedDate);
    const planItems=p?p.schedule.map(e=>({time:e.time,title:e.id==='play'?selectedPlanTitle(p):D.recipes[p.meals[e.id]]?.name||e.name,person:e.person,meta:e.id==='play'?D.activities[p.activity].scene+'，时长灵活':e.kind==='meal'?e.name:'家庭作息',activity:e.id==='play',meal:e.kind==='meal'})):[];
    const planMarkup=planItems.length?`<ol class="calendar-agenda">${planItems.map(x=>`<li><time>${x.time}</time><div><h3>${esc(x.title)}</h3><p>${esc(x.person)}，${esc(x.meta)}</p>${!future&&x.activity?pBtn('记一下','new-record','ghost',`data-date="${selectedDate}" data-linked="true"`):''}</div>${x.activity?pIcon('leaf'):pIcon(x.meal?'food':'day')}</li>`).join('')}</ol>`:'<div class="empty-state"><h3>这天还没有已保存安排</h3><p>可以与助手讨论，确认后再放入日历。</p></div>';
    return `<div class="selected-day-head"><div><span class="mini-label">${past?'回看这一天':future?'未来安排':'今天的安排与记录'}</span><h2>${dayLabel(selectedDate)}</h2></div><span class="status-pill ${past?'neutral':''}">${past?'过去':future?'未来':'今天'}</span></div><div class="day-tabs"><button data-p-action="day-tab" data-value="plan" aria-pressed="${dayTab==='plan'}">${past?'当时安排':'安排'} ${planItems.length}</button><button data-p-action="day-tab" data-value="records" aria-pressed="${dayTab==='records'}">记录 ${entries.length}</button></div>${dayTab==='plan'?planMarkup:`${entries.length?entries.map(calendarCard).join(''):'<div class="empty-state"><h3>这天暂无记录</h3><p>有想留下的时刻再记，不需要逐项打卡。</p></div>'}${past&&p?`<details class="past-plan"><summary>查看这天当时的安排</summary>${planMarkup}</details>`:''}`}<div class="calendar-day-actions">${future?pBtn(pIcon('message')+' 讨论这天的安排','ai-day','primary',`data-date="${selectedDate}"`):pBtn(pIcon('plus')+' '+(past?'补记这一天':'记一件事'),'new-record','primary',`data-date="${selectedDate}"`)}${!future?pBtn('与 AI 讨论','ai-day','',`data-date="${selectedDate}"`):''}</div><p class="caption-meta">仅展示已保存内容。过去的记录保留各自当时的安排。</p>`;
  }
  function calendarView(){
    const [year,mo]=month.split('-').map(Number),first=month+'-01',offset=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7,start=shift(first,-offset);
    let dates=Array.from({length:35},(_,n)=>shift(start,n));
    const daysInMonth=new Date(Date.UTC(year,mo,0)).getUTCDate();if(offset+daysInMonth>35)dates=Array.from({length:42},(_,n)=>shift(start,n));
    if(calendarMode==='week'){const offsetDay=(new Date(selectedDate+'T12:00:00Z').getUTCDay()+6)%7;dates=Array.from({length:7},(_,n)=>shift(selectedDate,n-offsetDay));}
    const cells=dates.map(date=>{const entries=recordsFor(date),p=planFor(date),photo=entries.some(x=>x.photos.length),day=Number(date.slice(8));return `<button class="calendar-cell ${date===selectedDate?'selected':''} ${date===TODAY?'is-today':''} ${date.slice(0,7)!==month?'outside':''}" data-p-action="select-day" data-date="${date}" aria-pressed="${date===selectedDate}" aria-label="${dayLabel(date)}${p?'，有安排':''}，${entries.length}条记录${photo?'，有照片':''}"><span class="day-number">${day}${date===TODAY?'<em>今天</em>':''}</span><span class="cell-marks">${p?'<span class="plan-mark"><i></i><b class="desktop-label">有安排</b><b class="mobile-label">计划</b></span>':''}${entries.length?`<span class="record-mark">${pIcon('note')}<b>${entries.length}<span class="desktop-label"> 条记录</span></b>${photo?pIcon('camera'):''}</span>`:''}</span></button>`;}).join('');
    return header('日历','未来看安排，今天记一下，过去慢慢回看。',pBtn(pIcon('plus')+' 补记一件事','new-record','','data-date="'+TODAY+'"'))+`<div class="calendar-layout"><section class="panel month-panel"><div class="month-toolbar"><div class="month-nav"><button class="icon-button" data-p-action="month-prev" aria-label="${calendarMode==='week'?'上一周':'上个月'}">${pIcon('left')}</button><h2>${year} 年 ${mo} 月</h2><button class="icon-button" data-p-action="month-next" aria-label="${calendarMode==='week'?'下一周':'下个月'}">${pIcon('chevron')}</button></div><div class="inline-actions">${pBtn('今天','calendar-today','ghost')}<div class="segmented"><button data-p-action="calendar-mode" data-value="month" aria-pressed="${calendarMode==='month'}">月</button><button data-p-action="calendar-mode" data-value="week" aria-pressed="${calendarMode==='week'}">周</button></div></div></div><div class="week-labels">${['一','二','三','四','五','六','日'].map(x=>`<span>${x}</span>`).join('')}</div><div class="month-grid ${calendarMode==='week'?'week-mode':''}">${cells}</div><div class="calendar-legend"><span><i></i>已保存安排</span><span>${pIcon('note')}实际记录</span><span>${pIcon('camera')}含照片</span></div><div class="calendar-hint">${pIcon('message')}<p>想一起调整一周？先与 AI 讨论，核对改动后再保存。</p>${pBtn('讨论本周','ai-week','ghost')}</div></section><aside class="panel day-panel">${dayDetails()}</aside></div>`;
  }
  function newRecord(date=TODAY,linked=false){
    date=date>TODAY?TODAY:date;
    editor={id:null,date,period:'下午',time:'',title:linked?activitySnapshot(date)?.title||'': '',participation:null,interest:null,note:'',photos:[],original:linked?activitySnapshot(date):null};
    go('record/new');
  }
  function choiceGroup(name,label,values,value){return `<fieldset class="record-options"><legend>${label}<span>选填</span></legend><div>${values.map(v=>`<label><input type="radio" name="${name}" value="${v}" ${value===v?'checked':''}><span>${v}</span></label>`).join('')}</div>${pBtn('清空选择','clear-record-choice','ghost',`data-field="${name}"`)}</fieldset>`;}
  function photoItems(photos,editing=true){return photos.length?`<div class="photo-grid">${photos.map(p=>`<figure class="photo-item"><img src="${esc(p.url)}" alt="${p.isDemo?'示例积木场景，非家庭真实照片':esc(p.name)}"><figcaption><span>${esc(p.name)}</span><b class="${p.status==='failed'?'photo-failed':''}">${p.status==='ready'?'本机预览已就绪':p.status==='processing'?'正在处理':'保存失败（演示）'}</b></figcaption><div class="photo-actions">${p.status==='failed'?pBtn('重试','retry-photo','',`data-id="${p.id}"`):''}${editing?pBtn('移除','remove-photo','ghost',`data-id="${p.id}"`):''}</div></figure>`).join('')}</div>`:'<div class="photo-empty">'+pIcon('camera')+'<p>有照片就留一张，只写文字也可以。</p></div>';}
  function editorView(){
    if(!editor)editor={id:null,date:selectedDate>TODAY?TODAY:selectedDate,period:'下午',time:'',title:'',participation:null,interest:null,note:'',photos:[],original:null};
    return header(editor.id?'编辑这条记录':'记一下','留下一点感想，或一张照片。', '',{title:'日历',route:'calendar/'+editor.date})+`<form id="record-editor" class="record-editor"><section class="panel record-form-panel"><div class="record-section"><h2>是什么时候的事</h2><div class="date-fields"><label class="field"><span>发生日期</span><input name="date" type="date" value="${editor.date}" max="${TODAY}" required></label><label class="field"><span>大概时段</span><select name="period">${['当天','上午','下午','晚上','具体时刻'].map(x=>`<option ${editor.period===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="field exact-time" ${editor.period==='具体时刻'?'':'hidden'}><span>具体时刻</span><input type="time" name="time" value="${editor.time}"></label></div><label class="field"><span>这件事的名称</span><input name="title" value="${esc(editor.title)}" maxlength="80" placeholder="比如：下午去公园，或第一次自己收积木" required></label></div><div class="record-section">${choiceGroup('participation','实际参与情况',['参与了','玩了一会儿','未开展'],editor.participation)}${choiceGroup('interest','宝宝的反应',['喜欢','没兴趣','太难'],editor.interest)}</div><div class="record-section"><label class="field"><span>想留给以后的话 <small>选填</small></span><textarea name="note" rows="4" maxlength="4000" placeholder="记一下你看到的、当时的感受，或下次想试的办法。">${esc(editor.note)}</textarea></label></div><div class="record-section"><div class="panel-header"><div><h2>照片</h2><p>选填，只为家庭留存</p></div><div class="inline-actions"><label class="btn photo-input">${pIcon('camera')}选照片<input id="record-photos" type="file" accept="image/*" multiple></label><label class="btn photo-input camera-only">拍一张<input id="record-camera" type="file" accept="image/*" capture="environment"></label></div></div><div id="photo-list">${photoItems(editor.photos)}</div><p class="caption-meta">本机原型预览；演示限制为每次3张、每张5MB。</p></div><p id="record-error" class="form-error" role="alert"></p><div class="record-savebar"><p>参与、反应、感想、照片，填一项就能保存。</p><div>${pBtn('取消','cancel-record')}<button type="submit" class="btn primary">保存这条记录</button></div></div></section><aside class="record-context"><section class="panel"><span class="mini-label">关联安排</span>${editor.original?`<h2>${esc(editor.original.title)}</h2><p class="muted-line">${dayLabel(editor.original.date)} ${editor.original.time}</p><p class="context-explanation">保存这次活动当时的安排。以后换了活动，记录仍然留在这里。</p>${pBtn('改为独立记录','unlink-record','ghost')}`:`<h2>单独记下这件事</h2><p class="context-explanation">临时外出、随手的发现，没提前安排也可以记录。</p>`}</section><p class="record-soft-note">填写时间会自动保存。补记过去的事，仍按你选的发生日期归档。</p></aside></form>`;
  }
  function recordView(id){
    const r=state.records.find(x=>x.id===id);if(!r)return header('这条记录暂时找不到','可以回日历重新选择。');
    return header(r.title,`${dayLabel(r.date)}，${r.time||r.period}，${r.author}记录`,pBtn('编辑记录','edit-record','',`data-id="${esc(r.id)}"`),{title:'日历',route:'calendar/'+r.date})+`<div class="record-detail-layout"><article class="panel record-detail"><div class="record-detail-meta"><span class="status-pill neutral">${esc(r.participation||'参与情况未填写')}</span><span class="status-pill neutral">${esc(r.interest||'兴趣未填写')}</span>${r.isDemo?'<span class="status-pill pending">演示内容</span>':''}</div>${r.isDemo?'<p class="demo-content-note">以下文字与玩具场景图用于演示，非家庭真实经历或照片。</p>':''}<h2>当时想留下的话</h2>${r.note?`<p class="parent-words">${esc(r.note)}</p>`:'<p class="muted-line">这次没有填写感想。</p>'}<section class="record-photo-section"><h2>${r.photos.length?'留下的照片':'这次没有添加照片'}</h2>${r.photos.length?photoItems(r.photos,false):'<p class="muted-line">也可以之后补上。</p>'}</section><footer class="record-stamps">填写时间：${esc(r.createdAt)}<br>最后更新：${esc(r.updatedAt)}<br>发生时间按这条记录的日期与时段保存。</footer><div class="record-delete">${pBtn('删除这条记录','delete-record','ghost',`data-id="${esc(r.id)}"`)}</div></article><aside><section class="panel original-plan"><span class="mini-label">记录与安排分别保留</span><h2>${r.original?'这次关联的原安排':'独立记录'}</h2>${r.original?`<p class="muted-line">${dayLabel(r.original.date)} ${r.original.time}</p><h3>${esc(r.original.title)}</h3><span class="status-pill neutral">当时版本 ${r.original.version}</span><details class="past-plan"><summary>展开当时的玩法</summary>${stepsMarkup({steps:r.original.steps})}</details><p class="context-explanation">之后的计划调整不会覆盖这份记录。</p>`:'<p class="context-explanation">这件事没有关联提前安排的活动。</p>'}</section><div class="section-gap">${pBtn('再记一次同类活动','record-again','',`data-id="${esc(r.id)}"`)}</div></aside></div>`;
  }

  function scopeLabel(){return chat.scope==='week'?'本周，10月26日—11月1日':dayLabel(chat.date);}
  function rangeDates(){
    if(chat.scope!=='week')return chat.date>=TODAY?[chat.date]:[];
    return Array.from({length:7},(_,n)=>shift('2026-10-26',n)).filter(d=>d>=TODAY);
  }
  function supersede(){if(chat.proposal){chat.previous.unshift({...clone(chat.proposal),status:'superseded'});chat.previous=chat.previous.slice(0,3);}}
  function makeProposal(text){
    const old=chat.intent||{indoor:false,outdoor:false,dinner:false,preference:false,excludeWednesday:false};
    const intent={...old};
    if(/室内/.test(text)){intent.indoor=true;intent.outdoor=false;}
    if(/户外/.test(text)){intent.outdoor=true;intent.indoor=false;}
    if(/晚餐|晚饭|换.*饭|软饭/.test(text))intent.dinner=true;
    if(/少.*面|减少.*面|不吃面/.test(text))intent.preference=true;
    if(/只.*晚餐|只.*晚饭/.test(text)){intent.dinner=true;intent.indoor=false;intent.outdoor=false;intent.preference=false;}
    if(/周三.*不动|周三.*原样/.test(text))intent.excludeWednesday=true;
    if(/不要.*偏好|不改.*偏好/.test(text))intent.preference=false;
    chat.intent=intent;supersede();chat.version++;
    const dates=rangeDates().filter(d=>!intent.excludeWednesday||d!=='2026-10-28'),changes=[];
    dates.forEach(date=>{
      const p=planFor(date)||seedPlan(date),mode=intent.indoor?'indoor':intent.outdoor?'outdoor':null;
      if(mode&&p.activity!==mode)changes.push({id:date+'-activity',kind:'activity',date,before:p.activity,after:mode,selected:true});
      if(intent.dinner&&p.meals.dinner!=='rice')changes.push({id:date+'-meal',kind:'meal',date,before:p.meals.dinner,after:'rice',selected:true});
    });
    if(intent.preference&&dates.length)changes.push({id:'preference',kind:'preference',date:dates[0],before:state.preferenceWindow?shortDate(state.preferenceWindow.start)+'—'+shortDate(state.preferenceWindow.end):'未设置有期限的偏好',after:{start:dates[0],end:'2026-11-01'},selected:true});
    chat.proposal={id:uid(),version:chat.version,status:'pending',baseRevision:state.revision,dates,changes,title:chat.scope==='week'?'这一周，按家里的节奏来':'今天的几处小调整',createdAt:stamp()};
    saveChat();
  }
  function sendMessage(text,explicitScope){
    text=String(text||'').trim();if(!text)return;
    const oldScope=chat.scope,oldDate=chat.date;
    if(explicitScope){chat.scope=explicitScope;chat.date=TODAY;}
    else if(/今天/.test(text)){chat.scope='today';chat.date=TODAY;}
    else if(/明天/.test(text)){chat.scope='date';chat.date=shift(TODAY,1);}
    else if(/本周|这周|一周/.test(text))chat.scope='week';
    if(explicitScope||oldScope!==chat.scope||oldDate!==chat.date){supersede();chat.proposal=null;chat.intent=null;}
    chat.messages.push({role:'user',text});chat.composer='';
    if(scenario==='ai'){chat.messages.push({role:'assistant',text:'助手暂时不可用，消息仍保留在这次讨论中。已有安排可以继续查看和手动调整。'});saveChat();refreshAssistant();return;}
    if(/下周|过几天|以后/.test(text)){
      chat.messages.push({role:'assistant',text:'先明确这次要调整的日期。可以选择今天、本周，或从日历选一天后继续。当前安排还没有改动。'});supersede();chat.proposal=null;
    }else if(/为什么|现在.*什么|查询|看看食材/.test(text)&&!/调整|改成|换/.test(text)){
      chat.messages.push({role:'assistant',text:'当前计划是'+(nowAndNext().now?.name||'自由安排')+'，晚餐为'+(recipeFor('dinner')?.name||'待安排')+'。家里南瓜已标记优先吃。这条回复没有提出需要保存的改动。'});
    }else{
      makeProposal(text);
      const n=chat.proposal.changes.length;
      chat.messages.push({role:'assistant',text:n?`我把这次讨论整理为 ${n} 项待确认改动。可以先看新旧对照，再继续缩小范围；点“确认并保存”后，才会进入正式安排。`:'当前安排已经符合这次选择，没有需要重复保存的改动。也可以继续告诉我想调整什么。'});
    }
    saveChat();refreshAssistant();
  }
  function diffLabel(c,after){
    if(c.kind==='activity')return D.activities[after?c.after:c.before]?.name||'未安排';
    if(c.kind==='meal')return D.recipes[after?c.after:c.before]?.name||'未安排';
    return after?'少安排面食，'+shortDate(c.after.start)+'—'+shortDate(c.after.end):c.before;
  }
  function proposalMarkup(){
    const p=chat.proposal;
    if(!p)return `<div class="proposal-empty">${pIcon('note')}<h2>先聊聊，再一起核对</h2><p>涉及安排、菜单或偏好的改动，会在这里逐项列出。</p><div class="proposal-steps"><span>讨论需求</span><span>预览改动</span><span>一次确认</span></div></div>`;
    const selected=p.changes.filter(c=>c.selected),saved=p.status==='saved',conflict=p.status==='conflict',failed=p.status==='failed',busy=p.status==='saving';
    return `<section class="proposal-card"><div class="proposal-scroll"><div class="proposal-head"><div><span class="mini-label">最终预览，版本 ${p.version}</span><h2>${esc(p.title)}</h2></div><span class="status-pill ${saved?'':conflict||failed?'pending':'neutral'}">${saved?'本机已保存':conflict?'需要重新核对':failed?'尚未保存':busy?'正在保存':'待你确认'}</span></div><p class="proposal-scope">${esc(scopeLabel())}${p.dates.length>1?'，仅调整今天及未来日期':''}</p>${chat.intent?.excludeWednesday?'<p class="kept-note">周三保持原样，已从本次改动中移除。</p>':''}${conflict?`<div class="proposal-alert"><h3>基础内容有新改动</h3><p>当前最新晚餐时间为 ${item('dinner').time}。请基于当前内容重新核对，这份预览尚未保存。</p>${pBtn('基于最新安排重新预览','proposal-rebase','soft')}</div>`:''}${failed?'<div class="proposal-alert"><h3>这次没有保存成功</h3><p>方案和讨论都已保留，可以直接重试。</p></div>':''}<div class="change-list">${p.changes.map(c=>`<label class="change-row ${!c.selected?'excluded':''}"><input type="checkbox" data-change="${c.id}" ${c.selected?'checked':''} ${saved||busy||conflict?'disabled':''}><div><div class="change-row-meta"><span>${c.kind==='activity'?'活动':c.kind==='meal'?'晚餐':'近期偏好'}</span><span>${shortDate(c.date)}</span></div><p class="change-before"><span>原来</span>${esc(diffLabel(c,false))}</p><p class="change-after"><span>改为</span>${esc(diffLabel(c,true))}</p></div></label>`).join('')||'<div class="empty-state">当前选择没有需要改动的内容。</div>'}</div><div class="proposal-impact"><strong>本次直接影响</strong><p>${selected.some(c=>c.kind==='meal')?'所选日期的晚餐菜谱和采购核对。':'所选日期的活动内容。'}${selected.some(c=>c.kind==='preference')?'近期偏好会按显示的期限保存。':''}</p><p>已有记录与照片继续保留，现有食材不会自动扣减。</p></div>${chat.previous.length?`<details class="old-proposals"><summary>之前的 ${chat.previous.length} 版预览已被替换</summary>${chat.previous.map(x=>`<p>版本 ${x.version}，已替换，不能保存</p>`).join('')}</details>`:''}</div><div class="proposal-save">${saved?`<div class="save-result">${pIcon('check')}<div><strong>整组改动已保存到本机演示</strong><p>${esc(p.savedAt)}</p></div></div><div class="inline-actions">${pBtn('查看日历','saved-calendar','primary')}${routeButton('查看今日菜单','meals')}</div>`:`<div class="proposal-save-count"><strong>${selected.length} 项改动，一次保存</strong><span>只保存当前版本 ${p.version}</span></div><div class="inline-actions">${pBtn('继续调整','continue-chat')}${pBtn(busy?'正在保存…':failed?'重试保存':'确认并保存','proposal-save','primary',`${!selected.length||busy||conflict||scenario==='ai'?'disabled':''}`)}</div>`}</div></section>`;
  }
  function discussionMarkup(){return `<section class="assistant-discussion"><div class="assistant-explainer">${pIcon('info')}<p>这是交互演示。回复与保存均在本机原型中完成。</p></div><div class="conversation" id="conversation">${chat.messages.length?chat.messages.map(m=>`<article class="chat-message ${m.role}"><span>${m.role==='user'?'你':m.role==='system'?'讨论范围':'AI 助手'}</span><p>${esc(m.text)}</p></article>`).join(''):`<div class="assistant-welcome"><span class="assistant-glyph">${pIcon('message')}</span><h2>今天想怎么安排？</h2><p>把想法说出来，一起整理成可核对的方案。</p><button data-p-action="prompt-today">下午改室内，晚餐换成饭</button><button data-p-action="prompt-week">这周户外为主，晚饭少排面</button><button data-p-action="prompt-query">看看现在的安排和食材</button></div>`}</div>${chat.proposal&&!['saved','saving'].includes(chat.proposal.status)?`<div class="followup-prompts">${pBtn('只调整晚餐','prompt-dinner','ghost')}${chat.scope==='week'?pBtn('周三保持原样','prompt-exclude','ghost'):''}</div>`:''}<form id="assistant-composer" class="assistant-composer"><label class="sr-only" for="assistant-message">继续讨论安排</label><textarea id="assistant-message" name="message" rows="2" maxlength="2000" placeholder="说说想调整什么，也可以继续修改方案…">${esc(chat.composer||'')}</textarea><div><span>确认前，正式安排保持当前版本。</span><button type="submit" class="btn primary">${pIcon('up')}<span>发送</span></button></div></form></section>`;}
  function assistantContents(panel=false){return `<div class="assistant-context-bar"><span>宝宝 17 个月</span><label><span class="sr-only">讨论日期范围</span><select id="assistant-scope"><option value="today" ${chat.scope==='today'?'selected':''}>今天，10月28日</option><option value="week" ${chat.scope==='week'?'selected':''}>本周，10月26日—11月1日</option><option value="date" ${chat.scope==='date'?'selected':''}>所选日，${shortDate(chat.date)}</option></select></label></div><div class="assistant-mobile-tabs"><button data-p-action="assistant-tab" data-value="discussion" aria-pressed="${assistantTab==='discussion'}">讨论</button><button data-p-action="assistant-tab" data-value="proposal" aria-pressed="${assistantTab==='proposal'}">${chat.proposal?.status==='saved'?'保存结果':'方案预览'}${chat.proposal?'，'+chat.proposal.changes.filter(x=>x.selected).length:''}</button></div><div class="assistant-layout ${panel?'in-panel':''} show-${assistantTab}">${discussionMarkup()}<div class="assistant-proposal">${proposalMarkup()}</div></div>`;}
  function assistantView(){return baseHeader('AI 助手','先把想法聊清楚，预览改动后再一起保存。')+assistantContents();}
  function refreshAssistant(){
    const d=$('#assistant-dialog');if(d.open)$('#assistant-body').innerHTML=assistantContents(true);else if(currentRoute()==='assistant')render();
    const log=$('#conversation');if(log)log.scrollTop=log.scrollHeight;
  }
  function openAssistant(date,scope){
    if(date&&(chat.date!==date||scope&&chat.scope!==scope)){
      supersede();chat.proposal=null;chat.intent=null;chat.date=date;chat.scope=scope||'date';chat.messages.push({role:'system',text:'当前讨论范围切换为 '+(scope==='week'?'本周':dayLabel(date))+'，需要重新核对方案。'});saveChat();
    }
    if(innerWidth<=900){go('assistant');return;}
    assistantOpener=document.activeElement;$('#assistant-body').innerHTML=assistantContents(true);$('#assistant-dialog').showModal();
  }
  async function saveProposal(){
    const p=chat.proposal;if(!p||p.status==='saved'||p.status==='saving'||p.status==='conflict'||!p.changes.some(x=>x.selected))return;
    if(scenario==='offline'){toast('当前离线，方案还没有提交。');return;}
    if(scenario==='ai'){toast('助手暂时不可用，方案已保留。');return;}
    let latest=readState();
    if(scenario==='conflict'&&!proposalConflictInjected){proposalConflictInjected=true;latest=clone(state);latest.schedule.find(x=>x.id==='dinner').time='17:30';latest.revision++;latest.updatedAt=stamp();latest.updatedBy='妈妈';localStorage.setItem(KEY,JSON.stringify(latest));}
    if(latest.appliedProposals?.includes(p.id)){state=latest;p.status='saved';p.savedAt=latest.updatedAt;saveChat();refreshAssistant();return;}
    if(latest.revision!==p.baseRevision){state=latest;p.status='conflict';saveChat();refreshAssistant();return;}
    p.status='saving';refreshAssistant();await new Promise(resolve=>setTimeout(resolve,250));
    if(scenario==='save-fail'&&!proposalSaveFailed){proposalSaveFailed=true;p.status='failed';saveChat();refreshAssistant();return;}
    latest=readState();if(latest.revision!==p.baseRevision){state=latest;p.status='conflict';saveChat();refreshAssistant();return;}
    const next=clone(latest);
    for(const c of p.changes.filter(x=>x.selected)){
      if(c.kind==='activity')applyDay(next,c.date,x=>{x.activity=c.after;x.schedule.find(y=>y.id==='play').name=c.after==='indoor'?'室内积木':'户外探索';});
      if(c.kind==='meal')applyDay(next,c.date,x=>x.meals.dinner=c.after);
      if(c.kind==='preference'){next.preference='less-noodles';next.preferenceWindow={...c.after,value:'less-noodles'};}
    }
    next.appliedProposals=[...(next.appliedProposals||[]),p.id];
    if(persist(next,'确认了 AI 方案中的 '+p.changes.filter(x=>x.selected).length+' 项改动')){p.status='saved';p.savedAt=state.updatedAt;}
    else p.status='failed';saveChat();render();refreshAssistant();
  }
  function captureEditor(){
    const f=$('#record-editor');if(!f||!editor)return;
    const data=new FormData(f);for(const k of ['date','period','time','title','note'])editor[k]=String(data.get(k)||'');
    editor.participation=data.get('participation')||null;editor.interest=data.get('interest')||null;
  }
  function photoListRefresh(){const target=$('#photo-list');if(target)target.innerHTML=photoItems(editor.photos);}
  async function readPhotos(files){
    captureEditor();
    for(const file of [...files]){
      if(editor.photos.length>=3){toast('本轮演示最多选择3张照片。');break;}
      if(!file.type.startsWith('image/')||file.size>5*1024*1024){toast('请选择5MB以内的图片，文字内容已保留。');continue;}
      const id=uid();
      try{
        const raw=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
        const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=raw;});
        const scale=Math.min(1,1000/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        editor.photos.push({id,name:file.name,url:canvas.toDataURL('image/jpeg',.82),status:scenario==='photo-fail'?'failed':'ready'});photoListRefresh();
      }catch(e){toast('这张照片暂时无法预览，已填写内容仍保留。');}
    }
  }
  function saveRecord(){
    captureEditor();const error=$('#record-error');
    if(!editor.title.trim()){error.textContent='给这件事起个名字，方便之后找回。';return;}
    if(!editor.date||editor.date>TODAY){error.textContent='实际记录请选择今天或过去的日期。';return;}
    if(editor.period==='具体时刻'&&!editor.time){error.textContent='请填写具体时刻，或改选大概时段。';return;}
    if(!editor.participation&&!editor.interest&&!editor.note.trim()&&!editor.photos.length){error.textContent='参与、反应、感想或照片，填一项就可以。';return;}
    if(scenario==='offline'){error.textContent='当前离线，尚未保存。已填写内容保留在这里。';return;}
    const latest=readState(),old=latest.records.find(r=>r.id===editor.id);
    if(old&&old.revision!==editor.originalRecordRevision){error.textContent='这条记录已有新改动，请先返回详情核对。当前填写内容仍保留。';return;}
    state=latest;const next=clone(latest),saved={...clone(editor),id:editor.id||uid(),title:editor.title.trim(),note:editor.note.trim(),author:old?.author||'你',createdAt:old?.createdAt||stamp(),updatedAt:stamp(),revision:(old?.revision||0)+1};
    if(old)next.records[next.records.findIndex(r=>r.id===old.id)]=saved;else next.records.push(saved);
    if(persist(next,'保存了一条 '+shortDate(saved.date)+' 的实际记录')){editor=null;go('record/'+saved.id);toast('记录已保存到本机，发生日期与填写时间分别保留');}
  }

  const baseHeader=header,baseRender=render,baseToday=today,baseActivities=activities,baseMeals=meals,baseGo=go;
  header=function(title,sub,actions='',back=''){
    if(!currentRoute().startsWith('display'))actions+=pBtn(pIcon('message')+'<span class="btn-label">AI 助手</span>','ai-open','assistant-top-button','aria-label="打开 AI 助手"');
    return baseHeader(title,sub,actions,back);
  };
  today=function(){const html=baseToday();return html.replace('<div class="main-grid">',`<section class="today-assistant-entry"><span class="entry-glyph">${pIcon('message')}</span><div><h2>计划有变化？一起理一理</h2><p>可以先讨论，核对改动后一次保存。</p></div>${pBtn('和 AI 讨论一下','ai-open','soft')}</section><div class="main-grid">`).replace('<p class="recent-change">',`<section class="today-record-entry"><div>${pIcon('note')}<span>今天想留下什么时刻？</span></div><div>${routeButton('打开日历','calendar')}${pBtn('记一下','new-record','soft',`data-date="${TODAY}"`)}</div></section><p class="recent-change">`);};
  activities=function(){const html=baseActivities(),wrap=document.createElement('div');wrap.innerHTML=html;const old=wrap.querySelector('.feedback-box');if(old){const count=state.records.filter(r=>r.date===TODAY&&r.original?.id==='play').length;old.outerHTML=`<section class="panel activity-record-entry"><div><span class="mini-label">${shortDate(TODAY)}，这次下午陪玩</span><h2>玩过以后，记下一点</h2><p class="muted-line">可以只写感想，或留一张照片。每次活动分别保存。</p>${count?`<p class="muted-line">这次安排已关联 ${count} 条记录。</p>`:''}</div><div class="inline-actions">${pBtn('记一下','new-record','primary',`data-date="${TODAY}" data-linked="true"`)}${routeButton('查看这一天','calendar/'+TODAY)}</div></section>`;}return wrap.innerHTML;};
  meals=function(){let html=baseMeals();if(state.preferenceWindow)html=html.replace('近期少安排面食。仅作为可复核的偏好记录。','近期少安排面食。生效期限：'+shortDate(state.preferenceWindow.start)+'—'+shortDate(state.preferenceWindow.end)+'，到期后重新核对。');return html;};
  go=function(route){if($('#assistant-dialog')?.open)$('#assistant-dialog').close();baseGo(route);};
  render=function(){
    if(isLoginExpired()){baseRender();return;}
    const route=currentRoute(),isCalendar=route==='calendar'||route.startsWith('calendar/'),isRecord=route.startsWith('record/'),isAssistant=route==='assistant';
    document.body.classList.toggle('assistant-route',isAssistant);
    if(!isCalendar&&!isRecord&&!isAssistant){baseRender();return;}
    document.body.classList.remove('is-fullscreen','is-print');
    if(isCalendar&&/^calendar\/\d{4}-\d{2}-\d{2}$/.test(route)){selectedDate=route.split('/')[1];month=selectedDate.slice(0,7);dayTab=selectedDate<TODAY?'records':'plan';}
    $$('.nav-button').forEach(b=>{const active=b.dataset.route===(isCalendar||isRecord?'calendar':'assistant');b.classList.toggle('active',active);active?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current');});
    $('#app').innerHTML=isCalendar?calendarView():isAssistant?assistantView():route==='record/new'?editorView():recordView(route.split('/')[1]);
    document.title='宝宝计划｜'+(isCalendar?'日历':isAssistant?'AI 助手':'活动记录');
  };
  const calendarNav=document.createElement('button');calendarNav.className='nav-button';calendarNav.dataset.route='calendar';calendarNav.innerHTML=pIcon('day')+'<span>日历</span>';$('.nav').children[0].after(calendarNav);
  const aiNav=document.createElement('button');aiNav.className='assistant-nav';aiNav.dataset.pAction='ai-open';aiNav.innerHTML=pIcon('message')+'<span>AI 助手</span>';$('.side-divider').before(aiNav);
  const dialog=document.createElement('dialog');dialog.id='assistant-dialog';dialog.className='assistant-drawer';dialog.setAttribute('aria-labelledby','assistant-dialog-title');dialog.innerHTML=`<header class="assistant-drawer-head"><div><h2 id="assistant-dialog-title">AI 助手</h2><p>讨论以后，再决定怎么改</p></div><div>${pBtn('展开','ai-expand','ghost')}<button class="icon-button" data-p-action="ai-close" aria-label="关闭 AI 助手">${pIcon('x')}</button></div></header><div id="assistant-body"></div>`;document.body.appendChild(dialog);
  dialog.addEventListener('close',()=>{if(assistantOpener?.isConnected)assistantOpener.focus({preventScroll:true});});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientY<r.top||e.clientX>r.right||e.clientY>r.bottom)dialog.close();}});
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-p-action]');if(!b)return;const a=b.dataset.pAction;
    if(a==='ai-open')openAssistant();
    if(a==='ai-close')dialog.close();
    if(a==='ai-expand'){dialog.close();go('assistant');}
    if(a==='ai-day')openAssistant(b.dataset.date,'date');
    if(a==='ai-week')openAssistant(TODAY,'week');
    if(a==='assistant-tab'){assistantTab=b.dataset.value;refreshAssistant();}
    if(a==='prompt-today')sendMessage('今天下午改室内，晚餐面换饭，这周先少安排面食。','today');
    if(a==='prompt-week')sendMessage('这周户外为主，晚饭少排面。','week');
    if(a==='prompt-query')sendMessage('看看现在的安排和家里食材');
    if(a==='prompt-dinner')sendMessage('只调整晚餐，其他不改。');
    if(a==='prompt-exclude')sendMessage('周三保持原样。');
    if(a==='continue-chat'){assistantTab='discussion';refreshAssistant();$('#assistant-message')?.focus();}
    if(a==='proposal-save')saveProposal();
    if(a==='proposal-rebase'){state=readState();makeProposal('按最新安排重新核对');refreshAssistant();}
    if(a==='saved-calendar')go('calendar/'+(chat.proposal?.dates[0]||TODAY));
    if(a==='select-day'){selectedDate=b.dataset.date;dayTab=selectedDate<TODAY?'records':'plan';history.replaceState(null,'','#calendar/'+selectedDate);renderCalendarOnly();}
    if(a==='calendar-today'){selectedDate=TODAY;month=TODAY.slice(0,7);dayTab='plan';calendarMode='month';history.replaceState(null,'','#calendar/'+TODAY);renderCalendarOnly();}
    if((a==='month-prev'||a==='month-next')&&calendarMode==='week'){selectedDate=shift(selectedDate,a==='month-next'?7:-7);month=selectedDate.slice(0,7);history.replaceState(null,'','#calendar/'+selectedDate);dayTab=selectedDate<TODAY?'records':'plan';renderCalendarOnly();}
    if((a==='month-prev'||a==='month-next')&&calendarMode!=='week'){const d=new Date(month+'-15T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+(a==='month-next'?1:-1));month=d.toISOString().slice(0,7);renderCalendarOnly();}
    if(a==='calendar-mode'){calendarMode=b.dataset.value;renderCalendarOnly();}
    if(a==='day-tab'){dayTab=b.dataset.value;renderCalendarOnly();}
    if(a==='new-record')newRecord(b.dataset.date||TODAY,b.dataset.linked==='true');
    if(a==='view-record')go('record/'+b.dataset.id);
    if(a==='cancel-record'){const date=editor?.date||TODAY;editor=null;formDirty=false;go('calendar/'+date);}
    if(a==='unlink-record'){captureEditor();editor.original=null;render();}
    if(a==='clear-record-choice'){captureEditor();editor[b.dataset.field]=null;render();}
    if(a==='remove-photo'){captureEditor();editor.photos=editor.photos.filter(x=>x.id!==b.dataset.id);photoListRefresh();}
    if(a==='retry-photo'){
      if(currentRoute()==='record/new'){const p=editor.photos.find(x=>x.id===b.dataset.id);if(p)p.status='ready';photoListRefresh();}
      else{const id=currentRoute().split('/')[1],next=clone(readState()),r=next.records.find(x=>x.id===id),p=r?.photos.find(x=>x.id===b.dataset.id);if(p){p.status='ready';r.revision++;r.updatedAt=stamp();if(persist(next,'重试了一张记录照片'))render();}}
    }
    if(a==='edit-record'){const r=state.records.find(x=>x.id===b.dataset.id);editor={...clone(r),originalRecordRevision:r.revision};go('record/new');}
    if(a==='delete-record'){const r=state.records.find(x=>x.id===b.dataset.id);showDialog('删除这条记录？',`<p>${esc(dayLabel(r.date)+' '+r.title)}</p><p class="muted-line">仅移除这条记录与关联照片，当天的安排和其他记录继续保留。</p><div class="dialog-actions">${button('保留记录','close')}${pBtn('删除记录','confirm-delete-record','danger',`data-id="${esc(r.id)}"`)}</div>`,'本机原型中的记录操作');}
    if(a==='confirm-delete-record'){const next=clone(readState()),r=next.records.find(x=>x.id===b.dataset.id);if(r){next.records=next.records.filter(x=>x.id!==r.id);if(persist(next,'删除了一条实际记录')){closeDialog();go('calendar/'+r.date);}}}
    if(a==='record-again'){const r=state.records.find(x=>x.id===b.dataset.id);newRecord(TODAY,false);editor.title=r.title;render();}
  });
  function renderCalendarOnly(){if(!currentRoute().startsWith('calendar'))return;$('#app').innerHTML=calendarView();}
  document.addEventListener('submit',e=>{
    if(e.target.id==='assistant-composer'){e.preventDefault();sendMessage(new FormData(e.target).get('message'));}
    if(e.target.id==='record-editor'){e.preventDefault();saveRecord();}
  });
  document.addEventListener('input',e=>{if(e.target.closest('#assistant-composer')){chat.composer=e.target.value;saveChat();}if(e.target.closest('#record-editor'))captureEditor();});
  document.addEventListener('change',e=>{
    if(e.target.id==='assistant-scope'){supersede();chat.proposal=null;chat.intent=null;chat.scope=e.target.value;chat.date=chat.scope==='today'?TODAY:chat.date;chat.messages.push({role:'system',text:'讨论范围已切换为 '+scopeLabel()+'。'});saveChat();refreshAssistant();}
    if(e.target.dataset.change&&chat.proposal){const id=e.target.dataset.change,checked=e.target.checked;supersede();chat.proposal=clone(chat.proposal);chat.proposal.id=uid();chat.proposal.version=++chat.version;chat.proposal.changes.find(c=>c.id===id).selected=checked;saveChat();refreshAssistant();}
    if(e.target.id==='record-photos'||e.target.id==='record-camera')readPhotos(e.target.files);
    if(e.target.closest('#record-editor')){captureEditor();if(e.target.name==='period')$('.exact-time').hidden=editor.period!=='具体时刻';}
  });
  window.BabyPlanning={getSelectedDate:()=>selectedDate,getProposal:()=>chat.proposal,getRecords:()=>state.records,openAssistant};
  render();
})();
