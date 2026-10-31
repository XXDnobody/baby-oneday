"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, Link as LinkIcon, Plus, ShieldCheck, Users } from "lucide-react";
import type { DeviceSession, Household, Invite, Me } from "@/shared/contracts";
import { api, message, newKey } from "./api";
import { CityPicker } from "./city-picker";
import { BirthdayPicker } from "./birthday-picker";
import { FoodRestrictionsEditor, FoodRestrictionsSummary, type FoodRestrictionDraft } from "./food-restrictions";

function deviceName(value: string) {
  const browser = value.includes("Edg/") ? "Edge" : value.includes("Firefox/") ? "Firefox" : value.includes("Chrome/") ? "Chrome" : value.includes("Safari/") ? "Safari" : null;
  return browser ? browser + " 浏览器" : "浏览器登录";
}

export function CreateFamily({ onSaved }: { onSaved: () => Promise<void> }) {
  const [name, setName] = useState(""); const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!city) { setError("请选择常住城市后再继续。"); return; }
    setBusy(true); setError(""); key.current ??= newKey();
    try { await api("households", "POST", { name, city, timezone: "Asia/Shanghai" }, key.current); await onSaved(); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel setup-panel"><p className="eyebrow">我们的家庭</p><h2>先给家人留个共同的位置</h2><p className="muted">设置家庭称呼与常住城市，下一步填写宝宝基本资料。</p>
    {error && <div role="alert" className="error">{error}</div>}<form onSubmit={submit} className="form-stack"><label>家庭称呼<input required maxLength={40} value={name} disabled={busy} onChange={(e) => { setName(e.target.value); key.current = null; }} placeholder="例如：五一的家" /></label><CityPicker disabled={busy} onChange={(next) => { setCity(next); setError(""); key.current = null; }} /><button className="primary" disabled={busy}>{busy ? "正在创建…" : "创建家庭，继续设置"}</button></form></section>;
}

export function BabyForm({ household, onSaved, onCancel }: { household: Household; onSaved: () => Promise<void>; onCancel?: () => void }) {
  const [name, setName] = useState(household.child?.name ?? "");
  const [birthDate, setBirthDate] = useState(household.child?.birthDate ?? "");
  const [ageMonths, setAgeMonths] = useState(String(household.child?.ageMonths ?? ""));
  const [foodStatus, setFoodStatus] = useState(household.child?.foodStatus ?? "unknown");
  const [restrictions, setRestrictions] = useState<FoodRestrictionDraft[]>(() => (household.child?.foodRestrictionItems ?? []).map((item, draftId) => ({ ...item, draftId })));
  const [baseRevision] = useState(household.revision);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (foodStatus === "restricted" && !restrictions.length) throw new Error("请至少添加一项食物过敏或忌口。");
      await api("households/" + household.id + (household.setupComplete ? "/child" : "/setup"), household.setupComplete ? "PATCH" : "PUT", {
        expectedRevision: baseRevision, child: { name, birthDate: birthDate || null, ageMonths: birthDate || ageMonths === "" ? null : Number(ageMonths), foodStatus, foodRestrictionItems: foodStatus === "restricted" ? restrictions.map(({ kind, food, note }) => ({ kind, food, note })) : [] },
      });
      await onSaved(); onCancel?.();
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <section className="panel setup-panel"><p className="eyebrow">宝宝基本资料</p><h2>{household.setupComplete ? "修改宝宝资料" : "从了解宝宝开始"}</h2><p className="muted">这些关键资料由管理员维护。暂不清楚有无食物过敏或忌口，可以先选“还不确定”。</p>{error && <div role="alert" className="error">{error}</div>}
    <form onSubmit={submit} className="form-stack"><label>宝宝称呼<input name="childName" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="宝宝的小名" /></label><div className="form-columns"><BirthdayPicker defaultValue={birthDate} onChange={setBirthDate} disabled={busy} /><label>当前月龄 <span className="muted">（未填生日时填写）</span><input type="number" name="ageMonths" min={0} max={216} required={!birthDate} disabled={!!birthDate} value={birthDate ? "" : ageMonths} onChange={(e) => setAgeMonths(e.target.value)} /></label></div>
      <FoodRestrictionsEditor status={foodStatus} items={restrictions} onStatusChange={setFoodStatus} onItemsChange={setRestrictions} disabled={busy} />
      <div className="form-actions">{onCancel && <button type="button" className="secondary" onClick={onCancel}>返回</button>}<button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存宝宝资料"}</button></div>
    </form></section>;
}

