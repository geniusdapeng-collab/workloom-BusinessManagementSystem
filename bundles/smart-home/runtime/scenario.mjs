import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BusinessError, assert, digest, clone, validate, rejectSecretsAndPII } from './errors.mjs';
import { OPERATION_BY_NAME, ENTITY_TYPES } from './catalogue.mjs';
import { WORKFORCE, employeeSkill } from './workforce.mjs';

export const SCENARIO_DATASET_ID = 'shuguang-chengdu-v1';
export const SCENARIO_DATASET_VERSION = '1.0.0';
const fixtureDigest = (() => {
  const sources = ['assets.mjs', 'catalogue.mjs', 'depth-catalogue.mjs', 'depth-domain.mjs', 'domain.mjs', 'errors.mjs', 'index.mjs', 'scenario.mjs', 'schema.mjs', 'storage.mjs', 'workflows.mjs', 'workforce.mjs'];
  try {
    return digest({ runtimeSources: Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(new URL(`./${path}`, import.meta.url))).digest('hex')])), workforce: WORKFORCE, procedures: WORKFORCE.flatMap(role => role.skills.map(skillId => employeeSkill(role.id, skillId).bodyDigest)) });
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('SCENARIO_ASSET_UNAVAILABLE', 'Installed scenario implementation inputs cannot be read', 500, { cause: error.code ?? error.name });
  }
})();
const storeId = 'SG-CD-GX-STORE';
const ids = suffix => `SG-${suffix}`;
const historicalDisclosure = '全部门店、客户、价格、施工与经营历史均为合成演练；不代表真实客户、华为/Aqara授权、兼容结论、签约、人审、收付款或现场施工。';
const namespace = value => value.startsWith('SG-') || value.startsWith('SYN-SG-');

export function listSyntheticScenarios() {
  return [{ datasetId: SCENARIO_DATASET_ID, version: SCENARIO_DATASET_VERSION, title: '蜀光智家 · 成都高新体验店', storeId, fixtureDigest, dataMode: 'sandbox', importMode: 'atomic-scope-isolated', covers: ['极简线索与逐步来源补全', '客户档案', '有尺寸坐标的房间点位', '设计与施工修订', '报价与合同独立审批', '采购安装调试验收合成历史', '售后与运营观察', '每个已安装技能的真实可领取准备任务'], disclosure: historicalDisclosure, humanReviewPerformed: false, modelTaskCompletionsImported: 0, actualCashMovement: false }];
}

