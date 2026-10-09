import { str, id, date, integer, number, bool, en, arr, obj, EVIDENCE_SCHEMA } from './schema.mjs';

export const LEAD_SOURCE_SCHEMA = en('customer', 'operator', 'site', 'document', 'model-proposal', 'synthetic-history');
export const LEAD_FIELDS = Object.freeze({
  alias: str(120), surname: str(40), contactRef: id, phoneRef: id, wechatRef: id, buildingRef: id, buildingName: str(200),
  channel: en('unknown', 'douyin', 'xiaohongshu', 'wechat-video', 'wechat-private', 'baidu', 'geo', 'walk-in', 'referral', 'designer', 'property', 'decoration-partner'),
  campaignRef: id, intent: str(1500), budgetCents: integer(),
  renovationStage: en('new-build', 'design', 'rough-in', 'decorating', 'finished', 'occupied', 'retrofit'),
  serviceArea: str(120), householdSize: integer(1, 20), preferredContactWindow: str(300), needs: arr(str(500), 1, 30),
});
export const LEAD_PATCH_SCHEMA = obj(LEAD_FIELDS, []);
export const DEPTH_ENTITY_TYPES = Object.freeze(['leadEnrichment', 'customer', 'pointPlan', 'design', 'construction', 'contract', 'business', 'scenario']);
export const INDUSTRY_SECTIONS = Object.freeze(['storeProfile', 'productReference', 'experienceGuide', 'channelGuide', 'officialReferences', 'syntheticDisclosure']);
export const MILESTONE_SCHEMA = arr(obj({ phase: en('procurement', 'installation', 'commissioning', 'acceptance'), ownerRole: id, dueAt: date, requiredEvidence: arr(str(500), 1, 20) }), 4, 4);

