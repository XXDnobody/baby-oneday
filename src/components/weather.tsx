"use client";
import { useState } from "react";
import { CloudSun, RefreshCw } from "lucide-react";
import type { Household } from "@/shared/contracts";
import type { ServiceStatus, WeatherLocation, WeatherProduct, WeatherView } from "@/shared/b3";
import { api } from "./api";
import { LoadState, stamp, useResource, useTask } from "./b2-common";
import { JobState, useJob } from "./b3-common";
import { WeatherLocationForm } from "./weather-location-form";

export function WeatherAttribution({ product }: { product: WeatherProduct }) {
  return <div className="weather-attribution small"><a href="https://www.qweather.com" target="_blank" rel="noreferrer">天气服务由和风天气驱动</a>{product.attributions.map((a, i) => <p key={i}>{/^https:\/\//.test(a) ? <a href={a} target="_blank" rel="noreferrer">{a}</a> : a}</p>)}{product.testService && <strong>专用测试服务 · 非真实天气</strong>}</div>;
}
export function WeatherPanel({ household, date, tick, activityTime, onOpenWardrobe }: { household: Household; date: string; tick: number; activityTime?: string; onOpenWardrobe?: () => void }) {
  const [startTime, setStart] = useState(activityTime ?? "09:00"), [endTime, setEnd] = useState(activityTime ? Number(activityTime.slice(0, 2)) < 23 ? String(Number(activityTime.slice(0, 2)) + 1).padStart(2, "0") + activityTime.slice(2) : "23:59" : "10:00");
  const [scene, setScene] = useState("outdoor"); const [jobId, setJobId] = useState(""); const task = useTask();
  const input = { date, startTime, endTime, scene };
  const resource = useResource<WeatherView>("households/" + household.id + "/weather?" + new URLSearchParams(input), tick);
  const { job, error } = useJob(household.id, jobId, resource.reload); const value = resource.data;
  return <section className="panel weather-panel"><div className="section-heading"><div><p className="eyebrow">天气与穿搭</p><h3><CloudSun size={20} aria-hidden />{value?.location?.label ?? household.city}</h3></div><button className="icon-button" aria-label="刷新天气" disabled={task.busy || !value?.location || !!job && ["queued", "running", "retry"].includes(job.state)} onClick={() => void task.run(input, async (key) => { const next = await api<{ jobId: string }>("households/" + household.id + "/weather", "POST", input, key); setJobId(next.jobId); })}><RefreshCw size={18} /></button></div>
    <p className="small muted">{date} · 活动时段预报</p><div className="form-columns weather-times"><label>开始时间<input type="time" value={startTime} onChange={(e) => setStart(e.target.value)} /></label><label>结束时间<input type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} /></label></div><label>活动场景<select value={scene} onChange={(e) => setScene(e.target.value)}><option value="outdoor">户外</option><option value="indoor">室内</option><option value="either">家人核对</option></select></label>
    {!value ? <LoadState error={resource.error} retry={resource.reload} /> : <>
      <div className="weather-current"><strong>当前天气</strong><p>{value.current?.state === "available" && value.current.data?.[0] ? value.current.data[0].text + " · " + value.current.data[0].temperature.toFixed(1) + "°C" : value.current?.reason || "尚无可用当前天气"}</p>{value.current && <p className="small muted">取数 {stamp(value.current.fetchedAt)} · {value.current.state === "available" ? "当前可用" : "不可作为当前值"}</p>}</div>
      {value.state !== "available" ? <p className="notice">{value.reason}</p> : <><p className="weather-range"><strong>{Math.min(...value.hours.map((p) => p.temperature)).toFixed(1)}–{Math.max(...value.hours.map((p) => p.temperature)).toFixed(1)}°C</strong><span>{startTime}–{endTime} 逐小时预报</span></p>{value.outfit && <div className="outfit"><h3>衣物类别参考</h3><p>{value.outfit.categories.join(" · ")}</p><ul>{value.outfit.reminders.map((r) => <li key={r}>{r}</li>)}</ul><details><summary>查看天气与建议依据</summary>{value.outfit.basis.map((b) => <p className="small muted" key={b}>{b}</p>)}<p className="small muted">规则 {value.outfit.ruleVersion}</p></details></div>}</>}
      {value.hourly && <><p className="small muted">预报取数 {stamp(value.hourly.fetchedAt)} · {value.hourly.validFrom ? "有效时段 " + stamp(value.hourly.validFrom) + " 至 " + stamp(value.hourly.validTo) : "无有效时段"}</p><WeatherAttribution product={{ ...value.hourly, attributions: [...new Set([...(value.current?.attributions ?? []), ...value.hourly.attributions])], testService: value.hourly.testService || !!value.current?.testService }} /></>}{value.current && !value.hourly && <WeatherAttribution product={value.current} />}
      <p className="small muted">活动由家人选择；刷新天气后可再决定是否调整。</p>
    </>}{onOpenWardrobe && <button className="text-button" onClick={onOpenWardrobe}>从衣服库搭一套</button>}{task.error && <p role="alert" className="error">{task.error}</p>}<JobState job={job} error={error} />
  </section>;
}
export function WeatherSettings({ household, tick, onSaved }: { household: Household; tick: number; onSaved: () => Promise<void> }) {
  const location = useResource<WeatherLocation | null>("households/" + household.id + "/weather-location", tick);
  const services = useResource<ServiceStatus>("households/" + household.id + "/services", tick);
  const [editing, setEditing] = useState(false); const task = useTask(); const [notice, setNotice] = useState("");
  return <section className="panel"><p className="eyebrow">家庭天气地点</p><h2>照着实际地点看天气</h2><p className="muted">{location.data?.label ?? household.city} · {location.data ? "已设置天气地点" : "尚未设置天气地点"}</p>{location.data && <details className="small muted"><summary>查看已保存的地点信息</summary><p>{location.data.latitude}, {location.data.longitude} · {location.data.provenance} · {stamp(location.data.confirmedAt)}</p></details>}
    {household.role === "admin" && <button className="secondary" onClick={() => setEditing(!editing)}>{editing ? "收起地点设置" : "设置天气地点"}</button>}
    {editing && household.role === "admin" && <WeatherLocationForm key={household.id + ":" + (location.data?.revision ?? 1)} initialLocation={location.data} householdCity={household.city} busy={task.busy} onSave={(fields) => {
      const input = { expectedRevision: location.data?.revision ?? 1, ...fields };
      void task.run(input, async (key) => { await api("households/" + household.id + "/weather-location", "PUT", input, key); setNotice("天气地点已保存；已有活动保持原样。"); setEditing(false); location.reload(); await onSaved(); });
    }} />}
    {services.data && !services.data.weather.ready && <p className="notice">天气服务尚未配置，暂时无法获取真实天气。</p>}{household.role !== "admin" && <p className="small muted">地点由家庭管理员维护。</p>}{notice && <p role="status" className="notice">{notice}</p>}{task.error && <p role="alert" className="error">{task.error}</p>}{location.error && <LoadState error={location.error} retry={location.reload} />}
  </section>;
}
