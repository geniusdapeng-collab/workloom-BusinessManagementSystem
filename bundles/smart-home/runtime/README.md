# 全屋智能门店本地业务内核

本目录提供行业包的可执行本地适配器。CLI、MCP 与本地 HTTP 工作台调用同一个 `createBusinessEngine` 网关，使用宿主工作台当前模型领取任务和提交产物。运行时不会调用外部模型，不要求模型 API key，不要求 PostgreSQL 或 npm 安装。

## 运行要求与事实来源

- Node.js 24 或更新的版本。
- SQLite 使用 Node.js 内置 `DatabaseSync`，事务采用 `BEGIN IMMEDIATE`，并启用 WAL、完整同步、外键和五秒锁等待。
- 本轮已核对安装的 Node.js 24.19.0，并读取 [官方 SQLite API 文档](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html)。
- 适配器仅位于行业包；公共 WorkLoom 运行时仍以 `packages/base` 为事实源。

## API 契约

```javascript
import { createBusinessEngine } from './index.mjs';

const engine = createBusinessEngine({
  dataDir: './.business-management/data/sandbox',
  tenantId: 'my-store-tenant',
  workspaceId: 'my-store-workspace',
  dataMode: 'sandbox',
});
const actor = {
  id: 'authenticated-host-worker',
  role: 'agent',
  channel: 'mcp',
  tenantId: 'my-store-tenant',
  workspaceId: 'my-store-workspace',
};
try {
  const catalogue = engine.catalog();
  const status = engine.call('status', {}, actor);
  // Every mutation needs a fresh request key; repeat the same key only to
  // recover the exact same request after an interrupted transport response.
  const progress = engine.call('workflow.tick', {
    idempotencyKey: 'host-tick-0001',
  }, actor);
  console.log({ catalogue: catalogue.schemaVersion, status, progress });
} finally {
  engine.close();
}
```

`engine.call(operation, input, actor)` 同步返回 `{operation, data, receipt?, replayed?}`；失败抛出 `BusinessError`，包含 `code`、`status` 和 `details`。`catalog()` 给出完整 JSON Schema、风险级别、角色和围栏绑定。输入对象不允许未知字段，金额使用整数分，日期使用带时区的 ISO 格式。

所有变更操作必须带 `idempotencyKey`。同一租户、工作区中，同一请求与同一操作者使用同一键时，返回原始回执；操作、输入、操作者或渠道变化时返回 `IDEMPOTENCY_CONFLICT`。已经过期的任务租约不能通过重放旧 `task.claim` 重新变成有效租约，需要新请求键重新领取。

`task.claim` 返回的一次性 `leaseToken` 是并发领取凭据。任务实体保存 `leaseTokenHash`，完整领取响应同时保存在 SQLite 的不可变幂等缓存中，包含原始明文 token 和领取时上下文，供相同请求、操作者与渠道重放。缓存没有单独加密，旧 token 在过期、完成或重新领取后仍可能保留；提交与失败登记继续检查当前任务状态、操作者、token 哈希和期限，缓存重放不会续期。

`entity.get`、`entity.list`、`state.snapshot`、`task.list` 与 `workflow.get` 不返回任务的租约哈希；`ledger.list` 返回事件摘要及回执摘要，不返回完整幂等响应或原始 token。本机文件访问者仍能读取数据库中的幂等缓存，因此 SQLite 文件、备份和目录应按敏感业务数据保护，不能把任务实体只存哈希解释为 token 从未明文落盘。并发租约不提供独立身份认证。

调用者负责在传输入口认证 `actor`，业务输入不能提供或覆盖操作者。MCP 只能使用 `role=agent`，不能携带 `humanConfirmed`。人工决断与现场记录由真实 CLI 确认或已认证的人类 HTTP 会话提交。`channel=test` 仅允许访问沙箱。拥有本地操作系统和数据库文件的管理员处于信任边界内；本地角色字段不是面向公网的身份提供者。

## 可执行业务链路

