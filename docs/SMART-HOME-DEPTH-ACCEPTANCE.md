# 全屋智能 AI 实战经营深化：实现与验收

## 覆盖率声明

- 范围内文件总数：**250**；精读：**197**；机检/脚本解析：**53**；抽样：**0**；未读：**0**。197 项 A 中有 45 项复用当前 SHA 完全一致的历史完整阅读，152 项来自本任务完整阅读。
- 本轮范围为默认全屋智能行业包、AI 岗位、CLI/MCP/HTTP、默认工作台、平台种子与投影、对外文档/网站及实际调用的交付链。文件逐项清单、当前 SHA、阅读方式和精确统计见 [本轮去重阅读覆盖](evidence/smart-home-depth/source-read-coverage.json)。该清单是多代理实际阅读记录的去重结果，不能把计数解释为理解度或生产验收率。
- A＝完整读取当前代码/正文，或之前完整读取且本轮逐文件核对 SHA 完全相同；B＝完整机检、生成内容解析或摘要校验；C＝抽样；D＝推断或未验证。下文源码行为标 A，实际运行记录及统计标 B，容量假设和生产边界标 D。
- 未将继承的整套平台、全部 Hotel 兼容模块、第三方依赖实现或真实设备环境纳入全量精读。它们仍受原有 CI 约束。本轮证据 JSON、原始执行材料和截图另列元数据；失败前证据保留历史身份，不冒充当前通过。

本文件对应任务 `T-2026-1009-0001`，以旧公开交付 `be5535ceaa1237377dedb2a1941b0be78c478ec6` 为基线。旧验收和旧账本保持原样；本轮证据目录为 `docs/evidence/smart-home-depth/`。本文件记录源码实现、局部验收及其版本边界；正式提交后的测试、CNB 原生候选 CI、合并和匿名消费回执由交付流程另外保存，不能从文档标题推定云端已经完成。

## 要解决的门店问题

**[A] 使用者是全屋智能门店老板、店长、顾问和工程人员，以及在现有 AI 工作台运行的数字员工。** 门店此前需要在聊天记录、表格与图纸间寻找来源、客户资料、设计修订和现场确认。本轮把残缺线索、客户档案、点位、设计、施工、报价、合同和经营观察连接成可检查的记录链；数字员工交付基于当前对象版本的询问、话术、分析、练习和待决包，人类核实客户事实、承诺和现场结果。

| 用户要求 | 当前实现与可检查结果 |
| --- | --- |
| README、项目介绍和文档体现 AI 经营及全屋智能 | README、双语网站、四份用户指南、AI 接入、能力图、实战手册和默认演示均围绕全屋智能客户旅程；默认 README 能力块只展示本产品入口。历史酒店材料明确为继承兼容参考 |
| 深填成都门店背景，参考华为/Aqara 官方内容 | 虚构“蜀光智家 · 成都高新体验店”，6 个背景分区、3 个服务区域、6 个体验区、8 个场景、3 条体验路线、6 个渠道、7 个只读产品参考；厂商授权未核实，门店 SKU 与官方知识分开 |
| 残缺多渠道线索逐步形成资料与工程链 | 任一有效姓氏、称谓、联系保管引用或楼盘信息可以建线索；缺失字段仍缺失。新增 8 类对象和 12 个操作形成线索提议、客户、点位、设计、施工、合同、经营和场景导入链 |
| 补齐线索挖掘、完善、邀约、销售助理、陪练、经营和店长助手 | 新增 7 岗、14 个有实质业务步骤的 SOP；总计 27 岗/49 技能。当前宿主实际完成 8 个指定任务，而初始导入的 53 个任务全部待领 |

**[D] 非功能假设：** 当前目标是一家门店、一台本地宿主和有限并发写入；没有宣称支撑多门店高并发或特定吞吐量。已实现租户/工作区隔离、显式输入上限、5 秒数据库锁等待、15 秒 HTTP 请求超时、版本冲突及幂等回执。容量、远程多用户会话、备份恢复 SLA 和法规适用性没有做生产验证。

## 方案选择与使用场景

