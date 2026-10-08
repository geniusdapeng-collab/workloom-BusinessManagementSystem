import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createBusinessEngine, seedSyntheticDemo, EMPLOYEES, SKILLS, EMPLOYEE_SKILLS, WORKFORCE } from '../index.mjs';

const anchor = '2026-10-09T01:00:00.000Z';
const bundlePath = fileURLToPath(new URL('../../', import.meta.url));
const error = code => caught => { assert.equal(caught.code, code, caught.message); return true; };
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'bms-employee-work-'));
  const engine = createBusinessEngine({ dataDir: directory, tenantId: 'synthetic-employee-tenant', workspaceId: 'synthetic-employee-workspace', clock: () => new Date(anchor) });
  seedSyntheticDemo(engine);
  const agent = { ...engine.scope, id: 'synthetic-host-worker', role: 'agent', channel: 'mcp' };
  let sequence = 0;
  const call = (operation, input = {}, actor = agent) => engine.call(operation, ['entity.get', 'entity.list', 'workflow.get', 'ledger.verify', 'ledger.list', 'goal.report', 'status'].includes(operation) ? input : { ...input, idempotencyKey: `employee-test-${++sequence}` }, actor);
  const start = (overrides = {}, actor = agent) => call('workflow.start', { id: `employee-flow-${sequence + 1}`, kind: 'employee-work', goalId: 'synthetic-growth-goal', employeeId: 'market-researcher', skillId: 'market-intelligence', brief: 'Prepare a source-backed local market research plan. Data gaps stay explicit; no external execution.', objectRefs: [{ type: 'store', id: 'synthetic-store' }], ...overrides }, actor).data;
  const claim = workflowId => call('task.claim', { workflowId }).data;
  const artifact = () => ({ objective: 'A local preparation package; external data remains unavailable.', plan: [{ step: 'Review the assigned store service area and document missing sources.', deliverable: 'Source research checklist and evidence gaps.', actionType: 'analysis' }], evidenceReferences: [{ type: 'store', id: 'synthetic-store', version: 1 }], risks: ['No external market figures have been independently verified.'], ownerDecisions: [], nextActions: [] });
  const submit = (lease, output = artifact(), actor = agent, trace = { host: 'test', model: 'synthetic-planning-provider', invocationRef: `synthetic-employee-${++sequence}` }) => call('task.submit', { taskId: lease.taskId, leaseToken: lease.leaseToken, artifact: output, modelTrace: trace }, actor).data;
  const updateStore = () => {
    const store = call('entity.get', { type: 'store', id: 'synthetic-store' }).data;
    return call('store.upsert', { id: store.id, name: 'Changed synthetic store information', city: store.city, serviceAreas: store.serviceAreas, minMarginRatio: store.minMarginRatio, maxDiscountRatio: store.maxDiscountRatio, expectedVersion: store.version }).data;
  };
  t.after(() => { engine.close(); rmSync(directory, { recursive: true, force: true }); });
  return { engine, directory, agent, call, start, claim, artifact, submit, updateStore };
}

test('installed workforce is the unique ownership source for all twenty employees and thirty-five skills', () => {
  const source = JSON.parse(readFileSync(join(bundlePath, 'library/workforce.json'), 'utf8'));
  assert.equal(WORKFORCE.length, 20);
  assert.equal(EMPLOYEES.length, 20);
  assert.equal(SKILLS.length, 35);
  assert.equal(new Set(source.roles.flatMap(role => role.skills)).size, 35);
  for (const role of source.roles) assert.deepEqual(EMPLOYEE_SKILLS[role.id], role.skills);
});