interface Template { kind: "weekday" | "weekend"; revision: number; slots: Array<{ label: string; time: string; kind?: "meal" | "activity" | "routine"; scene?: "indoor" | "outdoor" | "either" }> }
function TemplateForm({ householdId }: { householdId: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [kind, setKind] = useState<Template["kind"]>("weekday");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api<Template[]>("households/" + householdId + "/templates").then(setTemplates).catch((e: unknown) => setError(message(e))); }, [householdId]);
  const current = templates.find((t) => t.kind === kind);
  function change(index: number, field: "time" | "label" | "kind" | "scene", value: string) {
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
    {current && <form onSubmit={save} className="form-stack">{!current.slots.length && <p className="muted">还没有设置固定时段，可以先添加一项。</p>}{current.slots.map((slot, i) => <div className="template-row" key={i}><input type="time" aria-label={"作息时间 " + (i + 1)} required value={slot.time} onChange={(e) => change(i, "time", e.target.value)} /><input aria-label={"作息名称 " + (i + 1)} maxLength={40} required value={slot.label} onChange={(e) => change(i, "label", e.target.value)} /><select aria-label={"作息类型 " + (i + 1)} value={slot.kind ?? (/餐|饭|辅食/.test(slot.label) ? "meal" : /玩|活动|散步|绘本/.test(slot.label) ? "activity" : "routine")} onChange={(e) => change(i, "kind", e.target.value)}><option value="routine">生活作息</option><option value="meal">饮食</option><option value="activity">活动</option></select><select aria-label={"作息场景 " + (i + 1)} value={slot.scene ?? "either"} onChange={(e) => change(i, "scene", e.target.value)}><option value="either">家人核对场景</option><option value="indoor">室内</option><option value="outdoor">户外</option></select><button type="button" className="text-button" onClick={() => setTemplates((all) => all.map((t) => t.kind === kind ? { ...t, slots: t.slots.filter((_, n) => n !== i) } : t))}>移除</button></div>)}
      <div className="form-actions"><button type="button" className="secondary" disabled={current.slots.length >= 30} onClick={() => setTemplates((all) => all.map((t) => t.kind === kind ? { ...t, slots: [...t.slots, { time: "09:00", label: "" }] } : t))}><Plus size={16} aria-hidden />添加时段</button><button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存作息"}</button></div></form>}
  </section>;
}

function ChangePassword({ onChanged }: { onChanged: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <section className="panel"><p className="eyebrow">我的账号</p><h2>修改密码</h2><p className="muted small">需要当前密码。保存后所有设备退出，请使用新密码重新登录。</p>
    {error && <div className="error" role="alert">{error}</div>}
    <form className="form-stack" onSubmit={async (event) => {
      event.preventDefault(); setError("");
      if (password !== confirmation) { setError("两次新密码不一致，请核对。"); return; }
      setBusy(true);
      try { await api("auth/password", "PUT", { currentPassword, password }); setCurrentPassword(""); setPassword(""); setConfirmation(""); await onChanged(); }
      catch (e) { setError(message(e)); }
      finally { setBusy(false); }
    }}>
      <label>当前密码<input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
      <label>新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <label>再次输入新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
      <button className="secondary" disabled={busy}>{busy ? "正在保存…" : "修改密码并退出所有设备"}</button>
    </form>
  </section>;
}

export function Family({ household, me, refresh, onPasswordChanged }: { household: Household; me: Me; refresh: () => Promise<void>; onPasswordChanged: () => Promise<void> }) {
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
      <div className="notice"><ShieldCheck size={18} aria-hidden /><FoodRestrictionsSummary child={household.child} /></div>
      {isAdmin ? <button className="secondary" onClick={() => setEditing(true)}>修改宝宝资料</button> : <p className="small muted">宝宝关键资料、食物过敏与忌口由管理员维护。</p>}
      <div className="member-list">{household.members.map((m) => <div className="member-row" key={m.id}><div><strong>{m.displayName}{m.userId === me.user.id ? "（我）" : ""}</strong><p className="small muted">{m.role === "admin" ? "家庭管理员" : "日常照护成员"}</p></div>{isAdmin && <div className="member-actions"><button className="text-button" disabled={busy} onClick={() => void action(() => api("households/" + household.id + "/members/" + m.id, "PATCH", { role: m.role === "admin" ? "member" : "admin", expectedRevision: m.revision }))}>{m.role === "admin" ? "改为日常成员" : "设为管理员"}</button><button className="text-button danger-text" disabled={busy} onClick={() => { if (window.confirm("移除 " + m.displayName + " 后，对方会立即失去此家庭的访问权限。继续吗？")) void action(() => api("households/" + household.id + "/members/" + m.id, "DELETE", { expectedRevision: m.revision })); }}>移除</button></div>}</div>)}</div>
    </section>
    {isAdmin && <section className="panel"><p className="eyebrow">一起加入</p><h2>邀请一位家人</h2><p className="muted">邀请 7 天内有效，仅供一人加入。家人可以查看和编辑日常安排。</p><button className="primary" disabled={busy} onClick={() => void action(async () => { const result = await api<{ url: string }>("households/" + household.id + "/invites", "POST", { role: "member" }, newKey()); setInviteLink(result.url); })}><LinkIcon size={17} aria-hidden />创建家庭邀请</button>
      {inviteLink && <div className="invite-result"><label>一次性邀请链接<input readOnly value={inviteLink} onFocus={(e) => e.target.select()} /></label><button className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(inviteLink); setNotice("邀请链接已复制，请发给这位家人。"); } catch { setNotice("请选中上方链接手动复制。"); } }}><Copy size={16} aria-hidden />复制链接</button><p className="small muted">完整链接只在这次创建后展示，请及时复制。</p></div>}
      <div className="invite-list">{invites.map((invite) => <div className="invite-row" key={invite.id}><span>{invite.status === "active" ? "待家人加入" : invite.status === "accepted" ? "已加入" : invite.status === "revoked" ? "已撤销" : "已过期"}<small className="muted">有效至 {new Date(invite.expiresAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</small></span>{invite.status === "active" && <button className="text-button" disabled={busy} onClick={() => void action(async () => { await api("households/" + household.id + "/invites/" + invite.id, "DELETE"); setInviteLink(""); })}>撤销</button>}</div>)}</div>
    </section>}
    <TemplateForm householdId={household.id} />
    <section className="panel"><p className="eyebrow">我的账号</p><h2>已登录设备</h2><p className="muted small">只展示你自己的登录；移除设备后，该设备需要重新登录。</p>{sessions.map((s) => <div className="device-row" key={s.id}><div><strong>{s.current ? "当前设备" : "其他设备"}</strong><p className="device-name small muted">{deviceName(s.device)}</p><p className="small muted">最近活跃 {new Date(s.lastSeenAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p></div>{!s.current && <button className="text-button" disabled={busy} onClick={() => void action(() => api("auth/sessions/" + s.id, "DELETE"))}>退出此设备</button>}</div>)}</section>
    <ChangePassword onChanged={onPasswordChanged} />
  </div>;
}
