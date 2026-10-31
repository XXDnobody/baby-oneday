"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, Link as LinkIcon, Plus, ShieldCheck, Users } from "lucide-react";
import type { DeviceSession, Household, Invite, Me } from "@/shared/contracts";
import { api, message, newKey } from "./api";

function deviceName(value: string) {
  const browser = value.includes("Edg/") ? "Edge" : value.includes("Firefox/") ? "Firefox" : value.includes("Chrome/") ? "Chrome" : value.includes("Safari/") ? "Safari" : null;
  return browser ? browser + " 浏览器" : "浏览器登录";
}

export function CreateFamily({ onSaved }: { onSaved: () => Promise<void> }) {
  const [name, setName] = useState(""); const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); key.current ??= newKey();
    try { await api("households", "POST", { name, city, timezone: "Asia/Shanghai" }, key.current); await onSaved(); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel setup-panel"><p className="eyebrow">我们的家庭</p><h2>先给家人留个共同的位置</h2><p className="muted">设置家庭称呼与常住城市，下一步填写宝宝基本资料。</p>
    {error && <div role="alert" className="error">{error}</div>}<form onSubmit={submit} className="form-stack"><label>家庭称呼<input required maxLength={40} value={name} onChange={(e) => { setName(e.target.value); key.current = null; }} placeholder="例如：五一的家" /></label><label>常住城市<input required maxLength={80} value={city} onChange={(e) => { setCity(e.target.value); key.current = null; }} placeholder="请填写家庭实际所在城市" /></label><p className="small muted">当前使用北京时间。</p><button className="primary" disabled={busy}>{busy ? "正在创建…" : "创建家庭，继续设置"}</button></form></section>;
}

export function BabyForm({ household, onSaved, onCancel }: { household: Household; onSaved: () => Promise<void>; onCancel?: () => void }) {
  const [name, setName] = useState(household.child?.name ?? "");
  const [birthDate, setBirthDate] = useState(household.child?.birthDate ?? "");
  const [ageMonths, setAgeMonths] = useState(String(household.child?.ageMonths ?? ""));
  const [foodStatus, setFoodStatus] = useState(household.child?.foodStatus ?? "unknown");
  const [restrictions, setRestrictions] = useState(household.child?.foodRestrictions ?? "");
  const [baseRevision] = useState(household.revision);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api("households/" + household.id + (household.setupComplete ? "/child" : "/setup"), household.setupComplete ? "PATCH" : "PUT", {
        expectedRevision: baseRevision, child: { name, birthDate: birthDate || null, ageMonths: birthDate || ageMonths === "" ? null : Number(ageMonths), foodStatus, foodRestrictions: restrictions },
      });
      await onSaved(); onCancel?.();
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel setup-panel"><p className="eyebrow">宝宝基本资料</p><h2>{household.setupComplete ? "修改宝宝资料" : "从了解宝宝开始"}</h2><p className="muted">这些关键资料由管理员维护。暂时不清楚的食物限制可以保留为未知。</p>{error && <div role="alert" className="error">{error}</div>}
    <form onSubmit={submit} className="form-stack"><label>宝宝称呼<input name="childName" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="宝宝的小名" /></label><div className="form-columns"><label>生日 <span className="muted">（选填）</span><input type="date" name="birthDate" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></label><label>当前月龄 <span className="muted">（未填生日时填写）</span><input type="number" name="ageMonths" min={0} max={216} required={!birthDate} disabled={!!birthDate} value={birthDate ? "" : ageMonths} onChange={(e) => setAgeMonths(e.target.value)} /></label></div>
      <label>食物限制确认情况<select name="foodStatus" value={foodStatus} onChange={(e) => setFoodStatus(e.target.value as typeof foodStatus)}><option value="unknown">还不确定，暂时保留未知</option><option value="none">家庭已确认没有已知限制</option><option value="restricted">有已确认的食物限制</option></select></label>
      {foodStatus === "restricted" && <label>已确认的限制<textarea required rows={3} maxLength={1000} value={restrictions} onChange={(e) => setRestrictions(e.target.value)} /></label>}
      <div className="form-actions">{onCancel && <button type="button" className="secondary" onClick={onCancel}>返回</button>}<button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存宝宝资料"}</button></div>
    </form></section>;
}

