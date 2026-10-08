import { resolve } from 'node:path';
import { BusinessError, assert, clone, validate, rejectSecretsAndPII, digest } from './errors.mjs';
import { BusinessStorage } from './storage.mjs';
import { BusinessDomain } from './domain.mjs';
import { BusinessWorkflows, WORKFLOW_CATALOGUE, EMPLOYEES, SKILLS, EMPLOYEE_WORK_OUTPUT_SCHEMA } from './workflows.mjs';
import { EMPLOYEE_SKILLS, WORKFORCE } from './workforce.mjs';
import { OPERATION_CATALOGUE, OPERATION_BY_NAME, ENTITY_TYPES, id } from './catalogue.mjs';

export { BusinessError, OPERATION_CATALOGUE, WORKFLOW_CATALOGUE, EMPLOYEES, SKILLS, ENTITY_TYPES, WORKFORCE, EMPLOYEE_SKILLS, EMPLOYEE_WORK_OUTPUT_SCHEMA };
export const RUNTIME_VERSION = '1.0.0';

/**
 * Dependency-free industry adapter. All entry points share this gateway. The
 * caller authenticates actor at its transport boundary: input cannot choose it.
 * A local OS administrator can access this SQLite file; this is not a remote IdP.
 */
export function createBusinessEngine({ dataDir, tenantId = 'demo-store', workspaceId = 'default', dataMode = 'sandbox', clock = () => new Date() } = {}) {
  assert(Number(process.versions.node.split('.')[0]) >= 24, 'NODE_VERSION_REQUIRED', 'This runtime requires Node.js 24 or later');
  assert(typeof dataDir === 'string' && dataDir.trim().length > 0, 'DATA_DIR_REQUIRED', 'A dataDir is required');
  validate(id, tenantId, '$.tenantId'); validate(id, workspaceId, '$.workspaceId');
  assert(['sandbox', 'live'].includes(dataMode), 'INVALID_DATA_MODE', 'dataMode must be sandbox or live');
  assert(typeof clock === 'function', 'INVALID_CLOCK', 'clock must be a function');
  const now = () => {
    const current = new Date(clock());
    assert(Number.isFinite(current.getTime()), 'INVALID_CLOCK', 'Clock returned an invalid date', 500);
    return current.toISOString();
  };
  const storage = new BusinessStorage({ dataDir: resolve(dataDir), tenantId, workspaceId, dataMode, now });
  const domain = new BusinessDomain(storage, now);
  const workflows = new BusinessWorkflows(storage, domain, now);
  let closed = false;
  const catalog = () => clone({ schemaVersion: 'business-management.catalog/v1', runtimeVersion: RUNTIME_VERSION, productId: 'workloom-business-management-system', industry: 'smart-home', dataMode, operations: OPERATION_CATALOGUE, workflows: WORKFLOW_CATALOGUE, employees: EMPLOYEES, skills: SKILLS, workforce: WORKFORCE, employeeSkills: EMPLOYEE_SKILLS, entityTypes: ENTITY_TYPES, execution: { modelProvider: 'host-workbench', runtimeModelCalls: false, persistence: 'node:sqlite', approvals: 'human-session-only', receipts: 'local.sqlite.commit', externalVerification: false }, externalConnectors: { publishing: 'disabled', messaging: 'disabled', payments: 'disabled', deviceControl: 'disabled' }, limits: { inputBytes: 1000000, taskLeaseSeconds: { minimum: 30, maximum: 3600 }, taskMaxAttempts: 5, approvalMaxDays: 7 } });
  const engine = {
    scope: Object.freeze({ tenantId, workspaceId, dataMode }),
    catalog,
    close() { if (!closed) storage.close(); closed = true; },
    call(operation, rawInput = {}, actor) {
      assert(!closed, 'ENGINE_CLOSED', 'Business engine is closed', 503);
      const spec = OPERATION_BY_NAME.get(operation);
      assert(spec, 'UNKNOWN_OPERATION', 'Operation is not in the industry catalogue', 404);
      assert(actor && typeof actor === 'object', 'ACTOR_REQUIRED', 'Transport-authenticated actor is required', 401);
      validate(id, actor.id, '$.actor.id');
      assert(actor.tenantId === tenantId && actor.workspaceId === workspaceId, 'TENANT_SCOPE_MISMATCH', 'Actor tenant/workspace must match this engine', 403);
      assert(['cli', 'mcp', 'http', 'test'].includes(actor.channel), 'INVALID_ACTOR_CHANNEL', 'Unknown actor channel', 403);
      assert(spec.roles.includes(actor.role), 'PERMISSION_DENIED', 'Actor role cannot call this operation', 403);
      assert(!(actor.channel === 'mcp' && (actor.role !== 'agent' || actor.humanConfirmed)), 'MCP_ACTOR_SPOOFING', 'MCP may only act as an agent and cannot carry human confirmation', 403);
      assert(!(actor.channel === 'test' && dataMode !== 'sandbox'), 'TEST_ACTOR_IN_LIVE', 'A test actor cannot access a live workspace', 403);
      let input;
      try {
        const serialized = JSON.stringify(rawInput);
        assert(typeof serialized === 'string' && Buffer.byteLength(serialized) <= 1000000, 'INPUT_TOO_LARGE', 'Input must be JSON and stay within one megabyte', 413);
        input = JSON.parse(serialized);
      } catch (error) {
        if (error instanceof BusinessError) throw error;
        throw new BusinessError('INVALID_INPUT', 'Input must be finite JSON without circular references');
      }
      rejectSecretsAndPII(input);
      validate(spec.schema, input);
      if (spec.risk === 'block') throw new BusinessError('CONNECTOR_DISABLED', 'External execution is disabled and cannot be unlocked by a model-provided approval', 409);
      if (operation === 'approval.decide' || operation === 'goal.instruct') domain.human(actor);
      if (spec.readOnly) {
        if (operation === 'catalog') return { operation, data: catalog() };
        if (operation === 'status') return { operation, data: { runtimeVersion: RUNTIME_VERSION, industry: 'smart-home', ...engine.scope, database: 'local-sqlite', modelProvider: 'host-workbench', runtimeModelCalls: 0, connectors: catalog().externalConnectors, counts: Object.fromEntries(ENTITY_TYPES.map(type => [type, storage.count(type)])), ledger: storage.verify(), systemTime: now() } };
        if (!['ledger.verify', 'ledger.list'].includes(operation)) {
          const verification = storage.verify();
          assert(verification.ok, 'LEDGER_INTEGRITY_FAILURE', 'Corrupt local records cannot be presented as business facts', 409, verification);
        }
        return { operation, data: domain.read(operation, input, workflows) };
      }
      return storage.transaction(operation, input, actor, () => {
        const flow = workflows.execute(operation, input, actor);
        if (flow !== undefined) return flow;
        return domain.execute(operation, input, actor);
      }, spec.risk, spec.fenceIds);
    },
  };
  return engine;
}

