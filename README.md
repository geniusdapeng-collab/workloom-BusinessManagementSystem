# 经营管理系统 · BusinessManagementSystem

面向全屋智能门店的经营工作台，把获客、需求勘测、方案 BOM、报价审批、项目交付、售后和董事长汇报连成可追溯的业务流程。AI 由当前 Codex、千问办公或 WorkBuddy 会话的模型提供；运行时保存任务、校验产物、执行围栏并记录回执。

源码：[CNB 公共仓库](https://cnb.cool/workloom-ai/workloom-BusinessManagementSystem) · 许可证：[Apache-2.0](LICENSE) · 来源：`workloom-ai/workloom-hotel` 的 `5a04120a225dc3734415c8cc23e9c5f9474170c0`。

默认入口是本机 Node.js + SQLite 工作台，桌面和手机浏览器使用同一套业务接口。`sandbox` 演练数据始终带标识。业务状态持久保存，关闭聊天会话后可以继续；模型任务需要运行中的宿主会话。

## 克隆后启动

需要 Node.js 24 或更高版本。原平台工具链按 `package.json` 锁定 `pnpm@10.14.0`；本机工作台可以直接用 Node 启动。

```bash
git clone https://cnb.cool/workloom-ai/workloom-BusinessManagementSystem.git
cd workloom-BusinessManagementSystem
node scripts/business-management.mjs doctor
node scripts/business-management.mjs setup --client all
node scripts/business-management.mjs init --demo
node scripts/business-management.mjs serve
```

浏览器打开 **http://127.0.0.1:9393**。命令生成项目内配置和有明确 `synthetic` 标记的演练门店，不读取用户账号凭据。已有同名外部 MCP 配置时保留原文件并生成待合并的候选文件。依赖、数据范围、项目信任、千问办公导入和 WorkBuddy 启用步骤见 [AI 工作台接入](docs/AI-WORKBENCH.md)。

![经营工作台实际运行截图](docs/evidence/workbench-1440.png)

手机布局见 [390px 实际截图](docs/evidence/workbench-390.png)。截图使用沙箱数据，业务记录通过工作台接口读取。

## 三种日常使用方式

1. **董事长定目标**：创建有效线索、体验计划、验收项目、售后闭环或经营汇报目标；数字总经理读取实际账本、拆解岗位任务、交付待决包；店主通过 `goal.instruct` 调整目标或暂停。
2. **顾问推进签约与交付**：登记用途授权和现场勘测，校验型号/固件/电路/网络证据，生成 BOM 和整数分报价；报价审批绑定内容摘要，交付阶段必须按采购、安装、调试、客户验收顺序登记人类证据。
3. **增长团队准备内容与体验**：读取线索意向、预算与装修阶段，形成有来源的内容草稿和体验计划；未知授权、证据缺口、毛利违规或危险动作触发停止/待办，完成报告保留未完成原因。

本仓有 20 个岗位、35 个技能 SOP、16 条行业围栏、39 项操作契约和 5 类工作流；数量来自资产和运行时目录，详见 [业务能力矩阵](docs/SMART-HOME-BUSINESS-MATRIX.md) 和下方自动导览。四条固定业务工作流推进明确的本地业务对象；`employee-work` 支持全部已安装岗位技能，输出带对象版本和 SOP 摘要的分析、草稿、计划与人类待决包。视频技能交付拍摄/剪辑准备包，外发技能交付审批/发布准备包；外部执行没有回执时不会登记为成功。

## 让当前模型执行任务

```bash
node scripts/business-management.mjs catalog
node scripts/business-management.mjs describe workflow.start
node scripts/business-management.mjs call task.list
node scripts/business-management.mjs call task.claim --input '{"workflowId":"synthetic-growth-flow","idempotencyKey":"claim-growth-001"}'
```

`claim` 返回已安装的岗位技能、业务上下文、输出 schema 和有限时租约。当前会话模型生成结构化产物，调用 `task.submit`，再执行 `workflow.tick` 和 `goal.report`。CLI 与 MCP 共用契约，MCP 工具名采用 `bms_` 前缀。直接调用仓库技能 `$business-management` 可按此协议工作。

可给当前 AI 工作台这条任务：

> 使用本仓 business-management 技能，推进 synthetic-growth-flow 可执行的模型任务。按每次 claim 的 schema 提交，根据账本汇报结果。沙箱样本不能计为真实业绩，审批和现场证据缺口留在待办中。

后台 `tick` 执行确定性调度、租约恢复与依赖推进，模型由宿主执行。接入配置依据 [Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)、[千问办公连接器文档](https://help.aliyun.com/zh/qwenwork/desktop-connectors)、[WorkBuddy MCP 指南](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)。本次真实宿主执行证据来自 Codex；其他两个客户端的实际加载和执行单独标为未验证。

## 审批、真实数据和回执

普通 CLI、MCP、浏览器调用固定使用 agent 权限。店主通过启动服务的真实交互终端授权浏览器会话，或运行 `human-call` / `approve` 并核对确认语句。模型不能从参数中提权。人工批准与现场记录仍由业务围栏约束。

真实门店使用独立数据目录和范围，随后登记真实门店、授权和证据：

```bash
node scripts/business-management.mjs init --mode live --data-dir /absolute/path/bms-live --tenant my-store --workspace operations
node scripts/business-management.mjs setup --client codex --mode live --data-dir /absolute/path/bms-live --tenant my-store --workspace operations
```

`live` 表示本机数据口径；外部发布、消息、支付和设备控制连接器仍未启用。证据 URI 与摘要由人提供，系统记录引用并校验业务关系，外部事实未经独立核验时保留 `externalVerified=false`。租户/工作区隔离、幂等提交、事件链和摘要绑定均在运行时执行。

## 原平台与三端扩展

酒店源仓的公共平台、三端应用、电脑操作工具和历史演示保留在源码中，作为兼容和进一步集成资产。默认产品身份为 `smart-home`；PostgreSQL 平台与本机 SQLite 工作台使用独立数据存储，当前没有双向同步。

平台开发使用 `pnpm install --frozen-lockfile`、`pnpm setup:foundation` 和 `pnpm dev:foundation`。数据库迁移后 `pnpm db:seed` 安装全屋智能沙箱员工、围栏、技能和 FAQ；它拒绝生产环境、真实工作区和不同安装摘要，且不制造经营事件。PC 平台入口 `/smart-home/workbench` 指向本机经营工作台；B/C 客户端按行业投影装配。旧酒店种子仅通过显式 `pnpm db:seed:hotel-compat` 调用。

历史 `preview:all`、酒店演示截图、酒店专项套件和旧能力目录不构成本产品经营效果证明。正式签名桌面安装包要经过现有签名与发布门禁；当前入口交付源码与本机工作台，未发布已签名安装器。

## 验证与工程入口

```bash
pnpm test:business
pnpm exec tsx --test bundles/smart-home/assets.test.mts
pnpm typecheck
pnpm test
pnpm product:verify
pnpm bundle:governance
pnpm projections:check
pnpm capabilities:check
```

真实数据库的安全回归通过 `BMS_PG_TEST_URL` 指定独立 PostgreSQL 测试库，结果和运行环境见 [本次交付验收报告](docs/BUSINESS-MANAGEMENT-ACCEPTANCE.md)。版本、依赖和工具链以仓库锁文件为准；Node 内置 SQLite 行为依据 [Node.js 官方 SQLite 文档](https://nodejs.org/api/sqlite.html)。

<!-- CAPABILITIES:BEGIN -->
<!-- 本区块由 scripts/generate-capabilities.mjs 自动生成（2026-10-08），请勿手改；重跑 pnpm capabilities 更新 -->

## 🧩 系统能力速览（自动生成 · 与代码同步）

> 以下为源码目录与入口清单；实际调用及结果状态见能力导览的独立证据字段，未验证项不能作交付承诺。

- 🏠 **全屋智能门店经营（默认入口）**：响应式经营工作台 · 业务操作契约 ×39 · 宿主模型工作流 ×5 · 数字岗位 ×20 · 行业技能 SOP ×35 · 克隆后工作台配置
- 🖥 **继承平台三端入口（独立运行链）**：PC 端 · B 端工作台 · 移动端 · B 端高保真 · 移动端 · C 端 AI 服务前台
- 🏨 **行业 Bundle（垂直能力包）**：bundles/ai-pm/ · bundles/hotel/ · bundles/smart-home/
- 🧑‍💼 **继承平台的数字员工与数字人**：数字员工中心（`/agents`） · 织伴数字人（Live2D 常驻浮层） · 语音与口型引擎 · Live2D 渲染后端与资产
- 🖐 **操作电脑能力（本仓自带 · 可装生产工作站）**：computer-use 三层感知入口 · HTTP 远程驱动 + MCP server
- 🤖 **继承平台引擎（目录发现，须独立验收）**：围栏 DSL 引擎 · 技能保鲜环（下行分发） · L2 编排（ASK/QUEST） · 夜班自动运行 · 模型路由 · 五元事件 + RLS 隔离 等 10 项
- ✅ **验证与质量（工程纪律）**：项目配置初始化 · 全屋智能业务回归 · 主测试套件 · 发布门禁 · 五元事件验链 · Agent 能力巡游 等 7 项
- 🎁 **演示与交付资产**：高保真演示页 ×6 · 官网静态站 · 自带技能 ×5 · 能力导览 PPT · Mock 数据体系

> 📖 完整能力导览：[docs/capabilities.auto.md](docs/capabilities.auto.md) ｜ 🤖 AI Agent 入口：[AGENTS.repo.md](AGENTS.repo.md) ｜ 🎯 首启：`pnpm setup --client all` → `pnpm bm init --demo` → `pnpm dev`
<!-- CAPABILITIES:END -->

开发者依次阅读 [AGENTS.md](AGENTS.md)、[AGENTS.repo.md](AGENTS.repo.md)、[WORKLOOM_PRODUCT_CONTEXT.md](WORKLOOM_PRODUCT_CONTEXT.md)、[业务能力矩阵](docs/SMART-HOME-BUSINESS-MATRIX.md) 和 [AI 工作台接入](docs/AI-WORKBENCH.md)。需求、候选方案、对象契约、异常路径、测试覆盖与剩余边界记录在本仓文档中。