| 候选 | 优点 | 成本、风险及前提 | 本轮选择 |
| --- | --- | --- | --- |
| 在现有 Node/SQLite 经营内核中增加有类型契约的行业对象，复用宿主 MCP 与原生投影 | 克隆即可启动；延续事务、审批、任务租约和事件链；无需额外模型 API；旧行业包与 PostgreSQL 平台链可独立兼容 | 单机写入，尚无 SQLite/PostgreSQL 双向同步；持续 AI 工作依赖运行中的宿主会话；真实外部平台需另建连接器 | **采用。** 与现有独立经营入口一致，能在本轮真正实现、执行并复验 |
| 以 PostgreSQL 平台链作为唯一经营源，所有 AI 与页面经远程服务执行 | 更适合未来多门店集中协作、统一认证与服务部署 | 必须同时迁移现有任务/审批/账本；需要远程身份、连接器、模型调度、同步和运维验证；超出本轮明确的本地工作台深化 | 保留为后续架构提案；本轮不做半套迁移 |

三个可执行场景如下。

1. **设计师只给“李先生，想了解灯光”。** 顾问先登记姓氏和来源；线索完善岗位读取实际缺口，产出有来源的补充提议和确认问题。模型不知道预算就保持未知，人类确认后才写事实；用途授权单独登记，预约用途不能由咨询用途替代。
2. **一家 118 平方米住宅进入水电前设计。** 家庭档案连接勘测，点位图保存房间毫米尺寸、坐标、高度、回路与施工说明；设计引用准确点位版本和方案/BOM；施工策划引用设计；合同引用客户、报价、设计和施工。变更保留旧版，正式设计的每房间/SKU 设备点位数量必须与 BOM 闭合。
3. **店长安排本周顾问与工程资源。** 经营助理读取真实当前记录，解释待完善线索、待确认事项、经营观察与人力缺口，提交可执行待办；销售陪练提供具体问答和评分。演练资金观察不等于现金流，历史导入不提高本轮经营目标。

## 功能优先级与边界

| 优先级 | 已实现的行为 | 用户不用它的具体影响 |
| --- | --- | --- |
| P0 | 残缺线索建档、来源/版本补充、人类确认、独立用途授权 | 顾问无法接住信息不完整的转介，或把模型猜测混进客户档案 |
| P0 | 客户、勘测、毫米点位、设计/BOM、施工、报价和合同引用校验 | 旧方案与新施工混用，采购数量或合同范围难以追溯 |
| P0 | 27 岗/49 SOP、宿主 claim/submit、准确对象版本与产物校验 | AI 输出成为孤立文本，无法回到具体客户或工程待办 |
| P0 | 合成历史 provenance、原子导入、恢复/冲突守卫、历史指标分开 | 演练成功被误认为真实签约、验收或模型经营成果 |
| P0 | 店主 TTY 会话、MCP 固定 agent、独立报价/合同审批 | 自动化调用可能冒用店主身份或越过客户承诺边界 |
| P1 | 8 页中文工作台、岗位/技能下拉、动态 SVG、重复项表单、错误恢复 | 人员需要理解内部 ID 或手工读取 JSON，容易选错岗位和设计版本 |
| P1 | 门店背景、体验路线、渠道知识、官方来源与参考限制 | AI 生成脱离门店产品、场景与服务能力的话术 |
| P1 | PostgreSQL 27 岗/49 技能种子和默认 27 对象/5 流程投影 | 平台兼容入口仍停留在旧岗位、旧对象标签，交接不一致 |
| P2 | 保留正式外部连接器、多门店认证、双向同步和桌面签名发布的接口边界 | 目前必须由人类或独立系统完成真实外发、收支、设备与现场动作；这些能力本轮不假装已上线 |

**本轮不做：** 厂商授权认证、真 SKU 销售价格或兼容性认证、自动签约与资金操作、向真实客户发送消息、投放/发布、真实设备控制、工程专业审图、施工或品牌保修承诺。普通自由文本隐私检查不是完备的 PII 识别；真实联系信息应保存在受控存储，并仅使用引用。

## 数据、接口与异常路径

**[A] SQLite 物理模型**见 [`BusinessStorage`](../bundles/smart-home/runtime/storage.mjs)。`scope_registry` 主键为 `(tenant,workspace)`，保存数据模式；`entities` 主键为 `(tenant,workspace,type,id)`，保存版本与规范 JSON；`business_events` 保存事件序列、作用域、事件 ID、payload、当前/前序摘要和时间；`idempotency` 主键为作用域加键，绑定请求摘要、结果与事件。作用域事件索引为 `(tenant,workspace,seq)`。STRICT 表、WAL、FULL 同步、BEGIN IMMEDIATE 与只增触发器共同约束写入。它们证明本地事务，不替代离机锚点。

