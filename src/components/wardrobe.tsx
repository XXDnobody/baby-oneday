"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { Camera, Check, CloudSun, ImagePlus, Plus, RefreshCw, Shirt, X } from "lucide-react";
import type { Day, Household } from "@/shared/contracts";
import { garmentCategories, garmentFields, garmentStates, garmentWarmth, outfitActivities, type Garment, type GarmentFields, type OutfitInput, type OutfitResult, type Wardrobe } from "@/shared/wardrobe";
import { api, ApiError, message, newKey } from "./api";
import { LoadState, stamp, useResource, useTask } from "./b2-common";
import { CalendarPicker } from "./calendar-picker";
import { JobState, useJob } from "./b3-common";
import { WeatherAttribution } from "./weather";
import styles from "./wardrobe.module.css";

const empty: GarmentFields = { name: "", category: "top", warmth: "medium", color: "", size: "", scene: "either", activities: ["daily"], status: "ready", waterproof: false, windproof: false, notes: "" };
const entries = <T extends string>(object: Record<T, string>) => Object.entries(object) as [T, string][];
function fieldsOf(garment: Garment): GarmentFields { return garmentFields.parse(Object.fromEntries(Object.keys(empty).map((k) => [k, garment[k as keyof GarmentFields]]))); }
function Photo({ garment, compact = false }: { garment: Garment; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className={compact ? styles.miniPhoto : styles.photo}>
    {failed ? <div className={styles.photoFallback}><Shirt size={28} aria-hidden /><span>照片暂未加载</span><button className="text-button" onClick={() => setFailed(false)}>重试照片</button></div> : <Image src={garment.photoUrl} alt={garment.name + "的衣物照片"} width={400} height={400} unoptimized onError={() => setFailed(true)} />}
  </div>;
}

async function preparePhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请选择 JPG、PNG 或 WebP 照片，也可以直接拍照。");
  if (file.size > 20 * 1024 * 1024) throw new Error("照片超过 20 MB，请选择较小的照片。");
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("这张照片无法读取，请重新选择。")); image.src = url; });
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("照片处理暂时不可用，请重试。");
    context.fillStyle = "#f6f8f5"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(url); }
}

