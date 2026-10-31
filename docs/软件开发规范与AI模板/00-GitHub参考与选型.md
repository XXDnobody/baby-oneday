# GitHub 参考与选型

检索与核对日期：2026-10-31。通过 GitHub 仓库 API 和原文件读取核对以下 10 个一手来源，未安装其工具，也未将其指令导入当前项目。

## 1. 推荐的组合

建议以 **Spec Kit 的功能规格与任务链 + arc42 的架构视角 + MADR 的决策记录 + OpenAPI 的接口契约 + 工程评审与测试证据**作为基础，再增加 AI 上下文、执行边界、待定项和交接记录。这是本包的工程判断，具体适用性见下表。

OpenAPI 是 HTTP 接口描述规范；arc42、MADR 是文档方法与模板；其余来源是工具模板或工程实践。本包是独立编写的整合模板，不声明符合某项 ISO/IEEE 标准。若项目有合同指定的文档目录，应将字段映射到该目录。

| GitHub 来源 | 主要用途 | 选用内容 | 对应本包 | 适用边界与取舍 |
| --- | --- | --- | --- | --- |
| [github/spec-kit](https://github.com/github/spec-kit) | 需求拆分与 AI 开发主流程 | 用户故事、可独立验证的功能、规划和任务衔接 | 01、02、03、06 | 适合功能级协作；本包另加实际验证证据，不照搬其可选测试策略。 |
| [jam01/SRS-Template](https://github.com/jam01/SRS-Template) | 需求规格 | 功能、质量、约束和验证关系 | 02、07、10 | 社区 SRS 模板，不等同于 IEEE 官方文件；按实际规模裁剪。 |
| [arc42/arc42-template](https://github.com/arc42/arc42-template) | 架构设计 | 系统边界、模块、运行、部署、质量与风险视角 | 03、04、15 | 选择需要的架构视角；小功能通常不必写满完整架构章节。 |
| [adr/madr](https://github.com/adr/madr) | 技术决策 | 决策动因、备选方案、结果、代价和验证 | 11 | 只记录有持续影响的决定；AI 推荐本身不能作为选型理由。 |
| [microsoft/PromptKit](https://github.com/microsoft/PromptKit) | AI 文档编写与核对 | 从需求形成验证计划、识别文档与实现漂移 | 06、07、10、AI 提示词 | 适合把文档产出、验证和审查分别组织；本包提示词为独立编写。 |
| [google/eng-practices](https://github.com/google/eng-practices) | 开发质量与代码评审 | 检查设计、功能、复杂度、测试及文档 | 05、12 | 关注测试是否能发现错误；具体语言风格仍使用项目已有规范。 |
| [OAI/OpenAPI-Specification](https://github.com/OAI/OpenAPI-Specification) | HTTP API 契约 | 用机器可读描述组织路径、输入、响应和安全方案 | 04 | 本次读取 3.1.1 作为固定参考版本，不声称它是当前最新版本。 |
| [sonic-net/sonic-mgmt](https://github.com/sonic-net/sonic-mgmt) | 真实项目测试文档 | 测试范围、环境设置、目标和可执行步骤 | 07、08 | 网络设备领域示例，文档自标草稿；仅参考结构，不迁移其领域假设。 |
| [agentsmd/agents.md](https://github.com/agentsmd/agents.md) | AI 项目上下文 | 向编码代理说明环境、测试与提交约定 | 16 | 只参考文件职责；命令必须来自当前仓库，各工具的自动加载规则需分别核实。 |
| [taogen-docs/dev-spec](https://github.com/taogen-docs/dev-spec) | 中文与传统文档对照 | 需求、设计、开发约定的文档分类 | 01、02、05 | 所读中文 SRS 文件较早，仅作术语和章节参考，AI 协作部分另行设计。 |

## 2. 具体文件与版本

下面固定的是所读文件最近一次变更的 commit；日期是该文件的修改日期，**不能用于判断整个仓库最近是否活跃**。可变的默认分支入口适合跟进更新，固定链接适合复核本次参考。

| 实际核对的文件 | 固定 commit | 文件修改日期（UTC） |
| --- | --- | --- |
| [github/spec-kit / templates/spec-template.md](https://github.com/github/spec-kit/blob/756d63212987152564ed0a52ddfd7f8e9b504e09/templates/spec-template.md) | 756d63212987 | 2026-05-12 |
| [jam01/SRS-Template / srs-template.md](https://github.com/jam01/SRS-Template/blob/3965e951fa5ea1c1dd1bbc7a66b7f35f7e85c006/srs-template.md) | 3965e951fa5e | 2025-11-03 |
| [arc42/arc42-template / EN/arc42-template.adoc](https://github.com/arc42/arc42-template/blob/f507ad6114a6921a87f460b2ded9ad831bd4f1f8/EN/arc42-template.adoc) | f507ad6114a6 | 2025-11-17 |
| [adr/madr / template/adr-template.md](https://github.com/adr/madr/blob/8135ed2e01503be852769402ec3eeb585bfe75a2/template/adr-template.md) | 8135ed2e0150 | 2026-04-17 |
| [microsoft/PromptKit / templates/author-validation-plan.md](https://github.com/microsoft/PromptKit/blob/ca0a078b125e98386727b6433edbc0fa3dcd2c97/templates/author-validation-plan.md) | ca0a078b125e | 2026-08-04 |
| [google/eng-practices / review/reviewer/looking-for.md](https://github.com/google/eng-practices/blob/3e6ba5cfc8c096528173f8f31b2caf15bb78340c/review/reviewer/looking-for.md) | 3e6ba5cfc8c0 | 2022-03-31 |
| [OAI/OpenAPI-Specification / versions/3.1.1.md](https://github.com/OAI/OpenAPI-Specification/blob/36dd159c230f9066fba4b6c98cfed0218f44d382/versions/3.1.1.md) | 36dd159c230f | 2024-10-24 |
| [sonic-net/sonic-mgmt / docs/testplan/ACL-test-plan.md](https://github.com/sonic-net/sonic-mgmt/blob/8f01c7bbc2ea651e6cdabaf93659e62538f8fe98/docs/testplan/ACL-test-plan.md) | 8f01c7bbc2ea | 2022-10-31 |
| [agentsmd/agents.md / README.md](https://github.com/agentsmd/agents.md/blob/557da8b39c6f5b4dee2239df09a6ab97a82ff4df/README.md) | 557da8b39c6f | 2025-12-10 |
| [taogen-docs/dev-spec / document-templates/TEMPLATE-D1-SRS-software-requirements-specification-STD-CN.md](https://github.com/taogen-docs/dev-spec/blob/fbfe4df1c319596dc3cdfd1d744f1e11ed139d6d/document-templates/TEMPLATE-D1-SRS-software-requirements-specification-STD-CN.md) | fbfe4df1c319 | 2020-12-01 |

Spec Kit 同时读取了 [规划模板](https://github.com/github/spec-kit/blob/main/templates/plan-template.md) 与 [任务模板](https://github.com/github/spec-kit/blob/main/templates/tasks-template.md)，用于理解规格到实现的衔接。arc42 同时核对了其英文架构章节目录；其主文件通过 include 组织章节。

机器可读来源索引见 [sources.json](sources.json)。它记录来源和版本，不包含上游模板全文。

## 2.1 单人版复核与版本补充（2026-10-31）

本包初版于 2026-10-31 编写，同日增加单人维护版并修订为 1.1。原表记录的是具体文件的 UTC 修改日期，不能将本包编写时间、参考文件时间和项目发布版本混为一谈。

- 重新核对原 10 个文件，其最近变更 commit 与初次索引一致。
- arc42 的 [英文版本文件](https://github.com/arc42/arc42-template/blob/3e0d4861ff3f55d3bdd7bb590ad9259b1758a303/EN/version.properties) 声明 9.1-EN / October 2026，版本文件于 2026-10-19 修改。原索引的入口文件修改时间不能代表整个模板的更新状态。
- 截至本次核对，OpenAPI 最新稳定发布为 [3.2.1](https://github.com/OAI/OpenAPI-Specification/releases/tag/3.2.1)，发布时间为北京时间 2026-09-11（UTC 为 2026-09-10）。已补读 [3.2.1 固定规范文件](https://github.com/OAI/OpenAPI-Specification/blob/9f6c3fa4fdd8064e47d215a97308e7b56e55679d/versions/3.2.1.md)。原索引保留 3.1.1 以说明初版实际参考，不将其冒充最新版。
- 面向单人维护，SONiC 与 taogen 的旧示例仅保留来源历史，不列入常用参考。Google 评审文件继续用于相对稳定的设计、测试和复杂度检查。
- 推荐的维护结构及按北京时间显示的完整来源日期，见 [单人维护精简版](solo/README.md)。现有工具链的契约版本按实际支持选择；增加文档参考不代表自动升级应用。

## 3. 本包增加的 AI 开发约束

以下是针对 AI 辅助开发的整合建议，不将其归为某个单一上游项目的要求：

| 常见问题 | 本包的处理方式 |
| --- | --- |
| AI 根据模糊描述自行扩展范围 | 明确范围、排除项、待定项、允许修改路径及停止条件 |
| 重开对话后丢失上下文 | 固定仓库说明、功能规格与任务入口；保存已验证事实和下一步 |
| 文档、代码与测试彼此不一致 | 使用稳定编号、追踪矩阵和变更影响检查 |
| AI 写出“测试通过”，实际没有运行 | 分开记录用例编写、执行状态、运行版本和证据 |
| 同一假设同时污染实现和测试 | 测试从已确认验收条件推导；复核边界、反例和断言有效性 |
| 示例命令或 SDK API 不适用 | 记录真实依赖版本、核对对应版本文档；命令来自当前仓库 |
| 一次任务改动过大 | 按可独立交付的行为拆分任务，记录依赖、检查点和恢复方式 |
| 把 AI 编程等同于开发 AI 产品 | 通用协作规范独立使用，只有产品内含 LLM 时才增加模型评测 |
| 过度文档化 | 按规模选择最小组合，微小改动可合并为 Issue/PR |
| 交付结论超出证据 | 验收报告说明环境、覆盖范围、未测项和实际确认人 |

## 4. 如何继续更新

每季度或技术栈升级时，检查实际使用的上游文件及项目约定。先记录发生了什么变化，再决定是否更新模板；不因上游多了字段就自动增加团队负担。更新本包时记录版本、修改原因及对已有功能文档的影响。

本文对上游资料仅做简要归纳，中文字段、填写指导和示例为本次独立编写。直接引入上游原文件时，保留其要求的许可与署名信息。