**[A] 新对象的主要字段与关系**见 [`depth-catalogue.mjs`](../bundles/smart-home/runtime/depth-catalogue.mjs)、[`depth-domain.mjs`](../bundles/smart-home/runtime/depth-domain.mjs)。JSON 输入禁止未知字段，所有写操作要求 `idempotencyKey`。

| 对象 | 关键字段、约束与关系 |
| --- | --- |
| leadEnrichment | leadId、基准版本、patch、source、证据；模型来源形成 `pending-human-confirmation`，不改 lead/consent |
| customer | leadId、household、preferences、decisionProcess、communication、source、evidence；owner/operator 维护，人类事实确认独立于草案 |
| pointPlan | customerId、surveyId、连续 revision、previousRevisionId、rooms、points、evidence；尺寸 100–100000mm，点位 1–500，坐标必须在实际房间内 |
| design | customerId、solutionId、pointPlanId、连续 revision、场景价值/回退/验法、排除项；准确客户和空间、场景/BOM 及设备数量闭合 |
| construction | designId、连续 revision、采购/安装/调试/验收 4 阶段、责任人/期限/证据、材料、检查项、风险 |
| contract | customerId、quoteId、designId、constructionId、合同引用、范围、分期金额、变更/保修/排除条款；报价与合同批准独立，签约证据不由模型代填 |
| business | storeId、kind、时间、观察摘要、可选分/数量、对象引用、证据；观察记录不执行付款 |
| scenario | datasetId、修订/内容摘要、导入作用域/锚点、导入结果；历史 provenance 在后来更新时仍保留 |

**[A] HTTP/CLI/MCP 调用共同使用相同操作 schema 和领域实现。** 操作总数 51，完整参数/必填/枚举由 `node scripts/business-management.mjs describe <operation>` 返回，不复制一个会漂移的自由 JSON API。

| 入口 | 请求与返回 | 权限及失败 |
| --- | --- | --- |
| `GET /api/catalog` | 当前操作契约、岗位/技能/流程目录 | 仅 loopback 服务；拒绝错误 Host/Origin/URL |
| `GET /api/state`、`GET /api/status` | 当前作用域实体快照/运行状态 | 不跨租户或工作区读取 |
| `POST /api/call` | `{operation,input}`；成功返回本地领域结果/回执 | 固定 agent；业务参数不能传入 owner 或 humanConfirmed |
| `POST /api/owner/session` | 空对象；202 返回待确认请求号 | 真实 TTY 的 `owner <requestId>` 才可批准；进程没有 TTY 返回 403 |
| `GET/DELETE /api/owner/session` | 会话状态/注销 | 授权 cookie HttpOnly/SameSite=Strict；注销授权会话需 CSRF |
| `POST /api/owner/call` | 同一 `{operation,input}` | 已授权 cookie、准确 Origin 与 `X-BMS-CSRF`；普通 MCP 无此入口 |
| CLI `scenario list/import` | 列出或原子导入成都数据集 | sandbox、owner/operator；agent/MCP 和 live 禁止；不是人类经营审批 |
| MCP STDIO | schema 描述与受限操作调用；`task.claim/submit` 驱动宿主任务 | 固定 agent，宿主生成产物；运行内核自身不调用模型 API |

失败返回包含 `error.code` 和 `error.message` 的 JSON，并保持对应 HTTP 状态。输入、权限、版本、资产、数据库和外部连接器失败均有显式路径。主要异常如下。