function GarmentEditor({ householdId, item, onClose, onSaved }: { householdId: string; item: Garment | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null), album = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null), name = useRef<HTMLInputElement>(null);
  const pending = useRef(false), requestKey = useRef<string | null>(null), photoRequest = useRef(0);
  const [values, setValues] = useState<GarmentFields>(item ? fieldsOf(item) : empty);
  const [photo, setPhoto] = useState(""), [photoBusy, setPhotoBusy] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [baseRevision, setBaseRevision] = useState(item?.revision ?? 1), [conflict, setConflict] = useState<Garment | null>(null);
  useEffect(() => { dialog.current?.showModal(); name.current?.focus(); }, []);
  function update<K extends keyof GarmentFields>(key: K, value: GarmentFields[K]) { setValues((v) => ({ ...v, [key]: value })); requestKey.current = null; }
  async function choose(file?: File) {
    if (!file) return;
    const request = ++photoRequest.current; setPhotoBusy(true); setError("");
    try { const next = await preparePhoto(file); if (request === photoRequest.current) { setPhoto(next); requestKey.current = null; } }
    catch (e) { if (request === photoRequest.current) setError(message(e)); }
    finally { if (request === photoRequest.current) setPhotoBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (pending.current || photoBusy || conflict) return;
    setError("");
    if (!item && !photo) { setError("请先拍照或从相册选择一张衣物照片。"); return; }
    const parsed = garmentFields.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues.map((i) => i.message).join("；")); return; }
    pending.current = true; setBusy(true); requestKey.current ??= newKey();
    try {
      await api("households/" + householdId + "/wardrobe" + (item ? "/" + item.id : ""), item ? "PATCH" : "POST", { ...parsed.data, ...(photo ? { photo } : {}), ...(item ? { expectedRevision: baseRevision } : {}) }, requestKey.current);
      await onSaved(); onClose();
    } catch (e) {
      setError(message(e));
      if (item && e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        try { setConflict(await api<Garment>("households/" + householdId + "/wardrobe/" + item.id)); }
        catch (refreshError) { setError(message(refreshError)); }
      }
    } finally { pending.current = false; setBusy(false); }
  }
  const photoSource = photo || item?.photoUrl;
  return <dialog ref={dialog} className={"editor-dialog " + styles.editor} aria-labelledby="garment-editor-title" onCancel={(e) => { if (busy) e.preventDefault(); else onClose(); }}>
    <div className="dialog-header"><div><p className="eyebrow">家人一起整理</p><h2 id="garment-editor-title">{item ? "编辑这件衣物" : "添一件衣物"}</h2></div><button className="icon-button" disabled={busy} aria-label="关闭衣物编辑" onClick={onClose}><X /></button></div>
    <p className="muted small">照片方便家人认衣物，类别和适用情况由你确认。</p>
    <form onSubmit={(e) => void save(e)} className="form-stack">
      <fieldset disabled={busy} className={styles.editorFields}>
        <div className={styles.photoPicker}>
          <div className={styles.uploadPreview}>{photoSource ? <Image src={photoSource} alt="待保存的衣物照片" width={300} height={300} unoptimized /> : <><Shirt size={44} aria-hidden /><span>拍一张衣物的清晰照片</span></>}</div>
          <div className={styles.photoButtons}><button type="button" className="primary" disabled={photoBusy} onClick={() => camera.current?.click()}><Camera size={18} aria-hidden />拍照</button><button type="button" className="secondary" disabled={photoBusy} onClick={() => album.current?.click()}><ImagePlus size={18} aria-hidden />从相册选择</button><p className="small muted">JPG / PNG / WebP · 最大 20 MB<br />{photoBusy ? "正在处理照片…" : "保存前可重新选择"}</p></div>
          <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden aria-label="拍摄衣物照片" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={album} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="选择衣物照片" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <label>衣物名称<input ref={name} required maxLength={60} value={values.name} placeholder="例如：奶油色小熊卫衣" onChange={(e) => update("name", e.target.value)} /></label>
        <div className="form-columns"><label>衣物类别<select value={values.category} onChange={(e) => update("category", e.target.value as GarmentFields["category"])}>{entries(garmentCategories).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>厚薄<select value={values.warmth} onChange={(e) => update("warmth", e.target.value as GarmentFields["warmth"])}>{entries(garmentWarmth).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div>
        <div className="form-columns"><label>颜色（选填）<input maxLength={30} value={values.color} onChange={(e) => update("color", e.target.value)} placeholder="例如：米白" /></label><label>尺码（选填）<input maxLength={30} value={values.size} onChange={(e) => update("size", e.target.value)} placeholder="例如：90 cm" /></label></div>
        <div className="form-columns"><label>适用场景<select value={values.scene} onChange={(e) => update("scene", e.target.value as GarmentFields["scene"])}><option value="either">室内外通用</option><option value="indoor">室内</option><option value="outdoor">户外</option></select></label><label>衣物状态<select value={values.status} onChange={(e) => update("status", e.target.value as GarmentFields["status"])}>{entries(garmentStates).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div>
        <fieldset className={styles.activityFields}><legend>适用活动（至少选一项）</legend><div className={styles.checks}>{entries(outfitActivities).map(([key, label]) => <label key={key} className="checkbox"><input type="checkbox" checked={values.activities.includes(key)} onChange={(e) => update("activities", e.target.checked ? [...values.activities, key] : values.activities.filter((v) => v !== key))} />{label}</label>)}</div></fieldset>
        <div className={styles.checks}><label className="checkbox"><input type="checkbox" checked={values.windproof} onChange={(e) => update("windproof", e.target.checked)} />挡风</label><label className="checkbox"><input type="checkbox" checked={values.waterproof} onChange={(e) => update("waterproof", e.target.checked)} />防水</label></div>
        <label>衣物备注（选填）<textarea rows={2} maxLength={500} value={values.notes} onChange={(e) => update("notes", e.target.value)} placeholder="例如：裤脚偏长，出门前折一折" /></label>
      </fieldset>
      {error && <div className="error" role="alert">{error}</div>}
      {conflict && <div className="notice"><strong>家人刚刚更新了这件衣物</strong><p>{conflict.name} · {garmentStates[conflict.status]} · {garmentWarmth[conflict.warmth]} · {conflict.updatedBy}</p><details><summary>查看家人保存的完整资料</summary><p>类别：{garmentCategories[conflict.category]}；颜色：{conflict.color || "未填"}；尺码：{conflict.size || "未填"}；场景：{conflict.scene === "either" ? "室内外" : conflict.scene === "indoor" ? "室内" : "户外"}</p><p>活动：{conflict.activities.map((a) => outfitActivities[a]).join("、")}；挡风：{conflict.windproof ? "是" : "否"}；防水：{conflict.waterproof ? "是" : "否"}；备注：{conflict.notes || "未填"}</p><Photo key={conflict.photoUrl} garment={conflict} compact /></details><p>你的照片和输入仍保留，核对后再保存。</p><button type="button" className="secondary" onClick={() => { setBaseRevision(conflict.revision); setConflict(null); setError(""); requestKey.current = null; }}>已核对，保留我的输入继续</button></div>}
      <p className="small muted">保存后，当前家庭的家人都能查看和整理。</p>
      <div className="dialog-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || photoBusy || !!conflict}>{busy ? "正在保存…" : item ? "保存衣物" : "放进衣服库"}</button></div>
    </form>
  </dialog>;
}

function OutfitPlanner({ household, day, tick, onDateChange, onOpenLibrary }: { household: Household; day: Day; tick: number; onDateChange: (date: string) => void; onOpenLibrary: () => void }) {
  const activities = day.plan?.items.filter((i) => i.kind === "activity" && i.status === "active") ?? [];
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState<Omit<OutfitInput, "date">>({ startTime: "09:00", endTime: "10:00", scene: "outdoor", activity: "daily" });
  const [jobId, setJobId] = useState(""); const task = useTask();
  const query = { ...input, date: day.date }, valid = input.endTime > input.startTime;
  const resource = useResource<OutfitResult>("households/" + household.id + "/wardrobe/outfits?" + new URLSearchParams(query), tick, valid);
  const { job, error: jobError } = useJob(household.id, jobId, resource.reload);
  const value = resource.data, weather = value?.weather;
  const refreshing = task.busy || !!job && ["queued", "running", "retry"].includes(job.state);
  return <div className={styles.planner}>
    <section className={"panel " + styles.conditions}><p className="eyebrow">先看看今天怎么过</p><h2>出门前，搭一套</h2>
      <div className="form-stack"><CalendarPicker id="outfit-date" label="穿搭日期" required value={day.date} onChange={onDateChange} />
        <label>带入当天活动<select value={activities.some((a) => a.id === selected) ? selected : ""} onChange={(e) => { setSelected(e.target.value); const activity = activities.find((a) => a.id === e.target.value); if (activity) setInput((v) => ({ ...v, startTime: activity.time, endTime: activity.time < "23:00" ? String(Number(activity.time.slice(0, 2)) + 1).padStart(2, "0") + activity.time.slice(2) : "23:59", scene: activity.scene })); }}><option value="">自己选择时间和场景</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.time} · {a.title}</option>)}</select></label>
        <div className={"form-columns " + styles.times}><label>开始时间<input type="time" required value={input.startTime} onChange={(e) => { setSelected(""); setInput({ ...input, startTime: e.target.value }); }} /></label><label>结束时间<input type="time" required value={input.endTime} onChange={(e) => setInput({ ...input, endTime: e.target.value })} /></label></div>
        <label>活动场景<select value={input.scene} onChange={(e) => { setSelected(""); setInput({ ...input, scene: e.target.value as OutfitInput["scene"] }); }}><option value="outdoor">户外</option><option value="indoor">室内</option><option value="either">室内外待核对</option></select></label>
        <label>活动方式<select value={input.activity} onChange={(e) => setInput({ ...input, activity: e.target.value as OutfitInput["activity"] })}>{entries(outfitActivities).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      </div>
      <p className={"small muted " + styles.conditionNote}>选择后自动更新搭配。衣物由家人确认适用活动，正式日程保持原样。</p>
    </section>
    <div className={styles.results} aria-live="polite">
      {!valid ? <div className="error" role="alert">结束时间须晚于开始时间。</div> : !value ? <section className="panel"><LoadState error={resource.error} retry={resource.reload} /></section> : <>
        <section className={styles.weatherSummary}><div className={styles.weatherTitle}><CloudSun size={26} aria-hidden /><div><p className="small muted">{weather?.location?.label ?? household.city} · {input.startTime}–{input.endTime}</p><h3>{weather?.state === "available" ? Math.min(...weather.hours.map((h) => h.temperature)).toFixed(0) + "–" + Math.max(...weather.hours.map((h) => h.temperature)).toFixed(0) + "°C · " + weather.hours[0]?.text : "先确认所选时段天气"}</h3></div></div><button className="secondary" disabled={refreshing || !weather?.location} onClick={() => void task.run(query, async (key) => { const next = await api<{ jobId: string }>("households/" + household.id + "/weather", "POST", { date: day.date, startTime: input.startTime, endTime: input.endTime, scene: input.scene }, key); setJobId(next.jobId); })}><RefreshCw size={16} aria-hidden />{refreshing ? "刷新中…" : "刷新天气"}</button></section>
        {value.state === "weather_unavailable" ? <section className="panel"><h3>天气确认后，再来搭配</h3><p className="notice">{weather?.reason}</p><p className="muted small">可以先把衣物放进库里，再选择预报覆盖的日期和时段。天气地点可在“我的家庭”中设置。</p><button className="text-button" onClick={onOpenLibrary}>去整理衣服库</button></section> : <>
          <div className={styles.resultHeading}><h2>{value.state === "empty" ? "先找到适用的衣物" : "从我们已有的衣物里选"}</h2><span className="small muted">{outfitActivities[input.activity]} · {value.outfits.length} 套参考</span></div>
          <div className={styles.outfits}>{value.outfits.map((outfit) => <section className={"panel " + styles.outfitCard} key={outfit.id}><div className={styles.setHeading}><h3>{outfit.label}</h3><span className={outfit.missing.length ? styles.incomplete : styles.complete}>{outfit.missing.length ? "还需补齐" : "衣物已齐"}</span></div>
            {outfit.items.length > 0 ? <div className={styles.outfitItems}>{outfit.items.map(({ garment, reason }) => <div key={garment.id} className={styles.outfitItem}><Photo key={garment.photoUrl} garment={garment} compact /><div><strong>{garment.name}</strong><p className="small muted">{reason}</p>{garment.notes && <p className={styles.garmentNote}>{garment.notes}</p>}</div></div>)}</div> : <div className={styles.noClothes}><Shirt size={36} aria-hidden /><p>还没有适合这个场景的可穿衣物</p></div>}
            {outfit.missing.length > 0 && <div className={styles.missing}><strong>穿前还要准备</strong><ul>{outfit.missing.map((s) => <li key={s}>{s}</li>)}</ul><button className="text-button" onClick={onOpenLibrary}>查看衣服库</button></div>}
          </section>)}</div>
          <section className={"panel " + styles.reminders}><h3><Check size={18} aria-hidden />穿之前，再看一眼</h3><ul>{value.reminders.map((r) => <li key={r}>{r}</li>)}</ul><details><summary>搭配与天气依据</summary>{weather?.outfit?.basis.map((b) => <p key={b}>{b}</p>)}<p>仅选择标记“可穿”、场景与活动适用的实际入库衣物。保暖规则为通用参考，非专业审核结论。</p><p>规则：{value.ruleVersion}</p></details></section>
        </>}
        {weather?.hourly && <section className={styles.attribution}><p>预报取数：{stamp(weather.hourly.fetchedAt)} · {weather.hourly.state === "available" ? "预报有效性按所选时段检查" : "当前不可作为搭配依据"}</p><WeatherAttribution product={weather.hourly} /></section>}
        {resource.error && <LoadState error={resource.error} retry={resource.reload} />}
      </>}
      {task.error && <div className="error" role="alert">{task.error}</div>}<JobState job={job} error={jobError} />
    </div>
  </div>;
}

