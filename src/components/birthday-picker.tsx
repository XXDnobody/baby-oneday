"use client";

import { useId, useRef, useState } from "react";
import type { SelectInstance } from "react-select";
import { birthdayParts, birthdayValue, changeBirthday, daysInMonth, type BirthdayParts } from "@/shared/date-inputs";
import { localToday } from "./b2-common";
import { DateSelect, type DateChoice } from "./date-select";
import styles from "./date-picker.module.css";

export function BirthdayPicker({ defaultValue = "", onChange, disabled = false }: { defaultValue?: string; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId();
  const max = localToday();
  const [parts, setParts] = useState(() => birthdayParts(defaultValue));
  const [showError, setShowError] = useState(false);
  const yearRef = useRef<SelectInstance<DateChoice>>(null), monthRef = useRef<SelectInstance<DateChoice>>(null), dayRef = useRef<SelectInstance<DateChoice>>(null);
  const value = birthdayValue(parts);
  const hasParts = !!(parts.year || parts.month || parts.day);
  const currentYear = Number(max.slice(0, 4));
  const firstYear = Math.min(1900, Number(parts.year) || 1900);
  const monthLimit = parts.year === String(currentYear) ? Number(max.slice(5, 7)) : 12;
  const dayLimit = parts.year && parts.month ? Math.min(daysInMonth(Number(parts.year), Number(parts.month)), parts.year === String(currentYear) && Number(parts.month) === Number(max.slice(5, 7)) ? Number(max.slice(8)) : 31) : 0;
  function change(part: keyof BirthdayParts, next: string) {
    const updated = changeBirthday(parts, part, next, max);
    setParts(updated); setShowError(false); onChange(birthdayValue(updated));
  }
  return <fieldset className={styles.birthday} disabled={disabled}>
    <legend>生日 <span className="muted">（选填）</span></legend>
    <div className={styles.birthdayColumns}>
      <DateSelect id={id + "-year"} label="出生年份" placeholder="年" options={Array.from({ length: currentYear - firstYear + 1 }, (_, index) => ({ value: String(currentYear - index), label: currentYear - index + "年" }))} value={parts.year} onChange={(next) => change("year", next)} disabled={disabled} selectRef={yearRef} describedBy={showError ? id + "-error" : undefined} />
      <DateSelect id={id + "-month"} label="出生月份" placeholder="月" options={Array.from({ length: monthLimit }, (_, index) => ({ value: String(index + 1), label: index + 1 + "月" }))} value={parts.month} onChange={(next) => change("month", next)} disabled={disabled || !parts.year} selectRef={monthRef} />
      <DateSelect id={id + "-day"} label="出生日期" placeholder="日" options={Array.from({ length: dayLimit }, (_, index) => ({ value: String(index + 1), label: index + 1 + "日" }))} value={parts.day} onChange={(next) => change("day", next)} disabled={disabled || !parts.year || !parts.month} selectRef={dayRef} />
    </div>
    <input className={styles.validation} type="text" name="birthDate" value={value} onChange={() => {}} required={hasParts} disabled={disabled} tabIndex={-1} aria-hidden="true" onInvalid={(event) => {
      event.preventDefault(); setShowError(true);
      (!parts.year ? yearRef : !parts.month ? monthRef : dayRef).current?.focus();
    }} />
    {showError && !value && <p className={styles.fieldError} id={id + "-error"} role="alert">请完整选择年、月、日，或清除生日后填写月龄。</p>}
    {hasParts && <button type="button" className={styles.clearBirthday} disabled={disabled} onClick={() => { setParts(birthdayParts("")); setShowError(false); onChange(""); }}>清除生日，改填月龄</button>}
  </fieldset>;
}