| 工作流 | 结构化任务 | 自动执行的本地结果 | 必需的人类记录 |
|---|---|---|---|
| `growth-acquisition` | 资格判断、内容草稿、体验计划、董事长汇报 | 线索状态、内容草稿、拟定体验预约、证据决策包 | 客户用途授权；客户确认预约需要客户证据 |
| `project-delivery` | 方案/BOM、报价草案、交付计划、董事长汇报 | 精确兼容校验、整数分毛利计算、审批请求、交付计划 | 勘测、报价批准、合同、到货、安装、场景测试、客户验收 |
| `aftercare-loop` | 故障分级、处置计划、董事长汇报 | 故障假设、专业人员升级、服务计划、回访计划 | 服务证据与客户确认 |
| `management-loop` | 状态诊断、目标分解、董事长汇报 | 账本指标校验、目标记录、带先决对象的子工作流、决策包 | 董事长暂停、恢复和目标调整 |
| `employee-work` | 指定员工、所属技能、明确任务与现有对象引用 | 完整规程进入任务上下文，计划、证据版本、风险、人类待决与协作下一步写入本地报告 | 产物只代表准备包；外部发布、视频成片、支付、现场施工与验收仍需对应真实能力和人类证据 |

当前行业包包含 27 个员工、49 个技能、51 个业务操作与 27 种业务对象；以 `engine.catalog()` 和已封印的 `library/workforce.json` 为准。`catalog.skillTitles` 的中文名称来自同样已封印的 `library/skill-catalogue.json`，逐项核对无缺项、无重复和岗位归属。运行时逐个核对技能正文的 `name`、`owner`、版本与行业清单摘要。领取四条业务流的固定任务或 `employee-work` 任务时，任务指令都携带该岗位完整 `SKILL.md`，岗位不能领用他人所属技能。

`employee-work` 的 `workflow.start` 还必须给出 `employeeId`、`skillId`、`brief` 和至少一个 `objectRefs: [{type,id}]`。引用对象必须存在于当前租户工作区并属于目标门店；任务绑定其准确版本与摘要，记录变化后拒绝旧任务继续提交。通用产物包含 `objective`、`plan`、`evidenceReferences`、`risks`、`ownerDecisions`、`nextActions` 六个字段，证据必须引用分派对象的准确版本，下一步员工必须拥有所列技能。报告标为 `planningOnly=true`、`executionState=not-executed`，不修改客户授权、工程状态或外部完成口径。

`lead-profile-enrichment` 另要求非空 `proposedLeadPatch` 和 1—20 条 `confirmationQuestions`；`customer-handoff-check` 再要求 `handoffReady`，其值必须匹配已记录字段与咨询/预约授权。两种技能必须准确引用一个线索，提交之后写入 `leadEnrichment` 待人类确认草案，并关联准备报告；不会直接改写线索事实或客户授权。目录的 `employee-work.dynamicAssignment.outputSchemaBySkill` 提供这两个完整契约；每次 `task.claim` 返回的 `outputSchema` 是本次任务的最终契约。

资格判断中的预算与装修阶段必须匹配线索结构字段；缺失信息或不适配的线索直接进入董事长汇报，不继续安排体验。预算未知时产物使用零、装修阶段未知时产物使用 `unknown`，并说明缺失信息；原始线索中这些字段保持缺失，不填入虚构事实。

管理任务的每项 `actions` 都会创建实际可领取的 `employee-work` 准备任务，可传 `objectRefs`；未填写时使用当前门店档案。提出的目标带有正确的 `leadId`、`surveyId` 或 `ticketId` 时，系统自动创建相应业务子工作流与可领取任务；没有先决对象时，目标明确记录为 `waiting-input`。已有活动工作流占有相同业务输入时，拒绝创建重复队列。经营指标是当前工作区、当前门店的本地累计记录，目标以该累计口径计算；指标不代表外部渠道成交或消息送达。员工准备报告不计为真实获客、验收或已付款。

## 设备、方案与工程约束

