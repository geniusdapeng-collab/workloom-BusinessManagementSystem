# BusinessManagementSystem 仓库专属规则

本仓是从 CNB `workloom-ai/workloom-hotel` 派生的独立行业产品，默认行业为全屋智能门店 `smart-home`。共享受控上下文保持只读。行业语义在行业 bundle、适配器、扩展、工作台入口和本仓文档内维护；本仓改动不能自行向基座或其他行业仓分发。

## 克隆后必须完成

1. 完整读取根级 `AGENTS.md`、`WORKLOOM_PRODUCT_CONTEXT.md`、本文件和 `.agents/skills/business-management/SKILL.md`，核对仓库、分支、远端与已有改动。
2. 执行 `node scripts/business-management.mjs doctor`，随后 `node scripts/business-management.mjs setup --client all`。配置只写当前项目，已有冲突保留并输出 candidate，禁止覆盖用户级配置。
3. 演练任务用 `node scripts/business-management.mjs init --demo`；执行 `catalog`、`status`、`task.list` 阅读实际契约与状态。真实经营使用独立 live 数据目录，禁止把合成数据口径改成 live。
4. UI 任务启动 `node scripts/business-management.mjs serve`，至少在桌面和手机宽度实际截图。平台兼容开发另用 `setup:foundation` / `dev:foundation`，历史 `preview:all` 不作为本仓首次启动条件。

本仓的启动规则替代继承文档中针对酒店演示的首次 `preview:all` 约定，其他共享不变量与门禁保留。

## 宿主模型执行

Codex、千问办公、WorkBuddy 当前会话模型执行 `claim → artifact → submit → tick → report`。使用领取时返回的技能 SOP、准确对象版本和输出 schema，不根据技能名字猜执行流程。运行时不额外调用模型 API；后台调度不能被描述成后台模型自治。

`employee-work` 对全部岗位技能输出本地准备包；准备包保持 `planningOnly=true` 和 `executionState=not-executed`。视频渲染、外部发布、客户触达、支付、设备控制、现场作业需要另行实现连接器/权限/真实回执。不得通过人工批准或命令行参数绕过当前禁用状态。

普通 CLI `call` 与 MCP 固定 agent 权限。`scenario import` 和 `init --demo` 仅允许 sandbox 的合成历史导入，使用 operator 且不携带人员确认；该路径不能审批或证明现场行为。店主审批和现场记录仅允许真实交互终端确认或由终端授权的短期浏览器会话。租约、CSRF、客户证据、账号凭据不得写入公开报告。合成输入清楚标注；客户原始数据不提交到云端或 Git。

## 修改与验证

- 修改前完整读取目标文件与直接依赖，记录 A 精读/B 机检/C 抽样/D 推断证据。大文件分段读至末尾；继承资产的目录存在不等于实际可用。
- 变更运行时契约须同步 CLI/MCP/UI、资产目录、SOP、围栏、manifest 与相关测试。重新封印 bundle 后生成客户投影和能力导览。
- 必跑邻近业务测试、全局类型检查、相关标准套件、产品/Bundle/投影/能力生成物检查和秘密扫描。数据库变更在独立沙箱跑迁移、角色权限、RLS、回滚、并发与幂等验证。
- SQLite/PostgreSQL 数据链独立，未实现同步时不得写成统一数据库。源仓兼容性测试不得改成 smart-home 假数据后冒称原回归通过。
- 普通研发交付按 `docs/AUTOMATIC-RD-DELIVERY.md` 完成真实 Codex 审查回执、原必需 CI 和普通 PR 集成。禁止平台 AI 审核服务、伪造批准、强制合并和修改源码直推 main。
- 报告必须含覆盖率声明、逐条证据等级、收尾报告和自检表；现场安装、真实业绩、生产 ADR/HIR、其他宿主客户端实测缺失时写未验证。
