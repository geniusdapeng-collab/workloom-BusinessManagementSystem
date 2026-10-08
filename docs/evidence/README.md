# 经营管理系统验收证据索引

此目录保存版本对应的测试、宿主执行和浏览器证据。数据口径、执行身份、来源hash、实测结果与未验证边界都在各记录内；不能从文件存在推断生产通过。

| 证据 | 证明的范围 | 不能证明的范围 |
| --- | --- | --- |
| [host-model-proof.json](host-model-proof.json) | 真实Codex宿主经MCP完成四个获客模型阶段；合成线索、草稿、拟议体验、本地账本可读回 | 外部发布、邀约送达、客户到店、成交或真实经营收益 |
| [host-model-delivery-proof.json](host-model-delivery-proof.json) | 真实Codex宿主生成合成方案/BOM与报价；停在人类审批门禁 | 店主已批准、已签约、已施工或已验收 |
| [host-model-employee-proof.json](host-model-employee-proof.json) | 真实Codex宿主执行视频岗位技能准备任务，读取完整规程并提交有版本依据的报告 | 已拍摄、视频已渲染、平台已发布或已获客 |
| [host-model-proof-unqualified.json](host-model-proof-unqualified.json) | 保留真实运行中资格未充分、两阶段跳过与目标未达成的记录 | 四阶段均已完成或经营目标已达成 |
| [ui-workbench-proof.json](ui-workbench-proof.json) | 本机Chrome桌面/390px视口、表单校验、可选字段、错误路径和浏览器权限边界，以记录实际断言为准 | 真实客户、平台、设备或完整276项验收 |
| [industry-read-coverage.json](industry-read-coverage.json) | 行业代理精读、机检、抽样与未读文件清单及source hash | 整个继承仓库全量精读、生产环境通过率 |
| [industry-compat-read-coverage.json](industry-compat-read-coverage.json) | 发布、工单、审批、记忆与事件直接链的补充显式阅读清单，单独披露43份迁移机检与suite选段 | 原始行业242口径的自动扩大、所有递归继承事务入口的完整故障治理 |
| [service-approval-regression.json](service-approval-regression.json) | 最终必要门禁内75个独立public契约：69真PG、6单元；逐例前置/步骤/预期/实际、六类修复前反证、13份原始JSON哈希 | 重复22项累加、全部75均真PG、生产故障频率或正式clean-source MCD通过 |
| [gateway-transaction-pg-proof.json](gateway-transaction-pg-proof.json) | 72项分方法网关/事件回归：21单元、18PG故障、7接连前guard、26实际SQL，含授权消费与回放归属原子性 | 72项全部真PG、低层SQL完整语义schema、生产授权系统已认证 |
| [required-db-gate-regression.json](required-db-gate-regression.json) | 从最终.cnb解析的本机必要门禁：237项Vitest、16治理、7矩阵、43迁移、种子两次与事件链；数据库已删除、环境恢复 | CNB Linux原生CI已运行、最终clean提交独立验收或完整RDAS276 |
| [legacy-suite-regression.json](legacy-suite-regression.json) | 显式hotel合成夹具的464/464基础suite；E25严格校验全通道终态镜像与无重复副作用 | 旧幽灵pending行为应保留、正式生产经营结果 |
| [legacy-workspace-pg-regression.json](legacy-workspace-pg-regression.json) | 实际workspace回归1636通过、3具名条件skip、0fail；各包计数和skip原因逐项记录 | 1639项全通过、ai-pm双行业fixture或完整真实设备验收 |
| [site-proof.json](site-proof.json) | 双语静态介绍页的桌面/390px布局、锚点、语言切换、资源与链接验证 | 网站已部署、安装包已签名、外部业务已发生 |

宿主记录标为 sandbox/synthetic；runtimeModelCalls=0说明模型发生在宿主，真实宿主进程/tool事件提供执行证据，modelTrace本身仍是本地声明。local.sqlite.commit证明本地事务提交，externalVerified=false。

继承 `acceptance/profile.json` 的 RDAS v2 合同验证PostgreSQL/tRPC三端基础层。其 `nativeWorkbench` 扩展明确声明默认9393经营入口及独立证据，但扩展不由旧profile-check校验。profile-check结构有效、HTTP fixture成功和静态构建均不替代生产实测。

每个新增报告应披露：运行命令、前置条件、数据与环境档位、源文件hash、逐项预期/实际、失败与残留。缺失来源或未执行的项目标为未验证，不填造成功率。

`ui/UI-06-failure.png` 与 `ui/UI-09-failure.png` 保留首次交互回归发现问题时的截图；修复后的结果以 `ui-workbench-proof.json` 中22项断言与当前源码hash为准。`workbench-1440.png`、`workbench-390.png` 是清理测试输入后重新拍摄的沙箱页面。

全仓与本次聚焦阅读范围的合并口径见 [source-read-coverage.json](source-read-coverage.json)。这份清单把当前源码、上游对照、生成物和继承范围分别计数；A/B标签不能替代真实运行结果，未深读的继承文件也不因此被宣称通过。

修复过程中首次组合37项通过、2项失败的原始记录保留在 [approval-service-pg-results.json](service-approval/raw/approval-service-pg-results.json)，两项暴露跨工作区全局记忆ID碰撞。最终同用例通过不抹掉失败历史。所有候选回归与25张MCD卡的最终clean-source独立取证分开；正式276项仍为0通过、0失败、114未运行、162人工证据缺失。
