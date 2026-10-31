"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Check, Clock3, Home, LogOut, Plus, RefreshCw, Sprout, Tablet, Users, Utensils, BookOpen, Carrot, NotebookPen, Trash2 } from "lucide-react";
import type { Day, Household, Me, PlanItem } from "@/shared/contracts";
import { api, ApiError, message } from "./api";
import { AuthScreen, type EntryMode } from "./auth-screen";
import { BabyForm, CreateFamily, Family } from "./family";
import { PlanEditor } from "./plan-editor";
import { ContentDetail, ContentLibrary } from "./content-library";
import { PantryPage } from "./pantry";
import { CalendarPanel, Journal, RecordEditor } from "./journal";
import { TrashPage } from "./trash";
import { PrintButton } from "./printing";
import type { ContentVersion } from "@/shared/b2";
import { Agreements } from "./agreements";

const navigation = [
  { id: "today", label: "每日安排", title: "今天怎么过", icon: Home },
  { id: "content", label: "菜谱活动", title: "熟悉的菜与玩法", icon: BookOpen },
  { id: "pantry", label: "食材偏好", title: "家里有什么", icon: Carrot },
  { id: "calendar", label: "统一日历", title: "计划与回顾", icon: CalendarDays },
  { id: "records", label: "文字记录", title: "记下每次发生", icon: NotebookPen },
  { id: "family", label: "我的家庭", title: "我们的家庭", icon: Users },
  { id: "trash", label: "回收站", title: "找回原来的记录", icon: Trash2 },
] as const;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function JoinFamily({ token, onJoined }: { token: string; onJoined: () => Promise<void> }) {
  const [preview, setPreview] = useState<{ name: string } | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ name: string }>("invites/preview", "POST", { token }).then(setPreview).catch((e: unknown) => setError(message(e))); }, [token]);
  return <div className="standalone"><section className="panel setup-panel"><Users size={32} aria-hidden /><h1>加入{preview ? "「" + preview.name + "」" : "家庭"}</h1><p className="muted">确认后，你可以和家人共同查看、编辑日常安排。</p>{error && <div role="alert" className="error">{error}</div>}<button className="primary" disabled={busy || !preview} onClick={async () => { setBusy(true); setError(""); try { await api("invites/accept", "POST", { token }); await onJoined(); window.history.replaceState(null, "", "/"); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>{busy ? "正在加入…" : "确认加入家庭"}</button><Link href="/">返回我的家庭</Link></section></div>;
}

export function Workspace({ initialMode, token }: { initialMode: EntryMode; token: string }) {
  const [me, setMe] = useState<Me | null>();
  const [entryMode, setEntryMode] = useState(initialMode);
  const [joining, setJoining] = useState(initialMode === "join");
  const [householdId, setHouseholdId] = useState("");
  const [household, setHousehold] = useState<Household | null>(null);
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<Day | null>(null);
  const [tab, setTab] = useState<typeof navigation[number]["id"]>("today");
  const [tick, setTick] = useState(0);
  const [recording, setRecording] = useState<PlanItem | null>(null);
  const [contentDetail, setContentDetail] = useState<ContentVersion | null>(null);
  const [tablet, setTablet] = useState(false);
  const [sync, setSync] = useState<"connecting" | "live" | "poll" | "offline">("connecting");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ item: PlanItem | null } | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const loadMe = useCallback(async () => {
    setEditing(null); setRecording(null); setContentDetail(null);
    try {
      const next = await api<Me>("me");
      setMe(next); setError("");
      setHouseholdId((selected) => next.households.some((h) => h.id === selected) ? selected : next.households[0]?.id ?? "");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setMe(null); setHousehold(null); setDay(null); setEditing(null); setHouseholdId(""); }
      else setError(message(e));
    }
  }, []);
  useEffect(() => {
    let active = true;
    api<Me>("me").then((next) => {
      if (!active) return;
      setMe(next); setHouseholdId(next.households[0]?.id ?? "");
    }).catch((e: unknown) => {
      if (!active) return;
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setError(message(e));
    });
    return () => { active = false; };
  }, []);
  const userId = me?.user.id;
  useEffect(() => {
    if (!householdId || !userId) return;
    let active = true; let newest = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const stream = new EventSource("/api/v1/households/" + householdId + "/events");
    const refresh = async () => {
      const request = ++newest;
      try {
        const identity = await api<Me>("me");
        if (!active || request !== newest) return;
        if (identity.user.id !== userId || !identity.households.some((h) => h.id === householdId)) {
          setEditing(null); setRecording(null); setContentDetail(null); setHousehold(null); setDay(null); setMe(identity);
          setHouseholdId(identity.households[0]?.id ?? ""); stream.close(); return;
        }
        const [family, selectedDay] = await Promise.all([api<Household>("households/" + householdId), api<Day>("households/" + householdId + "/today?date=" + date)]);
        if (!active || request !== newest) return;
        setHousehold(family); setDay(selectedDay); setError(""); setTick((n) => n + 1);
      } catch (e) {
        if (!active || request !== newest) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
          stream.close(); setHousehold(null); setDay(null); setEditing(null); setRecording(null); setContentDetail(null); await loadMe();
        } else { setSync("offline"); setError(message(e)); }
      }
    };
    refreshRef.current = refresh;
    const scheduleRefresh = () => { refreshTimer ??= setTimeout(() => { refreshTimer = undefined; if (active) void refresh(); }, 50); };
    stream.addEventListener("ready", () => { if (active) setSync("live"); scheduleRefresh(); });
    stream.addEventListener("change", scheduleRefresh);
    stream.addEventListener("refresh", scheduleRefresh);
    stream.addEventListener("access-ended", () => { stream.close(); void refresh(); });
    stream.onerror = () => { if (active) setSync(navigator.onLine ? "poll" : "offline"); };
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = setInterval(visible, 8000);
    window.addEventListener("online", visible); window.addEventListener("pageshow", visible); document.addEventListener("visibilitychange", visible);
    void refresh();
    return () => { active = false; clearInterval(timer); clearTimeout(refreshTimer); stream.close(); window.removeEventListener("online", visible); window.removeEventListener("pageshow", visible); document.removeEventListener("visibilitychange", visible); refreshRef.current = async () => {}; };
  }, [householdId, userId, date, loadMe]);
  const refresh = useCallback(async () => { await refreshRef.current(); }, []);
  if (me === undefined) return <div className="standalone"><div className="panel"><Sprout size={34} /><p>{error || "正在打开宝宝计划…"}</p>{error && <button className="secondary" onClick={() => void loadMe()}>重试</button>}</div></div>;
  if (!me || entryMode === "register" || entryMode === "reset") return <AuthScreen initialMode={entryMode} token={token} onSignedIn={async () => { setEntryMode("login"); await loadMe(); }} onRegistered={() => { setJoining(false); setEntryMode("login"); }} />;
  if (joining) return <JoinFamily token={token} onJoined={async () => { setJoining(false); await loadMe(); }} />;
  const current = household?.id === householdId ? household : null;
  const selectedDay = day?.date === date && current ? day : null;
  const formatDate = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Shanghai" }).format(new Date(date + "T12:00:00+08:00"));
  const items = selectedDay?.plan?.items ?? [];
  const nextItem = items.find((item) => item.status !== "cancelled" && (date > today() || (date === today() && item.time >= new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }).format(new Date()))));
  return <div className={"app-shell" + (tablet ? " tablet-mode" : "")} key={me.user.id}>
    <aside className="sidebar"><Link className="brand" href="/"><span className="brand-mark"><Sprout aria-hidden /></span>宝宝计划</Link><p className="side-caption">家人一起，照顾每一天</p>
      <nav aria-label="主导航">{navigation.map((entry) => <button key={entry.id} className={tab === entry.id ? "active" : ""} onClick={() => setTab(entry.id)} aria-current={tab === entry.id ? "page" : undefined}><entry.icon size={20} aria-hidden />{tablet && entry.id === "today" ? "平板主页" : entry.label}</button>)}</nav>
      <div className="sidebar-bottom"><span className="avatar small-avatar">{me.user.displayName.slice(0, 1)}</span><div><strong>{me.user.displayName}</strong><p className="small muted">各自登录 · 共同照护</p></div><button className="icon-button" aria-label="退出登录" onClick={async () => { try { await api("auth/session", "DELETE"); setMe(null); setHousehold(null); setDay(null); setEditing(null); setRecording(null); setContentDetail(null); window.history.replaceState(null, "", "/"); } catch (e) { setError(message(e)); } }}><LogOut size={18} /></button></div>
    </aside>
    <main className="main-content"><header className="page-header"><div><p className="eyebrow">{tab === "today" ? "每一天，慢慢来" : "一起照顾，一起商量"}</p><h1>{navigation.find((entry) => entry.id === tab)?.title}</h1><p className="muted">{tab === "today" || tab === "calendar" ? formatDate : "让家人接得上手，让安排有据可循。"}</p></div><div className="header-tools">{me.households.length > 1 && <label className="sr-only" htmlFor="household-select">选择家庭</label>}{me.households.length > 1 && <select id="household-select" value={householdId} onChange={(e) => { setEditing(null); setRecording(null); setContentDetail(null); setHousehold(null); setDay(null); setHouseholdId(e.target.value); }} >{me.households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>}<button className={tablet ? "secondary selected" : "secondary"} onClick={() => setTablet((v) => !v)}><Tablet size={18} aria-hidden />{tablet ? "标准模式" : "平板大字"}</button></div></header>
      {error && <div role="alert" className="error">{error}<button className="text-button" onClick={() => void refresh()}>重新连接</button></div>}
      {!householdId ? me.user.canCreateHousehold ? <CreateFamily onSaved={loadMe} /> : <section className="panel empty-state"><Users size={38} aria-hidden /><h2>还没有可访问的家庭</h2><p>请打开家庭管理员发给你的有效邀请链接。</p><button className="secondary" onClick={() => void loadMe()}>检查家庭邀请结果</button></section>
      : !current || !selectedDay ? <section className="panel"><p role="status">正在读取家庭安排…</p></section>
      : !current.setupComplete ? current.role === "admin" ? <BabyForm household={current} onSaved={async () => { await loadMe(); await refresh(); }} /> : <section className="panel empty-state"><h2>等待管理员完成宝宝基本资料</h2><p>资料保存后，就可以一起安排每天的生活。</p></section>
      : tab === "family" ? <div className="b2-stack"><Family key={current.id + ":" + current.role} household={current} me={me} refresh={refresh} /><Agreements key={current.id} household={current} tick={tick} onSaved={refresh} /></div>
      : tab === "content" ? <ContentLibrary key={current.id} household={current} tick={tick} onSaved={refresh} />
      : tab === "pantry" ? <PantryPage key={current.id} household={current} tick={tick} onSaved={refresh} />
      : tab === "records" ? <Journal key={current.id} household={current} userId={me.user.id} date={date} tick={tick} onSaved={refresh} journal />
      : tab === "trash" ? <TrashPage key={current.id} householdId={current.id} tick={tick} onSaved={refresh} />
      : <>
        {tab === "calendar" && <CalendarPanel householdId={current.id} date={date} tick={tick} onSelect={(value) => { setEditing(null); setDate(value); }} />}
        <div className="day-toolbar"><div className="date-control"><CalendarDays size={19} aria-hidden /><label className="sr-only" htmlFor="plan-date">安排日期</label><input id="plan-date" type="date" value={date} onChange={(e) => { if (e.target.value) { setEditing(null); setDay(null); setDate(e.target.value); } }} /><button className="text-button" onClick={() => { setEditing(null); setDate(today()); }}>回到今天</button></div><span className={"sync-status " + sync}><span className="status-dot" />{sync === "live" ? "家人更新实时同步" : sync === "poll" ? "正在定时同步" : sync === "offline" ? "连接中断，保留已加载内容" : "正在连接同步"}</span></div>
        <div className="today-grid"><section className="panel day-plan"><div className="section-heading"><div><p className="eyebrow">{current.child?.name}的一天</p><h2>留些余地，也有安排</h2></div><button className="primary" onClick={() => setEditing({ item: null })}><Plus size={18} aria-hidden />添加安排</button></div>
          {!items.length ? <div className="empty-state"><CalendarDays size={42} aria-hidden /><h3>这一天，等我们一起安排</h3><p>先添上一餐、一次陪玩或一个作息时段。<br />保存后，家人打开就能看到。</p><button className="secondary" onClick={() => setEditing({ item: null })}>添加第一项安排<ArrowRight size={16} aria-hidden /></button></div>
          : <ol className="timeline">{items.map((item) => <li key={item.id}><div className="timeline-time">{item.time}<span className="timeline-dot" /></div><div className={"timeline-card" + (item.status === "cancelled" ? " cancelled-item" : "")}><div className="item-kind">{item.kind === "meal" ? <Utensils size={15} aria-hidden /> : item.kind === "activity" ? <BookOpen size={15} aria-hidden /> : <Clock3 size={15} aria-hidden />}{item.kind === "meal" ? "饮食安排" : item.kind === "activity" ? "亲子活动" : "生活作息"}{item.status === "cancelled" && " · 已取消安排"}</div><h3>{item.title}</h3>{item.notes && <p className="item-notes">{item.notes}</p>}{item.needsReview && <p className="notice">当前适用条件或内容启用状态已变化，请家人重新核对；原版本保持不变。</p>}{item.contentSnapshot && <button className="text-button" onClick={() => setContentDetail(item.contentSnapshot)}>查看采用内容与来源 · 版本 {item.contentVersion}</button>}<div className="item-footer"><span className="muted small">{item.caregiverName ?? "家人共同照护"} · {item.updatedBy}更新</span><div className="button-row">{date <= today() && <button className="secondary" aria-label={"记录 " + item.title} onClick={() => setRecording(item)}>记一下</button>}<button className="secondary" aria-label={"调整 " + item.title} onClick={() => setEditing({ item })}>调整</button></div></div></div></li>)}</ol>}
        </section><aside className="day-side"><section className="next-panel"><p className="eyebrow">接下来</p>{nextItem ? <><div className="next-time">{nextItem.time}</div><h2>{nextItem.title}</h2><p>{nextItem.caregiverName ?? "家人共同照护"}</p><button className="secondary" onClick={() => setEditing({ item: nextItem })}>看看安排<ArrowRight size={17} aria-hidden /></button></> : <><h2>{items.length ? "今天的时段已走过" : "把下一件小事安排好"}</h2><p>{items.length ? "时间经过不会自动记为完成，实际情况由家人记录。" : "可以从熟悉的生活节奏开始，不必一次填满。"}</p></>}</section><section className="panel quiet-panel"><Check size={22} aria-hidden /><h3>改动保存后，家人就能看到</h3><p className="muted small">每次只调整选中的事项。遇到家人同时修改，会先提醒你核对。</p><button className="text-button" onClick={() => setTab("family")}>查看家庭成员<ArrowRight size={15} aria-hidden /></button></section>{selectedDay.plan && !!items.length && <PrintButton householdId={current.id} input={{ kind: "day", date, expectedRevision: selectedDay.plan.revision, items: items.map((i) => ({ id: i.id, revision: i.revision })) }} />}<p className="small muted local-note"><RefreshCw size={14} aria-hidden />本机版本 · 手动选择与安排。天气、自动计划和 AI 仍在 B3。</p></aside></div>
        <Journal key={current.id + ":" + date} household={current} userId={me.user.id} date={date} tick={tick} onSaved={refresh} />
        {(selectedDay.shopping?.length ?? 0) > 0 && <section className="panel shopping-panel"><h3>采购与用量核对</h3><p className="small muted">缺货与未知分开列出；按菜谱原用量核对，粗略库存不自动换算或扣减。</p><ul>{selectedDay.shopping?.map((need, index) => <li key={index}><strong>{need.name}</strong> · {need.amountText || "用量待核对"} · {need.status === "missing" ? "缺货，需采购" : need.status === "unknown" ? "库存未知，先确认" : "现有余量需核对"}<p className="small muted">{need.recipeTitle} · 菜谱版本 {need.recipeVersion}</p></li>)}</ul></section>}<div className="daily-agreements"><Agreements household={current} tick={tick} onSaved={refresh} compact /></div>
      </>}
    </main>
    {editing && current && selectedDay && <PlanEditor key={editing.item?.id ?? "new-" + date} household={current} day={selectedDay} item={editing.item} onClose={() => setEditing(null)} onSaved={refresh} />}
    {recording && current && <RecordEditor key={recording.id} household={current} userId={me.user.id} date={date} record={null} item={recording} onClose={() => setRecording(null)} onSaved={refresh} />}
    {contentDetail && current && <ContentDetail householdId={current.id} initial={contentDetail} onClose={() => setContentDetail(null)} />}
  </div>;
}
