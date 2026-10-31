"use client";

import type { Ref } from "react";
import Select, { type AriaLiveMessages, type GroupBase, type SelectInstance } from "react-select";
import styles from "./date-picker.module.css";

export type DateChoice = { value: string; label: string; disabled?: boolean };

const messages: AriaLiveMessages<DateChoice, false, GroupBase<DateChoice>> = {
  guidance: ({ context }) => context === "menu" ? "使用上下方向键浏览，回车选择，Escape 关闭。" : "输入数字筛选，或按下方向键展开。",
  onChange: ({ label }) => label ? "已选择" + label : "已清空。",
  onFocus: ({ label }) => label,
  onFilter: ({ resultsMessage }) => resultsMessage,
};

export function DateSelect({ id, label, value, options, onChange, placeholder, disabled = false, compact = false, describedBy, selectRef }: {
  id: string; label: string; value: string; options: DateChoice[]; onChange: (value: string) => void;
  placeholder: string; disabled?: boolean; compact?: boolean; describedBy?: string; selectRef?: Ref<SelectInstance<DateChoice>>;
}) {
  return <Select<DateChoice> ref={selectRef} unstyled inputId={id} instanceId={id} aria-label={label} aria-describedby={describedBy}
    className={styles.select + (compact ? " " + styles.captionSelect : "")} classNamePrefix="date-select"
    options={options} value={options.find((option) => option.value === value) ?? null} onChange={(next) => onChange(next?.value ?? "")}
    isOptionDisabled={(option) => !!option.disabled} isDisabled={disabled} placeholder={placeholder} isSearchable
    maxMenuHeight={200} menuPlacement="auto" ariaLiveMessages={messages}
    noOptionsMessage={() => "没有匹配的日期选项"} screenReaderStatus={({ count }) => "找到 " + count + " 个选项。"} />;
}