export function WardrobePage({ household, day, tick, onSaved, onDateChange }: { household: Household; day: Day; tick: number; onSaved: () => Promise<void>; onDateChange: (date: string) => void }) {
  const [section, setSection] = useState<"outfits" | "library">("outfits"), [editor, setEditor] = useState<Garment | null>();
  const [category, setCategory] = useState("all"), [status, setStatus] = useState("visible"), [search, setSearch] = useState(""), [notice, setNotice] = useState("");
  const resource = useResource<Wardrobe>("households/" + household.id + "/wardrobe", tick), task = useTask();
  const items = resource.data?.items ?? [], ready = items.filter((g) => g.status === "ready").length;
  const visible = items.filter((g) => (category === "all" || g.category === category) && (status === "all" || status === "visible" && g.status !== "archived" || g.status === status) && (g.name + " " + g.color + " " + g.size).toLowerCase().includes(search.trim().toLowerCase()));
  async function saved() { resource.reload(); await onSaved(); }
  function markStatus(item: Garment, next: GarmentFields["status"]) {
    void task.run({ id: item.id, revision: item.revision, status: next }, async (key) => {
      try { await api("households/" + household.id + "/wardrobe/" + item.id, "PATCH", { ...fieldsOf(item), status: next, expectedRevision: item.revision }, key); setNotice("「" + item.name + "」已标记为" + garmentStates[next] + "。"); await saved(); }
      catch (e) { resource.reload(); throw e; }
    });
  }
  return <div className={styles.page}>
    <section className={styles.intro}><div><p className="eyebrow">宝宝的小衣橱</p><h2>穿得舒服，玩得自在</h2><p>把衣物拍下来，照着天气和活动，搭配熟悉的每一天。</p><span className={styles.libraryCount}><Shirt size={16} aria-hidden />{resource.data ? items.length + " 件衣物 · " + ready + " 件可穿" : "正在打开衣服库"}</span></div><button className="primary" onClick={() => setEditor(null)}><Plus size={18} aria-hidden />添加衣物</button></section>
    <div className={styles.tabs} aria-label="衣物搭配视图"><button className={section === "outfits" ? styles.activeTab : ""} aria-pressed={section === "outfits"} onClick={() => setSection("outfits")}><CloudSun size={18} aria-hidden />搭配建议</button><button className={section === "library" ? styles.activeTab : ""} aria-pressed={section === "library"} onClick={() => setSection("library")}><Shirt size={18} aria-hidden />衣服库{resource.data && <span>{items.length}</span>}</button></div>
    {notice && <p className="notice" role="status">{notice}</p>}
    {section === "outfits" ? <OutfitPlanner key={household.id + ":" + day.date} household={household} day={day} tick={tick} onDateChange={onDateChange} onOpenLibrary={() => setSection("library")} /> : <section className="panel">
      <div className="section-heading"><div><h2>我们的衣服库</h2><p className="small muted">家人一起整理，可穿的衣物才会参加搭配。</p></div><button className="secondary" onClick={() => setEditor(null)}><Camera size={17} aria-hidden />拍照入库</button></div>
      <div className={styles.filters}><label><span className="sr-only">搜索衣物</span><input type="search" placeholder="找一件衣物，或搜颜色、尺码" value={search} onChange={(e) => setSearch(e.target.value)} /></label><label><span className="sr-only">筛选衣物状态</span><select value={status} onChange={(e) => setStatusFilter(e.target.value)}><option value="visible">未收起的衣物</option><option value="all">全部状态</option>{entries(garmentStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className={styles.categories} aria-label="筛选衣物类别"><button aria-pressed={category === "all"} onClick={() => setCategory("all")}>全部</button>{entries(garmentCategories).map(([key, label]) => <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}</div>
      {!resource.data ? <LoadState error={resource.error} retry={resource.reload} /> : !items.length ? <div className="empty-state"><Shirt size={48} aria-hidden /><h3>把第一件衣物放进来</h3><p>拍照或从相册选择，再填一下类别和厚薄。<br />家人就能照着照片找到，也能用来搭配。</p><button className="primary" onClick={() => setEditor(null)}><Camera size={18} aria-hidden />添加第一件衣物</button></div> : !visible.length ? <div className="empty-state"><Shirt size={36} aria-hidden /><h3>没有找到符合条件的衣物</h3><button className="secondary" onClick={() => { setSearch(""); setStatusFilter("all"); setCategory("all"); }}>查看全部衣物</button></div> : <div className={styles.library}>{visible.map((g) => <article className={styles.garmentCard} key={g.id}><Photo key={g.photoUrl} garment={g} /><div className={styles.garmentInfo}><div className={styles.cardTitle}><h3>{g.name}</h3><span className={g.status === "ready" ? styles.complete : styles.incomplete}>{garmentStates[g.status]}</span></div><p className="small muted">{[garmentCategories[g.category], garmentWarmth[g.warmth], g.color, g.size].filter(Boolean).join(" · ")}</p><p className={styles.activities}>{g.activities.map((v) => outfitActivities[v]).join(" / ")}</p><div className={styles.cardActions}><button className="secondary" aria-label={"编辑 " + g.name} onClick={() => setEditor(g)}>编辑</button><button className="text-button" disabled={task.busy} onClick={() => markStatus(g, g.status === "ready" ? "laundry" : "ready")}>{g.status === "ready" ? "标记待洗" : "恢复可穿"}</button><button className="text-button" disabled={task.busy || g.status === "archived"} aria-label={"收起 " + g.name} onClick={() => markStatus(g, "archived")}>收起</button></div></div></article>)}</div>}
      {resource.error && resource.data && <LoadState error={resource.error} retry={resource.reload} />}{task.error && <div className="error" role="alert">{task.error}</div>}
    </section>}
    {editor !== undefined && <GarmentEditor key={editor?.id ?? "new"} householdId={household.id} item={editor} onClose={() => setEditor(undefined)} onSaved={async () => { setNotice(editor ? "衣物资料已更新，家人可以看到。" : "衣物已放进衣服库，家人可以看到。"); await saved(); }} />}
  </div>;

  function setStatusFilter(value: string) { setStatus(value); }
}
