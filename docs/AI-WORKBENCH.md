# 当前 AI 工作台驱动全屋智能门店经营

BusinessManagementSystem 的经营运行时独立于聊天窗口：Node.js 24 的内置 SQLite 保存目标、客户线索、勘测、方案、报价、工作流、任务租约、审批和事件回执；浏览器工作台和 CLI/MCP 共用同一业务入口。Codex、千问办公、WorkBuddy 当前会话内置模型负责领取任务、理解上下文、生成结构化产物并提交。此入口不会调用 Hotel 遗留服务的 LLM_PROVIDER/LLM_API_KEY；无需另购模型 API。

后台 `tick` 只执行确定性调度、过期租约恢复与依赖推进；模型工作需要一个运行中的宿主会话。关闭宿主后状态仍保留，重新连接可以继续领取任务。

## 本机启动

在克隆后的仓库根目录执行，Node 主版本必须至少为 24。

```bash
node scripts/business-management.mjs doctor
node scripts/business-management.mjs init --demo
node scripts/business-management.mjs setup --client all
node scripts/business-management.mjs serve
```

`init --demo` 仅支持 sandbox，生成明确标为 synthetic 的假门店、假 SKU 和两条业务工作流。它不代表真实兼容测试、客户授权或交付业绩。真实经营用独立 live 目录，先配置门店与实际证据。

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

> 使用 business-management 技能，读取当前沙箱的目标和工作流，推进 synthetic-growth-flow 所有可由当前内置模型完成的任务。每个 artifact 按 claim 返回的 schema 生成，提交后读实测指标；不要把合成样本说成真实经营业绩。遇到审批或现场证据就交付待办。

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
node scripts/business-management.mjs call task.claim --input '{"workflowId":"synthetic-growth-flow","idempotencyKey":"growth-claim-001"}'
```

领取返回 taskId、leaseToken、expiresAt、outputSchema，以及包含门店、目标、实测指标、关联对象、SKU和兼容记录的 task.context。leaseToken 只用于这一次租约，不要把它写入报告。当前模型根据任务 instructions 生成 artifact，再调用 `task.submit`：

任务实体保存租约哈希，SQLite 的幂等缓存保存完整领取响应及原始明文 leaseToken，以便相同请求、操作者和渠道重放；缓存没有单独加密。对象、任务列表、工作流详情与状态快照会移除租约哈希，经营事件只返回请求/结果摘要，不开放完整幂等缓存。文件、备份和本机账号权限仍能读取缓存，应按敏感业务数据保护。重放旧响应只返回旧期限，不能让过期、已完成或被重新领取的租约恢复有效；真正提交仍校验当前租约和操作者。隔离实测见 [租约存储与读取边界](evidence/lease-storage-boundary.json)。

```json
{
  "taskId": "synthetic-growth-flow:qualification",
  "leaseToken": "<刚领取的租约值>",
  "artifact": {
    "fit": true,
    "budgetCents": 200000,
    "renovationStage": "finished",
    "needs": ["合成客户需要客厅灯光场景"],
    "reason": "这里只引用合成线索已记录的预算和需求",
    "missingInformation": []
  },
  "modelTrace": {
    "host": "codex",
    "model": "host-default-unspecified",
    "invocationRef": "my-host-run-001"
  },
  "idempotencyKey": "growth-submit-001"
}
```

上述 artifact 只适用于明确写了预算、装修状态的合成测试线索。真实线索缺信息时应填 missingInformation，不能套用演示值。model 使用宿主公开的实际名称；不知道具体型号时用 `host-default-unspecified`，不猜型号。

提交文件后执行：

```bash
node scripts/business-management.mjs call task.submit --input-file work/submit.json
node scripts/business-management.mjs workflow tick --input '{"workflowId":"synthetic-growth-flow","idempotencyKey":"growth-tick-001"}'
node scripts/business-management.mjs call goal.report --input '{"goalId":"synthetic-growth-goal"}'
node scripts/business-management.mjs call ledger.verify
```

继续 claim/submit 到完成或明确门禁。失败用 task.fail 记录 error/retryable；失效租约先 tick 再领取。runtimeModelCalls 始终是 0，因为模型发生在宿主中。modelTrace 与 hostModelExternallyVerified=false 是本地宿主提交声明；另行保存宿主执行日志才能证明实际调用。

管理工作流的 plan 产物可提出子目标；带准确 leadId/surveyId/ticketId 时运行时自动启动对应子工作流，无先决对象时记 waiting-input。上下文包含当前活动工作流，避免对同一输入重复排队。资格不足的获客工作流会跳过内容/体验阶段并生成汇报，因此应一起读取 skippedPhases 和目标实测指标，不能把 completed 状态直接解释成四阶段全做或经营目标达成。

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
- SQLite 按 tenant/workspace 过滤；沙箱和 live 不允许复用同一范围口径。输入拒绝明文联系方式、账号密钥及提权字段。
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

脚本使用随机回环端口和临时独立 SQLite，运行 22 项用例，覆盖正常保存、特殊字符、校验、原始联系方式拒绝、人员会话/撤销、读失败恢复、可选对象与状态显示，验证 1440、390、320 三种宽度。UI-08 的终端授权是明确的合成自动化夹具；UI-21/UI-22 注入的状态仅检验显示，不证明业务状态迁移。JSON 含每项前置条件、步骤、预期、实际、结果及源文件 SHA256，默认写到 `docs/evidence/ui-workbench-proof.json`，截图写到 `docs/evidence/ui/`。结束后关闭浏览器、服务并删除临时数据库，调试时可加 `--keep-data` 保留它。
