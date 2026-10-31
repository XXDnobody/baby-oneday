# A 日常工作台

文件：`dir-1.html`。本稿仅为方向初稿，尚未选定最终设计，不包含远程账号、天气或同步接入。

## 视觉决策

- 188px 的窄侧栏承担今天、饮食、活动、家庭导航，独立右栏保留全天日程和照护交接。
- 午睡与下一次下午茶并置在同一块浅鼠尾草色表面，后续活动、晚餐和天气顺次出现。
- 近白背景、松绿强调色、中文无衬线、细边框；主体页面没有装饰阴影。实用元数据改为分开的字段或自然句子。
- form 来自「当前作息、下一项准备、照护交接」的内容关系。参考深泽直人关于日常直觉的思路，不复制具体作品。
- 手机收拢为单列与底部四项导航，正文按 16px 处理，保留轻量的日期与状态标签。

## 交互选择器

| 交互 | 选择器 |
|---|---|
| 主导航 | `[data-panel="today"]`、`[data-panel="food"]`、`[data-panel="activity"]`、`[data-panel="family"]` |
| 主详情抽屉 | `#detail-dialog`、`#dialog-title`、`#dialog-body` |
| 下午茶准备 | `[data-action="snack"]` |
| 室内外切换 | `main [data-activity="outdoor"]`、`main [data-activity="indoor"]` |
| 活动详情 | `[data-action="activity-detail"]` |
| 活动扩展内容 | `#detail-dialog details` |
| 可选反馈 | `[data-feedback="喜欢"]`、`[data-feedback="没兴趣"]`、`[data-feedback="太难"]` |
| 晚餐替换 | `#replace-dinner`，确认 `#confirm-dinner` |
| 替换偏好 | `input[name="meal-preference"]` |
| 食材核对 | `[data-action="pantry"]`，勾选 `input[name="pantry"]`，保存 `#confirm-pantry` |
| 只读大屏 | `.toolbar [data-action="display"]`，内容 `#display-dialog` |
| 打印预览 | `.toolbar [data-action="print"]`，内容 `#print-dialog` |
| 系统打印 | `[data-action="do-print"]` |
| 本地状态 | localStorage key `baby-plan-direction-a-v1` |

## 已验证

- 1440×900 首页文档宽高准确为 1440×900；375×812 无横向溢出。
- 默认可见按钮均至少 44×44；打印与活动详情的可见标签不小于 12px。
- 所有核心交互通过 Playwright，运行时与控制台错误为 0。
- 原生 dialog 支持焦点管理和 Esc 关闭；键盘焦点可见。
- 室内外活动反馈分别保存，初始均为「尚未反馈」。过去的日程不自动勾选完成。
- 晚餐确认后只改晚餐和购物需求；下午茶、午睡及其他餐次不变，不自动扣库存。
- 大屏只有退出按钮；打印是打开时的快照，带适用日期和内容更新时间。
- 本地更新实际时间使用 `Asia/Shanghai`；固定示例时钟始终为 14:40。
- 技能 design_lint 检查最终结果：无红灯，无模板装饰提示。
- UNICEF 儿童发展参考入口已确认可访问；原型明确标注它不是逐条活动来源或审核证明。

检查报告：`../screenshots/dir-1-checks.json`。
交互截图：`../screenshots/dir-1-display-readonly.png`、`../screenshots/dir-1-print-snapshot.png`。

## 范围说明

修改仅保存到当前浏览器。真实远程同步、冲突处理、天气来源、家人通知以及真实菜谱/活动的专业核对不在本方向稿实现范围中。没有写入 `direction-approved.md`。
