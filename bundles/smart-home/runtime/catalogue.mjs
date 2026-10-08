export const str = (max = 5000) => ({ type: 'string', minLength: 1, maxLength: max });
export const id = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
export const date = { ...str(40), format: 'date-time' };
export const integer = (min = 0, max = 1000000000) => ({ type: 'integer', minimum: min, maximum: max });
export const number = (min = 0, max = 1) => ({ type: 'number', minimum: min, maximum: max });
export const bool = { type: 'boolean' };
export const en = (...values) => ({ type: 'string', enum: values });
export const arr = (items, min = 0, max = 200) => ({ type: 'array', items, minItems: min, maxItems: max });
export const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

export const EVIDENCE_SCHEMA = obj({
  uri: { ...str(1000), pattern: '^(https://[^\\s]+|evidence://[A-Za-z0-9._:/-]+)$' },
  sha256: { ...str(64), pattern: '^[a-f0-9]{64}$' },
  source: en('synthetic', 'manufacturer', 'site', 'customer', 'invoice', 'technician'),
  observedAt: date,
  summary: str(1200),
});
export const INSTALLATION_REQUIREMENTS_SCHEMA = obj({ powerType: en('mains', 'low-voltage', 'battery', 'passive'), requiresNeutralWire: bool, ratedWatts: integer(0, 100000), voltageMin: integer(0, 1000), voltageMax: integer(0, 1000), requiresInternet: bool, requiresWiredBackhaul: bool });
export const BOM_SCHEMA = arr(obj({ skuId: id, roomId: id, quantity: integer(1, 1000), circuitId: id }, ['skuId', 'roomId', 'quantity']), 1, 200);
export const SCENE_SCHEMA = arr(obj({ id, roomId: id, name: str(200), trigger: str(1000), behavior: str(1500), skuIds: arr(id, 1, 30) }), 1, 100);
export const WORK_REFERENCE_TYPES = Object.freeze(['store', 'sku', 'compatibility', 'lead', 'experience', 'survey', 'solution', 'quote', 'project', 'procurement', 'commissioning', 'acceptance', 'aftercare', 'content', 'goal', 'report']);
export const WORK_REFERENCE_SCHEMA = obj({ type: en(...WORK_REFERENCE_TYPES), id });
export const WORK_REFERENCES_SCHEMA = { ...arr(WORK_REFERENCE_SCHEMA, 1, 30), uniqueItems: true };
export const WORK_EVIDENCE_REFERENCE_SCHEMA = obj({ type: en(...WORK_REFERENCE_TYPES), id, version: integer(1) });

const operations = [];
function op(name, title, properties = {}, required = Object.keys(properties), { readOnly = false, risk = 'auto', roles = ['owner', 'operator', 'agent'], description = '' } = {}) {
  const input = { ...properties };
  const keys = [...required];
  if (!readOnly) { input.idempotencyKey = id; keys.push('idempotencyKey'); }
  operations.push({ name, operation: name, title, description: description || title, readOnly, risk, roles: readOnly ? [...roles, 'viewer'] : roles, schema: obj(input, keys), inputSchema: obj(input, keys) });
}

op('status', '运行状态', {}, [], { readOnly: true });
op('catalog', '操作与工作流目录', {}, [], { readOnly: true });
op('entity.list', '当前工作区业务对象', { type: id, limit: integer(1, 500), offset: integer(0, 1000000) }, ['type'], { readOnly: true });
op('entity.get', '业务对象详情', { type: id, id }, ['type', 'id'], { readOnly: true });
op('state.snapshot', '门店经营快照', { limit: integer(1, 500) }, [], { readOnly: true });
op('ledger.verify', '验证当前租户事件链', {}, [], { readOnly: true });
op('ledger.list', '读取当前租户经营事件', { limit: integer(1, 500), after: integer(0, 1000000000) }, [], { readOnly: true });
op('approval.list', '人工审批待办', { status: en('pending', 'approved', 'rejected', 'expired'), limit: integer(1, 500) }, [], { readOnly: true });
op('task.list', '宿主模型任务列表', { workflowId: id, status: en('ready', 'leased', 'completed', 'failed', 'cancelled'), limit: integer(1, 500) }, [], { readOnly: true });
op('workflow.get', '工作流执行进度', { workflowId: id }, ['workflowId'], { readOnly: true });
op('goal.report', '董事长目标证据汇报', { goalId: id }, ['goalId'], { readOnly: true });