const customerProfiles = [
  { no: '06', alias: '陈先生', buildingRef: 'SYN-CD-GX-QINGXI', buildingName: '清溪雅庭（虚构）', stage: 'design', area: 118, occupants: 3, budget: 4200000, priorities: ['保留墙面简洁', '孩子睡眠不被误触发打扰', '能用普通按键控制'], wishes: ['回家玄关柔和亮灯', '观影一键关闭主灯保留灯带', '儿童夜起低亮路径'], undecided: ['面板颜色由夫妻共同确认', '主卧传感区需现场试装'] },
  { no: '07', alias: '赵女士', buildingRef: 'SYN-CD-GX-XINGHE', buildingName: '星河云邸（虚构）', stage: 'rough-in', area: 142, occupants: 4, budget: 5800000, priorities: ['老人也能直接操作', '卧室手动优先', '施工与精装交叉作业可核对'], wishes: ['入户灯与窗帘分时打开', '餐厅聚餐暖色灯光', '老人夜间起床自动低亮'], undecided: ['客餐厅第二版窗帘点位', '书房桌面布局正在变化'] },
  { no: '08', alias: '孙先生', buildingRef: 'SYN-CD-GX-YUNSHU', buildingName: '云墅里（虚构）', stage: 'decorating', area: 96, occupants: 2, budget: 3100000, priorities: ['预算范围透明', '先完成高频空间', '不安装摄像头和门锁'], wishes: ['上班离家灯光关闭', '周末书房专注灯', '客厅窗帘不依赖手机'], undecided: ['报价需本人复核', '窗帘盒需装饰公司测量'] },
  { no: '09', alias: '郭女士', buildingRef: 'SYN-CD-GX-JINCHENG', buildingName: '锦城悦府（虚构）', stage: 'rough-in', area: 126, occupants: 3, budget: 4700000, priorities: ['到货型号逐件可追溯', '家装进场预约明确', '账号交给客户本人'], wishes: ['迎宾灯光渐亮', '卧室晚安灯光与窗帘', '离家保留机械按键回退'], undecided: ['剩余灯具合成到货记录待补', '人类进场许可待安排'] },
  { no: '10', alias: '何先生', buildingRef: 'SYN-CD-GX-SHUFENG', buildingName: '蜀风华庭（虚构）', stage: 'finished', area: 108, occupants: 2, budget: 3900000, priorities: ['少拆墙', '断网保留手动', '访客不需账户'], wishes: ['玄关存在亮灯', '阅读灯按键调亮', '电影场景保留走道微光'], undecided: ['书房调试存在一项合成失败', '重复触发延迟需回归'] },
  { no: '11', alias: '唐女士', buildingRef: 'SYN-CD-GX-NANXI', buildingName: '南溪花园（虚构）', stage: 'occupied', area: 132, occupants: 5, budget: 5300000, priorities: ['老人孩子会用', '售后记录有对应场景', '隐私数据留在客户侧'], wishes: ['客厅回家与观影模式', '老人夜起照明', '窗帘定时可手动覆盖'], undecided: ['当前有一张离线售后合成工单', '培训复访排期未确认'] },
  { no: '12', alias: '邓先生', buildingRef: 'SYN-CD-GX-ZHUYING', buildingName: '竹影书院（虚构）', stage: 'retrofit', area: 89, occupants: 3, budget: 3400000, priorities: ['电路条件有证据才施工', '只做灯光窗帘', '分期费用规则清楚'], wishes: ['玄关和客厅分开控制', '窗帘保留手动拉动方案', '书房停止自动化也可读书'], undecided: ['合同需要逐条人工审核', '翻新墙面收口责任边界'] },
];
const skuDefinitions = [
  ['GW', '合成演练网关', 'gateway', 39000, 75000, 'low-voltage', 8],
  ['SW', '合成零线场景开关', 'switch', 6500, 13800, 'mains', 5],
  ['SE', '合成存在传感器', 'sensor', 4900, 9800, 'battery', 0],
  ['CU', '合成窗帘电机', 'curtain', 15000, 28800, 'mains', 120],
  ['LI', '合成可调光灯具', 'lighting', 9800, 19800, 'mains', 30],
  ['CT', '合成桌面场景控制器', 'switch', 12000, 22800, 'low-voltage', 4],
];
const skuId = short => `SYN-SG-${short}-01`;
const rooms = [
  { id: 'living', name: '客餐厅', areaSqm: 32, widthMm: 6200, lengthMm: 5200 },
  { id: 'master', name: '主卧', areaSqm: 19, widthMm: 4500, lengthMm: 4200 },
  { id: 'study', name: '书房', areaSqm: 12, widthMm: 3500, lengthMm: 3400 },
  { id: 'entry', name: '玄关走道', areaSqm: 7, widthMm: 2200, lengthMm: 3200 },
];
function bomForHome() {
  return [['living', 'GW', 1], ['living', 'LI', 4], ['living', 'SE', 1], ['living', 'CU', 2], ['living', 'SW', 2], ['master', 'LI', 2], ['master', 'SW', 1], ['master', 'SE', 1], ['master', 'CU', 1], ['study', 'LI', 1], ['study', 'SW', 1], ['study', 'CT', 1], ['entry', 'SE', 1], ['entry', 'LI', 1], ['entry', 'SW', 1]].map(([roomId, short, quantity]) => ({ roomId, skuId: skuId(short), quantity, ...(['LI', 'SW', 'CU'].includes(short) ? { circuitId: `${roomId}-lighting` } : {}) }));
}
function scenesForHome() {
  return [
    ['arrival', 'living', '回家迎宾', '仅合成测试按钮或存在条件', '客餐厅灯光渐亮，保持物理按键可用', ['GW', 'LI', 'SE']],
    ['cinema', 'living', '观影灯光', '客厅场景按键', '主灯调暗，走道保留低亮，不控制任何门锁', ['GW', 'LI', 'SW']],
    ['curtain', 'living', '窗帘晨起', '客户拟定时间或手动开关', '合成窗帘缓开，可随时手动停止', ['GW', 'CU', 'SW']],
    ['night', 'master', '夜起低亮', '主卧存在条件与夜间时间窗', '主卧低亮引导，避免照射床头，人工试装后再确认', ['LI', 'SE', 'SW']],
    ['focus', 'study', '专注阅读', '桌面场景控制器', '书房灯具稳定亮度，保留开关手动覆盖', ['CT', 'LI', 'SW']],
    ['entry', 'entry', '玄关通行', '玄关合成传感条件', '玄关柔和亮灯，误触发时可关闭自动化', ['SE', 'LI', 'SW']],
  ].map(([id, roomId, name, trigger, behavior, shorts]) => ({ id, roomId, name, trigger, behavior, skuIds: shorts.map(skuId) }));
}

export function assertInstalledScenarioRevision(storage, datasetId) {
  const previous = storage.get('scenario', datasetId, false);
  if (previous) assert(previous.fixtureDigest === fixtureDigest, 'SCENARIO_VERSION_CONFLICT', 'This workspace already imported a different scenario revision; retain it and choose a fresh sandbox workspace', 409);
  return previous;
}