`lead.create` 仅要求 `id`、`storeId` 与至少一个称谓、姓氏、不透明电话/微信引用或楼盘信息；预算、装修阶段、需求和授权可以暂时未知。`lead.enrich` 带 `expectedVersion`、来源和证据：`model-proposal` 只保存草案，已确认事实需要 owner/operator 的人类会话。字段旧值、新值、来源与时间保存在版本历史中，授权单独走 `lead.authorize`。

`customer.upsert` 保存家庭条件、偏好、决策过程和沟通记录，并绑定已获咨询授权的线索。更新要求准确版本，保留旧内容，不能改挂另一线索。`pointPlan.record` 保存毫米房间尺寸、每个设备点的坐标、高度、线缆路径和安装说明；校验房间、回路、SKU 与几何边界。点位草图可以暂时不完整；`design.record` 校验每个房间/SKU的点位数量与 BOM 完全一致，每个设备点有准确 SKU，并覆盖全部场景之后才标为本地核验的设计草案。网络/插座预留辅助点可以不绑定 SKU。`construction.record` 逐项绑定完整物料、采购/安装/调试/验收里程碑和责任岗位。设计、点位与施工均使用 `revision`/`previousRevisionId` 连续版本链，已保留旧版只能阅读，新承诺必须使用最新版本和当前引用。

`contract.create` 绑定同一客户、报价、设计和施工，整数分分期总额必须等于报价。`contract.request_approval` 要求报价已单独获批，再对准确合同摘要请求独立审批。`contract.record_signing` 要求仍有效的报价/合同批准与人类提供的客户证据；仅登记 `signed-local-record`，不证明外部签约或实际付款。有客户档案的 `project.create` 必须引用匹配的已签约本地合同；保留旧极简回归样例的直接合同证据路径。

`business.record` 记录八类运营观察或计划：渠道费用、应收计划、付款观察、运营费用、库存观察、人员时段、回访待办与问题台账。金额和数量按类型校验，引用不能跨门店，必须由人类确认；记录中的 `actualCashMovement`、`financialExecutionPerformed`、`externalPaymentExecuted` 与 `externalReceiptVerified` 均为 false。

- SKU 记录厂家、型号、协议、固件版本、成本、价格和来源证据；真实数据模式还必须填写厂商安装要求。
- 相同协议不能证明兼容。方案中每一对不同 SKU 都要求当前版本的明确兼容记录；缺失、过期、版本变化和矛盾证据都会阻断方案或报价承诺。这是保守的全对校验，不推断未登记的跨设备联动。
- 提供安装要求的市电设备必须绑定已勘测回路，校验零线、电压、累计额定功率、互联网和有线回程条件。软件校验通过仍不代表现场可施工。
- 低毛利、负毛利和超折扣报价可保存为诊断草案；批准和合同交付不得绕过门店硬底线。既有阈值只能收紧，阈值变更还必须由董事长确认。
- 采购数量不得超出已批准 BOM；序列号不得重复。安装必须先备齐物料，并记录合格人员引用和完整安全检查表。
- 调试必须覆盖方案中的全部场景。客户未确认、培训未完成、控制权未移交或仍有未闭问题时，不计为本地验收完成。
- 门锁、摄像头、强电和消防设备带高风险标记。本版本没有设备控制连接器，不会远程开锁、控制强电、重置设备或代替现场专业人员施工。

## 数据、回执与诚信边界

`sandbox` 与 `live` 不得混用同一租户和工作区。CLI 的 `init --demo` 现在使用 `seedSyntheticScenario(engine)`，经原生 `scenario.import` 在一个 SQLite 事务内导入“蜀光智家 · 成都高新体验店”场景：12 条渐进线索、7 份客户档案、9 版点位/设计/施工、7 份合同、3 个工程阶段、2 张售后工单、8 份内容草稿、23 项经营观察、49 个技能任务和 4 条固定业务流。全部 53 个初始任务处于 ready，没有导入模型产物、模型轨迹或已完成任务。