for (const role of WORKFORCE) for (const skillId of role.skills) {
  test(`employee-work dispatches ${role.id}/${skillId} with its entire procedure and persists only a planning report`, t => {
    const f = fixture(t);
    const before = f.call('entity.get', { type: 'lead', id: 'synthetic-lead' }).data;
    const workflow = f.start({ employeeId: role.id, skillId });
    const lease = f.claim(workflow.id);
    const body = readFileSync(join(bundlePath, `skills/${skillId}/SKILL.md`), 'utf8');
    assert.equal(lease.task.employee, role.id);
    assert.equal(lease.task.skill, skillId);
    assert.equal(lease.task.phase, 'skill-plan');
    assert.ok(lease.instructions.endsWith(body));
    assert.equal(lease.task.context.assignedObjects[0].record.id, 'synthetic-store');
    assert.equal(lease.task.context.planningOnly, true);
    const result = f.submit(lease);
    assert.equal(result.workflow.status, 'completed');
    assert.equal(result.workflow.completionBasis, 'local-validated-planning-artifact-only');
    assert.equal(result.applied.externalActions, 0);
    const report = f.call('entity.get', { type: 'report', id: result.applied.reportId }).data;
    assert.equal(report.skillId, skillId);
    assert.equal(report.employeeId, role.id);
    assert.equal(report.planningOnly, true);
    assert.equal(report.executionState, 'not-executed');
    assert.equal(report.externallyExecuted, false);
    assert.equal(report.videoRendered, false);
    assert.equal(report.financialExecutionPerformed, false);
    assert.equal(report.physicalExecutionAttested, false);
    assert.deepEqual(f.call('entity.get', { type: 'lead', id: 'synthetic-lead' }).data, before);
    assert.equal(f.call('goal.report', { goalId: 'synthetic-growth-goal' }).data.current, 0);
    assert.equal(f.call('ledger.verify').data.ok, true);
    const wrongOwner = EMPLOYEES.find(employee => employee !== role.id);
    assert.throws(() => f.start({ employeeId: wrongOwner, skillId }), error('EMPLOYEE_SKILL_MISMATCH'));
  });
}

test('assignment fails atomically for missing, unknown or conflicting employee/skill inputs', t => {
  const f = fixture(t), initial = f.call('ledger.verify').data.checkedEvents;
  assert.throws(() => f.start({ employeeId: undefined }), error('EMPLOYEE_ASSIGNMENT_REQUIRED'));
  assert.throws(() => f.start({ employeeId: 'unregistered-employee' }), error('UNKNOWN_EMPLOYEE'));
  assert.throws(() => f.start({ skillId: 'unregistered-skill' }), error('UNKNOWN_SKILL'));
  assert.throws(() => f.start({ leadId: 'synthetic-lead' }), error('WORKFLOW_INPUT_CONFLICT'));
  assert.throws(() => f.call('workflow.start', { id: 'override-fixed-flow', kind: 'growth-acquisition', goalId: 'synthetic-growth-goal', leadId: 'synthetic-lead', employeeId: 'store-ceo' }), error('WORKFLOW_INPUT_CONFLICT'));
  assert.equal(f.call('ledger.verify').data.checkedEvents, initial);
});

test('unknown, empty, duplicate and cross-store references never create a task queue', t => {
  const f = fixture(t);
  assert.throws(() => f.start({ objectRefs: [] }), error('INVALID_INPUT'));
  assert.throws(() => f.start({ objectRefs: [{ type: 'not-a-business-object', id: 'synthetic-store' }] }), error('INVALID_INPUT'));
  assert.throws(() => f.start({ objectRefs: [{ type: 'lead', id: 'not-in-this-workspace' }] }), error('NOT_FOUND'));
  assert.throws(() => f.start({ objectRefs: [{ type: 'store', id: 'synthetic-store' }, { type: 'store', id: 'synthetic-store' }] }), error('INVALID_INPUT'));
  f.call('store.upsert', { id: 'other-store', name: 'Other synthetic store', city: 'Synthetic', serviceAreas: ['Synthetic'], minMarginRatio: 0.25, maxDiscountRatio: 0.08 });
  assert.throws(() => f.start({ objectRefs: [{ type: 'store', id: 'other-store' }] }), error('STORE_SCOPE_MISMATCH'));
  assert.equal(f.call('entity.list', { type: 'workflow' }).data.length, 2);
});

test('references cannot reach another tenant through shared SQLite storage', t => {
  const f = fixture(t);
  const other = createBusinessEngine({ dataDir: f.directory, tenantId: 'other-employee-tenant', workspaceId: 'synthetic-employee-workspace', clock: () => new Date(anchor) });
  t.after(() => other.close());
  const actor = { ...other.scope, id: 'synthetic-other-host', role: 'agent', channel: 'mcp' };
  other.call('store.upsert', { id: 'foreign-tenant-store', name: 'Foreign synthetic', city: 'Synthetic', serviceAreas: ['Synthetic'], minMarginRatio: 0.25, maxDiscountRatio: 0.08, idempotencyKey: 'foreign-store' }, actor);
  assert.throws(() => f.start({ objectRefs: [{ type: 'store', id: 'foreign-tenant-store' }] }), error('NOT_FOUND'));
  assert.throws(() => f.start({}, actor), error('TENANT_SCOPE_MISMATCH'));
});

