import { ClipboardList, CookingPot } from "lucide-react";
import type { AiSuggestion } from "@/shared/b3";
import { dailyPrep, prepAmount, basisLabels } from "@/shared/recipe-amounts";
import styles from "./proposal-calendar.module.css";

export function DailyPreparation({ date, meals, canRefine = false }: { date: string; meals: Array<{ title: string; suggestion?: AiSuggestion }>; canRefine?: boolean }) {
  const prep = dailyPrep(meals);
  const missing = meals.some((meal) => !meal.suggestion);
  const incomplete = meals.some((meal) => meal.suggestion && (!meal.suggestion.servings || meal.suggestion.ingredients.some((ingredient) => ingredient.quantity === undefined)));
  const dateText = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(date + "T12:00:00+08:00"));
  return <section className={styles.prepPanel} aria-label="每日备料清单"><header><div><p className="eyebrow"><ClipboardList size={15} />当天一起准备</p><h3>{dateText} 备料清单</h3><p>合并当天 {meals.length} 个餐次；生重、熟重和按个计的数量分别汇总。</p></div><CookingPot size={28} aria-hidden /></header>
    {missing && <p className={styles.incomplete}>部分餐次没有结构化用量，未计入以下合计，请另外核对。</p>}
    {incomplete && <p className={styles.incomplete}>部分旧菜谱未注明份数或量化用量{canRefine ? "，可用“补全做法与用量”完善。" : "，请打开做法核对原用量。"}</p>}
    {prep.length ? <div className={styles.tableScroll}><table className={styles.prepTable}><thead><tr><th>食材</th><th>当天准备量</th><th>用于哪些餐</th></tr></thead><tbody>{prep.map((entry, index) => <tr key={index}><th>{entry.name}</th><td><strong>{prepAmount(entry)}</strong><small>{entry.basis === "unspecified" ? "生熟口径待核对" : basisLabels[entry.basis as keyof typeof basisLabels]}</small></td><td>{entry.meals.map((meal) => meal.split(/[：:]/)[0]).join("、")}</td></tr>)}</tbody></table></div> : <p className="muted">这天还没有可汇总的食材；点开餐食查看说明。</p>}
    <p className={styles.recipeNote}>按当前菜谱份数合计，供备料参考；准备前核对家中余量，按宝宝当天食量调整。</p>
  </section>;
}
