# 衣物搭配本机验证

日期：2026-10-31（Asia/Shanghai）
需求：[CR 衣物搭配](../../specs/baby-plan/wardrobe.md)
环境：Node 24.14.0 / Next.js 16.4.3 / PostgreSQL 测试库 5433 / Chrome（Playwright CLI）

## 实际交付

- 主导航新增“衣物搭配”，每日天气卡可直接进入。提供搭配建议和家庭衣服库两个视图。
- 手机相机 capture 输入、相册选择、图片预览、资料编辑、搜索/分类/状态筛选。支持待洗、不合身、收起及恢复。
- 结合现有逐小时天气、时段和活动方式从实际可穿库存提供最多三套组合。包括连体/分体选择、风雨标记排序、活动提醒、缺项和天气不可用状态。
- 图片与资料共同存入私有家庭表，服务端重新解码、去除元数据、压缩 JPEG。通过会话鉴权接口读取，未发布到公开静态目录。
- 沿用家庭权限、CSRF、幂等、修订冲突和实时同步；断网保留照片和输入，保存响应丢失后重试不产生重复衣物。

## 自动验证

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| `npm run check` | 退出 0；类型、lint、206 项测试与构建通过；本需求 27 项 | [最终检查](check-final.txt) |
| 正式构建浏览器主流程 | 19 项通过；包括上传/离线/响应丢失/冲突和五种尺寸的库、编辑器、搭配 | [结构化结果](browser-verification.json)、[执行脚本](browser-flow-built.js) |
| 正式构建活动流程 | 4 项通过；活动时间/场景、推车/跑跳/室内、无效时间、天气任务刷新、正式计划保持、刷新后照片读取 | [结构化结果](activity-verification.json)、[执行脚本](browser-activity.js) |
| 一致性备份与独立恢复 | 退出 0；41 表一致，衣物表 5 条照片及元数据一致，临时恢复库已移除 | [恢复核对](backup-verification.json) |
| 本机服务 | 主页 200；客户端包含衣物导航；未登录衣物/照片均 401 | [运行核对](local-runtime.json) |
| 依赖 | `npm ls sharp --all`：已有 0.35.5 提升为直接依赖；package.json 与锁文件一致 | [源码校验和](source-checksums.json) |

浏览器宽度：1440、390、320、834、1194；对应电脑、手机、小屏手机、平板竖屏和横屏。三种视图均无页面横向溢出，可见按钮高度至少 44px；原生模态编辑器内容可内部滚动。相机输入属性已核对，相册文件选择和真实图片处理已执行，未替代实体手机相机验收。

浏览器使用合成衣物照片和明确标识的天气服务，不把这些结果当成新一轮真实天气供应商验证。`pageerror` 为零。控制台的未登录 401、模拟断网、主动丢弃响应和预期 409 来自对应测试情景。

## 界面证据

- [桌面衣服库](../playwright/wardrobe-desktop-library.png) / [桌面搭配](../playwright/wardrobe-desktop-outfits.png)
- [手机衣服库](../playwright/wardrobe-mobile-library.png) / [手机搭配](../playwright/wardrobe-mobile-outfits.png) / [手机编辑器](../playwright/wardrobe-mobile-editor.png)
- [小屏手机](../playwright/wardrobe-small-mobile-library.png) / [平板竖屏](../playwright/wardrobe-tablet-portrait-library.png) / [平板横屏](../playwright/wardrobe-tablet-landscape-outfits.png)
- [断网保留照片与输入](../playwright/wardrobe-offline-preserved-upload.png) / [并发冲突核对](../playwright/wardrobe-conflict-review.png) / [无可用时段天气](../playwright/wardrobe-weather-missing.png)

## 首次失败和恢复

1. 沙箱内首次测试无法访问本机测试数据库（EPERM）；Vitest 包装错误影响错误显示。随后允许访问本机 5433，测试通过。
2. 离线 `npm install` 缺少 sharp 注册表缓存；使用已经安装并锁定的 0.35.5，同步直接依赖并核对，没有下载另一版本。
3. Playwright 技能包装器尝试访问不可达注册表，改用本机已安装 CLI。首轮选择框脚本用 `getByLabel` 精确匹配失败，改用实际可访问角色后通过。
4. 共享 public 测试数据曾在其他回归重建时被清空；后续浏览器使用专属 schema，保留真实开发库隔离。
5. 第一次完整检查遇到工作区同时更新的 AI 页 purity 错误（[原日志](check.txt)）；随后最终检查退出 0。新增衣物功能没有放宽 lint 或移除断言。
6. 本机服务切换时输出目录正被另一轮构建替换，一次启动缺少 standalone 文件；构建结束后的当前应用已恢复，并通过运行核对。最终使用标准本机 3000 入口。

## 使用与边界

刷新本机页面，进入“衣物搭配”→“添加衣物”，手机拍照或相册选择，确认名称、类别、厚薄和适用活动后保存。搭配页可带入日程活动，或单独选择日期、时间、场景与活动方式。照片用于家人认衣物；本轮没有自动识图或自动确认衣物属性。

衣服库最多 200 件（含收起），照片经压缩保存；收起可恢复，尚无永久删除。真实手机相机、真实衣物搭配舒适度、服务器容量、生产恢复与七天使用仍按实际使用验证。没有变更真实家庭正式日程、上传真实衣物、提交/推送代码或部署到外部服务器。