interface Template { kind: "weekday" | "weekend"; revision: number; slots: Array<{ label: string; time: string }> }
function TemplateForm({ householdId }: { householdId: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [kind, setKind] = useState<Template["kind"]>("weekday");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api<Template[]>("households/" + householdId + "/templates").then(setTemplates).catch((e: unknown) => setError(message(e))); }, [householdId]);
  const current = templates.find((t) => t.kind === kind);
  function change(index: number, field: "time" | "label", value: string) {
    setTemplates((all) => all.map((t) => t.kind === kind ? { ...t, slots: t.slots.map((s, i) => i === index ? { ...s, [field]: value } : s) } : t)); setNotice("");
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!current) return; setBusy(true); setError("");
    try {
      const result = await api<Template[]>("households/" + householdId + "/templates/" + kind, "PUT", { expectedRevision: current.revision, slots: current.slots });
      setTemplates((all) => all.map((t) => t.kind === kind ? result[0] : t)); setNotice("作息已保存，已有日计划保持原样。");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className="panel"><p className="eyebrow">照护节奏</p><h2>家庭基础作息</h2><p className="muted small">家人都可以维护。修改作息不会改写已有安排。</p><div className="segmented"><button className={kind === "weekday" ? "selected" : ""} onClick={() => setKind("weekday")}>工作日</button><button className={kind === "weekend" ? "selected" : ""} onClick={() => setKind("weekend")}>周末</button></div>
    {error && <div role="alert" className="error">{error}</div>}{notice && <p role="status" className="notice">{notice}</p>}
    {current && <form onSubmit={save} className="form-stack">{!current.slots.length && <p className="muted">还没有设置固定时段，可以先添加一项。</p>}{current.slots.map((slot, i) => <div className="template-row" key={i}><input type="time" aria-label={"作息时间 " + (i + 1)} required value={slot.time} onChange={(e) => change(i, "time", e.target.value)} /><input aria-label={"作息名称 " + (i + 1)} maxLength={40} required value={slot.label} onChange={(e) => change(i, "label", e.target.value)} /><button type="button" className="text-button" onClick={() => setTemplates((all) => all.map((t) => t.kind === kind ? { ...t, slots: t.slots.filter((_, n) => n !== i) } : t))}>移除</button></div>)}
      <div className="form-actions"><button type="button" className="secondary" disabled={current.slots.length >= 30} onClick={() => setTemplates((all) => all.map((t) => t.kind === kind ? { ...t, slots: [...t.slots, { time: "09:00", label: "" }] } : t))}><Plus size={16} aria-hidden />添加时段</button><button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存作息"}</button></div></form>}
  </section>;
}

export function Family({ household, me, refresh }: { household: Household; me: Me; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false); const [invites, setInvites] = useState<Invite[]>([]);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [inviteLink, setInviteLink] = useState(""); const [notice, setNotice] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const isAdmin = household.role === "admin";
  async function lists() {
    const devices = await api<DeviceSession[]>("auth/sessions"); setSessions(devices);
    if (isAdmin) setInvites(await api<Invite[]>("households/" + household.id + "/invites"));
    else { setInvites([]); setInviteLink(""); }
  }
  useEffect(() => {
    let active = true;
    Promise.all([api<DeviceSession[]>("auth/sessions"), isAdmin ? api<Invite[]>("households/" + household.id + "/invites") : Promise.resolve([])]).then(([devices, links]) => { if (active) { setSessions(devices); setInvites(links); } }).catch((e: unknown) => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [household.id, household.revision, isAdmin]);
  async function action(fn: () => Promise<unknown>) {
    setError(""); setBusy(true);
    try { await fn(); await refresh(); await lists(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  if (editing && isAdmin) return <BabyForm household={household} onSaved={refresh} onCancel={() => setEditing(false)} />;
  return <div className="family-grid">
    {error && <div className="error full-width" role="alert">{error}</div>}{notice && <div className="notice full-width" role="status">{notice}</div>}
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">共同照护</p><h2>{household.name}</h2></div><Users aria-hidden /></div><p className="muted">{household.city} · 北京时间</p>
      <div className="baby-summary"><span className="avatar">{household.child?.name.slice(0, 1)}</span><div><h3>{household.child?.name}</h3><p className="small muted">{household.child?.birthDate ? household.child.birthDate + " 出生" : household.child?.ageMonths + " 个月（" + household.child?.ageAsOf + " 确认）"}</p></div></div>
      <div className="notice"><ShieldCheck size={18} aria-hidden /><span>{household.child?.foodStatus === "unknown" ? "食物限制仍待确认，未启用自动饮食推荐。" : household.child?.foodStatus === "none" ? "家庭已确认没有已知食物限制。" : household.child?.foodRestrictions}</span></div>
      {isAdmin ? <button className="secondary" onClick={() => setEditing(true)}>修改宝宝资料</button> : <p className="small muted">宝宝关键资料与食物限制由管理员维护。</p>}
      <div className="member-list">{household.members.map((m) => <div className="member-row" key={m.id}><div><strong>{m.displayName}{m.userId === me.user.id ? "（我）" : ""}</strong><p className="small muted">{m.role === "admin" ? "家庭管理员" : "日常照护成员"}</p></div>{isAdmin && <div className="member-actions"><button className="text-button" disabled={busy} onClick={() => void action(() => api("households/" + household.id + "/members/" + m.id, "PATCH", { role: m.role === "admin" ? "member" : "admin", expectedRevision: m.revision }))}>{m.role === "admin" ? "改为日常成员" : "设为管理员"}</button><button className="text-button danger-text" disabled={busy} onClick={() => { if (window.confirm("移除 " + m.displayName + " 后，对方会立即失去此家庭的访问权限。继续吗？")) void action(() => api("households/" + household.id + "/members/" + m.id, "DELETE", { expectedRevision: m.revision })); }}>移除</button></div>}</div>)}</div>
    </section>
    {isAdmin && <section className="panel"><p className="eyebrow">一起加入</p><h2>邀请一位家人</h2><p className="muted">邀请 7 天内有效，仅供一人加入。家人可以查看和编辑日常安排。</p><button className="primary" disabled={busy} onClick={() => void action(async () => { const result = await api<{ url: string }>("households/" + household.id + "/invites", "POST", { role: "member" }, newKey()); setInviteLink(result.url); })}><LinkIcon size={17} aria-hidden />创建家庭邀请</button>
      {inviteLink && <div className="invite-result"><label>一次性邀请链接<input readOnly value={inviteLink} onFocus={(e) => e.target.select()} /></label><button className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(inviteLink); setNotice("邀请链接已复制，请发给这位家人。"); } catch { setNotice("请选中上方链接手动复制。"); } }}><Copy size={16} aria-hidden />复制链接</button><p className="small muted">完整链接只在这次创建后展示，请及时复制。</p></div>}
      <div className="invite-list">{invites.map((invite) => <div className="invite-row" key={invite.id}><span>{invite.status === "active" ? "待家人加入" : invite.status === "accepted" ? "已加入" : invite.status === "revoked" ? "已撤销" : "已过期"}<small className="muted">有效至 {new Date(invite.expiresAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</small></span>{invite.status === "active" && <button className="text-button" disabled={busy} onClick={() => void action(async () => { await api("households/" + household.id + "/invites/" + invite.id, "DELETE"); setInviteLink(""); })}>撤销</button>}</div>)}</div>
    </section>}
    <TemplateForm householdId={household.id} />
    <section className="panel"><p className="eyebrow">我的账号</p><h2>已登录设备</h2><p className="muted small">只展示你自己的登录；移除设备后，该设备需要重新登录。</p>{sessions.map((s) => <div className="device-row" key={s.id}><div><strong>{s.current ? "当前设备" : "其他设备"}</strong><p className="device-name small muted">{deviceName(s.device)}</p><p className="small muted">最近活跃 {new Date(s.lastSeenAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p></div>{!s.current && <button className="text-button" disabled={busy} onClick={() => void action(() => api("auth/sessions/" + s.id, "DELETE"))}>退出此设备</button>}</div>)}</section>
  </div>;
}