const operations = [];
const op = (name, title, properties, required = Object.keys(properties), options = {}) => {
  const { readOnly = false, risk = 'auto', roles = ['owner', 'operator', 'agent'], fenceIds = ['R-SH1'], description = title } = options;
  const fields = { ...properties, ...(!readOnly ? { idempotencyKey: id } : {}) };
  const schema = obj(fields, [...required, ...(!readOnly ? ['idempotencyKey'] : [])]);
  operations.push({ name, operation: name, title, description, schema, inputSchema: schema, readOnly, risk, roles: readOnly ? [...roles, 'viewer'] : roles, fenceIds });
};
op('industry.context', '读取封印的行业背景与官方参考', { section: en(...INDUSTRY_SECTIONS) }, [], { readOnly: true });
op('scenario.list', '可导入的合成经营场景', {}, [], { readOnly: true });
op('scenario.import', '导入明确标识的成都门店合成历史', { datasetId: en('shuguang-chengdu-v1'), anchorDate: date }, ['datasetId'], { roles: ['owner', 'operator'], risk: 'review', fenceIds: ['R-SH1', 'R-SH2', 'R-SH6', 'R-SH7', 'R-SH8', 'R-SH10', 'R-SH11', 'R-SH12', 'R-SH13'], description: 'Sandbox-only atomic synthetic history import. No model task completion, human review, customer contact, money movement or device operation is performed.' });
op('lead.enrich', '带来源与版本的渐进线索补充', { leadId: id, expectedVersion: integer(1), patch: LEAD_PATCH_SCHEMA, source: LEAD_SOURCE_SCHEMA, evidence: EVIDENCE_SCHEMA }, undefined, { fenceIds: ['R-SH1', 'R-SH2'], description: 'Model proposals persist a draft only. Applying customer facts requires human confirmation; consent is recorded separately.' });
op('customer.upsert', '维护关联线索的客户档案', {
  id, leadId: id, expectedVersion: integer(1),
  household: obj({ buildingRef: id, propertyType: en('apartment', 'villa', 'townhouse', 'retrofit'), areaSqm: number(1, 2000), rooms: integer(1, 30), occupants: integer(1, 20), accessibilityNeeds: arr(str(500), 0, 20) }, ['propertyType', 'areaSqm', 'rooms', 'occupants', 'accessibilityNeeds']),
  preferences: obj({ priorities: arr(str(500), 1, 30), preferredEcosystems: arr(str(200), 0, 10), sceneWishes: arr(str(1000), 1, 50), exclusions: arr(str(1000), 0, 30) }),
  decisionProcess: obj({ decisionRoles: arr(str(200), 1, 10), budgetOwnerRef: id, targetMoveInAt: date, undecidedTopics: arr(str(500), 0, 20) }, ['decisionRoles', 'undecidedTopics']),
  communication: obj({ contactPreference: str(300), cadence: str(300), lastConfirmedAt: date }),
  source: LEAD_SOURCE_SCHEMA, evidence: EVIDENCE_SCHEMA,
}, ['id', 'leadId', 'household', 'preferences', 'decisionProcess', 'communication', 'source', 'evidence'], { roles: ['owner', 'operator'], risk: 'review', fenceIds: ['R-SH2', 'R-SH8'] });
op('pointPlan.record', '保存可绘制的空间点位版本', {
  id, customerId: id, surveyId: id, revision: integer(1, 1000), previousRevisionId: id,
  rooms: arr(obj({ roomId: id, widthMm: integer(100, 100000), lengthMm: integer(100, 100000) }), 1, 100),
  points: arr(obj({ id, roomId: id, xMm: integer(0, 100000), yMm: integer(0, 100000), mountHeightMm: integer(0, 10000), kind: en('gateway', 'switch', 'lighting', 'sensor', 'curtain', 'network', 'outlet', 'controller'), skuId: id, circuitId: id, purpose: str(1000), cableRoute: str(1500), installNotes: str(1500) }, ['id', 'roomId', 'xMm', 'yMm', 'mountHeightMm', 'kind', 'purpose', 'cableRoute', 'installNotes']), 1, 500),
  evidence: EVIDENCE_SCHEMA,
}, ['id', 'customerId', 'surveyId', 'revision', 'rooms', 'points', 'evidence'], { fenceIds: ['R-SH6', 'R-SH8'] });
op('design.record', '保存关联方案与点位的设计修订', { id, customerId: id, solutionId: id, pointPlanId: id, revision: integer(1, 1000), previousRevisionId: id, rationale: str(5000), sceneNotes: arr(obj({ sceneId: id, userValue: str(1000), fallback: str(1000), testMethod: str(1000) }), 1, 100), exclusions: arr(str(1000), 0, 50), evidence: EVIDENCE_SCHEMA }, ['id', 'customerId', 'solutionId', 'pointPlanId', 'revision', 'rationale', 'sceneNotes', 'exclusions', 'evidence'], { fenceIds: ['R-SH6', 'R-SH8'] });
op('construction.record', '保存施工计划与验收检查版本', { id, designId: id, revision: integer(1, 1000), previousRevisionId: id, milestones: MILESTONE_SCHEMA, materials: arr(obj({ skuId: id, quantity: integer(1, 1000), receivingCheck: str(1500) }), 1, 200), qualityChecks: arr(obj({ checkpoint: str(1000), responsibleRole: id, evidenceRequired: str(1500), acceptanceRule: str(1500) }), 1, 100), risks: arr(str(1500), 0, 50), evidence: EVIDENCE_SCHEMA }, ['id', 'designId', 'revision', 'milestones', 'materials', 'qualityChecks', 'risks', 'evidence'], { fenceIds: ['R-SH8', 'R-SH9', 'R-SH11'] });
op('contract.create', '编制准确关联报价与设计的合同草案', { id, customerId: id, quoteId: id, designId: id, constructionId: id, numberRef: id, scope: arr(str(1500), 1, 100), paymentSchedule: arr(obj({ label: str(200), amountCents: integer(), dueRule: str(1000) }), 1, 10), warrantyTerms: str(5000), changeTerms: str(5000), exclusions: arr(str(1000), 0, 50) }, undefined, { fenceIds: ['R-SH7', 'R-SH10'] });
op('contract.request_approval', '请求合同内容的独立人类批准', { contractId: id, expiresAt: date, reason: str(1500) }, undefined, { risk: 'review', fenceIds: ['R-SH7', 'R-SH10'] });
op('contract.record_signing', '记录客户签约证据', { contractId: id, evidence: EVIDENCE_SCHEMA }, undefined, { roles: ['owner', 'operator'], risk: 'review', fenceIds: ['R-SH7', 'R-SH8'] });
op('business.record', '登记经营观察与合成历史对账项', { id, storeId: id, kind: en('channel-cost-observation', 'receivable-schedule', 'payment-observation', 'operating-expense-observation', 'inventory-observation', 'staff-capacity', 'customer-followup', 'issue-log'), occurredAt: date, summary: str(4000), amountCents: integer(), quantity: integer(), objectRefs: arr(obj({ type: id, id }), 0, 30), evidence: EVIDENCE_SCHEMA }, ['id', 'storeId', 'kind', 'occurredAt', 'summary', 'objectRefs', 'evidence'], { roles: ['owner', 'operator'], risk: 'review', fenceIds: ['R-SH2', 'R-SH10', 'R-SH11', 'R-SH13'] });
export const DEPTH_OPERATIONS = Object.freeze(operations);
