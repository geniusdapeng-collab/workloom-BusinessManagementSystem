const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
// HTML pattern uses Unicode sets; a literal trailing hyphen needs an escape.
const htmlPattern = pattern => escape(pattern.replace(/(?<!\\)-(?=\])/g, '\\-'));
const unique = prefix => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
const list = type => state[type]?.items ?? [];
const count = type => state[type]?.total ?? 0;
const money = cents => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format((cents ?? 0) / 100);
const dateText = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '待登记';
const channels = { douyin: '抖音', xiaohongshu: '小红书', 'wechat-video': '微信视频号', 'wechat-private': '微信私域', baidu: '百度搜索', geo: 'AI 搜索', 'walk-in': '门店自然到访', referral: '客户转介绍', designer: '设计师合作', property: '物业合作', 'decoration-partner': '装修合作' };
const statuses = { new: '新线索', qualified: '已确认需求', 'needs-information': '等待补充客户信息', proposed: '待客户确认', 'customer-confirmed': '客户已确认', ready: '等待 AI 领取', leased: 'AI 正在处理', completed: '已完成本地任务', failed: '需处理失败', pending: '等待店主确认', approved: '已批准', rejected: '已退回', expired: '已过期', draft: '草稿', 'awaiting-approval': '等待审批', 'waiting-approval': '等待店主审批', 'waiting-evidence': '等待人员登记现场依据', 'waiting-input': '等待关联业务资料', 'accepted-local-record': '本地已登记客户验收', active: '推进中', running: '执行中', 'awaiting-human': '等待人员确认', 'awaiting-host': '等待 AI 工作台', paused: '已暂停', cancelled: '已取消', accepted: '已记录验收', resolved: '已记录解决', open: '待处理', created: '已建立', procurement: '等待采购', installation: '等待安装', commissioning: '等待调试', acceptance: '等待验收', 'field-recorded': '已登记勘测', granted: '已授权', unknown: '尚未授权', denied: '已撤回' };
const types = { store: '门店', sku: '设备目录', compatibility: '兼容性依据', lead: '客户线索', experience: '体验计划', survey: '现场勘测', solution: '全屋方案', quote: '报价', approval: '审批', project: '交付项目', procurement: '采购记录', commissioning: '调试记录', acceptance: '验收记录', aftercare: '售后工单', content: '内容草稿', goal: '经营目标', workflow: '协作流程', task: '员工任务', report: '经营报告' };
const labels = { id: '记录编号', name: '名称', city: '所在城市', serviceAreas: '服务区域', budgetCents: '客户预算（分）', employeeId: '数字员工', skillId: '岗位技能', brief: '任务要求', objectRefs: '关联业务依据', work: '岗位任务产物', minMarginRatio: '最低毛利比例', maxDiscountRatio: '最高折扣比例', manufacturer: '设备品牌', model: '设备型号', category: '设备类型', protocol: '通信协议', firmwareVersion: '固件版本', costCents: '成本（分）', priceCents: '售价（分）', evidence: '依据记录', active: '是否在售', expectedVersion: '读取时的版本', leftSkuId: '设备一', rightSkuId: '设备二', result: '核查结果', conditions: '使用条件', expiresAt: '有效截止时间', storeId: '所属门店', alias: '客户称呼', contactRef: '客户联系方式保管编号', channel: '来源渠道', campaignRef: '活动编号', intent: '客户需求', consent: '客户用途授权', status: '状态', purposes: '授权用途', uri: '依据文件地址', sha256: '文件校验摘要', source: '依据来源', observedAt: '实际观察时间', summary: '依据摘要', leadId: '客户线索', startsAt: '体验开始时间', durationMinutes: '体验时长（分钟）', scenes: '场景', confirmationEvidence: '客户确认依据', renovationStage: '装修阶段', rooms: '空间与电路', network: '网络勘测', hazards: '现场风险', surveyId: '勘测记录', bom: '设备清单', compatibilityIds: '兼容依据编号', exclusions: '不包含的服务', solutionId: '全屋方案', laborCostCents: '人工成本（分）', laborPriceCents: '人工售价（分）', discountCents: '折扣金额（分）', validUntil: '报价有效截止', terms: '服务与付款条款', quoteId: '报价记录', reason: '理由', projectId: '交付项目', contractEvidence: '合同依据', dueAt: '交付截止时间', items: '采购明细', milestone: '现场阶段', professionalRef: '安装人员编号', safetyChecklist: '安装安全核对', powerIsolated: '断电隔离已完成', manufacturerInstructionsFollowed: '遵照厂家说明', networkConfigured: '网络已配置', customerPrivacyProtected: '客户隐私已保护', results: '场景测试结果', customerAccepted: '客户已接受验收', trainingDelivered: '客户培训已完成', credentialsTransferred: '管理权限已移交', outstandingIssues: '待解决问题', severity: '紧急程度', description: '问题说明', ticketId: '售后工单', resolution: '解决方式', customerConfirmed: '客户已确认解决', followupAt: '下次回访时间', title: '标题', body: '正文', claims: '事实声明与依据', skuIds: '关联设备', piiFree: '内容已经脱敏', contentId: '内容草稿', goalId: '经营目标', metric: '目标指标', target: '目标数量', deadline: '目标截止时间', constraints: '执行约束', instruction: '店主指令', action: '指令动作', kind: '协作流程', maxAttempts: '最多重试次数', approvalId: '审批编号', decision: '决定', contentDigest: '待审内容摘要', internetAvailable: '互联网可用', wiredBackhaul: '具备有线回程', coverageNotes: '网络覆盖说明', vlanRequirement: '需要隔离网络', version: '版本', dataMode: '业务数据模式', createdAt: '建立时间', updatedAt: '最近修改', totalCents: '报价总额（分）', grossMarginRatio: '毛利比例', localCommitted: '本地保存成功', externalVerified: '外部事实已核验', externallyVerified: '外部事实已核验', externalNotification: '外部通知', authority: '统计依据' };
const enums = { ...channels, 'growth-acquisition': '获客与体验', 'project-delivery': '方案与项目交付', 'aftercare-loop': '售后与回访', 'employee-work': '数字员工岗位任务', 'management-loop': '门店诊断与汇报', 'qualified-leads': '确认需求的线索', 'experience-plans': '体验计划', 'accepted-projects': '验收项目', 'resolved-aftercare': '解决的售后工单', 'management-reports': '经营报告', consultation: '咨询', appointment: '预约', marketing: '营销', aftercare: '售后', compatible: '兼容', incompatible: '不兼容', synthetic: '沙箱样本', manufacturer: '厂家资料', site: '现场资料', customer: '客户资料', invoice: '合同或票据', technician: '技术人员记录', 'new-build': '新建房屋', design: '设计阶段', 'rough-in': '水电阶段', decorating: '装修中', finished: '已装修', occupied: '已入住', retrofit: '改造升级', critical: '紧急', high: '高', normal: '普通', low: '低', offline: '设备离线', 'scene-failure': '场景异常', 'device-failure': '设备故障', training: '使用培训', safety: '安全问题', privacy: '隐私问题', 'door-lock': '门锁', camera: '摄像头', electrical: '电气', 'fire-safety': '消防设备', gateway: '网关', lighting: '照明', switch: '开关', sensor: '传感器', curtain: '窗帘', climate: '环境控制', audio: '音响', continue: '继续', pause: '暂停', resume: '恢复', ...statuses };
const pageTitles = { overview: '经营总览', growth: '获客与体验', delivery: '方案与交付', aftercare: '售后与回访', approvals: '待我确认', team: '数字员工', records: '业务记录' };
let state = {}, catalog = {}, reports = {}, owner = { status: 'anonymous' }, activeForm, lastUpdate, page = 'overview';