| 场景 | 实际行为与主要错误码 |
| --- | --- |
| 两名人员基于旧版本补同一条线索 | 当前事实版本不匹配，`VERSION_CONFLICT`；不默默覆盖 |
| 同幂等键改输入或操作者 | `IDEMPOTENCY_CONFLICT`；准确重放才返回原回执 |
| 场景文件改版后使用同旧键或新键恢复 | 回放前核对场景修订，`SCENARIO_VERSION_CONFLICT`；新沙箱处理新素材 |
| 模型无可证实字段却提交空补充 | `EMPTY_LEAD_PATCH`；技能要求 task.fail 或等待客户，不伪造资料 |
| 点位超界、重复、房间错配或设计设备数量不闭合 | 几何/引用校验拒绝；设备无 SKU 为 `DESIGN_POINT_SKU_REQUIRED`，数量不闭合为 `DESIGN_POINT_BOM_MISMATCH` |
| 用报价批准替代合同批准、批准过期或批准内容漂移 | 独立内容摘要和状态校验；`APPROVAL_CONTENT_MISMATCH` 等错误阻断 |
| 资产摘要、账本或对象投影被改动 | 开启/读取/写入阶段核验，显式拒绝；不返回损坏内容为经营事实 |
| 连接器未启用 | `CONNECTOR_DISABLED`；保留准备/待处理状态，无外部成功回执 |
| 数据库打开、锁等待、网络读或 HTTP 正文失败 | 领域/传输错误；事务回滚或保留页面缓存与可见错误，恢复后可重试 |

PostgreSQL 种子通过封印的相同 `industry-context.json` 装配虚构成都档案、27 岗/49 技能、围栏和 FAQ。准确资产/归属冲突拒绝覆盖，重复与并发初始化可恢复，业务事件/模型调用均为零。**SQLite 经营账与 PostgreSQL 平台链当前没有双向同步。**

## 实际运行与用例覆盖

**[B] 当前局部验证证据如下，均保留实际执行时间、实现版本和边界。** 相同测试出现在多个汇总中时不相加为新的覆盖率。

| 验证 | 实际结果 | 完整证据 |
| --- | ---: | --- |
| 运行层正常/边界/错误/权限/并发/恢复/回归 | 145/145，0 fail/skip | [原始执行](evidence/smart-home-depth/engine-runtime-tests.json)、[145 项断言矩阵](evidence/smart-home-depth/engine-runtime-case-matrix.json) |
| 独立场景回放和 BOM 点位探针 | 8/8 | [同行复核](evidence/smart-home-depth/industry-peer-review.json)及该报告的原始脚本/前后结果 |
| 当前封印、原生操作/流程与默认投影 | 122 声明资产 SHA 闭合；51/5 注册表深等；27/5 投影 | [当前兼容证明](evidence/smart-home-depth/engine-current-seal-basis.json) |
| 行业资产/完整机检/实际投影交叉探针 | 9/9；130/130；6/6 | [资产](evidence/smart-home-depth/industry-assets-test.json)、[机检](evidence/smart-home-depth/industry-machine-check.json)、[投影](evidence/smart-home-depth/industry-ui-manifest-check.json) |
| 独立 UI 纯函数边界 | 8/8 | [根集成独立审阅](evidence/smart-home-depth/engine-root-integration-review.json)；JSDOM/vm，不称为浏览器执行 |
| 当前 Chrome 深化/旧 UI 回归 | 11/11；22/22 | [深化逐案](evidence/smart-home-depth/ui/depth-browser-proof.json)、[回归逐案](evidence/smart-home-depth/legacy-ui/ui-workbench-proof.json) |
| 双语网站内容、链接与响应式/视觉 | 102/102；8/8 | [网站](evidence/smart-home-depth/site-proof.json)、[视觉](evidence/smart-home-depth/site-appearance-proof.json) |
| 公共 CLI 实际调用与恢复 | 52 检查通过 | [CLI 复放](evidence/smart-home-depth/public-cli-replay.json) |
| 公共内容及默认入口/平台投影 | 10/10 | [公共内容复核](evidence/smart-home-depth/public-content-proof.json) |
| 真实 PostgreSQL 种子安全与治理 | 17/17；16/16，0 skip | [独立根集成审阅与原日志绑定](evidence/smart-home-depth/engine-root-integration-review.json)；准确提交后的完整测试另做 |
| 工作区 TypeScript 与三端生产构建 | typecheck、web/webb/webc 均 exit 0 | 本轮真实构建日志；主 Web 的大 chunk 提示保留，未当成构建失败 |

逐案前置、步骤、预期和实际结果在对应 JSON；为便于定位，以下是代表性维度。

