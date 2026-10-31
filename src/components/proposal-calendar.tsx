"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Footprints, Utensils } from "lucide-react";
import type { PreviewChange } from "@/shared/b3";
import { RecipeDialog, type RecipeEntry } from "./recipe-dialog";
import { DailyPreparation } from "./daily-preparation";
import styles from "./proposal-calendar.module.css";

const dateText = (date: string, weekday = false) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", ...(weekday ? { weekday: "short" as const } : {}), timeZone: "Asia/Shanghai" }).format(new Date(date + "T12:00:00+08:00"));
function entriesOf(changes: PreviewChange[]): RecipeEntry[] {
  return changes.flatMap((change) => {
    if (!["plan.add", "plan.update"].includes(change.type) || !change.date || !change.after || typeof change.after !== "object") return [];
    const value = change.after as Record<string, unknown>;
    if (typeof value.title !== "string" || typeof value.time !== "string" || typeof value.kind !== "string") return [];
    return [{ date: change.date, time: value.time, title: value.title, kind: value.kind, notes: typeof value.notes === "string" ? value.notes : "", scene: String(value.scene ?? "either"), suggestion: change.suggestion, before: change.before }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
export function ProposalCalendar({ changes }: { changes: PreviewChange[] }) {
  const entries = useMemo(() => entriesOf(changes), [changes]);
  const dates = [...new Set(entries.map((entry) => entry.date))];
  const [selectedDate, setSelectedDate] = useState(dates[0] ?? "");
  const [page, setPage] = useState(0);
  const [view, setView] = useState("auto");
  const [selectedEntry, setSelectedEntry] = useState<RecipeEntry | null>(null);
  const shownDates = dates.slice(page * 7, page * 7 + 7);
  const times = [...new Set(entries.filter((entry) => shownDates.includes(entry.date)).map((entry) => entry.time))].sort();
  const activeDate = dates.includes(selectedDate) ? selectedDate : dates[0];
  const dayEntries = entries.filter((entry) => entry.date === activeDate);
  const meals = dayEntries.filter((entry) => entry.kind === "meal");
  function card(entry: RecipeEntry) {
    return <button type="button" className={styles.event + " " + (entry.kind === "meal" ? styles.meal : styles.activity)} onClick={() => setSelectedEntry(entry)} aria-label={dateText(entry.date) + " " + entry.time + " " + entry.title + "，查看详情"}><span className={styles.eventType}>{entry.kind === "meal" ? <Utensils size={13} /> : <Footprints size={13} />}{entry.kind === "meal" ? "餐食" : entry.kind === "activity" ? "活动" : "作息"}</span><strong>{entry.title.replace(/^(早餐|午餐|午饭|晚餐|晚饭|下午加餐|加餐|上午户外|下午户外)[：:]\s*/, "")}</strong>{entry.kind === "meal" && <small>{entry.suggestion?.servings ? `${entry.suggestion.servings} 人份` : "查看做法与用量"}{entry.suggestion?.cookMinutes !== undefined ? ` · ${entry.suggestion.cookMinutes} 分钟` : ""}</small>}</button>;
  }
  if (!entries.length) return null;
  return <div className={styles.calendar} data-view={view} data-testid="proposal-calendar">
    <div className={styles.toolbar}><div><strong>把这一周，放在一张表里</strong><p>点开一餐看做法，选日期看当天备料。</p></div><div className={styles.tools}><label className="sr-only" htmlFor="proposal-view">计划查看方式</label><select id="proposal-view" value={view} onChange={(event) => setView(event.target.value)}><option value="auto">自动适配</option><option value="week">周历</option><option value="day">按天</option></select>{dates.length > 7 && <><button className="icon-button" aria-label="上一周方案" disabled={page === 0} onClick={() => { setPage(page - 1); setSelectedDate(dates[(page - 1) * 7]); }}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="下一周方案" disabled={(page + 1) * 7 >= dates.length} onClick={() => { setPage(page + 1); setSelectedDate(dates[(page + 1) * 7]); }}><ChevronRight size={18} /></button></>}</div></div>
    <div className={styles.dateTabs} aria-label="选择备料日期">{shownDates.map((date) => <button key={date} type="button" aria-pressed={activeDate === date} className={activeDate === date ? styles.activeDate : ""} onClick={() => setSelectedDate(date)}>{dateText(date, true)}</button>)}</div>
    <div className={styles.weekScroll}><table className={styles.weekTable} aria-label="待确认安排周历"><thead><tr><th scope="col">时间</th>{shownDates.map((date) => <th key={date} scope="col" className={date === activeDate ? styles.selectedColumn : ""}><button onClick={() => setSelectedDate(date)} aria-label={"查看 " + dateText(date) + " 的备料"}>{dateText(date, true)}</button></th>)}</tr></thead><tbody>{times.map((time) => <tr key={time}><th scope="row">{time}</th>{shownDates.map((date) => <td key={date} className={date === activeDate ? styles.selectedColumn : ""}>{entries.filter((entry) => entry.date === date && entry.time === time).map((entry, index) => <div key={index}>{card(entry)}</div>)}</td>)}</tr>)}</tbody></table></div>
    <div className={styles.dayList} aria-label="选中日期的安排">{dayEntries.map((entry, index) => <div className={styles.dayRow} key={index}><time>{entry.time}</time>{card(entry)}</div>)}</div>
    <DailyPreparation date={activeDate} meals={meals} canRefine />
    {selectedEntry && <RecipeDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} />}
  </div>;
}
