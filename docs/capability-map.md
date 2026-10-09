# BusinessManagementSystem 能力地图｜全屋智能 AI 经营入口

给门店实施人员与AI代理使用。默认产品语义在`bundles/smart-home`，默认执行链是Node + SQLite + 当前宿主模型。目录可发现、实际可调用、结果已验证分别取证；计数由[自动能力导览](capabilities.auto.md)和运行时catalog生成。

本文的默认入口描述依据完整读取CLI/HTTP与native网关、领域、工作流、存储和岗位加载器（A）；继承平台目录仅列为兼容导航，递归实现与当前目标环境运行状态未由本文验证（B/D）。本次详细阅读清单与公开内容验证落在`docs/evidence/smart-home-depth/`，旧验收证据保持对应旧基线。

## L0 门店业务与背景

| 工作 | 入口与资料 | 看什么结果 |
| --- | --- | --- |
| 成都模拟门店 | `node scripts/business-management.mjs init --demo`；[实战手册](SMART-HOME-STORE-PLAYBOOK.md) | 蜀光智家背景、各阶段客户与工程；全部synthetic，任务需宿主实际执行 |
| 行业知识 | `industry.context`；`library/industry-context.json` | 官方品牌参考、门店/产品/体验/渠道背景；不是真实销售目录或品牌授权 |
| 来源到客户 | `lead.create`、`lead.enrich`、`customer.upsert`；[客户流程](02-新客户首次接入完整流程.md) | 残缺线索可接续；AI保存补充草案，人类确认后应用事实；未知字段、版本、来源和用途授权明确 |
| 体验与销售 | `experience.schedule`、销售助理/陪练/邀约岗位 | 拟议体验、话术、练习与准备包；客户确认和外部消息分别判断 |
| 点位与方案 | `survey.record`、`pointPlan.record`、`design.record`、`solution.build` | 房间、尺寸、坐标、场景/BOM与精确版本证据；不替代现场测量 |
| 价格与合同 | `quote.create/request_approval`、`contract.create/request_approval/record_signing` | 价格复算、内容摘要、待审与人类签约证据；草案不形成外部承诺 |
| 施工与验收 | `construction.record`、`project.create/milestone`、采购/调试/验收操作 | 顺序依赖与人类现场记录；软件图形和本地提交不证明现场完成 |
| 售后与经营 | `aftercare-loop`、`management-loop`、经营助理与店长助理 | 分级、回访、指标、交接、岗位任务与未决事项 |

精确字段、枚举、必填与权限，以`describe <operation>`和[业务实现矩阵](SMART-HOME-BUSINESS-MATRIX.md)为准，不用本文短表替代schema。

## L1 本机工作台、CLI与MCP

```bash
node scripts/business-management.mjs doctor
node scripts/business-management.mjs setup --client all
node scripts/business-management.mjs init --demo
node scripts/business-management.mjs serve
```

| 入口 | 作用 | 验证条件 |
| --- | --- | --- |
| `http://127.0.0.1:9393` | 桌面/手机浏览器读取同一SQLite工作区 | API真实返回、桌面/手机可操作、空/错/加载状态明确 |
| `catalog` / `describe <operation>` | 操作、工作流、岗位、技能、风险与输入schema | 输出来自当前运行时，不用固定数字替代 |
| `call <operation> --input-file <path>` | agent读写入口 | schema、范围、幂等、角色与业务规则通过 |
| `task.claim/submit/fail` | 当前宿主模型领取、生成、提交或记录失败 | 有实际宿主执行日志、有效租约和结构化产物 |
| `workflow.tick` | 依赖推进、到期和租约恢复 | modelCalls=0；模型推理仍需宿主会话 |
| `goal.report` / `ledger.verify` | 本地实测指标与事件/投影/回执校验 | 无编数、无账本异常；不解释为外部结果 |
| `approve` / `human-call` | 店主人类决断与现场证据入口 | 真实TTY确认或浏览器终端授予owner会话，核对具体摘要 |
| `mcp` / 项目配置 | Codex、千问办公、WorkBuddy可发现的stdio服务 | 客户端协议配置和真机验收分别记录，MCP固定agent |
| `scenario.list/import` | 查询或导入封印的模拟历史 | import仅sandbox且operator/owner，保留dataset/version/digest与未真实人审标识 |

