# 方向 C：一眼看清

已实现的独立候选：`dir-3.html`。尚未代表用户选定方向。

Form 来自作息和照护交接：左侧用 14:40、当前午睡与 15:00 下一项建立远读顺序，右侧四条信息行回答餐食、陪玩、穿搭和家庭约定，底部横向日程保留一天的上下文。顶部是横向导航，不是侧边栏工作台。

视觉约束来源：已亲眼查看 huashu-design 的 web 07「cosmic retro-futurism」样张。保留深浅分区、钴蓝、字号反差与功能性刻度；移除宇宙和轨道隐喻。正文采用系统中文无衬线字体，Georgia 只用于计划时刻。无外部字体、CDN 或外部图片依赖。

## 交互入口

| 功能 | 选择器 |
| --- | --- |
| 餐食面板 | `.main-nav [data-open="meals"]` |
| 替换晚餐 | `#dialog [data-open="replace"]`、`#confirm-dinner` |
| 食材核对 | `.main-nav [data-open="pantry"]`、`#pantry-0` 至 `#pantry-4`、`#confirm-pantry` |
| 活动指引 | `.main-nav [data-open="activity"]` |
| 室内外切换 | `#choose-outdoor`、`#choose-indoor` |
| 进阶说明与来源 | `#activity-more` |
| 可选活动反馈 | `[data-feedback]`，再次点击可撤回 |
| 只读大屏预览 | `.top-actions [data-open="display"]` |
| 菜谱打印预览 | `.top-actions [data-open="print"]`、`#print-now` |
| 完整日程 | `[data-open="schedule"]` |
| 家庭资料 | `.main-nav [data-open="family"]` |
| 关闭面板 | `#close-dialog` 或 Escape |

本地存储键：`baby-plan-direction-c-v1`。无预置完成记录，活动反馈初始为空。换餐仅影响晚餐、购物需求和明确选择的近期偏好；食材不自动扣减。活动方案切换只影响下午活动，并清空上一方案的反馈。只读大屏只有关闭按钮，不提供任何状态写入入口。

打印快照分别显示「方案更新时间」和「快照生成时间」，明确使用北京时间 `Asia/Shanghai`。没有本地操作时，更新时间显示为尚无本地操作；原始食材确认时间仍单列为示例。

## 验证

Chromium 已验证 1440×900 和 375×812：没有横向溢出、按钮点击区不少于 44×44 px、标签不少于 12 px，控制台和 JavaScript 无错误。导航、局部换餐、库存核对、活动切换与反馈、原生 dialog 焦点限制、Escape 关闭与焦点还原、只读状态不写入、本地保存和打印快照均通过。

有用的交互截图及报告已保存到 `screenshots/dir-3-display.png`、`screenshots/dir-3-print.png`、`screenshots/dir-3-interaction-report.json`。桌面和手机初始截图暂存在 `/private/tmp/baby-plan-direction-c/`，便于主设计师统一归档。

## 内容边界

这是一份本地 UI 原型，未连接账号、天气、服务器或真实家庭同步；不根据固定演示时刻自动标记完成。食材数量、禁忌资料、餐食份量与实际做法均待家庭核对。

活动详情链接到已核实存在的 UNICEF 页面：[21 learning activities for babies and toddlers](https://www.unicef.org/parenting/child-care/21-learning-activities-babies-and-toddlers)。页面仅作为延伸阅读，保留「来源状态待核对」；没有声称示例活动逐条来自该文章或已经过专业审核。

服务器冲突、离线恢复、多设备同步和真实平板远距测试不在这份候选原型的工程范围内。
