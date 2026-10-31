"use client";

import { useId, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Child } from "@/shared/contracts";
import { foodRestrictionLabels, type FoodRestrictionItem } from "@/shared/food-restrictions";
import styles from "./food-restrictions.module.css";

export type FoodRestrictionDraft = FoodRestrictionItem & { draftId: number };

interface Props {
  status: Child["foodStatus"];
  items: FoodRestrictionDraft[];
  onStatusChange: (status: Child["foodStatus"]) => void;
  onItemsChange: (items: FoodRestrictionDraft[]) => void;
  disabled: boolean;
}

export function FoodRestrictionsEditor({ status, items, onStatusChange, onItemsChange, disabled }: Props) {
  const hintId = useId();
  const nextId = useRef(items.length);
  const focusId = useRef<number | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  function addItem(focus = true) {
    const draftId = nextId.current++;
    if (focus) focusId.current = draftId;
    onItemsChange([...items, { draftId, kind: "allergy", food: "", note: "" }]);
  }
  function updateItem(draftId: number, fields: Partial<FoodRestrictionItem>) {
    onItemsChange(items.map((item) => item.draftId === draftId ? { ...item, ...fields } : item));
  }

  return <fieldset className={styles.editor} disabled={disabled}>
    <legend>食物过敏与忌口</legend>
    <label>宝宝有已知的食物过敏或忌口吗？
      <select name="foodStatus" value={status} onChange={(event) => {
        const value = event.target.value as Child["foodStatus"];
        onStatusChange(value);
        if (value === "restricted" && !items.length) addItem(false);
      }}>
        <option value="unknown">还不确定，待确认</option>
        <option value="none">目前没有已知的食物过敏或忌口</option>
        <option value="restricted">有已知的食物过敏或忌口</option>
      </select>
    </label>
    {status === "restricted" ? <>
      <p className="small muted" id={hintId}>直接输入食物名称，每种食物单独添加。多个过敏可点“再添加一项”；不爱吃请记在“近期偏好”。</p>
      <div className={styles.entries} aria-describedby={hintId}>
        {items.map((item, index) => <fieldset key={item.draftId} className={styles.entry}>
          <legend>第 {index + 1} 项</legend>
          <div className={styles.entryHeader}>
            <span className={styles.badge}>{foodRestrictionLabels[item.kind]}</span>
            <button type="button" className="text-button danger-text" aria-label={`删除第 ${index + 1} 项`} onClick={() => { onItemsChange(items.filter((entry) => entry.draftId !== item.draftId)); addButton.current?.focus(); }}>
              <Trash2 size={15} aria-hidden />删除
            </button>
          </div>
          <div className={styles.columns}>
            <label>类型
              <select value={item.kind} onChange={(event) => updateItem(item.draftId, { kind: event.target.value as FoodRestrictionItem["kind"] })}>
                {item.kind === "unspecified" && <option value="unspecified">原有记录，待分类</option>}
                <option value="allergy">过敏</option>
                <option value="avoid">其他忌口</option>
              </select>
            </label>
            {item.kind === "unspecified" ? <label>原有说明
              <textarea required rows={3} maxLength={1000} value={item.food} onChange={(event) => updateItem(item.draftId, { food: event.target.value })} />
            </label> : <label>食物名称
              <input required maxLength={100} value={item.food} placeholder="例如：鸡蛋" ref={(element) => { if (element && item.draftId === focusId.current) { focusId.current = null; element.focus(); } }} onChange={(event) => updateItem(item.draftId, { food: event.target.value })} />
            </label>}
          </div>
          {item.kind === "unspecified" && <p className="small muted">这是之前保存的原文，可核对后拆成多项，并选择对应类型。</p>}
          <label><span>备注 <span className="muted">（选填）</span></span>
            <input maxLength={200} value={item.note} placeholder="补充已确认的情况或忌口原因" onChange={(event) => updateItem(item.draftId, { note: event.target.value })} />
          </label>
        </fieldset>)}
      </div>
      {!items.length && <p className="small muted" role="status">请至少添加一项食物过敏或忌口。</p>}
      <button ref={addButton} type="button" className={`secondary ${styles.add}`} disabled={items.length >= 20} onClick={() => addItem()}><Plus size={17} aria-hidden />{items.length ? "再添加一项" : "添加一项"}</button>
    </> : status === "unknown" && <p className="small muted">确认前保留未知，餐食暂不进入自动推荐。</p>}
  </fieldset>;
}

export function FoodRestrictionsSummary({ child }: { child: Child | null }) {
  if (!child || child.foodStatus === "unknown") return <span>食物过敏与忌口仍待确认，未启用自动饮食推荐。</span>;
  if (child.foodStatus === "none") return <span>目前没有已知的食物过敏或忌口。</span>;
  return <div className={styles.summary}>
    <strong>食物过敏与忌口</strong>
    <ul>{child.foodRestrictionItems.map((item, index) => <li key={index}>
      <span className={styles.badge}>{foodRestrictionLabels[item.kind]}</span><span className={styles.food}>{item.food}</span>
      {item.note && <span className={styles.note}>{item.note}</span>}
    </li>)}</ul>
  </div>;
}
