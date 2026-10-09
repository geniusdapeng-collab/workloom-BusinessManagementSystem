const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
// HTML pattern uses Unicode sets; a literal trailing hyphen needs an escape.
const htmlPattern = pattern => escape(pattern.replace(/(?<!\\)-(?=\])/g, '\\-'));
const unique = prefix => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
const list = type => state[type]?.items ?? [];
const count = type => state[type]?.total ?? 0;
const money = cents => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format((cents ?? 0) / 100);
const dateText = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '待登记';
const channels = { unknown: '来源待确认', douyin: '抖音', xiaohongshu: '小红书', 'wechat-video': '微信视频号', 'wechat-private': '微信私域', baidu: '百度搜索', geo: 'AI 搜索', 'walk-in': '门店自然到访', referral: '客户转介绍', designer: '设计师合作', property: '物业合作', 'decoration-partner': '装修合作' };
const statuses = { 'pending-human-confirmation': '等待人员核实', 'draft-local-validated': '本地校验的设计草案', 'planned-local': '本地施工计划', 'signed-local-record': '已登记客户签约', new: '新线索', qualified: '已确认需求', 'needs-information': '等待补充客户信息', proposed: '待客户确认', 'customer-confirmed': '客户已确认', ready: '等待 AI 领取', leased: 'AI 正在处理', completed: '已完成本地任务', failed: '需处理失败', pending: '等待店主确认', approved: '已批准', rejected: '已退回', expired: '已过期', draft: '草稿', 'awaiting-approval': '等待审批', 'waiting-approval': '等待店主审批', 'waiting-evidence': '等待人员登记现场依据', 'waiting-input': '等待关联业务资料', 'accepted-local-record': '本地已登记客户验收', active: '推进中', running: '执行中', 'awaiting-human': '等待人员确认', 'awaiting-host': '等待 AI 工作台', paused: '已暂停', cancelled: '已取消', accepted: '已记录验收', resolved: '已记录解决', open: '待处理', created: '已建立', procurement: '等待采购', installation: '等待安装', commissioning: '等待调试', acceptance: '等待验收', 'field-recorded': '已登记勘测', granted: '已授权', unknown: '尚未授权', denied: '已撤回' };
const types = { store: '门店', sku: '设备目录', compatibility: '兼容性依据', lead: '客户线索', experience: '体验计划', survey: '现场勘测', solution: '全屋方案', quote: '报价', approval: '审批', project: '交付项目', procurement: '采购记录', commissioning: '调试记录', acceptance: '验收记录', aftercare: '售后工单', content: '内容草稿', goal: '经营目标', workflow: '协作流程', task: '员工任务', report: '经营报告', leadEnrichment: '线索补充草案', customer: '客户档案', pointPlan: '施工点位图', design: '设计修订', construction: '施工计划', contract: '合同', business: '经营记录', scenario: '演练资料批次' };
const labels = { id: '记录编号', name: '名称', city: '所在城市', serviceAreas: '服务区域', budgetCents: '客户预算（分）', surname: '客户姓氏', phoneRef: '手机号保管编号', wechatRef: '微信资料保管编号', buildingName: '楼盘名称（不含门牌）', employeeId: '数字员工', skillId: '岗位技能', brief: '任务要求', objectRefs: '关联业务依据', work: '岗位任务产物', minMarginRatio: '最低毛利比例', maxDiscountRatio: '最高折扣比例', manufacturer: '设备品牌', model: '设备型号', category: '设备类型', protocol: '通信协议', firmwareVersion: '固件版本', costCents: '成本（分）', priceCents: '售价（分）', evidence: '依据记录', active: '是否在售', expectedVersion: '读取时的版本', leftSkuId: '设备一', rightSkuId: '设备二', result: '核查结果', conditions: '使用条件', expiresAt: '有效截止时间', storeId: '所属门店', alias: '客户称呼', contactRef: '客户联系方式保管编号', channel: '来源渠道', campaignRef: '活动编号', intent: '客户需求', consent: '客户用途授权', status: '状态', purposes: '授权用途', uri: '依据文件地址', sha256: '文件校验摘要', source: '依据来源', observedAt: '实际观察时间', summary: '依据摘要', leadId: '客户线索', startsAt: '体验开始时间', durationMinutes: '体验时长（分钟）', scenes: '场景', confirmationEvidence: '客户确认依据', renovationStage: '装修阶段', rooms: '空间与电路', network: '网络勘测', hazards: '现场风险', surveyId: '勘测记录', bom: '设备清单', compatibilityIds: '兼容依据编号', exclusions: '不包含的服务', solutionId: '全屋方案', laborCostCents: '人工成本（分）', laborPriceCents: '人工售价（分）', discountCents: '折扣金额（分）', validUntil: '报价有效截止', terms: '服务与付款条款', quoteId: '报价记录', reason: '理由', projectId: '交付项目', contractEvidence: '合同依据', dueAt: '交付截止时间', items: '采购明细', milestone: '现场阶段', professionalRef: '安装人员编号', safetyChecklist: '安装安全核对', powerIsolated: '断电隔离已完成', manufacturerInstructionsFollowed: '遵照厂家说明', networkConfigured: '网络已配置', customerPrivacyProtected: '客户隐私已保护', results: '场景测试结果', customerAccepted: '客户已接受验收', trainingDelivered: '客户培训已完成', credentialsTransferred: '管理权限已移交', outstandingIssues: '待解决问题', severity: '紧急程度', description: '问题说明', ticketId: '售后工单', resolution: '解决方式', customerConfirmed: '客户已确认解决', followupAt: '下次回访时间', title: '标题', body: '正文', claims: '事实声明与依据', skuIds: '关联设备', piiFree: '内容已经脱敏', contentId: '内容草稿', goalId: '经营目标', metric: '目标指标', target: '目标数量', deadline: '目标截止时间', constraints: '执行约束', instruction: '店主指令', action: '指令动作', kind: '协作流程', maxAttempts: '最多重试次数', approvalId: '审批编号', decision: '决定', contentDigest: '待审内容摘要', internetAvailable: '互联网可用', wiredBackhaul: '具备有线回程', coverageNotes: '网络覆盖说明', vlanRequirement: '需要隔离网络', version: '版本', dataMode: '业务数据模式', createdAt: '建立时间', updatedAt: '最近修改', totalCents: '报价总额（分）', grossMarginRatio: '毛利比例', localCommitted: '本地保存成功', externalVerified: '外部事实已核验', externallyVerified: '外部事实已核验', externalNotification: '外部通知', authority: '统计依据' };
const enums = { ...channels, 'growth-acquisition': '获客与体验', 'project-delivery': '方案与项目交付', 'aftercare-loop': '售后与回访', 'employee-work': '数字员工岗位任务', 'management-loop': '门店诊断与汇报', 'qualified-leads': '确认需求的线索', 'experience-plans': '体验计划', 'accepted-projects': '验收项目', 'resolved-aftercare': '解决的售后工单', 'management-reports': '经营报告', consultation: '咨询', appointment: '预约', marketing: '营销', aftercare: '售后', compatible: '兼容', incompatible: '不兼容', synthetic: '沙箱样本', manufacturer: '厂家资料', site: '现场资料', customer: '客户资料', invoice: '合同或票据', technician: '技术人员记录', 'new-build': '新建房屋', design: '设计阶段', 'rough-in': '水电阶段', decorating: '装修中', finished: '已装修', occupied: '已入住', retrofit: '改造升级', critical: '紧急', high: '高', normal: '普通', low: '低', offline: '设备离线', 'scene-failure': '场景异常', 'device-failure': '设备故障', training: '使用培训', safety: '安全问题', privacy: '隐私问题', 'door-lock': '门锁', camera: '摄像头', electrical: '电气', 'fire-safety': '消防设备', gateway: '网关', lighting: '照明', switch: '开关', sensor: '传感器', curtain: '窗帘', climate: '环境控制', audio: '音响', continue: '继续', pause: '暂停', resume: '恢复', ...statuses };
Object.assign(labels, { buildingRef: '楼盘资料保管编号', serviceArea: '服务区域', householdSize: '家庭人数', preferredContactWindow: '希望联系的时段', needs: '客户关注点', patch: '要补充的线索信息', customerId: '客户档案', household: '房屋与家庭', propertyType: '住宅类型', areaSqm: '建筑面积（㎡）', occupants: '居住人数', accessibilityNeeds: '无障碍需求', preferences: '体验偏好', priorities: '优先事项', preferredEcosystems: '考虑的生态', sceneWishes: '希望实现的场景', decisionProcess: '决策安排', decisionRoles: '参与决策的人', budgetOwnerRef: '预算决策人保管编号', targetMoveInAt: '计划入住时间', undecidedTopics: '待确认问题', communication: '联系安排', contactPreference: '联系偏好', cadence: '跟进频次', lastConfirmedAt: '最近确认时间', revision: '修订序号', previousRevisionId: '上一修订', widthMm: '空间宽度（毫米）', lengthMm: '空间长度（毫米）', points: '设备点位', roomId: '空间编号', xMm: '横坐标（毫米）', yMm: '纵坐标（毫米）', mountHeightMm: '安装高度（毫米）', skuId: '设备型号', circuitId: '电路编号', purpose: '点位用途', cableRoute: '走线要求', installNotes: '安装注意事项', pointPlanId: '点位图', designId: '设计修订', constructionId: '施工计划', contractId: '合同记录', rationale: '设计理由', sceneNotes: '场景设计说明', sceneId: '场景编号', userValue: '客户使用价值', fallback: '故障与离线处理', testMethod: '验收方法', milestones: '交付阶段', phase: '阶段', ownerRole: '负责岗位', requiredEvidence: '需核验的依据', materials: '材料安排', quantity: '数量', receivingCheck: '到货核对要求', qualityChecks: '质量检查', checkpoint: '检查节点', responsibleRole: '责任岗位', evidenceRequired: '所需依据', acceptanceRule: '通过条件', risks: '施工风险', numberRef: '合同保管编号', scope: '合同服务范围', paymentSchedule: '付款安排', amountCents: '金额（分）', dueRule: '付款条件', warrantyTerms: '保修与售后条款', changeTerms: '变更处理条款', occurredAt: '观察时间', anchorDate: '演练基准时间', datasetId: '演练资料集', dataOrigin: '资料来源' });
Object.assign(enums, { apartment: '平层住宅', villa: '别墅', townhouse: '联排住宅', controller: '中控面板', outlet: '插座', network: '网络点位', operator: '人员登记', document: '文件资料', 'model-proposal': 'AI 提议（不会改成客户事实）', 'synthetic-history': '演练历史', 'channel-cost-observation': '渠道成本观察', 'receivable-schedule': '应收安排', 'payment-observation': '付款情况观察', 'operating-expense-observation': '经营费用观察', 'inventory-observation': '库存观察', 'staff-capacity': '人员产能', 'customer-followup': '客户回访', 'issue-log': '问题台账', 'synthetic-history-import': '导入的虚构经营历史' });
Object.assign(statuses, { contracted: '已登记合同项目', 'awaiting-materials': '等待材料到位', 'materials-recorded': '材料已登记齐备', 'installed-recorded': '已登记安装依据', 'commissioned-recorded': '已登记调试通过', 'acceptance-pending': '验收尚未齐备', 'commissioning-failed': '调试未通过', 'approved-pending-connector': '已批准 · 渠道待连接', triaged: '已准备故障诊断', 'waiting-service-evidence': '等待人员登记服务结果', 'paused-by-owner': '店主已暂停' });
const pageTitles = { overview: '经营总览', growth: '获客与体验', delivery: '方案与交付', aftercare: '售后与回访', approvals: '待我确认', team: '数字员工', records: '业务记录', store: '门店与产品' };
let state = {}, catalog = {}, reports = {}, industry = {}, owner = { status: 'anonymous' }, activeForm, lastUpdate, page = 'overview';