test('changed assigned object versions block claim and submission rather than silently using stale evidence', t => {
  const f = fixture(t), flow = f.start(), before = f.call('ledger.verify').data.checkedEvents;
  f.updateStore();
  assert.throws(() => f.claim(flow.id), error('WORK_REFERENCE_STALE'));
  assert.equal(f.call('entity.get', { type: 'task', id: `${flow.id}:skill-plan` }).data.status, 'ready');
  const fresh = f.start({ id: 'fresh-current-refs' }), lease = f.claim(fresh.id);
  f.updateStore();
  assert.throws(() => f.submit(lease, { ...f.artifact(), evidenceReferences: [{ type: 'store', id: 'synthetic-store', version: 2 }] }), error('WORK_REFERENCE_STALE'));
  assert.equal(f.call('entity.get', { type: 'task', id: lease.taskId }).data.status, 'leased');
  assert.ok(f.call('ledger.verify').data.checkedEvents > before);
});

test('plan evidence must cite assigned objects and exact versions; corrected artifact can use the same lease', t => {
  const f = fixture(t), flow = f.start(), lease = f.claim(flow.id), initial = f.call('ledger.verify').data.checkedEvents;
  assert.throws(() => f.submit(lease, { ...f.artifact(), evidenceReferences: [{ type: 'sku', id: 'SYN-GW-01', version: 1 }] }), error('UNASSIGNED_EVIDENCE_REFERENCE'));
  assert.throws(() => f.submit(lease, { ...f.artifact(), evidenceReferences: [{ type: 'store', id: 'synthetic-store', version: 999 }] }), error('EVIDENCE_VERSION_MISMATCH'));
  assert.equal(f.call('entity.list', { type: 'report' }).data.length, 0);
  assert.equal(f.call('ledger.verify').data.checkedEvents, initial);
  assert.equal(f.submit(lease).workflow.status, 'completed');
});

test('next action validates accountable skill ownership and same-store references without executing it', t => {
  const f = fixture(t), flow = f.start(), lease = f.claim(flow.id);
  const next = { employeeId: 'video-producer', skillId: 'short-video-production', brief: 'Prepare a storyboard using store facts; no rendered video is claimed.', objectRefs: [{ type: 'store', id: 'synthetic-store' }] };
  assert.throws(() => f.submit(lease, { ...f.artifact(), nextActions: [{ ...next, employeeId: 'finance-controller' }] }), error('EMPLOYEE_SKILL_MISMATCH'));
  assert.throws(() => f.submit(lease, { ...f.artifact(), nextActions: [{ ...next, objectRefs: [{ type: 'lead', id: 'invented-lead' }] }] }), error('NOT_FOUND'));
  const result = f.submit(lease, { ...f.artifact(), nextActions: [next] });
  assert.equal(result.applied.nextActionsScheduled, false);
  assert.deepEqual(result.workflow.proposedNextActions, [next]);
  assert.equal(f.call('entity.list', { type: 'workflow' }).data.length, 3);
});

test('plan schema and privacy checks reject forged execution fields, secrets, contact details and empty evidence', t => {
  const f = fixture(t), lease = f.claim(f.start().id);
  for (const field of ['approved', 'externallyPublished', 'videoRendered', 'paymentCompleted', 'customerAccepted']) assert.throws(() => f.submit(lease, { ...f.artifact(), [field]: true }), error('INVALID_INPUT'));
  assert.throws(() => f.submit(lease, { ...f.artifact(), plan: [] }), error('INVALID_INPUT'));
  assert.throws(() => f.submit(lease, { ...f.artifact(), evidenceReferences: [] }), error('INVALID_INPUT'));
  assert.throws(() => f.submit(lease, { ...f.artifact(), objective: 'Contact synthetic@example.invalid' }), error('PII_REJECTED'));
  assert.throws(() => f.submit(lease, { ...f.artifact(), objective: `Bearer ${'a'.repeat(40)}` }), error('SECRET_REJECTED'));
  assert.throws(() => f.start({ brief: 'Call 13812345678' }), error('PII_REJECTED'));
  assert.equal(f.call('entity.list', { type: 'report' }).data.length, 0);
});

