"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { DayPicker, type DropdownProps } from "@daypicker/react";
import { zhCN } from "@daypicker/react/locale/zh-CN";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { CalendarDays, ChevronDown } from "lucide-react";
import { dateError, dateLabel, dateString, parseDate } from "@/shared/date-inputs";
import { localToday } from "./b2-common";
import { DateSelect } from "./date-select";
import "@daypicker/react/style.css";
import styles from "./date-picker.module.css";

function CalendarDropdown({ options, value, onChange, disabled, "aria-label": label }: DropdownProps) {
  const id = useId();
  return <DateSelect id={id} label={label ?? "选择年月"} compact placeholder="请选择" disabled={disabled} value={String(value ?? "")}
    options={(options ?? []).map((option) => ({ value: String(option.value), label: option.label, disabled: option.disabled }))}
    onChange={(next) => onChange?.({ target: { value: next }, currentTarget: { value: next } } as ChangeEvent<HTMLSelectElement>)} />;
}

export function CalendarMonthPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const [year, month] = value.split("-");
  const first = Math.min(1900, Number(year)), last = Math.max(Number(localToday().slice(0, 4)) + 10, Number(year));
  return <div className={styles.monthPicker} role="group" aria-label="日历月份">
    <DateSelect id={id + "-year"} label="日历年份" placeholder="年" value={String(Number(year))} options={Array.from({ length: last - first + 1 }, (_, index) => ({ value: String(last - index), label: last - index + "年" }))} onChange={(next) => onChange(next.padStart(4, "0") + "-" + month)} />
    <DateSelect id={id + "-month"} label="日历月份" placeholder="月" value={String(Number(month))} options={Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: index + 1 + "月" }))} onChange={(next) => onChange(year + "-" + next.padStart(2, "0"))} />
  </div>;
}

export function CalendarPicker({ id: providedId, name, label, value, onChange, min, max, required = false, disabled = false, hideLabel = false, compact = false }: {
  id?: string; name?: string; label: string; value: string; onChange: (value: string) => void;
  min?: string; max?: string; required?: boolean; disabled?: boolean; hideLabel?: boolean; compact?: boolean;
}) {
  const generatedId = useId(), id = providedId ?? generatedId;
  const trigger = useRef<HTMLButtonElement>(null), popover = useRef<HTMLDivElement>(null), validation = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [showError, setShowError] = useState(false);
  const today = localToday(), selected = parseDate(value), earliest = min ? parseDate(min) : undefined, latest = max ? parseDate(max) : undefined;
  const [month, setMonth] = useState(() => parseDate(value) ?? parseDate(today)!);
  const error = dateError(value, { min, max, required });
  useEffect(() => { validation.current?.setCustomValidity(error); }, [error]);
  useEffect(() => {
    const button = trigger.current, panel = popover.current;
    if (!open || !button || !panel) return;
    let active = true;
    const cleanup = autoUpdate(button, panel, () => {
      void computePosition(button, panel, { strategy: "fixed", placement: "bottom-start", middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8, crossAxis: true })] }).then(({ x, y }) => {
        if (active) Object.assign(panel.style, { left: x + "px", top: y + "px" });
      });
    });
    return () => { active = false; cleanup(); };
  }, [open]);
  function choose(next: string) {
    setShowError(false); onChange(next); popover.current?.hidePopover(); trigger.current?.focus();
  }
  return <div className={styles.field + (compact ? " " + styles.compact : "")}>
    <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>{label}</label>
    <button ref={trigger} id={id} type="button" className={styles.trigger} disabled={disabled} popoverTarget={id + "-calendar"}
      aria-label={label} aria-haspopup="dialog" data-invalid={showError && !!error || undefined} aria-describedby={id + "-value" + (showError && error ? " " + id + "-error" : "")}
      onClick={() => { if (!popover.current?.matches(":popover-open")) setMonth(selected ?? earliest ?? parseDate(today)!); }}>
      <CalendarDays size={18} aria-hidden /><span id={id + "-value"}>{dateLabel(value)}</span><ChevronDown size={16} aria-hidden />
    </button>
    <input ref={validation} className={styles.validation} type="text" name={name} value={value} onChange={() => {}} required={required} disabled={disabled} tabIndex={-1} aria-hidden="true" onInvalid={(event) => {
      event.preventDefault(); setShowError(true); trigger.current?.focus(); popover.current?.showPopover();
    }} />
    {showError && error && <p id={id + "-error"} className={styles.fieldError} role="alert">{error}</p>}
    <div ref={popover} popover="auto" id={id + "-calendar"} role="dialog" aria-label={"选择" + label} className={styles.popover} onToggle={(event) => setOpen(event.newState === "open")}>
      {open && <>
        <DayPicker className={styles.calendar} locale={zhCN} weekStartsOn={1} mode="single" required autoFocus fixedWeeks showOutsideDays
          selected={selected} month={month} onMonthChange={setMonth} captionLayout="dropdown" navLayout="after" reverseYears
          startMonth={earliest ?? parseDate(Math.min(1900, selected?.getFullYear() ?? 1900) + "-01-01")}
          endMonth={latest ?? parseDate(Math.max(Number(today.slice(0, 4)) + 10, selected?.getFullYear() ?? 0) + "-12-31")}
          disabled={[...(earliest ? [{ before: earliest }] : []), ...(latest ? [{ after: latest }] : [])]}
          components={{ Dropdown: CalendarDropdown }}
          formatters={{ formatYearDropdown: (date) => date.getFullYear() + "年", formatMonthDropdown: (date) => date.getMonth() + 1 + "月" }}
          labels={{ labelMonthDropdown: () => "选择月份", labelYearDropdown: () => "选择年份", labelNext: () => "下个月", labelPrevious: () => "上个月", labelDayButton: (date) => "选择 " + dateLabel(dateString(date)) }}
          onSelect={(next) => { if (next) choose(dateString(next)); }} />
        <div className={styles.calendarFooter}><span aria-live="polite">{value ? dateLabel(value) : "请选择日期"}</span><div className={styles.calendarFooterActions}>
          {!required && <button type="button" onClick={() => choose("")}>清除</button>}
          <button type="button" disabled={!!dateError(today, { min, max })} onClick={() => choose(today)}>今天</button>
          <button type="button" onClick={() => { popover.current?.hidePopover(); trigger.current?.focus(); }}>关闭</button>
        </div></div>
      </>}
    </div>
  </div>;
}
