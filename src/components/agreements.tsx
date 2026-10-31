"use client";
import { useState, type FormEvent } from "react";
import type { Household } from "@/shared/contracts";
import type { Agreements as Values } from "@/shared/b2";
import { api } from "./api";
import { LoadState, stamp, useResource, useTask } from "./b2-common";
export function Agreements({ household, tick, onSaved, compact = false }: { household: Household; tick: number; onSaved: () => Promise<void>; compact?: boolean }) {
  const path = "households/" + household.id + "/agreements"; const remote = useResource<Values>(path, tick);
  return <section className={compact ? "panel quiet-panel" : "panel full-width"}><h3>家里的共同提醒</h3>{!remote.data ? <LoadState error={remote.error} retry={remote.reload} /> : <>{remote.data.items.filter((i) => i.enabled).length ? <ul>{remote.data.items.filter((i) => i.enabled).map((i, index) => <li key={index}>{i.text}</li>)}</ul> : <p className="muted small">家人还没有设置已认可的共同提醒。</p>}{remote.data.confirmedBy && <p className="small muted">约定来源：家庭共同约定 · {remote.data.confirmedBy}记录于 {stamp(remote.data.confirmedAt)} · 版本 {remote.data.revision}</p>}{!compact && household.role === "admin" && <ReminderEditor key={household.id} initial={remote.data} latest={remote.data} path={path} onSaved={onSaved} />}{!compact && household.role !== "admin" && <p className="small muted">由管理员与家人确认后修改，所有成员可查看。</p>}</>}</section>;
}
function ReminderEditor({ initial, latest, path, onSaved }: { initial: Values; latest: Values; path: string; onSaved: () => Promise<void> }) {
  const [text, setText] = useState(initial.items.filter((i) => i.enabled).map((i) => i.text).join("\n")); const [base, setBase] = useState(initial.revision); const task = useTask();
  async function save(e: FormEvent) { e.preventDefault(); const input = { expectedRevision: base, items: text.split("\n").map((s) => s.trim()).filter(Boolean).map((text) => ({ text, enabled: true })) }; await task.run(input, async (key) => { const saved = await api<Values>(path, "PUT", input, key); setBase(saved.revision); await onSaved(); }); }
  return <form className="form-stack" onSubmit={save}><label>已与家人确认的提醒（每行一条，清空可停用）<textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>{latest.revision !== base && <div className="notice"><p>提醒已有新版本，请核对后载入再修改。</p><button type="button" className="secondary" onClick={() => { setBase(latest.revision); setText(latest.items.filter((i) => i.enabled).map((i) => i.text).join("\n")); }}>载入最新提醒</button></div>}{task.error && <div className="error" role="alert">{task.error}</div>}<button className="primary" disabled={task.busy || latest.revision !== base}>保存共同提醒</button></form>;
}