test('transport actor and lease binding remain strict for generic employee work', t => {
  const f = fixture(t);
  assert.throws(() => f.call('workflow.start', { id: 'viewer-generic', kind: 'employee-work', goalId: 'synthetic-growth-goal' }, { ...f.agent, role: 'viewer' }), error('PERMISSION_DENIED'));
  assert.throws(() => f.call('workflow.tick', {}, { ...f.agent, role: 'owner', humanConfirmed: true }), error('MCP_ACTOR_SPOOFING'));
  const lease = f.claim(f.start().id);
  assert.throws(() => f.submit(lease, f.artifact(), { ...f.agent, id: 'another-host-worker' }), error('INVALID_TASK_LEASE'));
  assert.throws(() => f.call('task.submit', { taskId: lease.taskId, leaseToken: 'forged', artifact: f.artifact(), modelTrace: { host: 'codex', model: 'host-provided', invocationRef: 'forged-lease' } }), error('INVALID_TASK_LEASE'));
  const result = f.submit(lease, f.artifact(), f.agent, { host: 'codex', model: 'host-provided', invocationRef: 'synthetic-unverified-codex-trace' });
  assert.equal(result.task.modelTrace.host, 'codex');
  assert.equal(result.task.hostModelExternallyVerified, false);
  assert.equal(result.task.executionEvidence, 'host-submitted-structured-artifact');
});

test('planning artifacts, model attribution, procedure digest and receipts survive engine restart', t => {
  const f = fixture(t), flow = f.start(), result = f.submit(f.claim(flow.id));
  f.engine.close();
  const reopened = createBusinessEngine({ dataDir: f.directory, ...f.engine.scope, clock: () => new Date(anchor) });
  t.after(() => reopened.close());
  const report = reopened.call('entity.get', { type: 'report', id: result.applied.reportId }, f.agent).data;
  assert.equal(report.planningOnly, true);
  const recovered = reopened.call('workflow.get', { workflowId: flow.id }, f.agent).data;
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.tasks[0].modelTrace.invocationRef, result.task.modelTrace.invocationRef);
  assert.equal(recovered.tasks[0].skillAsset.digest, report.skillAsset.digest);
  assert.equal(reopened.call('ledger.verify', {}, f.agent).data.ok, true);
});

test('management decomposition creates actual claimable employee tasks and rejects mismatched ownership atomically', t => {
  const f = fixture(t);
  f.call('goal.create', { id: 'management-generic-goal', storeId: 'synthetic-store', title: 'Synthetic workforce collaboration', metric: 'management-reports', target: 1, deadline: '2026-10-19T01:00:00.000Z', constraints: ['Local planning only'] });
  const workflow = f.call('workflow.start', { id: 'management-generic-flow', kind: 'management-loop', goalId: 'management-generic-goal' }).data;
  f.submit(f.claim(workflow.id), { observations: [{ metric: 'qualified-leads', value: 0, explanation: 'Exact local record count.' }], bottlenecks: [] });
  const lease = f.claim(workflow.id);
  const action = { title: 'Prepare video storyboard', employee: 'video-producer', skill: 'short-video-production', priority: 'P1', outcome: 'Only a local storyboard and source checklist.', objectRefs: [{ type: 'store', id: 'synthetic-store' }] };
  assert.throws(() => f.submit(lease, { actions: [{ ...action, employee: 'social-publisher' }], proposedGoals: [] }), error('EMPLOYEE_SKILL_MISMATCH'));
  const result = f.submit(lease, { actions: [action], proposedGoals: [] });
  assert.equal(result.applied.generatedEmployeeWorkflowIds.length, 1);
  const child = f.claim(result.applied.generatedEmployeeWorkflowIds[0]);
  assert.equal(child.task.employee, 'video-producer');
  assert.equal(child.task.skill, 'short-video-production');
  assert.equal(child.task.context.planningOnly, true);
  assert.equal(f.call('ledger.verify').data.ok, true);
});

test('tampered installed skill text fails before an engine can expose it as trusted instructions', t => {
  const directory = mkdtempSync(join(tmpdir(), 'bms-workforce-integrity-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const copy = join(directory, 'smart-home');
  cpSync(bundlePath, copy, { recursive: true });
  writeFileSync(join(copy, 'skills/market-intelligence/SKILL.md'), 'Unsealed procedure injected into a copied test bundle.');
  const script = `import(${JSON.stringify(pathToFileURL(join(copy, 'runtime/index.mjs')).href)}).then(() => process.exit(2)).catch(error => process.stdout.write(JSON.stringify({ code: error.code })))`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).code, 'WORKFORCE_ASSET_INTEGRITY');
});