export function importSyntheticScenario(domain, workflows, input, actor) {
  const s = domain.s;
  assert(s.dataMode === 'sandbox', 'SCENARIO_IN_LIVE_BLOCKED', 'Synthetic history must never be imported into a live workspace', 403);
  assert(input.datasetId === SCENARIO_DATASET_ID, 'UNKNOWN_SCENARIO', 'Unknown installed synthetic scenario');
  const previous = assertInstalledScenarioRevision(s, input.datasetId);
  if (previous) {
    for (const reference of previous.objectReferences) {
      const record = s.get(reference.type, reference.id, false);
      assert(record?.provenance?.datasetId === input.datasetId, 'SCENARIO_RECOVERY_INCOMPLETE', 'An imported object is missing or no longer carries this scenario provenance', 409, reference);
    }
    return { ...clone(previous.summary), imported: false, recovered: true, overwrittenObjects: 0 };
  }
  const currentTime = domain.now(), now = Date.parse(currentTime), anchorDate = input.anchorDate ?? currentTime, anchor = Date.parse(anchorDate);
  assert(anchor <= now && now - anchor <= 86400000, 'INVALID_SCENARIO_ANCHOR', 'A new import anchor must be no more than one day old and cannot be in the future');
  for (const type of ENTITY_TYPES) assert(!s.all(type).some(record => namespace(record.id)), 'SCENARIO_OBJECT_COLLISION', 'Scenario object IDs collide with existing records; no existing business object is overwritten', 409, { type });
  const date = days => new Date(anchor + days * 86400000).toISOString();
  const evidence = (label, days = -1) => ({ uri: `evidence://synthetic/shuguang-chengdu-v1/${label}`, sha256: digest({ datasetId: input.datasetId, label, anchorDate }), source: 'synthetic', observedAt: date(days), summary: `合成历史资料：${label}。${historicalDisclosure}` });
  const operationTrail = [];
  const provenance = { datasetId: input.datasetId, version: SCENARIO_DATASET_VERSION, fixtureDigest, anchorDate, importedAt: domain.now(), importBasis: 'explicit-sandbox-opt-in', disclosure: historicalDisclosure, modelInvocationPerformed: false, humanReviewPerformed: false, externalExecutionPerformed: false };
  const fixtureActor = { ...actor, role: 'owner', humanConfirmed: false };
  const run = (operation, payload) => {
    const specification = OPERATION_BY_NAME.get(operation);
    assert(specification && !specification.readOnly && specification.risk !== 'block' && !operation.startsWith('task.'), 'SCENARIO_OPERATION_FORBIDDEN', 'Scenario history cannot complete model tasks or run external connectors', 500, { operation });
    const request = { ...payload, idempotencyKey: `fixture:${operationTrail.length + 1}` };
    rejectSecretsAndPII(request); validate(specification.schema, request);
    s.importContext = { ...provenance, sourceOperation: operation, sourceSequence: operationTrail.length + 1 };
    let result = workflows.execute(operation, request, fixtureActor);
    if (result === undefined) result = domain.execute(operation, request, fixtureActor);
    assert(result !== undefined, 'SCENARIO_OPERATION_UNHANDLED', 'A synthetic fixture operation has no native implementation', 500, { operation });
    operationTrail.push({ operation, resultDigest: digest(result), recordId: result.id ?? null });
    return result;
  };
  domain.syntheticHistory = provenance;
  s.importContext = provenance;
  try {
    run('store.upsert', { id: storeId, name: '蜀光智家 · 成都高新体验店（合成演练）', city: '成都', serviceAreas: ['成都高新区（合成服务范围）', '天府新区（合成服务范围）', '武侯区（合成服务范围）'], minMarginRatio: 0.28, maxDiscountRatio: 0.08 });
    for (const [short, model, category, costCents, priceCents, powerType, ratedWatts] of skuDefinitions) run('sku.upsert', { id: skuId(short), manufacturer: '蜀光合成实验室（虚构，非华为/Aqara）', model: `${model} SG-${short}-LAB（不可购买）`, category, protocol: 'synthetic-shuguang-test-bus', firmwareVersion: 'synthetic-1.0', costCents, priceCents, installationRequirements: { powerType, requiresNeutralWire: powerType === 'mains', ratedWatts, voltageMin: powerType === 'mains' ? 200 : 0, voltageMax: powerType === 'mains' ? 240 : 48, requiresInternet: short === 'GW', requiresWiredBackhaul: short === 'GW' }, evidence: evidence(`sku-${short}`, -25) });
    const compatibilityIds = [];
    for (let left = 0; left < skuDefinitions.length; left++) for (let right = left + 1; right < skuDefinitions.length; right++) {
      const id = ids(`PAIR-${skuDefinitions[left][0]}-${skuDefinitions[right][0]}`); compatibilityIds.push(id);
      run('compatibility.record', { id, leftSkuId: skuId(skuDefinitions[left][0]), rightSkuId: skuId(skuDefinitions[right][0]), result: 'compatible', conditions: '仅该合成总线与合成固件的演练组合；不证明任何真实品牌/协议/设备互通。', evidence: evidence(`pair-${left}-${right}`, -20), expiresAt: date(30) });
    }
    run('lead.create', { id: ids('L01'), storeId, surname: '李', source: 'synthetic-history' });
    run('lead.create', { id: ids('L02'), storeId, wechatRef: 'SYN-WX-CD-002', source: 'synthetic-history' });
    run('lead.create', { id: ids('L03'), storeId, buildingRef: 'SYN-CD-GX-FUYUE', buildingName: '浮月庭（虚构）', source: 'synthetic-history' });
    run('lead.create', { id: ids('L04'), storeId, surname: '周', phoneRef: 'SYN-PHONE-CD-004', channel: 'designer', source: 'synthetic-history' });
    run('lead.enrich', { leadId: ids('L04'), expectedVersion: 1, patch: { buildingRef: 'SYN-CD-GX-JINGLAN', buildingName: '景澜府（虚构）', intent: '先了解灯光窗帘，预算和装修阶段尚未确认。', serviceArea: '成都高新区', needs: ['先体验手动优先的灯光控制'] }, source: 'synthetic-history', evidence: evidence('L04-first-consultation', -8) });
    run('lead.enrich', { leadId: ids('L04'), expectedVersion: 2, patch: { preferredContactWindow: '工作日午休时间，须本人再次确认' }, source: 'synthetic-history', evidence: evidence('L04-contact-window', -4) });
    run('lead.create', { id: ids('L05'), storeId, alias: '王女士', contactRef: 'SYN-CONTACT-CD-005', channel: 'property', intent: '暂不继续联系，保留撤回记录。', source: 'synthetic-history', consent: { status: 'denied', purposes: [] } });

    const latest = {};
    for (const profile of customerProfiles) {
      const no = profile.no, leadId = ids(`L${no}`), customerId = ids(`C${no}`), surveyId = ids(`SURVEY${no}`), solutionId = ids(`SOLUTION${no}`), quoteId = ids(`QUOTE${no}`);
      run('lead.create', { id: leadId, storeId, alias: profile.alias, contactRef: `SYN-CONTACT-CD-${no}`, channel: ['06', '10'].includes(no) ? 'walk-in' : no === '07' ? 'designer' : no === '11' ? 'referral' : 'xiaohongshu', intent: `${profile.wishes.join('；')}。缺失和待确认事项保留在档案。`, source: 'synthetic-history' });
      run('lead.enrich', { leadId, expectedVersion: 1, patch: { buildingRef: profile.buildingRef, buildingName: profile.buildingName, budgetCents: profile.budget, renovationStage: profile.stage, serviceArea: '成都高新区', householdSize: profile.occupants, preferredContactWindow: '合成客户拟定工作日晚间，真实预约仍须客户确认', needs: profile.wishes }, source: 'synthetic-history', evidence: evidence(`L${no}-needs`, -14) });
      run('lead.authorize', { leadId, status: 'granted', purposes: ['consultation', 'appointment', 'aftercare'], evidence: evidence(`L${no}-synthetic-consent`, -13) });
      run('customer.upsert', { id: customerId, leadId, household: { buildingRef: profile.buildingRef, propertyType: no === '12' ? 'retrofit' : 'apartment', areaSqm: profile.area, rooms: 4, occupants: profile.occupants, accessibilityNeeds: no === '07' || no === '11' ? ['老人优先物理按键', '夜间路径灯不照射床头'] : ['保留常规开关，客户无需每次使用手机'] }, preferences: { priorities: profile.priorities, preferredEcosystems: ['品牌生态仅作后续官方资料研究，当前SKU全部合成'], sceneWishes: profile.wishes, exclusions: ['摄像头/门锁/消防/真实支付均不在本演练范围', '禁止客户账号密码进入档案'] }, decisionProcess: { decisionRoles: ['家庭需求提出者', '家庭预算复核者'], budgetOwnerRef: `SYN-DECISION-CD-${no}`, targetMoveInAt: date(45), undecidedTopics: profile.undecided }, communication: { contactPreference: '不透明联系引用；无明文电话或微信号', cadence: '每个变更节点先确认，再记录来源和版本', lastConfirmedAt: date(-12) }, source: 'synthetic-history', evidence: evidence(`C${no}-dossier`, -12) });
      run('survey.record', { id: surveyId, leadId, renovationStage: profile.stage, rooms: rooms.map(room => ({ id: room.id, name: room.name, areaSqm: room.areaSqm, circuits: [{ id: `${room.id}-lighting`, neutralWire: true, voltage: 220, maxLoadWatts: 1800 }] })), network: { internetAvailable: true, wiredBackhaul: true, coverageNotes: '合成勘测：网关预留有线回程；现场RSSI、干扰、路由与零线仍需真实专业测量。', vlanRequirement: false }, hazards: ['合成测量不代表真实现场可施工', '配电箱、强电施工只能由人类专业人员开展'], evidence: evidence(`SURVEY${no}-synthetic-field`, -11) });
      const bom = bomForHome(), scenes = scenesForHome();
      run('solution.build', { id: solutionId, surveyId, name: `${profile.alias} · ${profile.buildingName}灯光窗帘方案（合成）`, bom, scenes, compatibilityIds, exclusions: ['不接入门锁/摄像头/消防', '不声明任何真实品牌设备兼容', '无真实设备控制'] });
      const recordEngineering = revision => {
        const pointPlanId = ids(`POINT${no}-V${revision}`), designId = ids(`DESIGN${no}-V${revision}`), constructionId = ids(`BUILD${no}-V${revision}`);
        const counters = new Map();
        const points = bom.flatMap(row => Array.from({ length: row.quantity }, (_, number) => {
          const position = counters.get(row.roomId) ?? 0; counters.set(row.roomId, position + 1);
          const room = rooms.find(room => room.id === row.roomId);
          const definition = skuDefinitions.find(item => skuId(item[0]) === row.skuId), kind = definition[2] === 'switch' ? (definition[0] === 'CT' ? 'controller' : 'switch') : definition[2];
          return { id: `p-${row.roomId}-${definition[0].toLowerCase()}-${number + 1}`, roomId: row.roomId, xMm: 300 + (position % 4) * Math.floor((room.widthMm - 600) / 4) + (revision === 2 && definition[0] === 'CU' ? 100 : 0), yMm: 350 + Math.floor(position / 4) * 1100, mountHeightMm: ['sensor', 'lighting', 'curtain'].includes(kind) ? 2600 : 1200, kind, skuId: row.skuId, ...(row.circuitId ? { circuitId: row.circuitId } : {}), purpose: `合成${rooms.find(room => room.id === row.roomId).name}${definition[1]}位置；需专业人员现场核对`, cableRoute: kind === 'gateway' ? '合成弱电柜经预留管路到网关；强弱电分离需现场复核' : `合成${row.roomId}顶面/墙面预留路线，图纸尺寸单位mm`, installNotes: `版本${revision}：厂家安装边界仅为合成测试数据，现场人员复核位置、通风、固定、供电与手动回退。` };
        }));
        points.push({ id: 'p-living-network', roomId: 'living', xMm: 300, yMm: 300, mountHeightMm: 400, kind: 'network', purpose: '合成网关有线回程点', cableRoute: '弱电柜预留网线；真实连通性未测', installNotes: '不记录任何WiFi密码或配对码' });
        run('pointPlan.record', { id: pointPlanId, customerId, surveyId, revision, ...(revision > 1 ? { previousRevisionId: ids(`POINT${no}-V${revision - 1}`) } : {}), rooms: rooms.map(room => ({ roomId: room.id, widthMm: room.widthMm, lengthMm: room.lengthMm })), points, evidence: evidence(`POINT${no}-V${revision}`, revision > 1 ? -7 : -10) });
        run('design.record', { id: designId, customerId, solutionId, pointPlanId, revision, ...(revision > 1 ? { previousRevisionId: ids(`DESIGN${no}-V${revision - 1}`) } : {}), rationale: `依据${profile.alias}已录的${profile.priorities.join('、')}，以四个房间、六个场景与物理手动覆盖组织。${revision > 1 ? '第二版移动窗帘点位100mm，记录前版和变更理由；旧版仍保留。' : '第一版保留尚未确认事项，不替客户做最终确认。'}${historicalDisclosure}`, sceneNotes: scenes.map(scene => ({ sceneId: scene.id, userValue: `${scene.name}对应家庭日常使用，先体验再确认`, fallback: '停用自动规则后仍可用物理按键；不绕过安全设备', testMethod: '逐项测试触发、手动覆盖、断网、恢复和误触发；本导入无真实测试' })), exclusions: ['所有设备均为演练SKU', '设计草案不等同施工许可或客户批准'], evidence: evidence(`DESIGN${no}-V${revision}`, revision > 1 ? -7 : -10) });
        const quantities = new Map(); for (const row of bom) quantities.set(row.skuId, (quantities.get(row.skuId) ?? 0) + row.quantity);
        run('construction.record', { id: constructionId, designId, revision, ...(revision > 1 ? { previousRevisionId: ids(`BUILD${no}-V${revision - 1}`) } : {}), milestones: ['procurement', 'installation', 'commissioning', 'acceptance'].map((phase, index) => ({ phase, ownerRole: ['procurement-controller', 'installation-supervisor', 'commissioning-engineer', 'acceptance-auditor'][index], dueAt: date(12 + index * 2), requiredEvidence: [['批准合同/BOM', '逐项到货型号和数量'], ['人类进场许可', '专业人员断电和装配记录'], ['全部六个场景测试矩阵', '失败回退与手动覆盖'], ['客户签收', '账号交接与培训', '未闭问题清单']][index] })), materials: [...quantities].map(([skuId, quantity]) => ({ skuId, quantity, receivingCheck: '核对演练SKU/合成固件/数量/完整性；真实项目另需实际厂商凭据和到货照片' })), qualityChecks: [{ checkpoint: '强弱电与供电条件', responsibleRole: 'installation-supervisor', evidenceRequired: '真实专业人员断电、零线、负载与分离检查', acceptanceRule: '任一安全检查未通过停止进场' }, { checkpoint: '点位与设计版本', responsibleRole: 'project-manager', evidenceRequired: '最新点位图版本和变更确认', acceptanceRule: '未确认的旧版不能作为施工依据' }, { checkpoint: '场景失败回退', responsibleRole: 'commissioning-engineer', evidenceRequired: '每场景手动覆盖、断网/恢复测试', acceptanceRule: '全部场景有结果，失败项进入问题清单' }, { checkpoint: '客户交接', responsibleRole: 'acceptance-auditor', evidenceRequired: '客户培训、账号权属与签收证据', acceptanceRule: '有未闭问题不计完整验收' }], risks: profile.undecided.concat(['当前日期为合成计划，实际进场需单独人类确认']), evidence: evidence(`BUILD${no}-V${revision}`, revision > 1 ? -6 : -9) });
        return { pointPlanId, designId, constructionId };
      };
      let engineering = recordEngineering(1);
      if (no === '07' || no === '12') engineering = recordEngineering(2);
      const quote = run('quote.create', { id: quoteId, solutionId, laborCostCents: 76000, laborPriceCents: 138000, discountCents: 18000, validUntil: date(6), terms: '合成整数分报价，仅用于核对设备、施工、毛利与合同分期；不代表已发送或承诺真实价格。' });
      let quoteApproval = null;
      if (['08', '09', '10', '11', '12'].includes(no)) {
        quoteApproval = run('quote.request_approval', { quoteId, expiresAt: date(5), reason: '合成历史审批/待审资料；没有进行真实人类审核。' });
        if (no !== '08') run('approval.decide', { approvalId: quoteApproval.id, decision: 'approved', contentDigest: quoteApproval.contentDigest, reason: '仅导入合成历史批准状态；不是当前店主决定，不形成真实经营承诺。' });
      }
      const deposit = Math.floor(quote.totalCents * 0.3), installation = Math.floor(quote.totalCents * 0.5);
      const contractId = ids(`CONTRACT${no}`);
      run('contract.create', { id: contractId, customerId, quoteId, designId: engineering.designId, constructionId: engineering.constructionId, numberRef: `SYN-SG-CONTRACT-${no}`, scope: ['四房间演练点位与六场景清单', '按冻结设计/施工版本核对设备数量', '安装调试培训仅登记合成历史或后续真实人类证据'], paymentSchedule: [{ label: '预约款（计划，无实际收款）', amountCents: deposit, dueRule: '双方真实签约后单独核对，不由系统收款' }, { label: '安装阶段款（计划）', amountCents: installation, dueRule: '真实到货与安装前置凭据核对后按合同执行' }, { label: '验收阶段款（计划）', amountCents: quote.totalCents - deposit - installation, dueRule: '客户真实验收与未闭问题处理后另行办理' }], warrantyTerms: '合成条款：设备和施工的质保范围、期限、例外及责任主体须按真实厂商与门店批准文件确认。演练不承诺真实免费/永久服务。', changeTerms: '任何点位、SKU、场景、金额或工期变化须生成新设计/施工/报价/合同资料并重新人审；不得静默覆盖旧版。', exclusions: ['不包含门锁摄像头消防', '不实际购买或收付款', '虚构门店不代表任何厂商授权'] });
      if (['09', '10', '11', '12'].includes(no)) {
        const approval = run('contract.request_approval', { contractId, expiresAt: date(4), reason: '导入合成合同资料供逐条审核演练；独立于报价批准。' });
        if (no !== '12') {
          run('approval.decide', { approvalId: approval.id, decision: 'approved', contentDigest: approval.contentDigest, reason: '合成历史合同批准状态；无真实店主人审。' });
          run('contract.record_signing', { contractId, evidence: evidence(`CONTRACT${no}-synthetic-signing`, -5) });
          const projectId = ids(`PROJECT${no}`);
          run('project.create', { id: projectId, quoteId, contractId, contractEvidence: evidence(`PROJECT${no}-synthetic-contract`, -5), dueAt: date(20) });
          const quantities = new Map(); for (const row of bom) quantities.set(row.skuId, (quantities.get(row.skuId) ?? 0) + row.quantity);
          if (no === '09') run('procurement.record', { id: ids(`RECEIVED${no}-PART`), projectId, items: [{ skuId: skuId('GW'), quantity: 1, serialRefs: [`SYN-SERIAL-${no}-GW-1`] }], evidence: evidence(`PROJECT${no}-partial-receiving`, -4) });
          else {
            run('procurement.record', { id: ids(`RECEIVED${no}`), projectId, items: [...quantities].map(([skuId, quantity]) => ({ skuId, quantity, serialRefs: Array.from({ length: quantity }, (_, index) => `SYN-SERIAL-${no}-${skuId}-${index + 1}`) })), evidence: evidence(`PROJECT${no}-complete-receiving`, -4) });
            run('project.milestone', { projectId, milestone: 'installation', professionalRef: `SYN-TECHNICIAN-${no}`, safetyChecklist: { powerIsolated: true, manufacturerInstructionsFollowed: true, networkConfigured: true, customerPrivacyProtected: true }, evidence: evidence(`PROJECT${no}-synthetic-installation`, -3) });
            run('commissioning.record', { id: ids(`TEST${no}`), projectId, results: scenes.map(scene => ({ sceneId: scene.id, passed: no === '11' || scene.id !== 'focus', observation: no === '10' && scene.id === 'focus' ? '合成失败：书房按钮连续触发会延迟，保留复测待办。' : '合成历史测试条目通过；本内核没有控制或测量真实设备。' })), evidence: evidence(`PROJECT${no}-synthetic-commissioning`, -2) });
            if (no === '11') run('acceptance.record', { id: ids('ACCEPT11'), projectId, customerAccepted: true, trainingDelivered: true, credentialsTransferred: true, outstandingIssues: [], evidence: evidence('PROJECT11-synthetic-customer-acceptance', -1) });
          }
        }
      }
      latest[no] = { leadId, customerId, surveyId, solutionId, quoteId, contractId, ...engineering };
    }
    for (const no of ['06', '08', '12']) run('experience.schedule', { id: ids(`VISIT${no}`), leadId: ids(`L${no}`), startsAt: date(2), durationMinutes: no === '06' ? 60 : 90, scenes: ['回家迎宾与物理按键回退', '观影与夜起照明', '点位图、施工责任与报价解释'], status: 'proposed' });
    run('aftercare.open', { id: ids('SERVICE11-OPEN'), projectId: ids('PROJECT11'), category: 'offline', severity: 'normal', description: '合成已交付客户报告：玄关离线，先排查供电与网络，不指导拆带电部件。', dueAt: date(2) });
    run('aftercare.open', { id: ids('SERVICE11-RESOLVED'), projectId: ids('PROJECT11'), category: 'training', severity: 'low', description: '合成培训历史：老人不熟悉场景面板，记录培训复盘而非冒充外部消息。', dueAt: date(3) });
    run('aftercare.resolve', { ticketId: ids('SERVICE11-RESOLVED'), resolution: '合成历史：改为一页物理按键说明并完成训练记录；未真实联系客户。', evidence: evidence('SERVICE11-synthetic-training', -1), customerConfirmed: true, followupAt: date(7) });
    const contentTopics = [
      ['douyin', '成都装修第一问：先确定生活场景，再谈设备', '围绕回家、夜起、观影三条路线讲解；邀请仅为草稿，不含真实项目或授权品牌背书。'],
      ['xiaohongshu', '精装房灯光窗帘改造，要先看哪些现场条件', '列出回路、零线、窗帘盒、网络和手动回退清单；合成示意不能代替勘测。'],
      ['wechat-video', '老人也能用的智能家居，体验时验证三件事', '物理按键、断网手动、误触发关闭；避免把试演结果写成安全保证。'],
      ['wechat-private', '一次体验的准备清单（未发送）', '先问装修阶段、预算范围、最重要的三个生活场景；不得借咨询授权群发营销。'],
      ['baidu', '成都全屋智能方案的报价边界', '解释设备、施工、调试、培训及变更，引用合成计价示例，真实金额另行审批。'],
      ['geo', '全屋智能设计前需要准备哪些资料', '房间图、已有设备准确型号、装修节点、供电网络和客户偏好；不推断未知设备兼容。'],
      ['xiaohongshu', '点位图不是完工证明：认识四个版本节点', '需求档案、点位设计、施工计划、验收记录各有版本和来源，工程状态必须有现场证据。'],
      ['douyin', '售后怎么描述一次偶发故障', '记录发生时间、场景、可见灯态及安全限制；无远程控制或自动工单关闭承诺。'],
    ];
    for (const [index, [channel, title, body]] of contentTopics.entries()) run('content.create', { id: ids(`CONTENT${String(index + 1).padStart(2, '0')}`), storeId, channel, title: `${title}（合成草稿）`, body: `${body}\n${historicalDisclosure}`, claims: [], skuIds: [], piiFree: true });

    const businessRows = [];
    const add = (kind, summary, extra = {}, objectRefs = []) => businessRows.push({ kind, summary, ...extra, objectRefs });
    for (const [index, channel] of ['designer', 'xiaohongshu', 'walk-in', 'referral', 'property', 'douyin'].entries()) add('channel-cost-observation', `上个合成月${channel}渠道资料整理费用：用于经营对比，金额编排为演练，不是查询到的真实花费。`, { amountCents: [128000, 86000, 34000, 22000, 48000, 97000][index] });
    for (const no of ['09', '10', '11']) {
      const contract = domain.get('contract', ids(`CONTRACT${no}`));
      add('receivable-schedule', `${no}号合成合同的总应收计划；不是实际收入。`, { amountCents: contract.totalCents }, [{ type: 'contract', id: contract.id }]);
      add('payment-observation', `${no}号演练对账样本：合成预约款条目，无银行流水/真实收款或付款回执。`, { amountCents: contract.paymentSchedule[0].amountCents }, [{ type: 'contract', id: contract.id }]);
    }
    add('operating-expense-observation', '合成体验店场地运营费用样本，无实际账单。', { amountCents: 680000 });
    add('operating-expense-observation', '合成培训与方案资料制作成本样本，无实际支出。', { amountCents: 94000 });
    add('operating-expense-observation', '合成设备样机维护成本样本，不等同采购或付款。', { amountCents: 51000 });
    add('inventory-observation', '合成演练库存盘点：网关两件，具体可用性须实际检查。', { quantity: 2 }, [{ type: 'sku', id: skuId('GW') }]);
    add('inventory-observation', '合成场景开关库存样本十六件；不能据此向供应商下单。', { quantity: 16 }, [{ type: 'sku', id: skuId('SW') }]);
    add('staff-capacity', '合成下周可安排安装检查时段六个，尚无真实人类排班确认。', { quantity: 6 });
    add('staff-capacity', '合成体验讲解时段十二个，须客户明确确认后才成为实际预约。', { quantity: 12 });
    add('customer-followup', '唐女士培训后合成回访待办：确认物理按键是否熟悉，不冒称已发送消息。', {}, [{ type: 'customer', id: ids('C11') }]);
    add('customer-followup', '仅有微信ref的二号线索仍缺需求与授权；本地建议先询问，不自动外联。', {}, [{ type: 'lead', id: ids('L02') }]);
    add('issue-log', '十号项目书房连续触发合成失败已保留，未闭问题不得计为完整验收。', {}, [{ type: 'project', id: ids('PROJECT10') }]);
    add('issue-log', '十二号客户旧版点位/设计/施工保留，用第二版进入合同审核，待真实人类决定。', {}, [{ type: 'design', id: ids('DESIGN12-V2') }]);
    for (const [index, row] of businessRows.entries()) run('business.record', { id: ids(`BUSINESS${String(index + 1).padStart(2, '0')}`), storeId, occurredAt: date(-30 + index), ...row, evidence: evidence(`business-${index + 1}`, -30 + index) });
    const goals = [
      ['GROWTH', '新增有效线索与体验计划', 'qualified-leads', 4],
      ['DELIVERY', '完成本周期有证据的项目交付', 'accepted-projects', 2],
      ['SERVICE', '解决待办售后并准备复访', 'resolved-aftercare', 1],
      ['MANAGEMENT', '向董事长提交经营诊断和待决包', 'management-reports', 1],
    ];
    for (const [short, title, metric, target] of goals) run('goal.create', { id: ids(`GOAL-${short}`), storeId, title: `${title}（沙箱演练）`, metric, target, deadline: date(28), constraints: ['导入历史不计为本周期模型业绩', '全部外部发布/联系/支付/设备控制禁用', '客户事实与工程证据须真实人类确认'] });
    run('workflow.start', { id: ids('FLOW-GROWTH'), kind: 'growth-acquisition', goalId: ids('GOAL-GROWTH'), leadId: ids('L06') });
    run('workflow.start', { id: ids('FLOW-DELIVERY'), kind: 'project-delivery', goalId: ids('GOAL-DELIVERY'), surveyId: ids('SURVEY07') });
    run('workflow.start', { id: ids('FLOW-SERVICE'), kind: 'aftercare-loop', goalId: ids('GOAL-SERVICE'), ticketId: ids('SERVICE11-OPEN') });
    run('workflow.start', { id: ids('FLOW-MANAGEMENT'), kind: 'management-loop', goalId: ids('GOAL-MANAGEMENT') });
    for (const role of WORKFORCE) for (const [index, skillId] of role.skills.entries()) {
      const reference = ['lead-profile-enrichment', 'customer-handoff-check', 'source-lead-intake'].includes(skillId) ? [{ type: 'lead', id: ids('L02') }] : ['solution-design', 'bom-check', 'project-scheduling', 'contract-handoff', 'quote-margin-control', 'installation-quality', 'scene-commissioning', 'acceptance-handover'].includes(skillId) ? [{ type: 'customer', id: ids('C07') }, { type: 'design', id: ids('DESIGN07-V2') }, { type: 'construction', id: ids('BUILD07-V2') }] : ['sales-meeting-prep', 'sales-objection-brief', 'consultative-sales', 'experience-appointment', 'appointment-coordination', 'appointment-recovery'].includes(skillId) ? [{ type: 'lead', id: ids('L06') }, { type: 'customer', id: ids('C06') }] : ['aftercare-triage', 'aftercare-resolution', 'customer-followup'].includes(skillId) ? [{ type: 'aftercare', id: ids('SERVICE11-OPEN') }, { type: 'customer', id: ids('C11') }] : ['finance-reconcile', 'business-data-reconciliation', 'operations-daily-control'].includes(skillId) ? [{ type: 'store', id: storeId }, { type: 'business', id: ids('BUSINESS07') }, { type: 'business', id: ids('BUSINESS08') }] : [{ type: 'store', id: storeId }];
      run('workflow.start', { id: `SG-WORK-${digest({ employeeId: role.id, skillId }).slice(0, 20)}`, kind: 'employee-work', goalId: ids('GOAL-MANAGEMENT'), employeeId: role.id, skillId, brief: `${role.name} / ${skillId}：依据分派对象的准确版本，完成该岗位规程要求的具体准备包。${index ? '本技能与该岗位其他技能分别入队，不以岗位名称冒充实际派工。' : ''}${['lead-profile-enrichment', 'customer-handoff-check'].includes(skillId) ? '对二号微信ref极简线索提出字段补全建议与明确确认问题；未知预算、装修和授权不得编造，提交落leadEnrichment草案。' : '输出可执行的分析、草稿或人类待决，列出尚缺客户/厂商/现场证据。'} ${historicalDisclosure}`, objectRefs: reference });
    }
    const objectReferences = ENTITY_TYPES.filter(type => type !== 'scenario').flatMap(type => s.all(type).filter(record => record.provenance?.datasetId === input.datasetId).map(record => ({ type, id: record.id })));
    const counts = Object.fromEntries(ENTITY_TYPES.map(type => [type, type === 'scenario' ? 1 : objectReferences.filter(reference => reference.type === type).length]));
    const summary = { datasetId: input.datasetId, version: SCENARIO_DATASET_VERSION, fixtureDigest, anchorDate, storeId, dataMode: 'sandbox', dataOrigin: 'synthetic-history-import', imported: true, recovered: false, overwrittenObjects: 0, counts, leadIds: Array.from({ length: 12 }, (_, index) => ids(`L${String(index + 1).padStart(2, '0')}`)), customerIds: customerProfiles.map(profile => ids(`C${profile.no}`)), projectIds: ['09', '10', '11'].map(no => ids(`PROJECT${no}`)), latestEngineering: latest, workflowIds: { growth: ids('FLOW-GROWTH'), delivery: ids('FLOW-DELIVERY'), service: ids('FLOW-SERVICE'), management: ids('FLOW-MANAGEMENT') }, readyEmployeeTasks: WORKFORCE.reduce((sum, role) => sum + role.skills.length, 0), completedModelTasks: 0, humanReviewPerformed: false, modelInvocationPerformed: false, actualCashMovement: false, financialExecutionPerformed: false, externalActionsPerformed: 0, disclosure: historicalDisclosure };
    s.importContext = provenance;
    s.save('scenario', input.datasetId, { datasetId: input.datasetId, fixtureDigest, versionLabel: SCENARIO_DATASET_VERSION, anchorDate, storeId, objectReferences, operationTrail, summary, historicalEvidenceOnly: true, noModelArtifactsImported: true }, { create: true });
    return summary;
  } finally { domain.syntheticHistory = null; s.importContext = null; }
}

export function seedSyntheticScenario(engine, options = {}, suppliedActor) {
  assert(engine.scope.dataMode === 'sandbox', 'SCENARIO_IN_LIVE_BLOCKED', 'Synthetic scenarios may only be seeded in sandbox', 403);
  const datasetId = options.datasetId ?? SCENARIO_DATASET_ID;
  const actor = suppliedActor ?? { id: 'local-synthetic-importer', role: 'operator', channel: 'cli', humanConfirmed: false, tenantId: engine.scope.tenantId, workspaceId: engine.scope.workspaceId };
  const result = engine.call('scenario.import', { datasetId, ...(options.anchorDate ? { anchorDate: options.anchorDate } : {}), idempotencyKey: options.idempotencyKey ?? `scenario:${datasetId}` }, actor);
  return { ...result.data, seeded: !result.replayed && result.data.imported, recovered: result.replayed || result.data.recovered, replayed: result.replayed, receipt: result.receipt };
}