所有历史批准、签约、到货、施工、验收和运营条目均为明确标识的合成历史资料；事件操作者类型是 `synthetic-importer`，回执声明 `humanReviewPerformed=false`、`modelInvocationPerformed=false`、`actualCashMovement=false`。虚构门店和演练 SKU 不代表华为/Aqara 授权、真实型号兼容、真实客户或真实收支。后续整份客户、SKU 或门店替换仍保留合成资料来源；实际人类或宿主任务处理另外写入事件链，不能把原演练资料改称真实客户记录。

同一场景修订内，相同键重放原始回执；新请求键会核对场景标记后返回恢复结果，保留已经补全的资料，不覆盖对象。运行时代码、岗位规程或场景内容摘要改变时，`scenario.import` 在账本与请求摘要验证后的重放前也检查当前场景修订，因此相同旧键和新键都会拒绝恢复，要求使用新的沙箱工作区。其他业务操作继续遵循准确原请求的幂等回执语义。发现固定 `SG-`/`SYN-SG-` 命名空间碰撞就整批拒绝；中途失败回滚所有导入对象，重试同一请求可恢复。默认日期锚点为导入时刻；指定锚点不得在未来，也不得早于导入时刻一天。`live` 和 agent/MCP 禁止导入。

`seedSyntheticDemo(engine)` 保留为旧极简回归样例的兼容 API，采用逐操作幂等初始化；它不是 CLI 的默认 `--demo` 场景，也不会伪造模型产物。

线索保存称谓、姓氏、楼盘名称和不透明 `contactRef`/`phoneRef`/`wechatRef`/`buildingRef`；不得将手机号或微信号作为引用字符串。明文电话、电子邮箱及显式 `address`/`fullName` 等隐私字段和凭据字段会被拒绝；自由文本仍需调用方人工审查，字符串检查不能发现所有家庭地址或个人身份。凭据和真实联系方式应留在受控连接器或隐私存储中。任务上下文明确把外部内容视为数据，而非可以覆盖系统规则的指令。

目标指标排除纯导入历史。`goal.report.historicalSynthetic` 保留导入时的线索/项目、已验收项目和已解决售后数量；本轮实际资格判断、验收或售后登记使用独立标记进入本地经营指标。后续实际处理不会把导入历史总数扩大成当前业绩。指标仍只证明本地记录，合成测试中的人工确认/模型产物测试不能当成生产经营结果。

每次成功变更在同一事务中写入业务对象、五元事件和幂等回执。事件与幂等回执有禁止更新、删除的数据库触发器；哈希链还绑定对象版本摘要、请求摘要和结果摘要。重启、读取业务对象和每次写入都会核验账本；检测到篡改时拒绝把损坏对象作为经营事实呈现。

`receipt.kind=local.sqlite.commit` 证明本地 SQLite 事务已提交。`localCommitted=true`，`externalVerified=false`，`synced=false`。现场或厂商证据是带摘要的人工提供记录，本内核未向厂商或客户平台独立核验。宿主模型轨迹是调用者提交的归因字段，也没有被本地内核外部核验。哈希链能发现未一致重写的篡改，不能替代离机锚点或防止拥有操作系统权限的管理员完整重写数据库。

外部发布、客户消息、投放、支付与设备控制均为 `disabled`。内容批准之后仍为 `approved-pending-connector`，`content.publish` 始终返回 `CONNECTOR_DISABLED`，没有外部回执时不计为外部完成。

## 验证

```bash
node --test bundles/smart-home/runtime/tests/*.test.mjs
```

测试覆盖五条工作流、27 员工与 49 技能逐项分派和完整规程、两种专门线索草案产物、渐进输入/上下界/未知字段、来源确认与版本冲突、客户修订、点位几何、连续工程版本链、准确场景/BOM/合同引用、报价/合同独立批准与过期、合成来源替换后恢复、历史与实际处理指标、幂等重放、原子回滚、隔离、角色/MCP 伪审批、并发导入、重启、账本与资产篡改，以及原有兼容、电气、工程顺序、客户验收、外发阻断和任务租约回归。内核单元测试只使用合成资料；实际宿主模型验收由工作台验收记录单独说明。