| 维度/用例 | 前置与步骤 | 预期 | 实际 |
| --- | --- | --- | --- |
| 正常：`DEPTH-UI-04` | 新鲜成都沙箱，读取实际坐标并切换点位版本 | SVG 与存储房间/点位一致，新旧图可切换 | 匹配 4 房间/22 点，9 版设计/施工、7 合同可读，通过 |
| 空/缺失：`DEPTH-UI-02/03` | 浏览器保存仅姓氏线索，再提议补充 | 不生成联系方式、预算或装修阶段；提议不改变事实 | 原字段保持缺失，原版本与 consent 不变，提议待人确认，通过 |
| 边界/授权：`DEPTH-UI-11` | 预算 0、无服务区、仅 consultation 授权 | 预算/服务区仍缺，appointment 仍缺 | 原生和页面准确显示三项，通过 |
| 并发/错误：同行场景与设计探针 | 同键/新键改 fixture；少点、多点、设备无 SKU | 全部明确拒绝；完整设备加无 SKU 的网络辅助点可用 | 8 条预期与实际一致，通过 |
| 权限：`DEPTH-UI-05`/22 项回归 | 匿名网页/MCP 尝试签约、人审和会话绕过 | 没有 TTY 授权不能取得店主能力 | 绕过被拒绝；sandbox PTY 正常路径在旧回归另验，通过 |
| 错误恢复：`DEPTH-UI-08` | 注入 industry.context 500 后恢复 | 显示错误、保留缓存、按钮恢复、重试成功 | 全部成立；预期 500 console 记录未隐藏，通过 |
| 回归/宽度：`DEPTH-UI-09/10` | 八页分别跑 390/320，检查脚本与账本 | 无文档横向溢出、无非预期 JS/CSP 错误、账本有效 | 16 个 route/width 测量一致，脚本/CSP 0，账本通过 |

根代理另逐张查看 7 张当前桌面/移动视口截图，核查标题、卡片、按钮、说明文字和底部导航。表格局部滚动属于设计行为；没有把三端构建等同为三端全部人工交互验收。

## 真实宿主模型与合成背景的区别

