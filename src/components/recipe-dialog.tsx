"use client";
import { useEffect, useRef } from "react";
import { Clock3, Users, X } from "lucide-react";
import type { AiSuggestion } from "@/shared/b3";
import { basisLabels, ingredientAmount } from "@/shared/recipe-amounts";
import styles from "./proposal-calendar.module.css";

export interface RecipeEntry { date: string; time: string; title: string; kind: string; notes: string; scene?: string; suggestion?: AiSuggestion; before?: unknown }
export function RecipeDialog({ entry, onClose }: { entry: RecipeEntry; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const current = dialog.current;
    current?.showModal();
    return () => {
      current?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  const recipe = entry.suggestion;
  const previous = entry.before && typeof entry.before === "object" ? entry.before as { title?: string; time?: string; notes?: string } : null;
  return <dialog ref={dialog} className={styles.dialog} onCancel={onClose} aria-labelledby="recipe-dialog-title">
    <header className={styles.dialogHeader}><div><p className="eyebrow">{entry.date} · {entry.time}</p><h2 id="recipe-dialog-title">{entry.title}</h2></div><button className="icon-button" aria-label="关闭做法详情" onClick={onClose}><X size={22} /></button></header>
    {recipe ? <>
      {entry.kind === "meal" && <><div className={styles.recipeStats}><span><Users size={16} />{recipe.servings ? `宝宝 ${recipe.servings} 人份` : "份数待补全"}</span>{recipe.prepMinutes !== undefined && <span><Clock3 size={16} />备料 {recipe.prepMinutes} 分钟</span>}{recipe.cookMinutes !== undefined && <span>制作 {recipe.cookMinutes} 分钟</span>}</div>{recipe.yieldText && <p className={styles.yield}>预计成品：{recipe.yieldText}</p>}<p className={styles.recipeNote}>{recipe.servingNote || "用量供家庭备料参考，按宝宝当天食量调整。"}</p>
      <section className={styles.detailSection}><h3>这一餐准备什么</h3><div className={styles.tableScroll}><table className={styles.ingredients}><thead><tr><th>食材</th><th>本餐备料量</th><th>切配与处理</th></tr></thead><tbody>{recipe.ingredients.map((ingredient, index) => <tr key={index}><th>{ingredient.name}</th><td><strong>{ingredientAmount(ingredient)}</strong><small>{ingredient.basis ? basisLabels[ingredient.basis] : "生熟口径未注明"}</small></td><td>{ingredient.formText}</td></tr>)}</tbody></table></div></section></>}
      {entry.kind === "activity" && <section className={styles.detailSection}><h3>出门前准备</h3>{recipe.materials && <p>{recipe.materials}</p>}{recipe.weatherCondition && <p>出门条件：{recipe.weatherCondition}</p>}{recipe.indoorAlternative && <div className={styles.alternative}><strong>室内备选</strong><p>{recipe.indoorAlternative}</p></div>}</section>}
      <section className={styles.detailSection}><h3>{entry.kind === "meal" ? "一步一步做" : "怎么玩"}</h3><ol className={styles.steps}>{recipe.steps.map((step, index) => <li key={index}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol></section>
      {recipe.assumptions.length > 0 && <details className={styles.assumptions}><summary>采用前核对</summary><ul>{recipe.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
    </> : <p className={styles.plainNotes}>{entry.notes || "这项安排没有另外填写做法。"}</p>}
    {previous && <details className={styles.assumptions}><summary>查看本次调整前的安排</summary><strong>{previous.time} · {previous.title}</strong>{previous.notes && <p className={styles.plainNotes}>{previous.notes}</p>}</details>}
    <footer className={styles.dialogFooter}><span>AI 建议 · 家庭核对后采用</span><button className="primary" onClick={onClose}>看好了，返回计划</button></footer>
  </dialog>;
}
