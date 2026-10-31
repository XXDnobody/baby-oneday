"use client";
import { useState } from "react";
import type { Household } from "@/shared/contracts";
import type { Automation, Job } from "@/shared/b3";
import { api } from "./api";
import { LoadState, localToday, useResource, useTask } from "./b2-common";
import { JobState, jobLabels, useJob } from "./b3-common";

export function AutomationSettings({ household, tick, onSaved }: { household: Household; tick: number; onSaved: () => Promise<void> }) {
  const resource = useResource<Automation>("households/" + household.id + "/automation", tick), jobs = useResource<Job[]>("households/" + household.id + "/jobs", tick);
  const task = useTask(); const [notice, setNotice] = useState(""); const value = resource.data;
  return <section className="panel"><p className="eyebrow">提前准备，留些余地</p><h2>次日自动计划</h2><p className="muted small">按家庭时区与工作日／周末模板准备，仅补可填的空位。人工留空、取消、删除和已确认 AI 结果均受保护。</p>
    {!value ? <LoadState error={resource.error} retry={resource.reload} /> : household.role !== "admin" ? <p className="notice">{value.enabled ? "每晚 " + value.runTime + " 准备次日安排" : "夜间自动准备已关闭"} · 设置由管理员修改。</p> : <form key={value.revision} className="form-stack" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const input = { expectedRevision: value.revision, enabled: form.has("enabled"), runTime: String(form.get("runTime")) }; void task.run(input, async (key) => { await api("households/" + household.id + "/automation", "PUT", input, key); setNotice("自动计划设置已保存，已有安排保持原样。"); resource.reload(); await onSaved(); }); }}><label className="checkbox"><input type="checkbox" name="enabled" defaultChecked={value.enabled} />每晚准备次日安排</label><label>夜间准备时间<input name="runTime" type="time" required defaultValue={value.runTime} /></label><p className="small muted">{household.timezone} · 20:00 为工程默认建议，可按家庭节奏调整。当地周六、周日使用周末模板。</p><button className="primary" disabled={task.busy}>保存自动计划设置</button></form>}
    {notice && <p className="notice" role="status">{notice}</p>}{task.error && <p className="error" role="alert">{task.error}</p>}
    <details className="automation-history"><summary>最近准备任务</summary>{jobs.data?.filter((j) => j.kind === "automatic").map((j) => <div key={j.id}><p>{String(j.result?.date ?? "计划准备")} · {jobLabels[j.state]} · 第 {j.attempts} 次处理</p>{j.errorMessage && <p className="small muted">{j.errorMessage}</p>}{j.result?.reason ? <p className="small muted">{String(j.result.reason)}</p> : null}{j.state === "failed" && household.role === "admin" && <button className="secondary" disabled={task.busy} onClick={() => void task.run({ id: j.id }, async () => { await api("households/" + household.id + "/jobs/" + j.id + "/retry", "POST", {}); jobs.reload(); })}>重试准备</button>}</div>)}</details>
  </section>;
}
export function PrepareTomorrow({ household, onSaved }: { household: Household; onSaved: () => Promise<void> }) {
  const [jobId, setJobId] = useState(""); const task = useTask(); const { job, error } = useJob(household.id, jobId, () => { void onSaved(); });
  const tomorrow = new Date(Date.parse(localToday()) + 86400000).toISOString().slice(0, 10);
  return <section className="panel quiet-panel"><h3>明天，提前一点准备</h3><p className="small muted">采用已启用的内容。没有适用候选时保留待安排，并说明原因。</p>{household.role === "admin" ? <button className="secondary" disabled={task.busy || !!job && ["queued", "running", "retry"].includes(job.state)} onClick={() => void task.run({ date: tomorrow }, async (key) => { const next = await api<{ jobId: string }>("households/" + household.id + "/automatic-plans", "POST", { date: tomorrow }, key); setJobId(next.jobId); })}>准备 {tomorrow} 安排</button> : <p className="small muted">可在家庭页查看自动计划设置。</p>}<JobState job={job} error={error} />{task.error && <p className="error" role="alert">{task.error}</p>}{job?.result?.reason ? <p className="small muted">{String(job.result.reason)}</p> : null}</section>;
}
