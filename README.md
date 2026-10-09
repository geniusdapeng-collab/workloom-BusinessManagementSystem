# BusinessManagementSystem · AI 自主经营系统｜全屋智能门店

**让一家全屋智能门店，从第一条线索到客户交付，都有可接续的经营记录和数字员工。**

门店卖的不只是中控屏、灯具和传感器，还要把客户的家变成能长期使用的生活场景。设计师转来一句“王先生，成都南边某楼盘，想看看智能灯光”，顾问还不知道姓名、电话和预算；方案做好后，点位、回路、施工变更和验收又容易散在聊天、表格与文件里。本系统把这些工作放到同一条客户旅程中，让 AI 围绕门店目标推进分析、话术、方案与经营复盘，让人类核实客户授权、价格承诺和现场结果。

源码：[CNB 公共仓库](https://cnb.cool/workloom-ai/workloom-BusinessManagementSystem) · 许可证：[Apache-2.0](LICENSE) · 基础来源：`workloom-ai/workloom-hotel@5a04120a225dc3734415c8cc23e9c5f9474170c0`。

## 先走进一家成都全屋智能门店

默认演练门店是 **蜀光智家 · 成都高新体验店**。这是虚构品牌与模拟经营数据集，借鉴华为全屋智能的空间、主机、中控和场景思路，以及 Aqara 的传感、自动化和体验服务思路；它不是华为或绿米授权门店。品牌产品知识来自[官方行业资料](bundles/smart-home/library/industry-context.json)，门店自己的 SKU、价格、客户、合作伙伴、工程和财务记录均有合成标识，不代表真实厂家报价、真实客户或真实营收。

门店围绕中控与网关、照明与开关、窗帘、环境与安防等产品组织体验。顾问先问“回家、观影、起夜、离家时想发生什么”，再核对户型、装修进度、电气与网络条件，最后形成分房间点位、场景设计、设备清单、施工计划和合同范围。AI 经营始终围绕这些真实业务动作，产品资料是经营输入。

| 你会遇到的日常场景 | 系统怎样接住这件事 | 交付给人的下一步 |
| --- | --- | --- |
| 设计师、装修公司、异业伙伴给来一条残缺线索 | 先保存称呼、渠道和已有引用，保留未知字段；线索完善任务列出应问的问题和来源 | 顾问核对用途授权，逐步补客户资料与楼盘信息，准备到店体验 |
| 客户到店比较中控、灯光和自动化 | 从需求、预算与装修阶段准备体验路线、销售话术和陪练；预约计划与客户确认分别记录 | 人类确认邀约、勘测与报价，避免把草稿当成客户承诺 |
| 项目从方案进入施工和验收 | 客户档案连接勘测、点位图、设计方案、BOM、报价、施工方案、合同与工程记录 | 采购到货、安装、逐场景调试、客户培训与验收按证据推进 |
| 店长复盘本周经营 | 读取当前门店账本，识别线索缺口、待审批、待现场证据和售后风险，拆成岗位任务 | 老板决定目标、资源与待决事项，下一次会话继续执行 |

完整日常流程见[门店实战手册](docs/SMART-HOME-STORE-PLAYBOOK.md)、[店长使用指南](docs/01-门店店长使用指南.md)和[新客户接入流程](docs/02-新客户首次接入完整流程.md)。

## 数字员工围绕客户与经营目标工作

线索接待与完善、渠道合作、邀约、销售助理、AI 陪练、门店经营助理、店长助理，连接方案设计、报价审核、工程交付和售后岗位。岗位拥有明确技能、前置记录和责任人；客户信息不足时先补信息，勘测和兼容证据不足时先提出缺口，价格、合同与现场工作需要人类参与。

当前岗位与技能清单以[已安装岗位目录](bundles/smart-home/library/workforce.json)和下方自动导览为准。固定业务流会应用本地业务变化；指定岗位的 `employee-work` 交付带对象版本依据的分析、话术、草稿、计划和待决包。销售练习是练习记录，发布准备是准备包，施工计划是计划；这些结果分别保存，不混算为真实成交、已外发或已施工。

## 克隆后用当前 AI 工作台启动

默认入口是本机 Node.js + SQLite 工作台。代码要求 **Node.js 24 或更高版本**；平台工具链由 `package.json` 与锁文件固定。独立经营入口可以直接用 Node 启动，不要求先安装平台依赖。SQLite API 依据 [Node.js 24 官方文档](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html)。

```bash
git clone https://cnb.cool/workloom-ai/workloom-BusinessManagementSystem.git
cd workloom-BusinessManagementSystem
node scripts/business-management.mjs doctor
node scripts/business-management.mjs setup --client all
node scripts/business-management.mjs init --demo
node scripts/business-management.mjs serve
```

打开 **http://127.0.0.1:9393**，查看成都模拟门店的线索、产品、客户、工程、经营记录、AI 任务和人工待办。`init --demo` 在沙箱导入完整演练背景；重复初始化恢复同一数据集，不把模拟历史解释成刚执行的 AI 成果。浏览器与 CLI/MCP 读取同一工作区，关闭宿主会话后记录仍保留。

`setup` 生成项目内 Codex / WorkBuddy 配置及千问办公导入 JSON，保留已有配置冲突候选文件。使用说明与实际验证边界见 [AI 工作台接入](docs/AI-WORKBENCH.md)。千问办公和 WorkBuddy 的协议配置不替代对应客户端真机验证。

在当前 AI 工作台给出这条任务：

> 使用本仓 business-management 技能，读取成都模拟门店的经营目标、未完善线索和可领取任务。优先准备线索完善、到店邀约、销售与店长经营待办；按每次 claim 的岗位规程和 outputSchema 生成并提交产物。缺字段就说明缺口，不猜客户陈述。逐步读取实际记录和目标指标，遇到人审或现场证据保留待办，并区分模拟历史与本次真实宿主执行。

`task.claim` 返回当前业务对象、完整岗位技能、输出 schema 和有限时租约。当前宿主模型生成产物，`task.submit` 校验并保存，`workflow.tick` 推进依赖，`goal.report` 读取本地指标。调度器自身不调用模型，持续 AI 工作需要运行中的宿主会话。

## 从模拟运营走向自己的门店

先在 sandbox 走完三条主线：残缺线索完善、方案工程交接、店长复盘。检查每一步的来源、状态和未闭事项，再为自己的门店建立独立 live 目录：

```bash
node scripts/business-management.mjs init --mode live --data-dir /absolute/path/bms-live --tenant my-store --workspace operations
node scripts/business-management.mjs setup --client codex --mode live --data-dir /absolute/path/bms-live --tenant my-store --workspace operations
```

真实数据模式禁止合成历史与合成证据。联系方式使用受控存储的引用；原始电话、微信账号、家庭地址、账号密码不能进入公开仓库、模型报告或普通经营对象。现场人员和店主登记客户授权、勘测、签约与验收证据，店主核对具体摘要后决定审批。普通 MCP 不能从业务参数取得店主身份。

本地回执表示业务记录已提交，`externalVerified=false`。发布、客户消息、资金执行和设备控制连接器目前为 `disabled`；客户是否收到消息、款项是否发生、设备是否实际调试成功，需要对应真实平台或现场证据。当前源代码交付没有已签名桌面安装器的承诺。

## 产品、接入与工程资料

- [用户功能清单](docs/03-功能清单-用户版.md)：每项工作给门店带来什么、还需人做什么。
- [全屋智能落地向导](docs/04-行业落地向导-用户版.md)：门店、产品、场景、渠道、人员和证据怎样配置。
- [AI 工作台接入](docs/AI-WORKBENCH.md)：命令、数据范围、宿主任务循环、审批与恢复。
- [业务与实现矩阵](docs/SMART-HOME-BUSINESS-MATRIX.md)：对象、操作、岗位、异常路径和证据等级。
- [本轮实战深化验收](docs/SMART-HOME-DEPTH-ACCEPTANCE.md)：架构取舍、渐进资料链、真实宿主任务、测试证据与生产边界。
- [演示脚本](docs/demo-script.md)：按实际数据演示，避免把模拟背景说成已完成经营。
- [现有交付验收报告](docs/BUSINESS-MANAGEMENT-ACCEPTANCE.md)：前次基线的验证范围；新变更以本次独立证据为准。

默认 `smart-home` 行业包承载本产品语义。继承平台三端、PostgreSQL、电脑操作工具和 Hotel 历史资产保留在独立兼容链中；SQLite 经营账与平台数据库当前没有双向同步。平台开发路径为 `pnpm install --frozen-lockfile`、`pnpm setup:foundation`、`pnpm dev:foundation`。数据库主种子默认全屋智能沙箱，旧酒店种子需显式 `pnpm db:seed:hotel-compat`。历史酒店演示与测试资产只作为继承参考，不进入默认门店用户路径。

工程验证入口：

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

<!-- CAPABILITIES:BEGIN -->
<!-- 本区块由 scripts/generate-capabilities.mjs 自动生成（2026-10-09），请勿手改；重跑 pnpm capabilities 更新 -->

## 🧩 系统能力速览（自动生成 · 与代码同步）

> 以下为源码目录与入口清单；实际调用及结果状态见能力导览的独立证据字段，未验证项不能作交付承诺。

- 🏠 **全屋智能门店经营（默认入口）**：响应式 AI 经营工作台 · 业务操作契约 ×51 · 宿主模型工作流 ×5 · 数字岗位 ×27 · 行业技能 SOP ×49 · 克隆后工作台配置 · 成都门店经营演练 · 全屋智能行业背景

继承平台、历史行业与演示资产列在完整能力导览的工程目录中；默认经营入口、门店资料与 AI 岗位使用全屋智能行业包。

> 📖 完整能力导览：[docs/capabilities.auto.md](docs/capabilities.auto.md) ｜ 🤖 AI Agent 入口：[AGENTS.repo.md](AGENTS.repo.md) ｜ 🎯 首启：`pnpm setup --client all` → `pnpm bm init --demo` → `pnpm dev`
<!-- CAPABILITIES:END -->

开发者依次阅读 [AGENTS.md](AGENTS.md)、[AGENTS.repo.md](AGENTS.repo.md)、[WORKLOOM_PRODUCT_CONTEXT.md](WORKLOOM_PRODUCT_CONTEXT.md) 和业务实现矩阵。目录清单、实际调用和结果验证分别取证。