/** Explicit opt-in demo seed: fabricated SKUs, contacts and proof, sandbox only. */
export function seedSyntheticDemo(engine, suppliedActor) {
  assert(engine.scope.dataMode === 'sandbox', 'DEMO_IN_LIVE_BLOCKED', 'Synthetic demo seeding is only allowed in sandbox');
  const actor = suppliedActor ?? { id: 'synthetic-seeder', role: 'operator', channel: 'test', humanConfirmed: true, tenantId: engine.scope.tenantId, workspaceId: engine.scope.workspaceId };
  const now = engine.call('status', {}, actor).data.systemTime;
  const future = days => new Date(Date.parse(now) + days * 86400000).toISOString();
  const evidence = label => ({ uri: `evidence://synthetic/${label}`, sha256: 'a'.repeat(64), source: 'synthetic', observedAt: new Date(Date.parse(now) - 60000).toISOString(), summary: `Synthetic test evidence: ${label}. This is not a manufacturer certificate or a real customer record.` });
  const put = (operation, input, key) => {
    const type = operation.split('.')[0];
    let previous = null;
    try { previous = engine.call('entity.get', { type, id: input.id }, actor).data; }
    catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
    if (previous) {
      for (const [field, value] of Object.entries(input)) {
        if (['expiresAt', 'deadline', 'evidence', 'consent'].includes(field)) continue;
        const actual = type === 'workflow' && ['leadId', 'surveyId', 'ticketId'].includes(field) ? previous.refs[field] : previous[field];
        assert(actual !== undefined && digest(actual) === digest(value), 'DEMO_OBJECT_COLLISION', `Existing ${type} ${input.id} conflicts with the synthetic seed`, 409);
      }
      return previous;
    }
    return engine.call(operation, { ...input, idempotencyKey: `demo:${key}` }, actor).data;
  };
  // Re-running the demo is a read-only recovery of the fixed object IDs. The
  // initial seed has its own per-operation idempotency receipts.
  const existing = engine.call('entity.list', { type: 'workflow' }, actor).data;
  if (existing.some(item => item.id === 'synthetic-growth-flow') && existing.some(item => item.id === 'synthetic-delivery-flow')) return { ...SYNTHETIC_DEMO_IDS, seeded: false, recovered: true, dataMode: 'sandbox' };
  put('store.upsert', { id: 'synthetic-store', name: '全屋智能合成测试门店', city: '合成城市', serviceAreas: ['合成服务区域'], minMarginRatio: 0.25, maxDiscountRatio: 0.08 }, 'store');
  put('sku.upsert', { id: 'SYN-GW-01', manufacturer: 'Synthetic manufacturer', model: 'Synthetic gateway; not purchasable', category: 'gateway', protocol: 'synthetic-test-bus', firmwareVersion: 'synthetic-1', costCents: 10000, priceCents: 18000, evidence: evidence('gateway') }, 'gateway');
  put('sku.upsert', { id: 'SYN-LIGHT-01', manufacturer: 'Synthetic manufacturer', model: 'Synthetic light; not purchasable', category: 'lighting', protocol: 'synthetic-test-bus', firmwareVersion: 'synthetic-1', costCents: 3000, priceCents: 6000, evidence: evidence('lighting') }, 'light');
  put('compatibility.record', { id: 'synthetic-pair', leftSkuId: 'SYN-GW-01', rightSkuId: 'SYN-LIGHT-01', result: 'compatible', conditions: 'Synthetic same-room test only; no commercial device compatibility is asserted.', evidence: evidence('compatibility'), expiresAt: future(30) }, 'compatibility');
  put('lead.create', { id: 'synthetic-lead', storeId: 'synthetic-store', alias: '合成客户A', contactRef: 'synthetic-contact-A', channel: 'walk-in', intent: '合成客户：已知预算200000分，完成装修，计划客厅灯光场景。仅用于测试。', budgetCents: 200000, renovationStage: 'finished', consent: { status: 'granted', purposes: ['consultation', 'appointment', 'aftercare'], evidence: evidence('consent') } }, 'lead');
  put('survey.record', { id: 'synthetic-survey', leadId: 'synthetic-lead', renovationStage: 'finished', rooms: [{ id: 'living-room', name: '合成客厅', areaSqm: 30, circuits: [{ id: 'lighting-circuit', neutralWire: true, voltage: 220, maxLoadWatts: 2000 }] }], network: { internetAvailable: true, wiredBackhaul: true, coverageNotes: 'Synthetic network survey, no real measurements', vlanRequirement: false }, hazards: [], evidence: evidence('survey') }, 'survey');
  put('goal.create', { id: 'synthetic-growth-goal', storeId: 'synthetic-store', title: '合成获客测试：生成一个本地体验计划', metric: 'experience-plans', target: 1, deadline: future(14), constraints: ['只用合成数据', '禁止外发'] }, 'growth-goal');
  put('goal.create', { id: 'synthetic-delivery-goal', storeId: 'synthetic-store', title: '合成交付测试：记录一个本地验收项目', metric: 'accepted-projects', target: 1, deadline: future(14), constraints: ['只用合成数据与人工测试回执', '不控制真实设备'] }, 'delivery-goal');
  put('workflow.start', { id: 'synthetic-growth-flow', kind: 'growth-acquisition', goalId: 'synthetic-growth-goal', leadId: 'synthetic-lead' }, 'growth-workflow');
  put('workflow.start', { id: 'synthetic-delivery-flow', kind: 'project-delivery', goalId: 'synthetic-delivery-goal', surveyId: 'synthetic-survey' }, 'delivery-workflow');
  return { ...SYNTHETIC_DEMO_IDS, seeded: true, recovered: false, dataMode: 'sandbox' };
}

export const SYNTHETIC_DEMO_IDS = Object.freeze({ storeId: 'synthetic-store', leadId: 'synthetic-lead', surveyId: 'synthetic-survey', skuIds: ['SYN-GW-01', 'SYN-LIGHT-01'], compatibilityId: 'synthetic-pair', growthGoalId: 'synthetic-growth-goal', deliveryGoalId: 'synthetic-delivery-goal', growthWorkflowId: 'synthetic-growth-flow', deliveryWorkflowId: 'synthetic-delivery-flow' });
