# 当前 AI 工作台驱动全屋智能门店经营

BusinessManagementSystem 的经营运行时独立于聊天窗口：Node.js 24 的内置 SQLite 保存门店目标、残缺线索与完善草案、客户资料、勘测、点位、设计、报价、施工、合同、经营观察、工作流、任务租约、审批和事件回执；浏览器工作台和 CLI/MCP 共用同一业务入口。Codex、千问办公、WorkBuddy 当前会话内置模型负责领取任务、理解上下文、生成结构化产物并提交。此入口不会调用 Hotel 遗留服务的 LLM_PROVIDER/LLM_API_KEY；无需另购模型 API。

后台 `tick` 只执行确定性调度、过期租约恢复与依赖推进；模型工作需要一个运行中的宿主会话。关闭宿主后状态仍保留，重新连接可以继续领取任务。

## 本机启动

在克隆后的仓库根目录执行，Node 主版本必须至少为 24。

```bash
node scripts/business-management.mjs doctor
node scripts/business-management.mjs init --demo
node scripts/business-management.mjs setup --client all
node scripts/business-management.mjs serve
```

`init --demo` 仅支持 sandbox，导入 `shuguang-chengdu-v1` 完整成都演练背景：蜀光智家 · 成都高新体验店、合成SKU/价格、分阶段线索与客户、点位设计、施工合同、工程售后和经营观察。它不表示华为/Aqara品牌授权、真实兼容测试、客户授权、签约或交付业绩。历史来源标为 `synthetic-history-import`，保留dataset/version/digest和未真实人审标识；待执行AI任务不伪造完成产物或modelTrace。旧 `seedSyntheticDemo` 仅为测试回归小样本，不是默认门店背景。真实经营用独立live目录，先配置门店与实际证据。

```bash
node scripts/business-management.mjs scenario list
node scripts/business-management.mjs scenario import
node scripts/business-management.mjs call industry.context
```

`scenario import` 是专用CLI沙箱operator演练入口，允许非TTY导入合成历史，始终声明没有真实人审/客户联系/资金/设备动作；普通`call`与MCP使用agent，不能导入历史。数据集导入按封印摘要校验、原子提交，相同修订可恢复且不覆盖业务对象；代码、规程或数据集摘要变化后，旧键重放与新键恢复都会拒绝，应保留旧范围并创建新的sandbox。行业背景只读来自 `library/industry-context.json`，含门店、产品参考、体验、渠道、官方引用和模拟披露六部分。

默认浏览器地址为 `http://127.0.0.1:9393`。端口按 `--port`、环境变量 `BMS_PORT`、`product.manifest.json` 的 `workbench.port` 顺序取值。服务只绑定 127.0.0.1，拒绝异域 Origin 和未知 Host。

| 参数 | 环境变量 | 默认 |
| --- | --- | --- |
| `--data-dir` | `BMS_DATA_DIR` | `.business-management/data/<mode>` |
| `--mode` | `BMS_DATA_MODE` | `sandbox` |
| `--tenant` | `BMS_TENANT_ID` | `demo-store` |
| `--workspace` | `BMS_WORKSPACE_ID` | `default` |
| `--port` | `BMS_PORT` | 产品清单端口 9393 |

命令不隐式加载 `.env`。需要该文件时使用 `node --env-file=.env scripts/business-management.mjs ...`。同一 tenant/workspace 的 dataMode 在 SQLite 首次创建后不能变更；切换 live 应使用不同目录或 workspace。

```bash
node scripts/business-management.mjs init --mode live --data-dir /absolute/path/bms-live --tenant my-store --workspace operations
node scripts/business-management.mjs setup --client codex --mode live --data-dir /absolute/path/bms-live --tenant my-store --workspace operations
```

## Codex

`setup --client codex` 将当前 Node 可执行文件、仓库和数据目录的绝对路径写入项目 `.codex/config.toml` 的受管区块。它保留其他配置；已有同名非受管服务或结构冲突时保留原文件并生成 candidate 文件供人工合并。