async function request(path, body, extra = {}) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) });
  let value;
  try { value = await response.json(); } catch { throw new Error('服务返回了无法读取的数据，请检查本地服务。'); }
  if (!response.ok || value.error) {
    const code = value.error?.code;
    const messages = { PERMISSION_DENIED: '当前入口没有这项权限，请使用人员确认会话。', HUMAN_CONFIRMATION_REQUIRED: '请使用人员确认会话录入客户事实或现场记录。', EMPTY_LEAD_PATCH: '至少补充一项线索信息，原有资料可以保持不变。', POINT_OUTSIDE_ROOM: '点位坐标超出所选空间尺寸，请核对毫米数值。', REVISION_CHAIN_INVALID: '修订必须关联当前最新版本，并使用下一个修订序号。', DOCUMENT_REFERENCE_STALE: '关联客户或设计资料已变化，请先核对并建立新修订。', HUMAN_REVIEW_REQUIRED: '这项操作需要人员确认。请先申请店主会话。', OWNER_SESSION_REQUIRED: '人员确认权限尚未建立或已过期，请重新申请。', CONSENT_REQUIRED: '缺少这项用途的客户授权，请先登记客户提供的依据。', PII_REJECTED: '请使用联系方式保管编号；不要把手机号或邮箱写入业务记录。', EXTERNAL_CONNECTOR_DISABLED: '外部发布渠道尚未连接，内容已保留为草稿。', NOT_FOUND: '关联记录不存在，请重新选择。', IDEMPOTENCY_CONFLICT: '这次保存请求的内容发生了变化，请关闭后重新打开表单。', VERSION_CONFLICT: '记录已由另一人修改，请刷新后重试。', LEDGER_INTEGRITY_FAILURE: '记录校验发现异常，当前保存被阻止。', OWNER_CONSOLE_UNAVAILABLE: '请在终端运行门店工作台，再由启动人员确认浏览器请求。' };
    throw new Error(messages[code] ?? value.error?.message ?? `读取失败（${response.status}）`);
  }
  return value;
}
async function call(operation, input = {}, human = false) {
  return request(human ? '/api/owner/call' : '/api/call', { operation, input }, human ? { 'x-bms-csrf': owner.csrfToken ?? '' } : {});
}
function dataOf(value) { return value?.data ?? value; }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function pendingApprovals() { return list('approval').filter(item => item.status === 'pending' && Date.parse(item.expiresAt) > Date.now()); }
function badge(value) { const text = statuses[value] ?? value ?? '待登记'; return `<span class="tag ${['pending', 'awaiting-approval', 'waiting-approval', 'waiting-evidence', 'waiting-input', 'needs-information', 'awaiting-human', 'awaiting-host', 'pending-human-confirmation'].includes(value) ? 'orange' : ['failed', 'rejected', 'expired'].includes(value) ? 'red' : ''}">${escape(text)}</span>`; }
function empty(title, text, operation) { return `<div class="empty"><strong>${escape(title)}</strong>${escape(text)}${operation ? `<br><button class="button secondary small" data-operation="${escape(operation)}">开始登记</button>` : ''}</div>`; }
function head(title, subtitle, operation, actionTitle) { return `<div class="page-head"><div><div class="eyebrow">SMART HOME · BUSINESS WORKSPACE</div><h1>${escape(title)}</h1><p class="subtitle">${escape(subtitle)}</p></div>${operation ? `<button class="button primary" data-operation="${escape(operation)}">＋ ${escape(actionTitle ?? '新增记录')}</button>` : ''}</div>`; }
function kpi(label, value, unit, note, icon) { return `<div class="kpi"><div class="kpi-label">${escape(label)}<span aria-hidden="true">${icon}</span></div><strong>${escape(value)}<small>${escape(unit)}</small></strong><div class="kpi-foot">${escape(note)}</div></div>`; }
function panel(title, note, body, link) { return `<section class="panel"><div class="panel-head"><div><h2>${escape(title)}</h2>${note ? `<p>${escape(note)}</p>` : ''}</div>${link ? `<a href="#${link}">查看记录 ↗</a>` : ''}</div>${body}</section>`; }
function row(type, entity, description, extra = '') { return `<div class="row"><span class="row-icon" aria-hidden="true">${type === 'workflow' ? '✦' : type === 'lead' ? '↗' : '⌑'}</span><div class="row-body"><strong>${escape(entity.title ?? entity.name ?? entity.alias ?? (type === 'workflow' ? enums[entity.kind] : undefined) ?? types[type])}</strong><small>${escape(description)}</small></div><div class="row-right">${extra || badge(entity.status ?? entity.stage)}<button class="link-button" data-detail-type="${type}" data-detail-id="${escape(entity.id)}">详情 →</button></div></div>`; }
function renderGoals() { return '<button class="button secondary small goal-add" data-operation="goal.create">＋ 新建经营目标</button><br><br>' + (list('goal').slice(0, 3).map(goal => { const report = reports[goal.id], current = report?.current ?? '待读取'; return `<div class="goal-card"><div class="goal-top"><div><h3>${escape(goal.title)}</h3><p>${escape(enums[goal.metric])} · 截止 ${dateText(goal.deadline)}</p></div><span class="goal-number">${escape(current)}<small> / ${escape(goal.target)}</small></span></div><div class="progress"><span data-size="${typeof current === 'number' ? Math.min(100, current / goal.target * 100) : 0}"></span></div><p class="report-note">${report?.error ? escape('汇报暂时无法读取：' + report.error) : '本周期本地进度 · 导入历史不计新增成果 · 外部结果待核验'}</p><button class="link-button" data-report="${escape(goal.id)}">阅读证据汇报 →</button></div>`; }).join('<br>') || empty('从一个可衡量目标开始', '给团队明确数量、期限与执行边界。')); }
function renderOverview() {
  const pending = pendingApprovals().length, readyTasks = list('task').filter(task => task.status === 'ready').length;
  const workflows = list('workflow').slice(-4);
  const channelCounts = Object.entries(channels).map(([key, title]) => [title, list('lead').filter(lead => lead.channel === key).length]).filter(([, number]) => number > 0);
  const max = Math.max(1, ...channelCounts.map(([, number]) => number));
  return `${head('把今天的经营，安排得更清楚。', '从客户需求到现场交付，每一步都有记录，每个承诺都有依据。', 'lead.create', '登记新线索')}
    <div class="kpis">${kpi('客户线索', count('lead'), '条', '记录来源渠道与用途授权', '↗')}${kpi('体验计划', count('experience'), '场', '客户确认与计划分别记录', '⌂')}${kpi('交付项目', count('project'), '个', '从批准报价进入交付', '⌑')}${kpi('待我确认', pending, '项', '报价与内容承诺由店主把关', '✓')}</div>
    <div class="grid-two">${panel('团队正在推进', `${readyTasks} 项任务等待 AI 工作台领取`, workflows.length ? workflows.map(workflow => row('workflow', workflow, `${enums[workflow.kind] ?? workflow.kind} · ${dateText(workflow.updatedAt)}`)).join('') : empty('团队准备就绪', '建立目标后启动一个协作流程。', 'workflow.start'), 'team')}
    <section class="hero"><div class="eyebrow">A COMPANY THAT WORKS WITH YOU</div><h2>你定经营方向，<br>让数字员工推进工作。</h2><p>获客、方案、售后、汇报，围绕同一个目标协作。</p><button class="button" data-operation="workflow.start">启动团队协作 <span>↗</span></button></section></div>
    <div class="grid-two">${panel('董事长目标', '目标进度来自当前工作区业务记录', renderGoals())}${panel('线索从哪里来', '首次登记渠道归因', channelCounts.length ? channelCounts.map(([title, number]) => `<div class="channel-row"><span>${escape(title)}</span><div class="bar-track"><div class="bar" data-size="${number / max * 100}"></div></div><strong>${number}</strong></div>`).join('') : empty('还没有渠道数据', '登记第一条线索后，这里将展示渠道分布。'))}</div>
    ${panel('最近的客户需求', '让每一次咨询都得到跟进', table('lead', list('lead').slice(-5), [['客户称呼', x => x.alias], ['来源', x => channels[x.channel]], ['需求', x => x.intent], ['用途授权', x => statuses[x.consent?.status]]]), 'growth')}`;
}
function table(type, items, columns) {
  if (!items.length) return empty(`暂无${types[type] ?? '业务'}记录`, '数据只在操作成功后出现，刷新不会创建样本。');
  return `<div class="table-wrap"><table><thead><tr>${columns.map(([label]) => `<th>${escape(label)}</th>`).join('')}<th>操作</th></tr></thead><tbody>${items.map(item => `<tr>${columns.map(([, value], index) => `<td>${index === 0 ? `<strong>${escape(value(item))}</strong>` : escape(value(item))}</td>`).join('')}<td><button class="link-button" data-detail-type="${type}" data-detail-id="${escape(item.id)}">查看详情 →</button></td></tr>`).join('')}</tbody></table></div>`;
}
function actions(operations) { return `<div class="toolbar">${operations.map(name => `<button class="button secondary small" data-operation="${name}">${escape(catalog.operations?.find(item => item.name === name)?.title ?? name)}</button>`).join('')}</div>`; }
function leadName(lead) { return lead.alias || (lead.surname ? lead.surname + '先生/女士' : '') || lead.buildingName || lead.buildingRef || lead.wechatRef || lead.phoneRef || lead.contactRef || '尚未填写称呼'; }
function leadMissing(lead) {
  const known = { ...lead, alias: lead.alias ?? lead.surname, contactRef: lead.contactRef ?? lead.phoneRef ?? lead.wechatRef, buildingRef: lead.buildingRef ?? lead.buildingName };
  const completeness = lead.completeness ?? {
    missingFields: ['alias', 'contactRef', 'buildingRef', 'intent', 'budgetCents', 'renovationStage', 'serviceArea'].filter(key => known[key] === undefined || known[key] === '' || (key === 'budgetCents' && known[key] <= 0)),
    permissionsMissing: ['consultation', 'appointment'].filter(purpose => lead.consent?.status !== 'granted' || !lead.consent.purposes?.includes(purpose)),
  };
  return [...completeness.missingFields.map(key => labels[key] ?? key), ...completeness.permissionsMissing.map(purpose => `${enums[purpose] ?? purpose}用途授权`)];
}
function originNote(entity) { return entity.dataOrigin === 'synthetic-history-import' ? '<span class="tag orange">虚构历史资料</span>' : entity.dataMode === 'sandbox' ? '<span class="tag">沙箱新增记录</span>' : '<span class="tag">真实资料 · 待独立核验</span>'; }
function renderGrowth() {
  const customers = list('customer');
  return `${head('从一条残缺线索，逐步认识客户。', '只有称呼、微信资料编号或楼盘信息也能开始。保留来源，再补预算、装修进度和实际授权。', 'lead.create', '登记线索')}${actions(['lead.enrich', 'lead.authorize', 'customer.upsert', 'experience.schedule', 'content.create', 'content.request_publication'])}
    <div class="grid-two equal">${panel('渐进线索档案', '空白信息明确留空，AI 提议与人员确认分别保存', list('lead').map(lead => `<article class="lead-card"><div class="card-top"><h3>${escape(leadName(lead))}</h3>${badge(lead.status)}</div><p>${escape(lead.intent || '客户需求等待进一步了解')}</p><div class="chips"><span class="chip">${escape(channels[lead.channel] || '来源待确认')}</span>${originNote(lead)}</div><p class="missing">待完善：${escape(leadMissing(lead).join('、') || '核心线索信息已登记')}</p><div class="card-actions"><button class="link-button" data-enrich-lead="${escape(lead.id)}">补充资料 →</button><button class="link-button" data-detail-type="lead" data-detail-id="${escape(lead.id)}">来源与历史 →</button></div></article>`).join('') || empty('记录刚开始的咨询', '无需先编造姓名、手机号或预算。', 'lead.create'))}
    ${panel('客户与家庭', '从线索发展出的完整需求档案', customers.map(customer => { const lead = list('lead').find(item => item.id === customer.leadId); return `<article class="lead-card"><div class="card-top"><h3>${escape(lead ? leadName(lead) : customer.id)}</h3>${originNote(customer)}</div><p>${escape(enums[customer.household?.propertyType])} · ${escape(customer.household?.areaSqm)}㎡ · ${escape(customer.household?.occupants)}人居住</p><div class="chips">${(customer.preferences?.priorities ?? []).map(item => `<span class="chip">${escape(item)}</span>`).join('')}</div><p>${escape((customer.preferences?.sceneWishes ?? []).join('；'))}</p><button class="link-button" data-detail-type="customer" data-detail-id="${escape(customer.id)}">查看家庭、决策与跟进安排 →</button></article>`; }).join('') || empty('客户信息逐步积累', '确认房屋与家庭需求后，形成可供方案设计的档案。', 'customer.upsert'))}</div>
    <div class="grid-two equal">${panel('等待核实的 AI 补充', '建议不自动覆盖线索与客户授权', list('leadEnrichment').map(item => row('leadEnrichment', item, item.summary ?? '待人员核实的补充提议')).join('') || empty('暂无补充提议', '让线索完善专员依据已有记录提出问题和建议。'))}${panel('门店体验', '计划与客户确认分别记录', list('experience').map(item => row('experience', item, `${dateText(item.startsAt)} · ${item.durationMinutes} 分钟`)).join('') || empty('暂无体验安排', '确认客户愿意到店后再登记时间。', 'experience.schedule'))}</div>
    ${panel('内容工作台', '依据门店场景形成草稿，发布结果等待正式渠道回执', table('content', list('content'), [['标题', x => x.title], ['渠道', x => channels[x.channel]], ['状态', x => statuses[x.status]]]))}`;
}
function pointDiagram(plan) {
  if (!plan) return empty('还没有施工点位资料', '依据现场尺寸与勘测建立点位修订。', 'pointPlan.record');
  const colors = { lighting: '#ac884b', switch: '#4d785c', controller: '#49667e', gateway: '#796591', sensor: '#b56a50', curtain: '#598e8a', network: '#6e7483', outlet: '#687143' };
  return `<div class="diagram-note">${originNote(plan)} 修订 ${escape(plan.revision)} · 坐标与高度单位：毫米。示意图呈现点位分布，墙体、门窗与实际施工条件需现场复核。</div><div class="point-grid">${(plan.rooms ?? []).map(room => {
    const width = Number(room.widthMm), length = Number(room.lengthMm), points = (plan.points ?? []).filter(point => point.roomId === room.roomId);
    const roomName = list('survey').find(survey => survey.id === plan.surveyId)?.rooms?.find(item => item.id === room.roomId)?.name ?? room.roomId;
    if (!Number.isFinite(width) || !Number.isFinite(length) || width <= 0 || length <= 0) return '<p>空间尺寸无效，请核实资料。</p>';
    const pad = Math.max(width, length) * .08, radius = Math.max(width, length) * .027;
    return `<figure class="room-diagram"><figcaption><strong>${escape(roomName)}</strong><span>${width} × ${length} mm</span></figcaption><svg role="img" aria-label="${escape(roomName)}设备点位图" viewBox="${-pad} ${-pad} ${width + pad * 2} ${length + pad * 2}"><rect x="0" y="0" width="${width}" height="${length}" fill="#f5f7ee" stroke="#9ba992" stroke-width="${radius * .1}"/>${points.map((point, index) => `<g><circle cx="${Number(point.xMm)}" cy="${Number(point.yMm)}" r="${radius}" fill="${colors[point.kind] || '#4d785c'}"/><text x="${Number(point.xMm)}" y="${Number(point.yMm) + radius * .35}" text-anchor="middle" fill="white" font-size="${radius * 1.1}">${index + 1}</text><title>${escape(`${enums[point.kind] ?? point.kind} · ${point.purpose} · 安装高度 ${point.mountHeightMm} mm`)}</title></g>`).join('')}</svg><ol>${points.map(point => `<li><strong>${escape(enums[point.kind] || point.kind)}</strong> ${escape(point.purpose)}<small>坐标 ${escape(point.xMm)}, ${escape(point.yMm)} · 高度 ${escape(point.mountHeightMm)} mm · ${escape(point.cableRoute)}</small></li>`).join('')}</ol></figure>`;
  }).join('')}</div><button class="link-button" data-detail-type="pointPlan" data-detail-id="${escape(plan.id)}">核对点位、线缆与安装注意事项 →</button>`;
}
function renderDelivery() {
  const plans = list('pointPlan'), plan = plans.at(-1);
  return `${head('把客户需求，落到可复核的交付资料。', '现场勘测 → 点位与设计 → 报价与合同 → 施工 → 调试与验收。每次修订都关联前一版本。', 'survey.record', '登记现场勘测')}${actions(['pointPlan.record', 'solution.build', 'design.record', 'quote.create', 'construction.record', 'contract.create', 'contract.request_approval', 'contract.record_signing', 'project.create'])}
    ${panel('空间与设备点位', '查看实际保存的尺寸与点位修订', `${plans.length ? `<label class="diagram-select">点位版本 <select id="point-plan-view">${[...plans].reverse().map(item => `<option value="${escape(item.id)}">${escape(item.id)} · 修订 ${escape(item.revision)}</option>`).join('')}</select></label>` : ''}<div id="point-diagram">${pointDiagram(plan)}</div>`)}<br>
    <div class="grid-two equal">${panel('设计修订', '场景价值、离线处理、验收方法与排除范围', list('design').map(item => row('design', item, `修订 ${item.revision} · ${item.rationale}`)).join('') || empty('暂无设计修订', '关联方案与点位图后记录设计决定。', 'design.record'))}${panel('施工计划', '阶段责任、材料、质量检查与风险', list('construction').map(item => row('construction', item, `修订 ${item.revision} · ${item.milestones?.length ?? 0} 个阶段 · ${item.qualityChecks?.length ?? 0} 项检查`)).join('') || empty('暂无施工计划', '根据设计修订安排材料与验收检查。', 'construction.record'))}</div>
    <div class="grid-two equal">${panel('合同与客户确认', '合同审批、签约依据与付款执行分别记录', list('contract').map(item => row('contract', item, `${item.numberRef} · ${(item.paymentSchedule ?? []).length} 期付款安排`)).join('') || empty('暂无合同', '报价、设计和施工版本一致后编制合同。', 'contract.create'))}${panel('方案与报价', '精确 SKU 版本、兼容依据与毛利约束', list('quote').map(item => row('quote', item, `${money(item.totalCents)} · 毛利 ${((item.grossMarginRatio ?? 0) * 100).toFixed(1)}%`)).join('') || empty('暂无报价', '先核验现场事实与设备清单。', 'solution.build'))}</div>
    ${actions(['quote.request_approval', 'procurement.record', 'project.milestone', 'commissioning.record', 'acceptance.record'])}${panel('项目推进', '历史资料有独立来源标记；新增现场结果由人员登记', list('project').map(item => row('project', item, `交付截止 ${dateText(item.dueAt)}`)).join('') || empty('暂无交付项目', '店主批准与客户合同依据齐备后建立项目。', 'project.create'))}<br>${panel('现场勘测', '用于设计与施工校验的房间、电路和网络记录', table('survey', list('survey'), [['记录', x => x.name ?? x.id], ['装修阶段', x => enums[x.renovationStage]], ['空间', x => x.rooms?.length ?? 0], ['风险', x => x.hazards?.length ?? 0]]))}`;
}
function renderStore() {
  const profile = industry.storeProfile, products = industry.productReference, guide = industry.experienceGuide, channelGuide = industry.channelGuide, references = industry.officialReferences;
  if (!profile) return `${head('门店、产品与经营背景', '场景资料与在售演练产品为数字员工提供背景。')}${empty('行业背景暂未读取', '点击刷新，核对本地行业资料是否完整。')}`;
  return `${head(profile.name, profile.positioning)}<div class="notice">${escape(industry.syntheticDisclosure?.statement || '这是一家虚构门店，经营数据用于沙箱演练。')} 华为与 Aqara 资料用于公开产品参考，品牌授权尚未核验。</div>
    <div class="grid-two equal">${panel('服务与区域', '让咨询与交付围绕门店能力安排', `<div class="chips">${(profile.serviceAreas ?? []).map(item => `<span class="chip">${escape(item.label)}</span>`).join('')}</div>${(profile.services ?? []).map(item => `<p class="text-note">${escape(typeof item === 'string' ? item : item.name ?? item.label ?? item.description)}</p>`).join('')}`)}${panel('体验分区', '用真实需求选择体验路线', (profile.experienceZones ?? []).map(zone => `<article class="lead-card"><h3>${escape(zone.name)}</h3><p>${escape(zone.focus)}</p></article>`).join(''))}</div>
    ${panel('门店演练设备目录', 'SYN-SG 型号与价格均为虚构样本；独立于厂商公开参考', table('sku', list('sku'), [['设备编号', x => x.id], ['类别', x => enums[x.category]], ['型号', x => x.model], ['演练售价', x => money(x.priceCents)]]))}<br>
    ${panel('体验场景', '先了解客户使用价值，再核对实施条件', `<div class="scenario-grid">${(guide?.scenes ?? []).map(scene => `<article class="lead-card"><h3>${escape(scene.name)}</h3><p>${escape(scene.behavior)}</p><small>触发：${escape(scene.trigger)}</small><p class="missing">失效处理：${escape(scene.fallback)}</p><p>${escape(scene.customerQuestion)}</p></article>`).join('')}</div>`)}<br>
    ${panel('渠道经营安排', '渠道内容与线索来源已建模，外部账号连接尚未启用', `<div class="scenario-grid">${(channelGuide?.channels ?? []).map(channel => `<article class="lead-card"><h3>${escape(channel.name)}</h3><p>${escape(channel.purpose)}</p><div class="chips">${(channel.contentTopics ?? []).map(item => `<span class="chip">${escape(item)}</span>`).join('')}</div><p class="missing">${escape(channel.consentPolicy)}</p></article>`).join('')}</div>`)}<br>
    ${panel('厂商公开参考', '参考资料不能自动作为报价 SKU、互联兼容依据或品牌授权', (products?.items ?? []).map(product => `<article class="reference-row"><div><h3>${escape(product.name)} · ${escape(product.model || product.category)}</h3><p>${escape(product.summary)}</p><small>${escape((product.limitations ?? []).join('；'))}</small></div><span class="tag">公开参考</span></article>`).join(''))}<br>
    ${panel('资料出处', `核对日期 ${escape(references?.checkedAt || '待核对')}`, (references?.items ?? []).map(ref => `<p class="text-note">${/^https:\/\//.test(ref.url) ? `<a href="${escape(ref.url)}" target="_blank" rel="noopener noreferrer">${escape(ref.title)} ↗</a>` : escape(ref.title)}<small>${escape(ref.limitation)}</small></p>`).join(''))}`;
}
function renderAftercare() { return `${head('售后有响应，结果有回访。', '记录问题、处理期限、服务依据与客户确认，安全问题优先处理。', 'aftercare.open', '新增售后工单')}${actions(['aftercare.resolve', 'workflow.start'])}${panel('售后工单', '现场解决结果需要人员确认', table('aftercare', list('aftercare'), [['问题', x => x.description], ['紧急程度', x => enums[x.severity]], ['处理截止', x => dateText(x.dueAt)], ['状态', x => statuses[x.status]]]))}`; }
function renderApprovals() { const items = pendingApprovals(); return `${head('每个承诺，都经过你的确认。', '审批针对当前内容摘要；过期或内容变化后，旧审批不能继续使用。')}${owner.status !== 'authorized' ? '<div class="notice">当前浏览器尚无人员确认权限。点击「申请店主会话」，由启动工作台的人员在终端核对请求号。</div><button class="button secondary" id="request-owner">申请店主会话</button><br><br>' : '<div class="notice">人员会话已确认。请核对内容、金额、有效期与风险，再决定批准或退回。</div>'}${panel('等待确认', `${items.length} 项有效待办`, items.map(item => `<div class="row"><span class="row-icon">✓</span><div class="row-body"><strong>${escape(item.reason ?? '业务承诺审批')}</strong><small>${escape(types[item.targetType] ?? item.kind ?? '业务审批')} · 截止 ${dateText(item.expiresAt)}</small></div><div class="row-right"><button class="link-button" data-detail-type="approval" data-detail-id="${escape(item.id)}">核对内容</button><button class="button secondary small" data-decision="rejected" data-approval="${escape(item.id)}">退回</button><button class="button primary small" data-decision="approved" data-approval="${escape(item.id)}">批准</button></div></div>`).join('') || empty('当前没有待确认事项', '团队遇到报价和发布承诺时，会把任务送到这里。'))}`; }
function renderTeam() {
  const workforce = Array.isArray(catalog.workforce) ? catalog.workforce : catalog.workforce?.employees ?? catalog.employees ?? [], skillCatalogue = catalog.workforce?.skills ?? [];
  return `${head('让岗位分工，真正进入可领取任务。', '线索挖掘、资料完善、预约、销售、陪练和经营分析由当前 AI 工作台模型产出。', 'workflow.start', '启动协作')}${panel('协作流程', '任务领取、有限重试与业务条件校验', list('workflow').map(item => row('workflow', item, `${enums[item.kind] || item.kind} · ${dateText(item.updatedAt)}`, `<button class="button secondary small" data-tick="${escape(item.id)}">推进待办</button>${badge(item.status)}`)).join('') || empty('还没有协作流程', '建立目标后选择流程，模型任务才会进入队列。', 'workflow.start'))}<br><div class="team-grid">${workforce.map(employee => { const key = typeof employee === 'string' ? employee : employee.id, tasks = list('task').filter(task => task.employee === key), name = employee.name || employee.label || key, skills = employee.skills || []; return `<section class="team-card"><div class="team-avatar">${escape(name.slice(0, 1))}</div><h3>${escape(name)}</h3><p>${escape(employee.responsibility || employee.description || employee.mission || '依据岗位 SOP 提交可复核产物；现场事实与外部动作由人员和正式连接器完成。')}</p><div class="chips"><span class="chip">${tasks.length} 项任务</span><span class="chip">${tasks.filter(item => item.status === 'completed').length} 项本地完成</span></div><div class="role-skills">${skills.map(skill => { const id = typeof skill === 'string' ? skill : skill.id, title = catalog.skillTitles?.[id] || skillCatalogue.find(item => item.id === id)?.name || id; return `<button class="link-button" data-employee="${escape(key)}" data-skill="${escape(id)}">${escape(title)} →</button>`; }).join('')}</div></section>`; }).join('')}</div>`;
}
function renderRecords() { return `${head('每一次动作，都留下依据。', '读取业务记录，登记设备与现场事实，验证当前工作区的记录完整性。')}<div class="toolbar"><select id="record-type" aria-label="业务记录类型">${Object.entries(types).map(([key, title]) => `<option value="${key}">${title}</option>`).join('')}</select><button class="button secondary small" id="verify-ledger">核验记录完整性</button><button class="button secondary small" id="request-owner">申请店主会话</button></div><div id="record-table">${table('store', list('store'), [['名称', x => x.name], ['城市', x => x.city], ['最近修改', x => dateText(x.updatedAt)]])}</div><br>${panel('登记业务资料', '每项资料遵循输入校验、关联对象和人员权限', `<div class="action-grid">${(catalog.operations ?? []).filter(item => !item.readOnly && !item.name.startsWith('task.') && item.name !== 'approval.decide' && item.risk !== 'block').map(item => `<button class="operation-button" data-operation="${escape(item.name)}">${escape(item.title)}<small>${item.roles.includes('agent') ? '业务校验后保存' : '需要人员确认'} · ${escape(item.risk === 'review' ? '含确认边界' : '本地业务记录')}</small></button>`).join('')}</div>`)}`; }
function render() {
  page = location.hash.slice(1) || 'overview'; if (!pageTitles[page]) page = 'overview';
  $('#breadcrumb').textContent = pageTitles[page]; document.title = `${pageTitles[page]} · 经营管理系统`;
  document.querySelectorAll('nav a').forEach(link => { const active = link.dataset.page === page; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('#content').innerHTML = ({ overview: renderOverview, growth: renderGrowth, delivery: renderDelivery, aftercare: renderAftercare, approvals: renderApprovals, team: renderTeam, records: renderRecords, store: renderStore })[page]();
  document.querySelectorAll('[data-size]').forEach(element => { element.style.width = `${Math.max(0, Math.min(100, Number(element.dataset.size)))}%`; });
  const store = list('store')[0]; $('#store-name').textContent = store?.name ?? '全屋智能门店'; $('#store-city').textContent = store?.city ? `${store.city} · 全屋智能` : '尚未配置门店';
  $('#approval-count').textContent = pendingApprovals().length;
  $('#mode').textContent = catalog.dataMode === 'live' ? '真实资料 · 外部未核验' : '沙箱数据 · 本地运行';
  $('#owner-label').textContent = owner.status === 'authorized' ? '人员确认权限已建立' : owner.status === 'pending' ? '等待终端核对请求号' : '申请人员确认权限';
}
async function refresh() {
  const button = $('#refresh'); button.disabled = true;
  try {
    const results = await Promise.all([request('/api/state'), request('/api/catalog'), request('/api/owner/session'), call('industry.context')]);
    state = dataOf(results[0]); catalog = results[1]; owner = results[2]; industry = dataOf(dataOf(results[3])); reports = {};
    const outcomes = await Promise.allSettled(list('goal').map(async goal => [goal.id, dataOf(await call('goal.report', { goalId: goal.id }))]));
    for (const [index, result] of outcomes.entries()) reports[list('goal')[index].id] = result.status === 'fulfilled' ? result.value[1] : { error: result.reason?.message ?? '读取失败' };
    lastUpdate = new Date(); $('#updated').textContent = `更新于 ${lastUpdate.toLocaleTimeString('zh-CN', { hour12: false })} · 外部渠道未连接`;
    $('#banner').hidden = true; render();
  } catch (error) { $('#banner').textContent = `连接未完成：${error.message}`; $('#banner').hidden = false; if (!lastUpdate) $('#content').innerHTML = empty('本地服务暂时无法读取', '启动门店工作台后，点击右上角刷新。'); }
  finally { button.disabled = false; }
}
const refs = { storeId: 'store', leadId: 'lead', surveyId: 'survey', solutionId: 'solution', quoteId: 'quote', projectId: 'project', ticketId: 'aftercare', contentId: 'content', goalId: 'goal', leftSkuId: 'sku', rightSkuId: 'sku', skuId: 'sku', customerId: 'customer', designId: 'design', constructionId: 'construction', pointPlanId: 'pointPlan', contractId: 'contract' };
function sample(schema) {
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'array') return schema.minItems ? Array.from({ length: schema.minItems }, () => sample(schema.items)) : [];
  if (schema.type === 'object') return Object.fromEntries((schema.required ?? Object.keys(schema.properties ?? {})).map(key => [key, sample(schema.properties[key])]));
  if (schema.type === 'boolean') return false;
  if (['number', 'integer'].includes(schema.type)) return schema.minimum ?? 0;
  if (schema.format === 'date-time') return new Date(Date.now() + 7 * 86400000).toISOString();
  return '';
}
function optionLabel(key, value) {
  if (key === 'employeeId' || key === 'ownerRole' || key === 'responsibleRole') return catalog.workforce?.find?.(role => role.id === value)?.name ?? value;
  if (key === 'skillId') return catalog.skillTitles?.[value] ?? value;
  return enums[value] ?? value;
}
function field(key, schema, required, path = key, defaultValue) {
  if (key === 'idempotencyKey') return '';
  const title = labels[key] ?? key, req = required ? ' required' : '', name = escape(path), label = `${escape(title)}${required ? ' *' : '（选填）'}`;
  if (schema.type === 'object' && schema.properties) {
    const enabled = required || defaultValue !== undefined;
    const children = Object.entries(schema.properties).map(([child, spec]) => field(child, spec, schema.required?.includes(child), `${path}.${child}`, defaultValue?.[child])).join('');
    return `<div class="object-group">${required ? `<p class="field">${label}</p>` : `<label class="object-toggle"><input type="checkbox" name="__enable.${name}" data-object-toggle="${name}"${enabled ? ' checked' : ''}>填写${escape(title)}（选填）</label>`}<fieldset data-object-fields="${name}" class="field object-fields"${enabled ? '' : ' disabled'}>${children}</fieldset></div>`;
  }
  if (schema.type === 'array' && activeForm?.structuredArrays) {
    activeForm.arraySchemas.set(path, schema);
    const values = defaultValue ?? Array.from({ length: schema.minItems ?? 0 }, () => undefined);
    activeForm.arrayCounters.set(path, values.length);
    return `<fieldset class="array-group" data-array-path="${name}"><legend>${label}</legend><div data-array-items="${name}">${values.map((value, index) => arrayItem(path, schema, index, value)).join('')}</div><button type="button" class="button secondary small" data-add-array="${name}">＋ 添加一项</button><small class="text-note">${schema.minItems ? `至少 ${schema.minItems} 项。` : '没有实际内容时可以留空。'}最多 ${schema.maxItems ?? 200} 项。</small></fieldset>`;
  }
  let control;
  if (['employeeId', 'ownerRole', 'responsibleRole'].includes(key)) control = `<select name="${name}"${req}><option value="">请选择${escape(title)}</option>${(catalog.workforce ?? []).filter(role => !schema.enum || schema.enum.includes(role.id)).map(role => `<option value="${escape(role.id)}"${defaultValue === role.id ? ' selected' : ''}>${escape(role.name)}</option>`).join('')}</select>`;
  else if (key === 'skillId') control = `<select name="${name}"${req}><option value="">请选择岗位技能</option>${Object.keys(catalog.skillTitles ?? {}).filter(id => !schema.enum || schema.enum.includes(id)).map(id => `<option value="${escape(id)}"${defaultValue === id ? ' selected' : ''}>${escape(optionLabel(key, id))}</option>`).join('')}</select>`;
  else if (refs[key]) control = `<select name="${name}"${req}><option value="">请选择${escape(types[refs[key]])}</option>${list(refs[key]).map(item => `<option value="${escape(item.id)}"${defaultValue === item.id ? ' selected' : ''}>${escape(item.name ?? item.title ?? item.alias ?? item.id)}</option>`).join('')}</select>`;
  else if (schema.enum) control = `<select name="${name}"${req}>${!required ? '<option value="">不填写</option>' : ''}${schema.enum.map(value => `<option value="${escape(value)}"${defaultValue === value ? ' selected' : ''}>${escape(optionLabel(key, value))}</option>`).join('')}</select>`;
  else if (schema.type === 'boolean') control = `<select name="${name}"${req}>${!required ? '<option value="">不填写</option>' : ''}<option value="false">否</option><option value="true"${defaultValue === true ? ' selected' : ''}>是</option></select>`;
  else if (['integer', 'number'].includes(schema.type)) control = `<input name="${name}" type="number"${req} min="${schema.minimum ?? 0}" max="${schema.maximum ?? Number.MAX_SAFE_INTEGER}" step="${schema.type === 'integer' ? 1 : 'any'}" value="${escape(defaultValue ?? (required ? schema.minimum ?? 0 : ''))}">`;
  else if (schema.type === 'array' || schema.type === 'object') control = `<textarea name="${name}" class="structured"${req} placeholder="${escape(JSON.stringify(sample(schema)))}">${escape(defaultValue === undefined ? schema.type === 'array' && !schema.minItems ? '[]' : '' : JSON.stringify(defaultValue, null, 2))}</textarea><small>填写结构化资料：${escape(JSON.stringify(sample(schema)))}。只提交实际已核对的内容。</small>`;
  else if (schema.format === 'date-time') control = `<input name="${name}" type="datetime-local"${req} value="${defaultValue ? escape(new Date(new Date(defaultValue).getTime() - new Date(defaultValue).getTimezoneOffset() * 60000).toISOString().slice(0, 16)) : ''}"><small>时间按当前设备的本地时区保存。</small>`;
  else if ((schema.maxLength ?? 0) > 500) control = `<textarea name="${name}"${req} maxlength="${schema.maxLength ?? 5000}">${escape(defaultValue ?? '')}</textarea>`;
  else control = `<input name="${name}" type="text"${req} maxlength="${schema.maxLength ?? 5000}"${schema.pattern ? ` pattern="${htmlPattern(schema.pattern)}"` : ''} value="${escape(defaultValue ?? '')}">`;
  return `<label class="field"><span>${label}</span>${control}${key === 'contactRef' ? '<small>这里只保留编号；手机号、邮箱与家庭地址保存在你受控的客户资料系统。</small>' : ''}</label>`;
}
function arrayItem(path, schema, index, value) {
  const childPath = `${path}.${index}`;
  return `<div class="array-item" data-array-item="${escape(childPath)}"><div class="array-item-head"><strong>第 ${index + 1} 项</strong><button type="button" class="link-button" data-remove-array="${escape(childPath)}">移除</button></div>${schema.items.type === 'object' ? Object.entries(schema.items.properties).map(([key, spec]) => field(key, spec, schema.items.required?.includes(key), `${childPath}.${key}`, value?.[key])).join('') : field(path.split('.').at(-1), schema.items, true, childPath, value)}</div>`;
}
function openOperation(operation, overrides = {}) {
  const spec = catalog.operations?.find(item => item.name === operation); if (!spec) { toast('当前业务入口不可用，请先刷新。'); return; }
  const requiredHuman = !spec.roles.includes('agent');
  const human = requiredHuman || (owner.status === 'authorized' && spec.roles.includes('owner'));
  if (requiredHuman && owner.status !== 'authorized') { showOwner(); return; }
  const defaults = { id: unique(operation.split('.')[0]), ...(operation === 'lead.create' ? { consent: { status: 'unknown', purposes: [] }, ...(list('store').length === 1 ? { storeId: list('store')[0].id } : {}) } : {}), ...overrides };
  const hidden = { idempotencyKey: unique('save') };
  if (operation === 'approval.decide') for (const key of ['approvalId', 'decision', 'contentDigest']) hidden[key] = overrides[key];
  activeForm = { spec, hidden, human, defaults, arraySchemas: new Map(), arrayCounters: new Map(), structuredArrays: ['customer.upsert', 'pointPlan.record', 'design.record', 'construction.record', 'contract.create', 'business.record'].includes(operation) };
  $('#drawer-title').textContent = spec.title;
  $('#drawer-description').textContent = human ? '请依据客户确认与实际现场资料填写。保存后记录归属于当前人员会话，外部事实核验仍需独立完成。' : '资料会保存在本地工作区。相关对象、业务条件与输入格式通过校验后，才会推进下一步。';
  $('#form-fields').innerHTML = Object.entries(spec.schema.properties).filter(([key]) => !Object.hasOwn(hidden, key)).map(([key, schema]) => field(key, schema, spec.schema.required?.includes(key), key, defaults[key])).join('');
  syncSkillOptions();
  $('#form-error').hidden = true; $('#submit-action').disabled = false; $('#submit-action').textContent = '保存记录'; $('#drawer').showModal();
}
function syncSkillOptions() {
  const employee = $('#action-form [name="employeeId"]'), skill = $('#action-form [name="skillId"]');
  if (!employee || !skill) return;
  const selected = skill.value, role = catalog.workforce?.find(item => item.id === employee.value);
  const ids = role?.skills ?? Object.keys(catalog.skillTitles ?? {});
  skill.innerHTML = `<option value="">请选择岗位技能</option>${ids.map(id => `<option value="${escape(id)}"${selected === id ? ' selected' : ''}>${escape(optionLabel('skillId', id))}</option>`).join('')}`;
}
function readField(schema, path, form) {
  if (schema.type === 'array' && activeForm.structuredArrays) {
    const container = [...document.querySelectorAll('[data-array-items]')].find(element => element.dataset.arrayItems === path);
    if (!container) return undefined;
    const values = [...container.children].filter(element => element.dataset.arrayItem).map(element => readField(schema.items, element.dataset.arrayItem, form));
    if (values.length < (schema.minItems ?? 0) || values.length > (schema.maxItems ?? 200)) throw new Error(`${labels[path.split('.').at(-1)] ?? path}需要 ${schema.minItems ?? 0} 到 ${schema.maxItems ?? 200} 项。`);
    return values;
  }
  if (schema.type === 'object' && schema.properties) {
    const toggle = form.elements.namedItem(`__enable.${path}`);
    if (toggle && !toggle.checked) return undefined;
    const value = {}; for (const [key, child] of Object.entries(schema.properties)) { const item = readField(child, `${path}.${key}`, form); if (item !== undefined) value[key] = item; }
    return Object.keys(value).length ? value : undefined;
  }
  const raw = form.elements.namedItem(path)?.value; if (raw === undefined || raw === '') return undefined;
  if (schema.type === 'boolean') return raw === 'true';
  if (['number', 'integer'].includes(schema.type)) return Number(raw);
  if (['array', 'object'].includes(schema.type)) { try { return JSON.parse(raw); } catch { throw new Error(`${labels[path.split('.').at(-1)] ?? path}的结构化资料不是有效格式。`); } }
  if (schema.format === 'date-time') return new Date(raw).toISOString();
  return raw.trim();
}
async function submit(event) {
  event.preventDefault(); const form = event.currentTarget, button = $('#submit-action'); button.disabled = true; $('#form-error').hidden = true;
  try {
    const input = { ...activeForm.hidden };
    for (const [key, schema] of Object.entries(activeForm.spec.schema.properties)) if (!Object.hasOwn(input, key)) { const value = readField(schema, key, form); if (value !== undefined) input[key] = value; }
    await call(activeForm.spec.name, input, activeForm.human); $('#drawer').close(); toast('记录已保存；你可以查看本地业务回执。'); await refresh();
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { button.disabled = false; }
}
function detail(type, id) {
  const entity = list(type).find(item => item.id === id); if (!entity) { toast('记录未找到，请刷新。'); return; }
  $('#detail-title').textContent = `${types[type]} · ${entity.name ?? entity.title ?? entity.alias ?? entity.id}`;
  const hiddenKeys = new Set(['leaseToken', 'leaseTokenHash', 'csrfToken']);
  const entries = Object.entries(entity).filter(([key]) => !hiddenKeys.has(key));
  $('#detail-content').innerHTML = `<div class="notice">${entity.dataOrigin === 'synthetic-history-import' ? '沙箱业务样本 · 虚构历史资料，未发生人员批准、资金执行或现场作业' : entity.dataMode === 'live' ? '真实业务资料' : '沙箱业务样本'} · 本地已保存。现场事实与外部渠道成功仍需独立核验。</div>${entries.filter(([, value]) => typeof value !== 'object').map(([key, value]) => `<div class="detail-pair"><span>${escape(labels[key] ?? key)}</span><strong>${escape(typeof value === 'boolean' ? value ? '是' : '否' : key.endsWith('Cents') ? money(value) : enums[value] ?? statuses[value] ?? value)}</strong></div>`).join('')}<details><summary>查看结构化业务依据</summary><pre>${escape(JSON.stringify(Object.fromEntries(entries), (key, value) => hiddenKeys.has(key) ? undefined : value, 2))}</pre></details>`;
  $('#detail-dialog').showModal();
}
async function showOwner() {
  try {
    owner = await request('/api/owner/session');
    $('#detail-title').textContent = '人员确认权限';
    if (owner.status === 'authorized') $('#detail-content').innerHTML = `<div class="notice">本浏览器已由终端人员确认，有效截止 ${escape(dateText(owner.expiresAt))}。</div><button id="end-owner" class="button secondary">结束人员会话</button>`;
    else if (owner.status === 'pending') $('#detail-content').innerHTML = `<p>请启动工作台的人员在终端核对以下请求号并确认：</p><pre>owner ${escape(owner.requestId)}</pre><p>确认完成后，点击下方按钮刷新权限。</p><button id="check-owner" class="button primary">检查确认结果</button>`;
    else $('#detail-content').innerHTML = '<p>人员会话用于批准报价、录入勘测与现场交付事实。申请后，启动工作台的人员须在终端核对浏览器请求号。</p><button id="apply-owner" class="button primary">申请人员会话</button>';
    $('#detail-dialog').showModal(); render();
  } catch (error) { toast(error.message); }
}
async function guarded(button, handler) { button.disabled = true; try { await handler(); } catch (error) { toast(error.message); } finally { button.disabled = false; } }
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.addArray) {
    const path = button.dataset.addArray, spec = activeForm.arraySchemas.get(path);
    const container = [...document.querySelectorAll('[data-array-items]')].find(element => element.dataset.arrayItems === path);
    if (!spec || !container) return;
    if (container.children.length >= (spec.maxItems ?? 200)) return toast('已达到这项资料的数量上限。');
    const index = activeForm.arrayCounters.get(path) ?? 0; activeForm.arrayCounters.set(path, index + 1);
    container.insertAdjacentHTML('beforeend', arrayItem(path, spec, index));
    container.lastElementChild.querySelector('input,select,textarea')?.focus();
    return;
  }
  if (button.dataset.removeArray) { button.closest('.array-item').remove(); return; }
  if (button.dataset.enrichLead) { const lead = list('lead').find(item => item.id === button.dataset.enrichLead); if (lead) return openOperation('lead.enrich', { leadId: lead.id, expectedVersion: lead.version, patch: {}, source: 'model-proposal' }); }
  if (button.dataset.employee) return openOperation('workflow.start', { kind: 'employee-work', employeeId: button.dataset.employee, skillId: button.dataset.skill });
  if (button.dataset.operation) return openOperation(button.dataset.operation);
  if (button.dataset.detailId) return detail(button.dataset.detailType, button.dataset.detailId);
  if (button.dataset.approval) { const approval = list('approval').find(item => item.id === button.dataset.approval); if (!approval) return toast('待办已改变，请刷新。'); return openOperation('approval.decide', { approvalId: approval.id, decision: button.dataset.decision, contentDigest: approval.contentDigest }); }
  if (button.dataset.report) return guarded(button, async () => { const report = dataOf(await call('goal.report', { goalId: button.dataset.report })); $('#detail-title').textContent = '经营目标证据汇报'; $('#detail-content').innerHTML = `<div class="notice">本地进度 ${escape(report.current)} / ${escape(report.target)}。外部结果尚未独立核验。</div><pre>${escape(JSON.stringify(report, null, 2))}</pre>`; $('#detail-dialog').showModal(); });
  if (button.dataset.tick) return guarded(button, async () => { await call('workflow.tick', { workflowId: button.dataset.tick, idempotencyKey: unique('tick') }); toast('本地依赖已推进；模型任务等待 AI 工作台领取。'); await refresh(); });
  if (button.id === 'verify-ledger') return guarded(button, async () => { const result = dataOf(await call('ledger.verify')); toast(result.ok ? `记录完整性通过：${result.checkedEvents} 条事件，${result.checkedEntities} 项业务对象。` : '记录完整性未通过，暂停写入并检查资料。'); });
  if (['owner-session', 'request-owner'].includes(button.id)) return showOwner();
  if (button.id === 'apply-owner') return guarded(button, async () => { owner = await request('/api/owner/session', {}); $('#detail-dialog').close(); await showOwner(); });
  if (button.id === 'check-owner') { $('#detail-dialog').close(); await refresh(); return showOwner(); }
  if (button.id === 'end-owner') return guarded(button, async () => { const response = await fetch('/api/owner/session', { method: 'DELETE', headers: { 'x-bms-csrf': owner.csrfToken } }); if (!response.ok) throw new Error('结束会话失败，请刷新后重试。'); owner = { status: 'anonymous' }; $('#detail-dialog').close(); toast('人员会话已结束。'); render(); });
});
$('#new-goal').addEventListener('click', () => openOperation('goal.create'));
$('#refresh').addEventListener('click', refresh);
$('#action-form').addEventListener('submit', submit);
$('#close-drawer').addEventListener('click', () => $('#drawer').close());
$('#cancel-drawer').addEventListener('click', () => $('#drawer').close());
$('#close-detail').addEventListener('click', () => $('#detail-dialog').close());
document.addEventListener('change', event => {
  if (event.target.name === 'employeeId') { syncSkillOptions(); return; }
  if (event.target.dataset.objectToggle) {
    const group = [...document.querySelectorAll('[data-object-fields]')].find(element => element.dataset.objectFields === event.target.dataset.objectToggle);
    if (group) group.disabled = !event.target.checked;
    return;
  }
  if (event.target.id === 'point-plan-view') { $('#point-diagram').innerHTML = pointDiagram(list('pointPlan').find(item => item.id === event.target.value)); return; }
  if (event.target.id !== 'record-type') return;
  const type = event.target.value; $('#record-table').innerHTML = table(type, list(type), [['名称', x => x.name ?? x.title ?? x.alias ?? x.id], ['状态', x => statuses[x.status ?? x.stage] ?? '已登记'], ['最近修改', x => dateText(x.updatedAt)]]);
});
window.addEventListener('hashchange', render);
refresh();
