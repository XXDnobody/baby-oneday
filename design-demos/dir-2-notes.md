# 方向 B：陪伴清单

独立方向稿，尚未确认最终方向。文件：`dir-2.html`。

## 设计依据

使用共享 spec 和分配的方向卡独立构建。借鉴 Koto 的乐观与亲近感，减弱为白底、蓝灰文字、深石板蓝操作色与少量杏色提示；没有复制作品外观。

Form 来自照护交接与陪玩任务：横向日程将当前、下一项、照护者放在同一行，主要内容用两步玩法组织。积木材料图只出现在「室内备选 / 把积木送回家」，清楚标为示意图，桌面约占活动模块的五分之一宽度。

## 已实现的交互

| 功能 | 入口与关键选择器 |
|---|---|
| 今天 / 饮食 / 活动 / 家庭真实内容页 | `.nav [data-nav="today"]`，其余为 `food`、`activities`、`family` |
| 全天安排 | `[data-action="schedule"]` |
| 活动详情与更多说明 | `[data-action="activity-detail"]` → `#modal details summary` |
| 室内 / 户外替换确认 | `#activity-switch` → `[data-action="apply-indoor"]` 或 `[data-action="apply-outdoor"]` |
| 可选活动反馈 | `[data-feedback="喜欢"]`、`没兴趣`、`太难`；再次点击清空 |
| 食材勾选与确认 | `#pantry-open` → `input[name="pantry"]` → `#pantry-confirm` |
| 仅换晚餐 | `#dinner-replace` → `input[name="dinner-scope"]` → `#dinner-confirm` |
| 只读大屏 | `#big-preview` → `#display-modal`，只有退出按钮 |
| 菜谱打印预览 | `#print-preview` → `#print-sheet` → `#print-now` |
| 天气说明 | `[data-action="weather"]` |
| 对话框关闭 | `[data-close]` 或 Escape，焦点返回原入口 |

## 状态与诚实边界

- 本地状态 key：`baby-plan-direction-b-v1`。默认 2026-10-28、固定示例时刻 14:40、无活动反馈；不按经过时间自动完成。
- 食材仅保存明确勾选项；换餐只影响晚餐展示、购物需求及用户选定偏好，不自动扣库存。
- 新活动会清空旧活动反馈。大屏显示本地当前状态，没有任何写入操作。
- 计划版本、打印生成时间使用显式 `Asia/Shanghai`，界面标为北京时间。打印内容带适用日期。
- 未连接后台、真实天气、账号或家庭同步。真正的服务器冲突解决、离线合并、同步权限尚未实现。
- 活动来源标「待核对后启用」。UNICEF 链接已验证可访问；它只是延伸阅读入口，不声称具体活动已审核或逐条出自该页。
- 主图以 base64 嵌入单文件，不依赖 CDN。UI 图标使用内联 SVG。

## 验证

- 1440×900 首屏包含日程、两步玩法、室内备选、下一餐、晚餐入口、天气、家庭约定和最近修改。
- 375×812 无横向页面溢出；日程只在自身区域横向滚动，初始当前项完整可见。
- 原生 dialog 支持 Escape、焦点约束与关闭后回焦；导航支持左右方向键。
- 浏览器渲染及控制台无错误；标签不小于 12 px，可点按钮至少 44×44 px。
- 12 项主要交互检查通过，报告 `screenshots/dir-2-interaction-report.json`。
- 操作截图：`screenshots/dir-2-dinner-confirm.png`、`dir-2-activity-detail.png`、`dir-2-large-display.png`、`dir-2-print-preview.png`。
- 实际系统打印窗口未调用；已替身验证打印按钮正确调用 `window.print()`。
- 最终方向默认截图由主设计任务统一生成，避免与其他方向的截图参数不一致。