在 Codex 中以本仓库打开项目并信任项目，新建会话后检查 MCP `business_management`。仓库技能位于 `.agents/skills/business-management/SKILL.md`，可自动发现，也可明确调用 `$business-management`。

示例任务：

> 使用 business-management 技能，读取当前成都模拟门店的行业背景、目标、残缺线索与AI任务。优先推进线索完善、到店准备、销售陪练和店长经营待办；每个artifact按claim返回的岗位规程与schema生成，提交后读回实际指标。区分模拟历史与本次真实宿主执行，遇到审批或现场证据保留待办。

项目级配置及 stdio 字段以 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp) 为准。工作台仍需遵循宿主自身的工具审批与项目信任设置，本脚本不会修改用户级配置、登录状态或账号凭据。

## 千问办公

`setup --client qwenwork` 生成 `.business-management/setup/qwenwork.mcp.json`，内容只含 stdio 服务、Node/入口绝对路径和业务范围变量。按照 [千问办公官方连接器文档](https://help.aliyun.com/zh/qwenwork/desktop-connectors)，在“扩展 → 连接器 → 添加”粘贴 JSON，启用后新建任务。

使用相同宿主任务循环；modelTrace.host 填 `qwen-workbench`。该项目没有千问账号凭据读取逻辑。

## WorkBuddy

`setup --client workbuddy` 生成项目 `.workbuddy/mcp.json`，保留其他 mcpServers。以该项目目录创建任务并启用 business_management。官方配置入口与项目配置格式见 [WorkBuddy MCP 指南](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)。modelTrace.host 填 `workbuddy`。

`setup --client generic` 生成通用 stdio JSON。千问办公和 WorkBuddy 的配置按各自官方文档实现；具体客户端能否加载、审批或持续运行须在对应客户端实测，Codex 的成功记录不替代其他客户端验收。

## 宿主模型执行协议

MCP 工具名为 `bms_` 加操作名，将 `.` 替换为 `_`。CLI 保留原操作名，能力目录和输入 schema 来自同一运行时。

```bash
node scripts/business-management.mjs catalog
node scripts/business-management.mjs describe task.claim
node scripts/business-management.mjs call task.list
node scripts/business-management.mjs call task.claim --input '{"idempotencyKey":"host-claim-001"}'
```

领取返回 taskId、leaseToken、expiresAt、outputSchema，以及包含门店、目标、实测指标、关联对象、SKU和兼容记录的 task.context。leaseToken 只用于这一次租约，不要把它写入报告。当前模型根据任务 instructions 生成 artifact，再调用 `task.submit`：

任务实体保存租约哈希，SQLite 的幂等缓存保存完整领取响应及原始明文 leaseToken，以便相同请求、操作者和渠道重放；缓存没有单独加密。对象、任务列表、工作流详情与状态快照会移除租约哈希，经营事件只返回请求/结果摘要，不开放完整幂等缓存。文件、备份和本机账号权限仍能读取缓存，应按敏感业务数据保护。重放旧响应只返回旧期限，不能让过期、已完成或被重新领取的租约恢复有效；真正提交仍校验当前租约和操作者。隔离实测见 [租约存储与读取边界](evidence/lease-storage-boundary.json)。

提交JSON文件须包含领取返回的 `taskId` 与 `leaseToken`、符合该任务 `outputSchema` 的 `artifact`、本次宿主 `modelTrace` 和新的 `idempotencyKey`。每种阶段的schema不同，先读取再生成；不要把别的客户或旧回归样本产物复制到当前任务。客户预算、装修阶段和需求必须来自记录；缺信息应填缺口，不能猜值。`modelTrace.host`填实际宿主，`model`填宿主公开实际名称；不知道具体型号用`host-default-unspecified`。`invocationRef`关联本次宿主过程日志，不要编执行轨迹。

提交文件后执行：

```bash
node scripts/business-management.mjs call task.submit --input-file work/submit.json
node scripts/business-management.mjs workflow tick --input '{"idempotencyKey":"host-tick-001"}'
node scripts/business-management.mjs call entity.list --input '{"type":"goal"}'
node scripts/business-management.mjs call ledger.verify
```

从当前目标列表选定真实存在的goalId，再调用`goal.report`读取当前指标。继续claim/submit到完成或明确门禁。示例幂等键用于一次请求，新的业务请求使用新键；同一请求响应中断才重放原键。失败用 task.fail 记录 error/retryable；失效租约先 tick 再领取。runtimeModelCalls 始终是 0，因为模型发生在宿主中。modelTrace 与 hostModelExternallyVerified=false 是本地宿主提交声明；另行保存宿主执行日志才能证明实际调用。

管理工作流的 plan 产物可提出子目标；带准确 leadId/surveyId/ticketId 时运行时自动启动对应子工作流，无先决对象时记 waiting-input。上下文包含当前活动工作流，避免对同一输入重复排队。资格不足的获客工作流会跳过内容/体验阶段并生成汇报，因此应一起读取 skippedPhases 和目标实测指标，不能把 completed 状态直接解释成四阶段全做或经营目标达成。

## 线索完善、客户资料与工程版本

`lead.create`允许已有称呼/姓氏/联系引用/楼盘信息任一项作为起点，channel可unknown，意向与预算可未知；授权状态仍单独记录。`contactRef`、`phoneRef`、`wechatRef`用于受控存储的不透明引用，不应填明文联系方式。输入校验拒绝可检测的手机号、电子邮箱和敏感字段，无法识别所有可能的微信别名，记录者仍需遵守引用规则。

`lead.enrich`需要leadId、expectedVersion、patch、source和evidence。AI使用`source=model-proposal`时只保存`leadEnrichment`待确认草案，`customerFactsApplied=false`，不修改客户事实或授予授权。确认后的客户事实必须由owner/operator人类确认通道应用，变更包含来源与历史。`customer.upsert`需要consultation许可和人类确认，关联原线索，不允许改挂另一客户或门店。

工程链为客户/勘测 → 点位计划与已验证solution/BOM → design → construction → contract。点位房间尺寸与坐标使用毫米，坐标必须在房间范围，设备与回路引用必须存在。点位草图允许暂缺设备，但design要求每个设备点绑定准确SKU、分房间/SKU点位数量完整匹配BOM，并覆盖已验证方案的每个场景；网络/插座辅助预留点可不绑定SKU。construction数量准确匹配BOM；文档修订连接最新前版，客户、SKU、点位或方案变化会使旧快照失效。

合同草案需要合规报价与一致的设计/施工/客户引用；付款计划总额等于报价。合同审批需已批准且有效报价，合同签约再需要独立合同批准和客户证据。资料齐全的工程项目必须引用已签约合同。本地`business.record`登记经营观察与计划，不执行资金。完整schema与错误见 `describe` 和[业务实现矩阵](SMART-HOME-BUSINESS-MATRIX.md)，门店场景见[实战手册](SMART-HOME-STORE-PLAYBOOK.md)。

## 店主操作与现场证据

普通 CLI call、MCP 和浏览器 `/api/call` 固定 agent。人类操作必须由真实交互终端确认，不能通过 stdin 管道代办。

```bash
node scripts/business-management.mjs call approval.list --input '{"status":"pending"}'
node scripts/business-management.mjs approve <approvalId> --input-file work/approval.json
node scripts/business-management.mjs human-call survey.record --input-file work/survey.json
```

审批 JSON 必须含 approvalId、decision、reason、contentDigest 和 idempotencyKey。先查看审批对象的摘要并核实拟批准内容，再在终端输入显示的确认语句。现场操作还需人类已有对应权限和真实 evidence；系统登记引用与摘要，不声称已经访问或核验 URI 内容。

浏览器店主会话流程：店主在真实终端启动 serve，在浏览器申请会话，核对页面显示的 requestId，再在启动终端输入 `owner <requestId>`。申请 5 分钟有效，授权 30 分钟有效；后台非交互进程不能授权。店主请求还需同源 Origin、HttpOnly/SameSite=Strict 会话 cookie 与 CSRF 校验。退出会话会清除授权。

这里的人员确认以本机操作系统账号、启动终端和数据库文件权限为信任边界。普通 CLI、MCP 和浏览器业务参数不能改变 actor 或取得 owner；TTY 检查只保证走过交互终端确认流程，不是独立身份认证，也不提供不可伪造的人类在场证明。与店主拥有同一系统账号、任意 shell/PTY 或数据库写权限的宿主代理，可以启动 `human-call`、向 PTY 输入确认文本或改写 SQLite。必须在宿主权限中限制这些能力，才能把业务层审批与代理的运行权限分开；本项目不声称能抵抗本机管理员或同账号任意代码。

## 边界与审计

- 所有写操作需要幂等键；修改旧门店/SKU需 expectedVersion。事务将业务对象、幂等回执和事件链一起提交，失败回滚。
- SQLite按tenant/workspace过滤；sandbox和live不允许复用同一范围口径。live禁止合成历史和合成证据。输入拒绝可检测的明文手机号/邮箱、账号密钥及提权字段；不能据此保证任意文本都完成隐私识别。
- 现场勘测、合同、采购、安装、调试、客户验收、售后完成由 owner/operator 且 humanConfirmed 才能录入；MCP 无提权通道。
- 方案校验勘测房间、BOM、精确 SKU 版本的兼容证据；报价计算整数分、毛利和折扣；审批绑定摘要和有效期；施工/调试/验收强制顺序。
- 本地回执 kind 为 `local.sqlite.commit`，externalVerified=false。公开发布、消息、付款、真实设备控制连接器均 disabled，人类批准也不能开启。
- 此独立经营入口可在零外部凭据下运行。完整 Hotel 派生平台仍作为继承资产保留，其 PostgreSQL/桌面/遗留开发工具接入是另一条运行链。

stdio 使用逐行 JSON-RPC，stdout 只输出协议，日志写 stderr；协议依据 [MCP 官方传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。

## 重跑浏览器回归

安装仓库现有开发依赖后，使用 `apps/web` 已声明的 `@playwright/test`，不添加产品依赖。按 [Playwright 官方浏览器文档](https://playwright.dev/docs/browsers) 安装所需测试浏览器，再从仓库根目录运行：

```bash
pnpm --filter @workloom/web exec playwright install chromium
node scripts/check-business-workbench.mjs
```

本机已安装 Google Chrome 时可运行 `node scripts/check-business-workbench.mjs --channel chrome`；它使用独立浏览器上下文，不复用个人登录状态。`--browser` 支持 chromium、firefox、webkit；`--channel` 仅用于 chromium。`--source-root /absolute/path/clone` 指定待测克隆，`--output /absolute/path/evidence` 指定证据目录。缺少浏览器或依赖时命令失败退出，不能把零用例解释为通过。

脚本使用随机回环端口和临时独立SQLite，具体用例与数量以当前脚本和本次结果为准，覆盖正常保存、特殊字符、校验、敏感联系方式拒绝、人员会话/撤销、读失败恢复与各状态，并验证1440、390、320宽度。终端授权与状态注入是明确的合成自动化夹具，不证明真实人员决定或未操作的业务迁移。JSON包含每项前置、步骤、预期、实际、结果和源SHA。指定新的`--output`目录保存本次证据，避免覆盖旧基线记录；结束关闭服务、浏览器并清理临时库，调试可加`--keep-data`。
