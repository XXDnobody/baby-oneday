"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Day, Household, ItemFields, PlanItem } from "@/shared/contracts";
import { api, ApiError, message, newKey } from "./api";
import type { ContentLibrary } from "@/shared/b2";
import { useResource, useTask } from "./b2-common";
import { ContentBody } from "./content-library";

interface Props { household: Household; day: Day; item: PlanItem | null; onClose: () => void; onSaved: () => Promise<void> }
export function PlanEditor({ household, day, item, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const requestKey = useRef<string | null>(null);
  const [values, setValues] = useState<ItemFields>(item ? { kind: item.kind, title: item.title, time: item.time, notes: item.notes, caregiverId: item.caregiverId, contentId: item.contentId, contentVersion: item.contentVersion, scene: item.scene } : { kind: "routine", title: "", time: "09:00", notes: "", caregiverId: null, contentId: null, contentVersion: null, scene: "either" });
  const [baseRevision, setBaseRevision] = useState(item?.revision ?? day.plan?.revision ?? 1);
  const [conflict, setConflict] = useState<{ revision: number; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const actions = useTask(); const [deleting, setDeleting] = useState(false);
  const content = useResource<ContentLibrary>("households/" + household.id + "/content?kind=" + (values.kind === "meal" ? "recipe" : "activity") + "&date=" + day.date + "&scene=" + values.scene, 0, values.kind !== "routine");
  useEffect(() => { dialog.current?.showModal(); titleInput.current?.focus(); }, []);
  function update<K extends keyof ItemFields>(key: K, value: ItemFields[K]) { setValues((v) => ({ ...v, [key]: value })); requestKey.current = null; }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    requestKey.current ??= newKey();
    try {
      let plan = day.plan;
      if (!item && !plan) plan = { ...(await api<{ id: string; revision: number }>("households/" + household.id + "/plans", "POST", { date: day.date }, requestKey.current + "_plan")), date: day.date, items: [] };
      const path = "households/" + household.id + (item ? "/plan-items/" + item.id : "/plans/" + plan!.id + "/items");
      await api(path, item ? "PATCH" : "POST", { ...values, expectedRevision: baseRevision }, requestKey.current);
      await onSaved(); onClose();
    } catch (e) {
      setError(message(e));
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        try {
          const latest = await api<Day>("households/" + household.id + "/today?date=" + day.date);
          const latestItem = latest.plan?.items.find((v) => v.id === item?.id);
          setConflict({ revision: item ? latestItem?.revision ?? baseRevision : latest.plan?.revision ?? 1, description: item ? latestItem ? latestItem.time + " · " + latestItem.title + "（" + latestItem.updatedBy + "）" : "此安排已不可用" : "当天安排已更新为 " + (latest.plan?.items.length ?? 0) + " 项" });
        } catch (refreshError) { setError(message(refreshError)); }
      }
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor-dialog" onCancel={onClose} aria-labelledby="editor-title">
    <div className="dialog-header"><div><p className="eyebrow">{day.date}</p><h2 id="editor-title">{item ? "调整这项安排" : "添加一项安排"}</h2></div><button type="button" className="icon-button" aria-label="关闭编辑" onClick={onClose}><X /></button></div>
    <p className="muted">保存后，家人会看到这项更新。</p>
    {error && <div className="error" role="alert">{error}</div>}
    {conflict && <div className="notice"><strong>家人保存的最新内容</strong><p>{conflict.description}</p><p>你的输入保留在下方，请核对后再决定。</p><button type="button" className="secondary" onClick={() => { setBaseRevision(conflict.revision); setConflict(null); setError(""); requestKey.current = null; }}>已核对，保留我的输入继续</button></div>}
    <form className="form-stack" onSubmit={save}>
      <label>安排名称<input ref={titleInput} name="title" value={values.title} required maxLength={120} onChange={(e) => update("title", e.target.value)} placeholder="例如：午餐、一起读绘本" /></label>
      <div className="form-columns"><label>类型<select value={values.kind} onChange={(e) => { setValues((v) => ({ ...v, kind: e.target.value as ItemFields["kind"], contentId: null, contentVersion: null })); requestKey.current = null; }}><option value="routine">生活作息</option><option value="meal">饮食安排</option><option value="activity">亲子活动</option></select></label><label>时间<input type="time" name="time" required value={values.time} onChange={(e) => update("time", e.target.value)} /></label></div>
      {values.kind !== "routine" && <><label>活动／用餐场景<select value={values.scene} onChange={(e) => update("scene", e.target.value as ItemFields["scene"])}><option value="either">由家人核对场景</option><option value="indoor">室内</option><option value="outdoor">户外</option></select></label><label>选择已启用且适用的内容<select value={values.contentId ?? ""} onChange={(e) => { const candidate = content.data?.items.find((v) => v.id === e.target.value); setValues((v) => ({ ...v, contentId: candidate?.id ?? null, contentVersion: candidate?.version ?? null, title: candidate?.title ?? v.title })); requestKey.current = null; }}><option value="">手动填写／保留待安排</option>{values.contentId && !content.data?.items.some((v) => v.id === values.contentId && v.eligible) && <option value={values.contentId}>原选内容（需重新核对）</option>}{content.data?.items.filter((v) => v.eligible).sort((a, b) => b.score - a.score).map((v) => <option key={v.id} value={v.id}>{v.title} · 版本 {v.version}{v.score ? " · 结合已记录的食材／偏好排序" : ""}</option>)}</select></label>{content.data && !content.data.items.some((v) => v.eligible) && <div className="notice"><p>待安排：当前没有已启用且适用的候选。{values.kind === "meal" && household.child?.foodStatus === "unknown" ? "食物限制仍未知，不推断适用。" : "可在内容库核对，或由家人手动填写。"}</p><button type="button" className="secondary" onClick={() => { setValues((v) => ({ ...v, title: v.kind === "meal" ? "饮食待安排" : "活动待安排", contentId: null, contentVersion: null })); requestKey.current = null; }}>明确保留待安排</button></div>}{content.error && <div className="error" role="alert">{content.error}</div>}</>}
      <label>照护者<select value={values.caregiverId ?? ""} onChange={(e) => update("caregiverId", e.target.value || null)}><option value="">家人共同照护</option>{household.members.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
      <label>给家人的说明 <span className="muted">（选填）</span><textarea name="notes" rows={4} maxLength={2000} value={values.notes} onChange={(e) => update("notes", e.target.value)} placeholder="准备什么，或者需要注意的小事" /></label>
      <div className="dialog-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>暂不修改</button><button className="primary" disabled={busy || !!conflict}>{busy ? "正在保存…" : "保存并共享"}</button></div>
    </form>
    {item?.contentSnapshot && <details className="content-detail"><summary>原来采用的内容与来源</summary><ContentBody v={item.contentSnapshot} /></details>}
    {item && <section className="danger-zone"><h3>取消与删除分别处理</h3><p className="small muted">取消仍保留当天安排；删除移入 30 天回收站。关联的实际记录及当时快照保留。</p>{actions.error && <div className="error" role="alert">{actions.error}</div>}<div className="button-row"><button type="button" className="secondary" disabled={actions.busy || busy} onClick={() => void actions.run({ action: item.status === "cancelled" ? "resume" : "cancel", revision: baseRevision }, async (key) => { await api("households/" + household.id + "/plan-items/" + item.id + (item.status === "cancelled" ? "/resume" : "/cancel"), "POST", { expectedRevision: baseRevision }, key); await onSaved(); onClose(); })}>{item.status === "cancelled" ? "重新安排此项" : "取消这项安排"}</button><button type="button" className="text-button danger-text" onClick={() => setDeleting(true)}>删除至回收站</button></div>{deleting && <div className="notice"><p>确认将「{item.title}」移入回收站？30 天内可预览并恢复。</p><button type="button" className="secondary" disabled={actions.busy || busy} onClick={() => void actions.run({ delete: item.id, revision: baseRevision }, async (key) => { await api("households/" + household.id + "/plan-items/" + item.id, "DELETE", { expectedRevision: baseRevision }, key); await onSaved(); onClose(); })}>确认删除这项安排</button><button type="button" className="text-button" onClick={() => setDeleting(false)}>保留安排</button></div>}</section>}
  </dialog>;
}