async function request(path, body, extra = {}) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) });
  let value;
  try { value = await response.json(); } catch { throw new Error('服务返回了无法读取的数据，请检查本地服务。'); }
  if (!response.ok || value.error) {
    const code = value.error?.code;
    const messages = { HUMAN_REVIEW_REQUIRED: '这项操作需要人员确认。请先申请店主会话。', OWNER_SESSION_REQUIRED: '人员确认权限尚未建立或已过期，请重新申请。', CONSENT_REQUIRED: '缺少这项用途的客户授权，请先登记客户提供的依据。', PII_REJECTED: '请使用联系方式保管编号；不要把手机号或邮箱写入业务记录。', EXTERNAL_CONNECTOR_DISABLED: '外部发布渠道尚未连接，内容已保留为草稿。', NOT_FOUND: '关联记录不存在，请重新选择。', IDEMPOTENCY_CONFLICT: '这次保存请求的内容发生了变化，请关闭后重新打开表单。', VERSION_CONFLICT: '记录已由另一人修改，请刷新后重试。', LEDGER_INTEGRITY_FAILURE: '记录校验发现异常，当前保存被阻止。', OWNER_CONSOLE_UNAVAILABLE: '请在终端运行门店工作台，再由启动人员确认浏览器请求。' };
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
function badge(value) { const text = statuses[value] ?? value ?? '待登记'; return `<span class="tag ${['pending', 'awaiting-approval', 'waiting-approval', 'waiting-evidence', 'waiting-input', 'needs-information', 'awaiting-human', 'awaiting-host'].includes(value) ? 'orange' : ['failed', 'rejected', 'expired'].includes(value) ? 'red' : ''}">${escape(text)}</span>`; }
function empty(title, text, operation) { return `<div class="empty"><strong>${escape(title)}</strong>${escape(text)}${operation ? `<br><button class="button secondary small" data-operation="${escape(operation)}">开始登记</button>` : ''}</div>`; }
function head(title, subtitle, operation, actionTitle) { return `<div class="page-head"><div><div class="eyebrow">SMART HOME · BUSINESS WORKSPACE</div><h1>${escape(title)}</h1><p class="subtitle">${escape(subtitle)}</p></div>${operation ? `<button class="button primary" data-operation="${escape(operation)}">＋ ${escape(actionTitle ?? '新增记录')}</button>` : ''}</div>`; }
function kpi(label, value, unit, note, icon) { return `<div class="kpi"><div class="kpi-label">${escape(label)}<span aria-hidden="true">${icon}</span></div><strong>${escape(value)}<small>${escape(unit)}</small></strong><div class="kpi-foot">${escape(note)}</div></div>`; }
function panel(title, note, body, link) { return `<section class="panel"><div class="panel-head"><div><h2>${escape(title)}</h2>${note ? `<p>${escape(note)}</p>` : ''}</div>${link ? `<a href="#${link}">查看记录 ↗</a>` : ''}</div>${body}</section>`; }
function row(type, entity, description, extra = '') { return `<div class="row"><span class="row-icon" aria-hidden="true">${type === 'workflow' ? '✦' : type === 'lead' ? '↗' : '⌑'}</span><div class="row-body"><strong>${escape(entity.title ?? entity.name ?? entity.alias ?? (type === 'workflow' ? enums[entity.kind] : undefined) ?? types[type])}</strong><small>${escape(description)}</small></div><div class="row-right">${extra || badge(entity.status ?? entity.stage)}<button class="link-button" data-detail-type="${type}" data-detail-id="${escape(entity.id)}">详情 →</button></div></div>`; }
function renderGoals() { return '<button class="button secondary small goal-add" data-operation="goal.create">＋ 新建经营目标</button><br><br>' + (list('goal').slice(0, 3).map(goal => { const report = reports[goal.id], current = report?.current ?? '待读取'; return `<div class="goal-card"><div class="goal-top"><div><h3>${escape(goal.title)}</h3><p>${escape(enums[goal.metric])} · 截止 ${dateText(goal.deadline)}</p></div><span class="goal-number">${escape(current)}<small> / ${escape(goal.target)}</small></span></div><div class="progress"><span data-size="${typeof current === 'number' ? Math.min(100, current / goal.target * 100) : 0}"></span></div><p class="report-note">${report?.error ? escape('汇报暂时无法读取：' + report.error) : '以本地业务记录统计 · 外部结果尚未核验'}</p><button class="link-button" data-report="${escape(goal.id)}">阅读证据汇报 →</button></div>`; }).join('<br>') || empty('从一个可衡量目标开始', '给团队明确数量、期限与执行边界。')); }
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
function renderGrowth() { return `${head('把关注变成有价值的咨询。', '记录线索、用途授权、内容依据与体验计划，避免重复跟进和不当承诺。', 'lead.create', '新增线索')}${actions(['lead.authorize', 'experience.schedule', 'content.create', 'content.request_publication'])}<div class="grid-two">${panel('客户线索', '联系方式仅存保管编号', table('lead', list('lead'), [['客户', x => x.alias], ['渠道', x => channels[x.channel]], ['授权', x => statuses[x.consent?.status]]]))}${panel('门店体验', '计划不会自动发送客户通知', list('experience').map(item => row('experience', item, `${dateText(item.startsAt)} · ${item.durationMinutes} 分钟`)).join('') || empty('暂无体验计划', '先取得预约用途授权，再安排到店时间。', 'experience.schedule'))}</div>${panel('内容工作台', '有依据的草稿，审批后仍需连接正式发布渠道', table('content', list('content'), [['标题', x => x.title], ['渠道', x => channels[x.channel]], ['状态', x => statuses[x.status]]]))}`; }
function renderDelivery() { return `${head('交付，从可核验的方案开始。', '勘测 → 场景与设备 → 报价审批 → 采购安装 → 调试 → 客户验收。', 'survey.record', '登记现场勘测')}${actions(['solution.build', 'quote.create', 'quote.request_approval', 'project.create', 'procurement.record', 'project.milestone', 'commissioning.record', 'acceptance.record'])}<div class="grid-two">${panel('进行中的项目', '采购、安装、调试与验收按依赖顺序推进', list('project').map(item => row('project', item, `交付截止 ${dateText(item.dueAt)} · ${item.name ?? item.id}`)).join('') || empty('暂无交付项目', '报价经过店主批准后，凭合同依据建立项目。', 'project.create'))}${panel('方案与报价', '精确设备版本、兼容依据和毛利约束', list('quote').map(item => row('quote', item, `${money(item.totalCents)} · 毛利 ${((item.grossMarginRatio ?? 0) * 100).toFixed(1)}%`)).join('') || empty('暂无报价', '先登记现场事实，再校验方案与设备清单。', 'solution.build'))}</div>${panel('已登记的勘测', '现场事实须由人员会话录入', table('survey', list('survey'), [['记录', x => x.name ?? x.id], ['装修阶段', x => enums[x.renovationStage]], ['空间数量', x => x.rooms?.length ?? 0], ['风险数量', x => x.hazards?.length ?? 0]]))}`; }
function renderAftercare() { return `${head('售后有响应，结果有回访。', '记录问题、处理期限、服务依据与客户确认，安全问题优先处理。', 'aftercare.open', '新增售后工单')}${actions(['aftercare.resolve', 'workflow.start'])}${panel('售后工单', '现场解决结果需要人员确认', table('aftercare', list('aftercare'), [['问题', x => x.description], ['紧急程度', x => enums[x.severity]], ['处理截止', x => dateText(x.dueAt)], ['状态', x => statuses[x.status]]]))}`; }
function renderApprovals() { const items = pendingApprovals(); return `${head('每个承诺，都经过你的确认。', '审批针对当前内容摘要；过期或内容变化后，旧审批不能继续使用。')}${owner.status !== 'authorized' ? '<div class="notice">当前浏览器尚无人员确认权限。点击「申请店主会话」，由启动工作台的人员在终端核对请求号。</div><button class="button secondary" id="request-owner">申请店主会话</button><br><br>' : '<div class="notice">人员会话已确认。请核对内容、金额、有效期与风险，再决定批准或退回。</div>'}${panel('等待确认', `${items.length} 项有效待办`, items.map(item => `<div class="row"><span class="row-icon">✓</span><div class="row-body"><strong>${escape(item.reason ?? '业务承诺审批')}</strong><small>${escape(types[item.targetType] ?? item.kind ?? '业务审批')} · 截止 ${dateText(item.expiresAt)}</small></div><div class="row-right"><button class="link-button" data-detail-type="approval" data-detail-id="${escape(item.id)}">核对内容</button><button class="button secondary small" data-decision="rejected" data-approval="${escape(item.id)}">退回</button><button class="button primary small" data-decision="approved" data-approval="${escape(item.id)}">批准</button></div></div>`).join('') || empty('当前没有待确认事项', '团队遇到报价和发布承诺时，会把任务送到这里。'))}`; }
function renderTeam() { const names = { 'store-ceo': '门店总经理', 'growth-director': '增长负责人', 'market-researcher': '市场研究员', 'content-strategist': '内容策划', 'video-producer': '短视频制作', 'social-publisher': '社媒发布', 'lead-concierge': '线索管家', 'sales-consultant': '销售顾问', 'solution-designer': '方案设计师', 'survey-engineer': '勘测工程师', 'compatibility-engineer': '兼容核查工程师', 'quote-controller': '报价专员', 'project-manager': '交付项目经理', 'procurement-controller': '采购专员', 'installation-supervisor': '安装督导', 'commissioning-engineer': '调试工程师', 'acceptance-auditor': '验收专员', 'aftercare-specialist': '售后专员', 'finance-controller': '财务专员', 'knowledge-steward': '知识管理员' }; return `${head('让一支团队，围绕结果协作。', '由当前 AI 工作台内置模型承担思考与产出。本地系统负责依赖、校验、记录与人审边界。', 'workflow.start', '启动协作')}${panel('协作流程', '任务租约、有限重试与结构化产物', list('workflow').map(item => row('workflow', item, `${enums[item.kind]} · ${dateText(item.updatedAt)}`, `<button class="button secondary small" data-tick="${escape(item.id)}">推进待办</button>${badge(item.status)}`)).join('') || empty('还没有协作流程', '建立经营目标，选择对应工作流。', 'workflow.start'))}<br><div class="team-grid">${(catalog.employees ?? []).map(employee => { const key = typeof employee === 'string' ? employee : employee.id, tasks = list('task').filter(task => task.employee === key); return `<section class="team-card"><div class="team-avatar">${escape((names[key] ?? key).slice(0, 1))}</div><h3>${escape(names[key] ?? key)}</h3><p>按工作流分工领取任务，提交产物后经过业务校验。现场事实由人员提供。</p><div class="chips"><span class="chip">${tasks.length} 项已安排任务</span><span class="chip">${tasks.filter(item => item.status === 'completed').length} 项已完成</span></div></section>`; }).join('')}</div>`; }
function renderRecords() { return `${head('每一次动作，都留下依据。', '读取业务记录，登记设备与现场事实，验证当前工作区的记录完整性。')}<div class="toolbar"><select id="record-type" aria-label="业务记录类型">${Object.entries(types).map(([key, title]) => `<option value="${key}">${title}</option>`).join('')}</select><button class="button secondary small" id="verify-ledger">核验记录完整性</button><button class="button secondary small" id="request-owner">申请店主会话</button></div><div id="record-table">${table('store', list('store'), [['名称', x => x.name], ['城市', x => x.city], ['最近修改', x => dateText(x.updatedAt)]])}</div><br>${panel('登记业务资料', '每项资料遵循输入校验、关联对象和人员权限', `<div class="action-grid">${(catalog.operations ?? []).filter(item => !item.readOnly && !item.name.startsWith('task.') && item.name !== 'approval.decide' && item.risk !== 'block').map(item => `<button class="operation-button" data-operation="${escape(item.name)}">${escape(item.title)}<small>${item.roles.includes('agent') ? '业务校验后保存' : '需要人员确认'} · ${escape(item.risk === 'review' ? '含确认边界' : '本地业务记录')}</small></button>`).join('')}</div>`)}`; }
function render() {
  page = location.hash.slice(1) || 'overview'; if (!pageTitles[page]) page = 'overview';
  $('#breadcrumb').textContent = pageTitles[page]; document.title = `${pageTitles[page]} · 经营管理系统`;
  document.querySelectorAll('nav a').forEach(link => { const active = link.dataset.page === page; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('#content').innerHTML = ({ overview: renderOverview, growth: renderGrowth, delivery: renderDelivery, aftercare: renderAftercare, approvals: renderApprovals, team: renderTeam, records: renderRecords })[page]();
  document.querySelectorAll('[data-size]').forEach(element => { element.style.width = `${Math.max(0, Math.min(100, Number(element.dataset.size)))}%`; });
  const store = list('store')[0]; $('#store-name').textContent = store?.name ?? '全屋智能门店'; $('#store-city').textContent = store?.city ? `${store.city} · 全屋智能` : '尚未配置门店';
  $('#approval-count').textContent = pendingApprovals().length;
  $('#mode').textContent = catalog.dataMode === 'live' ? '真实资料 · 外部未核验' : '沙箱数据 · 本地运行';
  $('#owner-label').textContent = owner.status === 'authorized' ? '人员确认权限已建立' : owner.status === 'pending' ? '等待终端核对请求号' : '申请人员确认权限';
}
async function refresh() {
  const button = $('#refresh'); button.disabled = true;
  try {
    const results = await Promise.all([request('/api/state'), request('/api/catalog'), request('/api/owner/session')]);
    state = dataOf(results[0]); catalog = results[1]; owner = results[2]; reports = {};
    const outcomes = await Promise.allSettled(list('goal').map(async goal => [goal.id, dataOf(await call('goal.report', { goalId: goal.id }))]));
    for (const [index, result] of outcomes.entries()) reports[list('goal')[index].id] = result.status === 'fulfilled' ? result.value[1] : { error: result.reason?.message ?? '读取失败' };
    lastUpdate = new Date(); $('#updated').textContent = `更新于 ${lastUpdate.toLocaleTimeString('zh-CN', { hour12: false })} · 外部渠道未连接`;
    $('#banner').hidden = true; render();
  } catch (error) { $('#banner').textContent = `连接未完成：${error.message}`; $('#banner').hidden = false; if (!lastUpdate) $('#content').innerHTML = empty('本地服务暂时无法读取', '启动门店工作台后，点击右上角刷新。'); }
  finally { button.disabled = false; }
}
const refs = { storeId: 'store', leadId: 'lead', surveyId: 'survey', solutionId: 'solution', quoteId: 'quote', projectId: 'project', ticketId: 'aftercare', contentId: 'content', goalId: 'goal', leftSkuId: 'sku', rightSkuId: 'sku' };
function sample(schema) {
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'array') return schema.minItems ? Array.from({ length: schema.minItems }, () => sample(schema.items)) : [];
  if (schema.type === 'object') return Object.fromEntries((schema.required ?? Object.keys(schema.properties ?? {})).map(key => [key, sample(schema.properties[key])]));
  if (schema.type === 'boolean') return false;
  if (['number', 'integer'].includes(schema.type)) return schema.minimum ?? 0;
  if (schema.format === 'date-time') return new Date(Date.now() + 7 * 86400000).toISOString();
  return '';
}
function field(key, schema, required, path = key, defaultValue) {
  if (key === 'idempotencyKey') return '';
  const title = labels[key] ?? key, req = required ? ' required' : '', name = escape(path), label = `${escape(title)}${required ? ' *' : '（选填）'}`;
  if (schema.type === 'object' && schema.properties) {
    const enabled = required || defaultValue !== undefined;
    const children = Object.entries(schema.properties).map(([child, spec]) => field(child, spec, schema.required?.includes(child), `${path}.${child}`, defaultValue?.[child])).join('');
    return `<div class="object-group">${required ? `<p class="field">${label}</p>` : `<label class="object-toggle"><input type="checkbox" name="__enable.${name}" data-object-toggle="${name}"${enabled ? ' checked' : ''}>填写${escape(title)}（选填）</label>`}<fieldset data-object-fields="${name}" class="field object-fields"${enabled ? '' : ' disabled'}>${children}</fieldset></div>`;
  }
  let control;
  if (refs[key]) control = `<select name="${name}"${req}><option value="">请选择${escape(types[refs[key]])}</option>${list(refs[key]).map(item => `<option value="${escape(item.id)}">${escape(item.name ?? item.title ?? item.alias ?? item.id)}</option>`).join('')}</select>`;
  else if (schema.enum) control = `<select name="${name}"${req}>${!required ? '<option value="">不填写</option>' : ''}${schema.enum.map(value => `<option value="${escape(value)}"${defaultValue === value ? ' selected' : ''}>${escape(enums[value] ?? value)}</option>`).join('')}</select>`;
  else if (schema.type === 'boolean') control = `<select name="${name}"${req}>${!required ? '<option value="">不填写</option>' : ''}<option value="false">否</option><option value="true"${defaultValue === true ? ' selected' : ''}>是</option></select>`;
  else if (['integer', 'number'].includes(schema.type)) control = `<input name="${name}" type="number"${req} min="${schema.minimum ?? 0}" max="${schema.maximum ?? Number.MAX_SAFE_INTEGER}" step="${schema.type === 'integer' ? 1 : 'any'}" value="${escape(defaultValue ?? (required ? schema.minimum ?? 0 : ''))}">`;
  else if (schema.type === 'array' || schema.type === 'object') control = `<textarea name="${name}" class="structured"${req} placeholder="${escape(JSON.stringify(sample(schema)))}">${escape(defaultValue === undefined ? schema.type === 'array' && !schema.minItems ? '[]' : '' : JSON.stringify(defaultValue, null, 2))}</textarea><small>填写结构化资料：${escape(JSON.stringify(sample(schema)))}。只提交实际已核对的内容。</small>`;
  else if (schema.format === 'date-time') control = `<input name="${name}" type="datetime-local"${req} value="${defaultValue ? escape(new Date(new Date(defaultValue).getTime() - new Date(defaultValue).getTimezoneOffset() * 60000).toISOString().slice(0, 16)) : ''}"><small>时间按当前设备的本地时区保存。</small>`;
  else if ((schema.maxLength ?? 0) > 500) control = `<textarea name="${name}"${req} maxlength="${schema.maxLength ?? 5000}">${escape(defaultValue ?? '')}</textarea>`;
  else control = `<input name="${name}" type="text"${req} maxlength="${schema.maxLength ?? 5000}"${schema.pattern ? ` pattern="${htmlPattern(schema.pattern)}"` : ''} value="${escape(defaultValue ?? '')}">`;
  return `<label class="field"><span>${label}</span>${control}${key === 'contactRef' ? '<small>这里只保留编号；手机号、邮箱与家庭地址保存在你受控的客户资料系统。</small>' : ''}</label>`;
}
function openOperation(operation, overrides = {}) {
  const spec = catalog.operations?.find(item => item.name === operation); if (!spec) { toast('当前业务入口不可用，请先刷新。'); return; }
  const requiredHuman = !spec.roles.includes('agent');
  const human = requiredHuman || (owner.status === 'authorized' && spec.roles.includes('owner'));
  if (requiredHuman && owner.status !== 'authorized') { showOwner(); return; }
  const defaults = { id: unique(operation.split('.')[0]), contactRef: unique('contact'), ...(operation === 'lead.create' ? { consent: { status: 'unknown', purposes: [] } } : {}), ...overrides };
  const hidden = { idempotencyKey: unique('save') };
  if (operation === 'approval.decide') for (const key of ['approvalId', 'decision', 'contentDigest']) hidden[key] = overrides[key];
  activeForm = { spec, hidden, human };
  $('#drawer-title').textContent = spec.title;
  $('#drawer-description').textContent = human ? '请依据客户确认与实际现场资料填写。保存后记录归属于当前人员会话，外部事实核验仍需独立完成。' : '资料会保存在本地工作区。相关对象、业务条件与输入格式通过校验后，才会推进下一步。';
  $('#form-fields').innerHTML = Object.entries(spec.schema.properties).filter(([key]) => !Object.hasOwn(hidden, key)).map(([key, schema]) => field(key, schema, spec.schema.required?.includes(key), key, defaults[key])).join('');
  $('#form-error').hidden = true; $('#submit-action').disabled = false; $('#submit-action').textContent = '保存记录'; $('#drawer').showModal();
}
function readField(schema, path, form) {
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
  $('#detail-content').innerHTML = `<div class="notice">${entity.dataMode === 'live' ? '真实业务资料' : '沙箱业务样本'} · 本地已保存。现场事实与外部渠道成功仍需独立核验。</div>${entries.filter(([, value]) => typeof value !== 'object').map(([key, value]) => `<div class="detail-pair"><span>${escape(labels[key] ?? key)}</span><strong>${escape(typeof value === 'boolean' ? value ? '是' : '否' : key.endsWith('Cents') ? money(value) : enums[value] ?? value)}</strong></div>`).join('')}<details><summary>查看结构化业务依据</summary><pre>${escape(JSON.stringify(Object.fromEntries(entries), (key, value) => hiddenKeys.has(key) ? undefined : value, 2))}</pre></details>`;
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
  if (event.target.dataset.objectToggle) {
    const group = [...document.querySelectorAll('[data-object-fields]')].find(element => element.dataset.objectFields === event.target.dataset.objectToggle);
    if (group) group.disabled = !event.target.checked;
    return;
  }
  if (event.target.id !== 'record-type') return;
  const type = event.target.value; $('#record-table').innerHTML = table(type, list(type), [['名称', x => x.name ?? x.title ?? x.alias ?? x.id], ['状态', x => statuses[x.status ?? x.stage] ?? '已登记'], ['最近修改', x => dateText(x.updatedAt)]]);
});
window.addEventListener('hashchange', render);
refresh();
