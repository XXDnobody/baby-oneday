"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Mail, ShieldCheck, Sprout, Users } from "lucide-react";
import { api, message } from "./api";

export type EntryMode = "login" | "register" | "reset" | "join";
interface Props { initialMode: EntryMode; token: string; onSignedIn: () => Promise<void>; onRegistered: () => void }
export function AuthScreen({ initialMode, token, onSignedIn, onRegistered }: Props) {
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">(initialMode === "join" ? "login" : initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [remember, setRemember] = useState(true);
  const [challengeId, setChallengeId] = useState("");
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wait, setWait] = useState(0);
  const [invitation, setInvitation] = useState<{ name: string } | null>(null);
  useEffect(() => {
    if (initialMode !== "join") return;
    api<{ name: string }>("invites/preview", "POST", { token }).then(setInvitation).catch((e: unknown) => setError(message(e)));
  }, [initialMode, token]);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "login") {
        await api("auth/session", "POST", { email, password, remember });
        await onSignedIn();
      } else if (mode === "forgot") {
        const result = await api<{ message: string; retryAfter: number }>("auth/recovery/request", "POST", { email });
        setNotice(result.message); setWait(result.retryAfter);
      } else if (mode === "reset") {
        await api("auth/recovery/reset", "POST", { token, password });
        setPassword(""); setMode("login"); setNotice("密码已更新，所有旧设备登录已失效。请用新密码登录。");
        window.history.replaceState(null, "", "/");
      } else if (!challengeId) {
        const result = await api<{ challengeId: string; retryAfter: number }>("auth/email/verification", "POST", { email, registrationToken: token });
        setChallengeId(result.challengeId); setWait(result.retryAfter); setNotice("验证码已发送，请检查邮箱。");
      } else if (!ticket) {
        const result = await api<{ emailVerificationTicket: string }>("auth/email/verify", "POST", { challengeId, code });
        setTicket(result.emailVerificationTicket); setNotice("邮箱已验证，请设置称呼与密码。");
      } else {
        await api("auth/register", "POST", { emailVerificationTicket: ticket, displayName, password, registrationToken: token });
        onRegistered(); setInvitation(null); setMode("login"); setPassword(""); setNotice("注册成功，请登录。");
        window.history.replaceState(null, "", "/");
      }
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const title = mode === "register" ? "一起照顾每一天" : mode === "forgot" ? "找回密码" : mode === "reset" ? "设置新密码" : "欢迎回到宝宝计划";
  const action = mode === "register" ? !challengeId ? "发送验证码" : !ticket ? "验证邮箱" : "完成注册" : mode === "forgot" ? "发送重置邮件" : mode === "reset" ? "保存新密码" : "登录";
  return <main className="auth-page">
    <section className="auth-story">
      <Link className="brand" href="/"><span className="brand-mark"><Sprout aria-hidden /></span>宝宝计划</Link>
      <div className="auth-story-content"><p className="eyebrow">FAMILY, EVERY DAY</p><h1>把小日子，<br />一起照顾好。</h1><p>一份共同的安排，让每位家人<br />都知道接下来做什么。</p>
        <div className="story-line"><CalendarDays aria-hidden /><span>每天的安排，家人一起看</span></div>
        <div className="story-line"><Users aria-hidden /><span>各自登录，共同照护</span></div>
        <div className="story-line"><ShieldCheck aria-hidden /><span>每次改动，安心保存</span></div>
      </div><span className="auth-footer">宝宝计划 · 家庭日常工作台</span>
    </section>
    <section className="auth-form-section"><div className="auth-form">
      <p className="eyebrow">从今天的小事开始</p><h2>{title}</h2>
      <p className="muted">{mode === "register" ? "先验证邮箱，再设置密码；每位家人使用自己的账号。" : mode === "forgot" ? "输入注册邮箱，我们会发送一次性重置链接。" : mode === "reset" ? "保存后，其他设备需要重新登录。" : "查看今天的安排，和家人接上手。"}</p>
      {invitation && <div className="notice">邀请你加入「{invitation.name}」。已有账号可登录后确认加入。</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      <form onSubmit={submit} className="form-stack">
        {mode !== "reset" && <label>邮箱<input type="email" name="email" autoComplete="email" required maxLength={254} value={email} disabled={busy || (mode === "register" && !!challengeId)} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>}
        {mode === "register" && challengeId && !ticket && <label>邮箱验证码<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" /></label>}
        {mode === "register" && ticket && <label>家人怎么称呼你<input name="displayName" autoComplete="nickname" required maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="例如：爸爸、妈妈、奶奶" /></label>}
        {(mode === "login" || mode === "reset" || (mode === "register" && ticket)) && <label>{mode === "login" ? "密码" : "新密码"}<input type="password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "login" ? "输入密码" : "至少 12 个字符"} /></label>}
        {mode === "login" && <div className="form-split"><label className="checkbox"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />常用设备保持登录</label><button type="button" className="text-button" onClick={() => { setMode("forgot"); setError(""); setNotice(""); }}>忘记密码</button></div>}
        <button className="primary" disabled={busy || (mode === "forgot" && wait > 0)}>{busy ? "正在处理…" : mode === "forgot" && wait ? wait + " 秒后可重发" : action}<ArrowRight size={18} aria-hidden /></button>
      </form>
      {mode === "register" && challengeId && !ticket && <button className="text-button" disabled={busy || wait > 0} onClick={() => { setChallengeId(""); setCode(""); setError(""); setNotice("请核对邮箱后重新发送验证码。"); }}>{wait ? wait + " 秒后可重新申请" : "重新申请或修改邮箱"}</button>}
      {(mode !== "login" || invitation) && <button className="text-button" disabled={busy} onClick={() => { setMode(mode === "login" && invitation ? "register" : "login"); setError(""); setNotice(""); }}>{mode === "login" && invitation ? "还没有账号？验证邮箱并加入" : "返回登录"}</button>}
      <div className="auth-note"><Mail size={17} aria-hidden /><span>本机测试邮件可在 <a href="http://127.0.0.1:8025" target="_blank" rel="noreferrer">本地测试邮箱</a> 查看。</span></div>
      {initialMode === "login" && !token && <p className="small muted">首次使用请打开本机初始化生成的注册链接；家人通过邀请加入。</p>}
    </div></section>
  </main>;
}