op('store.upsert', '配置全屋智能门店', { id, name: str(200), city: str(120), serviceAreas: arr(str(120), 1, 100), minMarginRatio: number(0, 0.9), maxDiscountRatio: number(0, 0.9), expectedVersion: integer(1) }, ['id', 'name', 'city', 'serviceAreas', 'minMarginRatio', 'maxDiscountRatio']);
op('sku.upsert', '登记设备SKU及版本证据', { id, manufacturer: str(200), model: str(200), category: en('gateway', 'lighting', 'switch', 'sensor', 'curtain', 'climate', 'audio', 'door-lock', 'camera', 'electrical', 'fire-safety'), protocol: str(100), firmwareVersion: str(100), costCents: integer(), priceCents: integer(), evidence: EVIDENCE_SCHEMA, installationRequirements: INSTALLATION_REQUIREMENTS_SCHEMA, active: bool, expectedVersion: integer(1) }, ['id', 'manufacturer', 'model', 'category', 'protocol', 'firmwareVersion', 'costCents', 'priceCents', 'evidence']);
op('compatibility.record', '登记精确SKU版本的兼容依据', { id, leftSkuId: id, rightSkuId: id, result: en('compatible', 'incompatible'), conditions: str(1500), evidence: EVIDENCE_SCHEMA, expiresAt: date }, ['id', 'leftSkuId', 'rightSkuId', 'result', 'conditions', 'evidence', 'expiresAt']);
op('lead.create', '登记线索与渠道归因', { id, storeId: id, alias: str(120), contactRef: id, channel: en('douyin', 'xiaohongshu', 'wechat-video', 'wechat-private', 'baidu', 'geo', 'walk-in', 'referral', 'designer', 'property', 'decoration-partner'), campaignRef: id, intent: str(1500), budgetCents: integer(), renovationStage: en('new-build', 'design', 'rough-in', 'decorating', 'finished', 'occupied', 'retrofit'), consent: obj({ status: en('unknown', 'granted', 'denied'), purposes: arr(en('consultation', 'appointment', 'marketing', 'aftercare'), 0, 4), evidence: EVIDENCE_SCHEMA }, ['status', 'purposes']) }, ['id', 'storeId', 'alias', 'contactRef', 'channel', 'intent', 'consent']);
op('lead.authorize', '登记客户用途授权或撤回', { leadId: id, status: en('granted', 'denied'), purposes: arr(en('consultation', 'appointment', 'marketing', 'aftercare'), 0, 4), evidence: EVIDENCE_SCHEMA }, ['leadId', 'status', 'purposes', 'evidence']);
op('experience.schedule', '安排本地体验计划', { id, leadId: id, startsAt: date, durationMinutes: integer(15, 240), scenes: arr(str(300), 1, 20), status: en('proposed', 'customer-confirmed'), confirmationEvidence: EVIDENCE_SCHEMA }, ['id', 'leadId', 'startsAt', 'durationMinutes', 'scenes']);
op('survey.record', '登记有证据的现场勘测', { id, leadId: id, renovationStage: en('new-build', 'design', 'rough-in', 'decorating', 'finished', 'occupied', 'retrofit'), rooms: arr(obj({ id, name: str(120), areaSqm: number(1, 2000), circuits: arr(obj({ id, neutralWire: bool, voltage: integer(1, 1000), maxLoadWatts: integer(1, 100000) }), 0, 50) }), 1, 100), network: obj({ internetAvailable: bool, wiredBackhaul: bool, coverageNotes: str(2000), vlanRequirement: bool }), hazards: arr(str(500), 0, 50), evidence: EVIDENCE_SCHEMA }, ['id', 'leadId', 'renovationStage', 'rooms', 'network', 'hazards', 'evidence'], { risk: 'review', roles: ['owner', 'operator'] });
op('solution.build', '校验方案、场景与BOM', { id, surveyId: id, name: str(200), bom: BOM_SCHEMA, scenes: SCENE_SCHEMA, compatibilityIds: arr(id, 0, 500), exclusions: arr(str(500), 0, 50) }, ['id', 'surveyId', 'name', 'bom', 'scenes', 'compatibilityIds']);
op('quote.create', '计算报价、成本、毛利与折扣', { id, solutionId: id, laborCostCents: integer(), laborPriceCents: integer(), discountCents: integer(), validUntil: date, terms: str(2500) }, ['id', 'solutionId', 'laborCostCents', 'laborPriceCents', 'discountCents', 'validUntil', 'terms']);
op('quote.request_approval', '请求人类批准报价承诺', { quoteId: id, expiresAt: date, reason: str(1500) }, ['quoteId', 'expiresAt', 'reason'], { risk: 'review' });
op('approval.decide', '人类审批决断', { approvalId: id, decision: en('approved', 'rejected'), reason: str(1500), contentDigest: { ...str(64), pattern: '^[a-f0-9]{64}$' } }, ['approvalId', 'decision', 'reason', 'contentDigest'], { risk: 'review', roles: ['owner'] });
op('project.create', '批准报价后建立交付项目', { id, quoteId: id, contractEvidence: EVIDENCE_SCHEMA, dueAt: date }, ['id', 'quoteId', 'contractEvidence', 'dueAt'], { risk: 'review', roles: ['owner', 'operator'] });
op('procurement.record', '记录采购到货证据', { id, projectId: id, items: arr(obj({ skuId: id, quantity: integer(1, 1000), serialRefs: arr(id, 0, 1000) }), 1, 200), evidence: EVIDENCE_SCHEMA }, ['id', 'projectId', 'items', 'evidence'], { risk: 'review', roles: ['owner', 'operator'] });
op('project.milestone', '登记安装现场里程碑证据', { projectId: id, milestone: en('installation'), evidence: EVIDENCE_SCHEMA, professionalRef: id, safetyChecklist: obj({ powerIsolated: bool, manufacturerInstructionsFollowed: bool, networkConfigured: bool, customerPrivacyProtected: bool }) }, ['projectId', 'milestone', 'evidence', 'professionalRef', 'safetyChecklist'], { risk: 'review', roles: ['owner', 'operator'] });
op('commissioning.record', '记录场景调试测试', { id, projectId: id, results: arr(obj({ sceneId: id, passed: bool, observation: str(1500) }), 1, 100), evidence: EVIDENCE_SCHEMA }, ['id', 'projectId', 'results', 'evidence'], { risk: 'review', roles: ['owner', 'operator'] });
op('acceptance.record', '记录客户验收与未闭问题', { id, projectId: id, customerAccepted: bool, trainingDelivered: bool, credentialsTransferred: bool, outstandingIssues: arr(str(1000), 0, 100), evidence: EVIDENCE_SCHEMA }, ['id', 'projectId', 'customerAccepted', 'trainingDelivered', 'credentialsTransferred', 'outstandingIssues', 'evidence'], { risk: 'review', roles: ['owner', 'operator'] });
op('aftercare.open', '建立售后工单与SLA', { id, projectId: id, category: en('offline', 'scene-failure', 'network', 'device-failure', 'training', 'safety', 'privacy'), severity: en('critical', 'high', 'normal', 'low'), description: str(2500), dueAt: date }, ['id', 'projectId', 'category', 'severity', 'description', 'dueAt']);
op('aftercare.resolve', '记录售后现场服务与回访凭据', { ticketId: id, resolution: str(2500), evidence: EVIDENCE_SCHEMA, customerConfirmed: bool, followupAt: date }, ['ticketId', 'resolution', 'evidence', 'customerConfirmed', 'followupAt'], { risk: 'review', roles: ['owner', 'operator'] });
op('content.create', '创建事实有依据的内容草稿', { id, storeId: id, channel: en('douyin', 'xiaohongshu', 'wechat-video', 'wechat-private', 'baidu', 'geo'), title: str(200), body: str(12000), claims: arr(obj({ text: str(1000), evidence: EVIDENCE_SCHEMA }), 0, 100), skuIds: arr(id, 0, 100), piiFree: bool }, ['id', 'storeId', 'channel', 'title', 'body', 'claims', 'skuIds', 'piiFree']);
op('content.request_publication', '请求外发审批（连接器尚未启用）', { contentId: id, expiresAt: date, reason: str(1500) }, ['contentId', 'expiresAt', 'reason'], { risk: 'review' });
op('content.publish', '外部发布连接器未启用', { contentId: id, approvalId: id }, ['contentId', 'approvalId'], { risk: 'block' });
op('goal.create', '董事长设定可计量经营目标', { id, storeId: id, title: str(300), metric: en('qualified-leads', 'experience-plans', 'accepted-projects', 'resolved-aftercare', 'management-reports'), target: integer(1, 1000000), deadline: date, constraints: arr(str(1000), 0, 100) }, ['id', 'storeId', 'title', 'metric', 'target', 'deadline', 'constraints']);
op('goal.instruct', '董事长调整目标或暂停执行', { goalId: id, instruction: str(2500), action: en('continue', 'pause', 'resume'), target: integer(1, 1000000) }, ['goalId', 'instruction', 'action'], { risk: 'review', roles: ['owner'] });
op('workflow.start', '启动宿主模型业务工作流', { id: { ...id, maxLength: 64 }, kind: en('growth-acquisition', 'project-delivery', 'aftercare-loop', 'management-loop', 'employee-work'), goalId: id, leadId: id, surveyId: id, ticketId: id, employeeId: id, skillId: id, brief: str(5000), objectRefs: WORK_REFERENCES_SCHEMA, maxAttempts: integer(1, 5) }, ['id', 'kind', 'goalId']);
op('workflow.tick', '调度、恢复过期租约并推进依赖', { workflowId: id }, [], { description: 'Only deterministic local transitions; never calls an external model or connector.' });
op('task.claim', '宿主工作台领取模型任务', { taskId: id, workflowId: id, leaseSeconds: integer(30, 3600) }, []);
op('task.submit', '提交结构化模型产物并执行本地校验', { taskId: id, leaseToken: str(100), artifact: { type: 'object' }, modelTrace: obj({ host: en('codex', 'qwen-workbench', 'workbuddy', 'other', 'test'), model: str(150), invocationRef: id }) }, ['taskId', 'leaseToken', 'artifact', 'modelTrace']);
op('task.fail', '记录模型任务失败与有限重试', { taskId: id, leaseToken: str(100), error: str(1500), retryable: bool }, ['taskId', 'leaseToken', 'error', 'retryable']);