Node最低版本由源码检查，模型使用宿主当前会话，不读Hotel旧模型API配置。命令不自动加载`.env`。数据范围、配置冲突、敏感联系引用、租约缓存与本机信任边界见[接入文档](AI-WORKBENCH.md)。

## L2 验证与交付

| 检查 | 命令 | 应保存的证据 |
| --- | --- | --- |
| 独立业务与传输 | `pnpm test:business` | 正常、边界、错误、角色、版本、幂等、并发、租约与回执实际结果 |
| 行业资产 | `pnpm exec tsx --test bundles/smart-home/assets.test.mts` | 实际加载器、摘要、岗位技能归属与pipeline一致 |
| 类型与单元测试 | `pnpm typecheck` / `pnpm test` | 当前提交的非零失败及时修复 |
| 产品/投影/治理 | `pnpm product:verify` / `pnpm projections:check` / `pnpm bundle:governance` | 入口身份、默认行业资产、投影与治理绑定 |
| 能力导览 | `pnpm capabilities:check` | 自动文档与代码无漂移 |
| 浏览器工作台 | `node scripts/check-business-workbench.mjs` | 桌面/手机/窄屏状态与操作、源SHA和实际截图 |
| 双语介绍页 | `node scripts/check-business-site.mjs` | 导航、语言、FAQ、无JS、布局、资源与产品边界 |
| 真实宿主任务 | 当前AI工作台执行claim/submit | 真实宿主过程与业务回执分别保存；合成业务不变成真实业绩 |

当前客户端、物理设备、客户、渠道、资金和生产环境必须分别声明验证口径。旧提交的通过记录不能证明后续新增功能已经测过。

## L3 继承平台与公共包导航

以下是继承资产导航（B），不是默认门店已启用或生产可用证明。默认SQLite与继承PostgreSQL当前没有双向同步；native的任务、审批和local.sqlite.commit不能替代平台的线程、tRPC授权与事件。

| 目录/资产 | 可以继续研究什么 | 独立前提 |
| --- | --- | --- |
| `packages/base/fence-engine`、`workdata`、`tenancy` | 公共围栏、事件与RLS范围 | 目标平台配置、数据库和实际回归 |
| `captain`、`night-shift`、`model-router` | 平台编排、节拍与模型路由 | 配置与后台环境；不能归因成native持续推理 |
| `service-*`、`im-channels` | C服务前台、工单、知识与渠道 | 身份、行业adapter、实际授权和外部回执 |
| `computer-use` | 浏览器/桌面驱动与工作站 | 环境、安装、权限和真机实测，不能克隆即保证可用 |
| `bundles`、`skills`、`wizard` | 平台装配、技能与落地机制 | 当前清单、信任摘要与对应工作区 |
| `apps/web`、`apps/webb`、`apps/webc` | PC/B移动/C移动行业扩展 | PostgreSQL平台运行链与各端验收 |
| `apps/desktop`、发行工作流 | 签名安装器与平台分发 | 受保护发布、签名与独立部署验证 |
| `bundles/hotel`、`docs/demo`、`DEMO-TWIN.md` | Hotel历史演示与兼容回归 | 明确历史/模拟标识，不进入默认门店叙事 |

平台源码开发使用`pnpm install --frozen-lockfile`、`pnpm setup:foundation`、`pnpm dev:foundation`。`pnpm db:seed`默认全屋智能沙箱资产，酒店兼容种子需显式`pnpm db:seed:hotel-compat`。平台数据重置或生产部署应遵循具体资产规程，不把历史演示快捷命令当作门店首启指令。

## 给后续AI代理的执行纪律

先读取当前产品清单、业务目录、已安装岗位技能和真实对象，再选择任务。直接追到实现和当前schema，未知字段保留未知，不绕过授权、兼容、财务、工程顺序或外部禁用。模型产物只有提交并读回后才算本地完成；人类确认、真实现场和平台执行各需自己的证据。

完整日常使用见[实战手册](SMART-HOME-STORE-PLAYBOOK.md)，开发协议见仓库AGENTS与受控WorkLoom上下文。