**[B] 本轮实际启动当前账号的默认 Codex 宿主，通过真实 STDIO MCP 完成 8 项新岗位任务，进程 exit 0。** 未指定额外模型，未配置额外模型 API。执行号为 `host-depth-f83b19249093`；宿主 thread 为 `01a11ed8-a346-7561-9c1b-b12f3762b0c8`。55 次完成的 MCP 调用留下 110 条 started/completed 事件，不能写成 110 次调用。具体使用配置形式见 [Codex MCP 官方文档](https://learn.chatgpt.com/docs/extend/mcp)。

| 实跑任务 | 实际持久产物 |
| --- | --- |
| 线索挖掘 | 设计师、装修异业和自然到店三条具体找客路线、最小询问及人工交接 |
| 线索完善 | 非空、可追溯的 proposedLeadPatch 与确认问题；未改客户事实 |
| 客户交接检查 | 当前缺口、handoffReady 判断与待确认问题；未越过原生完整度 |
| 到店邀约 | 有明确时间/步骤、体验路线和人工确认点的邀约准备 |
| 销售助理 | 基于当前客户的会议准备、问法和报价前缺口 |
| 销售陪练 | 具体对话、评分维度、练习与反馈，保留练习身份 |
| 经营助理 | 基于指定经营观察、报价、合同与项目的核算与待决包，数值复算通过 |
| 店长助手 | 人员/时间安排、风险和负责人动作，未声明真实外发或现场执行 |

8 份报告与 8 个 SOP 已完整语义审阅，52 条语义标准与 93 条只读 SQLite 比对均通过。最终 2 个线索提议待人确认；12 条客户线索事实及 4 个经营目标保持原样。8 个产物为 planningOnly，本轮不将它们算作外部获客、真实销售、现场施工或现金回款。

证据见 [原始宿主执行](evidence/smart-home-depth/host-model-proof.json)、[独立语义审阅](evidence/smart-home-depth/host-model-semantic-review.json)、[最终资产兼容绑定](evidence/smart-home-depth/host-compatible-binding.json)。原宿主证明与原数据库没有重写。后来 UI 标签与封印更新只改变 manifest 的 UI digest、总 digest、对象标签和流程标签；71 个业务输入和 117 个非 UI 资产保持字节相同。原 manifest 已重建并匹配完整原 SHA，兼容结论不是凭回忆猜测。

新鲜演练背景为 261 实体、53 待领任务、0 模型完成、0 模型轨迹/产物。后来实跑的 8 任务以独立 workflow、实际 claim/submit 和报告记录加入，不能把导入历史改称本轮模型执行。

## 官方知识来源与工程含义

**[A/B] 官方页面支持的是产品/服务资料，虚构门店不是授权门店。** 当前来源及 checkedAt/限制存于 [industry-context](../bundles/smart-home/library/industry-context.json)和 [official-sources](../bundles/smart-home/library/official-sources.json)，不导入厂商价格、保修期限、服务收费或授权证明。

- 华为官方服务流程包含图纸深化、技术交底、安装、联调、客户验收与后续调优；本轮据此组织交接记录。官方说明的图纸范围不包括照明设计；门店的 SVG 点位示意不能冒充专业施工审图或厂商服务。来源：[华为全屋智能服务政策](https://consumer.huawei.com/cn/support/content/zh-cn15865128/)。
- 华为 3D 点位灯控功能有适用产品及参考物/灯点标注前提；本轮只画存储坐标，没有宣称接入该功能。来源：[华为 3D 点位说明](https://consumer.huawei.com/cn/support/content/zh-cn16092207/)。
- Aqara M3 参数与 FP400 的平台/区域能力限制作为只读参考；不能据协议相同推断合成 SKU 兼容。来源：[M3 参数](https://www.aqara.cn/Hub-m3_spec)、[FP400 官方知识文档](https://docs.aqara.com/zh/docs/aqara-studio/product-knowledge/sensors/spatial-multi-sensor-fp400/)。

## 交付前自检与自主修复

**[A/B] 实际独立复核发现的六项问题均已闭合：** 场景旧键重放绕修订守卫、设计设备点位/BOM 数量未闭合、线索卡完整度遗漏、岗位/技能内部 ID 输入与换岗旧值、PostgreSQL 旧 20/35 断言、默认行业投影旧 19/4 标签。对应原复现、修复、源位置和回归在 [行业同行复核](evidence/smart-home-depth/industry-peer-review.json)与 [根集成审阅](evidence/smart-home-depth/engine-root-integration-review.json)。

原 `.cnb.yml` 与可信 main 字节相同，原必需流水线、阶段、顺序及校验链保留。新增 22+11 浏览器检查追加在 `test:media` 原两项测试命令后并用 `&&` 串接；没有新增依赖或改锁文件。准确 source/main/policy tuple 的 CI 实现变化逐项填写审查依据，不能凭此段文案自行放行。

## 收尾报告

- **已完成：** 四项用户需求的源码与对外内容深化；27 岗/49 SOP；渐进资料和工程/合同链；虚构成都场景；默认页面与平台投影；实际宿主 8 任务；运行、权限、并发、回归、浏览器、网站、平台数据库、构建和独立同行复核。
- **未完成/未覆盖：** 真实客户、厂商授权、物理设备、实际签约/付款/外发、千问办公与 WorkBuddy 真机、全部继承平台人工走查、容量/SLA 和双向同步未验证。本源码阶段文档不作为后续云端 CI/合并的完成回执。
- **自主追加事项及理由：** 修复上述六处独立发现的问题；补做平台投影、真实数据库角色/SOP 读回、模型产物语义审阅和原 manifest 的准确兼容绑定，保证默认入口与交付证据一致。
- **采用的假设：** 一家虚构成都门店、合成客户/产品/经营历史、可销毁隔离沙箱；真实经营承诺由人类确认；默认宿主会话提供模型生成。
- **置信度：** 指定实现与本地可观察行为高；生产外部经营效果未验证，不作高置信度外推。
- **建议复核：** 仅姓氏线索与两类授权的缺口提示；同一客户的点位/设计/BOM/合同版本关系；8 个模型产物与历史导入/真实客户事实的区分。

## 自检表

- [是] 覆盖本轮明确任务与必要连带链，继承平台裁剪和未验证边界已列明。
- [是] 可自主完成的实现、修复、测试和复核已实际完成，没有推给用户或以无必要的问句收尾。
- [是] 结论可由源代码、实际运行与摘要绑定复查；A/B/D 分级与历史版本边界明确。
- [是] 当前代码、对象约束、异常路径、用例断言和报告可供资深工程师逐行审查。