const bindings = {
  'store.upsert': ['R-SH1', 'R-SH14'], 'sku.upsert': ['R-SH6'], 'compatibility.record': ['R-SH6'],
  'lead.create': ['R-SH1', 'R-SH2'], 'lead.authorize': ['R-SH2'], 'experience.schedule': ['R-SH2', 'R-SH4'],
  'survey.record': ['R-SH8'], 'solution.build': ['R-SH6', 'R-SH8'], 'quote.create': ['R-SH10'],
  'quote.request_approval': ['R-SH7', 'R-SH10'], 'approval.decide': ['R-SH3', 'R-SH7', 'R-SH10'],
  'project.create': ['R-SH7', 'R-SH8'], 'procurement.record': ['R-SH11'], 'project.milestone': ['R-SH8', 'R-SH9', 'R-SH11'],
  'commissioning.record': ['R-SH8', 'R-SH11'], 'acceptance.record': ['R-SH8', 'R-SH12'],
  'aftercare.open': ['R-SH13'], 'aftercare.resolve': ['R-SH12', 'R-SH13'],
  'content.create': ['R-SH1', 'R-SH5'], 'content.request_publication': ['R-SH3', 'R-SH15'], 'content.publish': ['R-SH3', 'R-SH15'],
  'goal.create': ['R-SH1'], 'goal.instruct': ['R-SH14'], 'workflow.start': ['R-SH1'], 'workflow.tick': ['R-SH1'],
  'task.claim': ['R-SH1'], 'task.submit': ['R-SH1'], 'task.fail': ['R-SH1'],
};
for (const operation of operations) operation.fenceIds = bindings[operation.name] ?? [];
export const OPERATION_CATALOGUE = Object.freeze(operations);
export const OPERATION_BY_NAME = new Map(operations.map(operation => [operation.name, operation]));
export const ENTITY_TYPES = Object.freeze(['store', 'sku', 'compatibility', 'lead', 'experience', 'survey', 'solution', 'quote', 'approval', 'project', 'procurement', 'commissioning', 'acceptance', 'aftercare', 'content', 'goal', 'workflow', 'task', 'report']);
