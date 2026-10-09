import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createBusinessEngine, seedSyntheticDemo, OPERATION_CATALOGUE, WORKFLOW_CATALOGUE } from '../index.mjs';

const anchor = '2026-10-09T01:00:00.000Z';
function fixture(t, { seed = true, dataMode = 'sandbox', tenantId = 'synthetic-tenant', workspaceId = 'synthetic-workspace', dataDir } = {}) {
  const directory = dataDir ?? mkdtempSync(join(tmpdir(), 'bms-synthetic-'));
  let time = Date.parse(anchor), count = 0;
  const engine = createBusinessEngine({ dataDir: directory, tenantId, workspaceId, dataMode, clock: () => new Date(time) });
  const base = { tenantId, workspaceId, channel: 'test' };
  const agent = { ...base, id: 'synthetic-worker', role: 'agent' };
  const human = { ...base, id: 'synthetic-owner', role: 'owner', humanConfirmed: true };
  const operator = { ...base, id: 'synthetic-technician', role: 'operator', humanConfirmed: true };
  const call = (operation, input = {}, actor = agent, key) => engine.call(operation, OPERATION_CATALOGUE.find(item => item.name === operation).readOnly ? input : { ...input, idempotencyKey: key ?? `case-${++count}` }, actor);
  if (seed) seedSyntheticDemo(engine);
  t.after(() => { engine.close(); if (!dataDir) rmSync(directory, { recursive: true, force: true }); });
  const future = days => new Date(time + days * 86400000).toISOString();
  const evidence = (label = 'field', source = 'synthetic') => ({ uri: `evidence://synthetic/${label}`, sha256: 'b'.repeat(64), source, observedAt: new Date(time - 60000).toISOString(), summary: `Synthetic fixture evidence ${label}; no real customer or device.` });
  const claim = workflowId => call('task.claim', { workflowId }).data;
  const submit = (lease, artifact) => call('task.submit', { taskId: lease.taskId, leaseToken: lease.leaseToken, artifact, modelTrace: { host: 'test', model: 'synthetic-artifact-provider', invocationRef: `synthetic-${++count}` } }).data;
  return { engine, directory, agent, human, operator, call, future, evidence, claim, submit, setTime(value) { time = Date.parse(value); }, advance(seconds) { time += seconds * 1000; } };
}
function error(code) { return err => { assert.equal(err.code, code, err.message); return true; }; }
const report = { summary: 'Local synthetic records completed. External actions remain disabled.', risks: ['No external business outcome has been verified.'], nextActions: ['Review local evidence and configure the required connector through a separate authorization.'] };
function solutionArtifact() { return { name: 'Synthetic living-room lighting', bom: [{ skuId: 'SYN-GW-01', roomId: 'living-room', quantity: 1 }, { skuId: 'SYN-LIGHT-01', roomId: 'living-room', quantity: 2 }], scenes: [{ id: 'scene-arrival', roomId: 'living-room', name: 'Synthetic arrival', trigger: 'Synthetic local test button', behavior: 'Synthetic lights turn on', skuIds: ['SYN-GW-01', 'SYN-LIGHT-01'] }], compatibilityIds: ['synthetic-pair'], exclusions: ['No safety-critical device is controlled.'] }; }
function quoteArtifact(f) { return { laborCostCents: 3000, laborPriceCents: 6000, discountCents: 1000, validUntil: f.future(5), terms: 'Synthetic quote, no financial commitment or payment.', approvalExpiresAt: f.future(3), approvalReason: 'Owner must approve before project contract.' }; }
function prepareApprovedDelivery(f) {
  f.submit(f.claim('synthetic-delivery-flow'), solutionArtifact());
  f.submit(f.claim('synthetic-delivery-flow'), quoteArtifact(f));
  const approval = f.call('approval.list').data[0];
  f.call('approval.decide', { approvalId: approval.id, decision: 'approved', reason: 'Synthetic owner test confirmation.', contentDigest: approval.contentDigest }, f.human);
  f.call('workflow.tick', { workflowId: 'synthetic-delivery-flow' });
  return approval;
}
function createProject(f, id = 'synthetic-project') {
  return f.call('project.create', { id, quoteId: 'synthetic-delivery-flow:quote', contractEvidence: f.evidence('contract'), dueAt: f.future(8) }, f.human).data;
}
function recordFieldDelivery(f, projectId = 'synthetic-project') {
  f.call('procurement.record', { id: 'synthetic-receipt', projectId, items: [{ skuId: 'SYN-GW-01', quantity: 1, serialRefs: ['synthetic-gateway-serial'] }, { skuId: 'SYN-LIGHT-01', quantity: 2, serialRefs: ['synthetic-light-serial-A', 'synthetic-light-serial-B'] }], evidence: f.evidence('received') }, f.operator);
  f.call('project.milestone', { projectId, milestone: 'installation', professionalRef: 'synthetic-qualified-installer', evidence: f.evidence('installed'), safetyChecklist: { powerIsolated: true, manufacturerInstructionsFollowed: true, networkConfigured: true, customerPrivacyProtected: true } }, f.operator);
  f.call('commissioning.record', { id: 'synthetic-commissioning', projectId, results: [{ sceneId: 'scene-arrival', passed: true, observation: 'Synthetic deterministic scene test passed.' }], evidence: f.evidence('commissioned') }, f.operator);
  f.call('acceptance.record', { id: 'synthetic-acceptance', projectId, customerAccepted: true, trainingDelivered: true, credentialsTransferred: true, outstandingIssues: [], evidence: f.evidence('acceptance') }, f.human);
}

test('catalogue publishes strict schemas and all five executable workflows', t => {
  const f = fixture(t, { seed: false });
  const catalogue = f.engine.catalog();
  assert.equal(catalogue.employees.length, 27);
  assert.equal(catalogue.skills.length, 49);
  assert.equal(catalogue.workflows.length, 5);
  for (const op of catalogue.operations) { assert.equal(op.schema.additionalProperties, false); if (!op.readOnly) assert.ok(op.schema.required.includes('idempotencyKey')); }
  for (const workflow of WORKFLOW_CATALOGUE) for (const phase of workflow.phases) assert.equal(phase.outputSchema.additionalProperties, false);
});

test('synthetic demo opt-in records honest local commit receipts and never completes model tasks', t => {
  const f = fixture(t, { seed: false });
  const seed = seedSyntheticDemo(f.engine);
  assert.equal(seed.seeded, true);
  assert.equal(f.call('entity.list', { type: 'task' }).data.filter(task => task.status === 'ready').length, 2);
  assert.equal(f.call('entity.list', { type: 'task' }).data.filter(task => task.status === 'completed').length, 0);
  assert.equal(seedSyntheticDemo(f.engine).recovered, true);
  const events = f.call('ledger.list').data;
  assert.ok(events.length >= 10);
  assert.ok(events.every(event => event.receipt.localCommitted && !event.receipt.externalVerified && event.context.data_mode === 'sandbox'));
  assert.equal(f.call('ledger.verify').data.ok, true);
});

test('growth workflow executes qualification, draft, appointment plan and evidence-based owner report', t => {
  const f = fixture(t);
  const first = f.claim('synthetic-growth-flow');
  assert.equal(first.task.employee, 'lead-concierge');
  assert.equal(first.task.context.refs.lead.contactRef, 'synthetic-contact-A');
  f.submit(first, { fit: true, budgetCents: 200000, renovationStage: 'finished', needs: ['Recorded synthetic lighting need.'], reason: 'Budget and stage are stated in the synthetic input.', missingInformation: [] });
  f.submit(f.claim('synthetic-growth-flow'), { channel: 'xiaohongshu', title: 'Synthetic store experience', body: 'Visit a local synthetic demonstration; exact device compatibility requires recorded evidence.', claims: [], skuIds: [], piiFree: true });
  f.submit(f.claim('synthetic-growth-flow'), { startsAt: f.future(1), durationMinutes: 60, scenes: ['Synthetic arrival lighting demonstration'] });
  f.submit(f.claim('synthetic-growth-flow'), report);
  const workflow = f.call('workflow.get', { workflowId: 'synthetic-growth-flow' }).data;
  assert.equal(workflow.status, 'completed');
  assert.ok(workflow.tasks.every(task => task.status === 'completed'));
  const measured = f.call('goal.report', { goalId: 'synthetic-growth-goal' }).data;
  assert.equal(measured.current, 1);
  assert.equal(measured.achievedLocally, true);
  assert.equal(measured.externallyVerified, false);
  assert.equal(f.call('entity.get', { type: 'experience', id: workflow.refs.experienceId }).data.externalNotification, 'disabled');
  assert.equal(f.call('ledger.verify').data.ok, true);
});

test('delivery workflow waits for human approval and field evidence before owner report', t => {
  const f = fixture(t);
  prepareApprovedDelivery(f);
  f.submit(f.claim('synthetic-delivery-flow'), { milestones: ['procurement', 'installation', 'commissioning', 'acceptance'].map((phase, index) => ({ phase, ownerRole: ['procurement-controller', 'installation-supervisor', 'commissioning-engineer', 'acceptance-auditor'][index], dueAt: f.future(index + 4), requiredEvidence: ['Human-supplied synthetic fixture evidence.'] })), risks: ['Physical execution is not performed by this test.'] });
  assert.equal(f.call('workflow.get', { workflowId: 'synthetic-delivery-flow' }).data.status, 'waiting-evidence');
  assert.throws(() => f.claim('synthetic-delivery-flow'), error('NO_READY_TASK'));
  createProject(f);
  recordFieldDelivery(f);
  f.call('workflow.tick', { workflowId: 'synthetic-delivery-flow' });
  f.submit(f.claim('synthetic-delivery-flow'), report);
  const workflow = f.call('workflow.get', { workflowId: 'synthetic-delivery-flow' }).data;
  assert.equal(workflow.status, 'completed');
  assert.equal(workflow.externalDeliveryVerified, false);
  const project = f.call('entity.get', { type: 'project', id: 'synthetic-project' }).data;
  assert.equal(project.status, 'accepted-local-record');
  assert.equal(project.externalAcceptanceVerified, false);
  assert.equal(f.call('goal.report', { goalId: 'synthetic-delivery-goal' }).data.current, 1);
  assert.equal(f.call('ledger.verify').data.ok, true);
});

test('aftercare closes only after human service evidence and customer confirmation', t => {
  const f = fixture(t);
  prepareApprovedDelivery(f); createProject(f);
  f.call('aftercare.open', { id: 'synthetic-ticket', projectId: 'synthetic-project', category: 'offline', severity: 'normal', description: 'Synthetic light offline.', dueAt: f.future(2) });
  f.call('goal.create', { id: 'synthetic-service-goal', storeId: 'synthetic-store', title: 'Synthetic service goal', metric: 'resolved-aftercare', target: 1, deadline: f.future(10), constraints: ['No real device control'] });
  f.call('workflow.start', { id: 'synthetic-service-flow', kind: 'aftercare-loop', goalId: 'synthetic-service-goal', ticketId: 'synthetic-ticket' });
  f.submit(f.claim('synthetic-service-flow'), { category: 'offline', requiresOnsite: true, hypotheses: ['Synthetic network fault, unconfirmed.'], customerGuidance: 'Check the visible indicator; contact a qualified technician.' });
  f.submit(f.claim('synthetic-service-flow'), { steps: ['Qualified technician records a safe network check.'], escalationRole: 'aftercare-specialist', followupAt: f.future(3), safetyWarning: 'Do not touch powered wiring.' });
  assert.equal(f.call('workflow.get', { workflowId: 'synthetic-service-flow' }).data.status, 'waiting-evidence');
  assert.throws(() => f.call('aftercare.resolve', { ticketId: 'synthetic-ticket', resolution: 'Synthetic repair', evidence: f.evidence('repair'), customerConfirmed: false, followupAt: f.future(3) }, f.human), error('CUSTOMER_CONFIRMATION_REQUIRED'));
  f.call('aftercare.resolve', { ticketId: 'synthetic-ticket', resolution: 'Synthetic technician recorded recovery.', evidence: f.evidence('repair'), customerConfirmed: true, followupAt: f.future(3) }, f.human);
  f.call('workflow.tick', { workflowId: 'synthetic-service-flow' });
  f.submit(f.claim('synthetic-service-flow'), report);
  assert.equal(f.call('workflow.get', { workflowId: 'synthetic-service-flow' }).data.status, 'completed');
});

test('management loop checks measured metrics, generates local goals and accepts owner instruction', t => {
  const f = fixture(t);
  f.call('goal.create', { id: 'synthetic-management-goal', storeId: 'synthetic-store', title: 'Synthetic management', metric: 'management-reports', target: 1, deadline: f.future(10), constraints: ['No spending'] });
  f.call('workflow.start', { id: 'synthetic-management-flow', kind: 'management-loop', goalId: 'synthetic-management-goal' });
  const lease = f.claim('synthetic-management-flow');
  assert.throws(() => f.submit(lease, { observations: [{ metric: 'qualified-leads', value: 999, explanation: 'Invented' }], bottlenecks: [] }), error('METRIC_EVIDENCE_MISMATCH'));
  f.submit(lease, { observations: [{ metric: 'qualified-leads', value: 0, explanation: 'No qualified record exists yet.' }], bottlenecks: ['Host task needs to run.'] });
  const plan = f.submit(f.claim('synthetic-management-flow'), { actions: [{ title: 'Qualify recorded synthetic lead', employee: 'lead-concierge', skill: 'lead-qualification', priority: 'P0', outcome: 'One evidence-based local qualification.' }], proposedGoals: [{ title: 'Synthetic proposed growth goal', metric: 'qualified-leads', target: 1, deadline: f.future(6), constraints: ['Local only'] }] });
  assert.equal(plan.applied.generatedGoalIds.length, 1);
  f.submit(f.claim('synthetic-management-flow'), report);
  const measured = f.call('goal.report', { goalId: 'synthetic-management-goal' }).data;
  assert.equal(measured.current, 1);
  f.call('goal.instruct', { goalId: 'synthetic-management-goal', action: 'pause', instruction: 'Synthetic owner pauses this goal.' }, f.human);
  assert.equal(f.call('entity.get', { type: 'goal', id: 'synthetic-management-goal' }).data.status, 'paused');
});

test('idempotent replay preserves event and receipt; payload/actor collision fails', t => {
  const f = fixture(t);
  const input = { id: 'synthetic-extra-goal', storeId: 'synthetic-store', title: 'Idempotency fixture', metric: 'qualified-leads', target: 1, deadline: f.future(5), constraints: [] };
  const first = f.call('goal.create', input, f.agent, 'same-request');
  const events = f.call('ledger.verify').data.checkedEvents;
  const repeat = f.call('goal.create', input, f.agent, 'same-request');
  assert.equal(repeat.replayed, true);
  assert.equal(repeat.receipt.eventId, first.receipt.eventId);
  assert.equal(f.call('ledger.verify').data.checkedEvents, events);
  assert.throws(() => f.call('goal.create', { ...input, target: 2 }, f.agent, 'same-request'), error('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => f.call('goal.create', input, f.human, 'same-request'), error('IDEMPOTENCY_CONFLICT'));
});

test('failed artifact validation rolls back all business changes and permits corrected lease submit', t => {
  const f = fixture(t);
  const lease = f.claim('synthetic-delivery-flow');
  const events = f.call('ledger.verify').data.checkedEvents;
  assert.throws(() => f.submit(lease, { ...solutionArtifact(), compatibilityIds: [] }), error('COMPATIBILITY_EVIDENCE_MISSING'));
  assert.equal(f.call('entity.list', { type: 'solution' }).data.length, 0);
  assert.equal(f.call('entity.get', { type: 'task', id: lease.taskId }).data.status, 'leased');
  assert.equal(f.call('ledger.verify').data.checkedEvents, events);
  f.submit(lease, solutionArtifact());
  assert.equal(f.call('entity.list', { type: 'solution' }).data.length, 1);
});

test('tenant and workspace isolation applies to entities, workflows, approvals and event chains', t => {
  const f = fixture(t);
  const other = fixture(t, { seed: false, dataDir: f.directory, tenantId: 'synthetic-other', workspaceId: 'synthetic-workspace' });
  assert.equal(other.call('entity.list', { type: 'store' }).data.length, 0);
  assert.equal(other.call('approval.list').data.length, 0);
  assert.equal(other.call('ledger.verify').data.checkedEvents, 0);
  assert.throws(() => other.call('entity.get', { type: 'lead', id: 'synthetic-lead' }), error('NOT_FOUND'));
  assert.throws(() => f.call('entity.get', { type: 'lead', id: 'synthetic-lead' }, other.agent), error('TENANT_SCOPE_MISMATCH'));
  const workspace = fixture(t, { seed: false, dataDir: f.directory, workspaceId: 'synthetic-other-workspace' });
  assert.equal(workspace.call('task.list').data.length, 0);
});

test('viewer cannot write and input cannot spoof scope or approval fields', t => {
  const f = fixture(t);
  const viewer = { ...f.agent, role: 'viewer' };
  assert.equal(f.call('status', {}, viewer).data.industry, 'smart-home');
  assert.throws(() => f.call('workflow.tick', {}, viewer), error('PERMISSION_DENIED'));
  assert.throws(() => f.call('workflow.tick', { tenantId: 'synthetic-other' }), error('INVALID_INPUT'));
  assert.throws(() => f.call('workflow.tick', { approval: 'forged-approval' }), error('INVALID_INPUT'));
});

test('MCP agent cannot approve, spoof a human actor or record physical field events', t => {
  const f = fixture(t);
  f.submit(f.claim('synthetic-delivery-flow'), solutionArtifact()); f.submit(f.claim('synthetic-delivery-flow'), quoteArtifact(f));
  const approval = f.call('approval.list').data[0];
  const mcp = { ...f.agent, channel: 'mcp' };
  const decision = { approvalId: approval.id, decision: 'approved', reason: 'Fake human', contentDigest: approval.contentDigest };
  assert.throws(() => f.call('approval.decide', decision, mcp), error('PERMISSION_DENIED'));
  assert.throws(() => f.call('approval.decide', decision, { ...mcp, role: 'owner', humanConfirmed: true }), error('MCP_ACTOR_SPOOFING'));
  assert.throws(() => f.call('approval.decide', decision, { ...f.human, humanConfirmed: false }), error('HUMAN_REVIEW_REQUIRED'));
  assert.throws(() => f.call('survey.record', { id: 'forged-survey', leadId: 'synthetic-lead', renovationStage: 'finished', rooms: [], network: {}, hazards: [], evidence: f.evidence() }, mcp), error('PERMISSION_DENIED'));
});

test('quote approval binds content digest, expires and is consumed only once', t => {
  const f = fixture(t);
  f.submit(f.claim('synthetic-delivery-flow'), solutionArtifact()); f.submit(f.claim('synthetic-delivery-flow'), quoteArtifact(f));
  const approval = f.call('approval.list').data[0];
  assert.throws(() => f.call('approval.decide', { approvalId: approval.id, decision: 'approved', reason: 'Synthetic owner', contentDigest: 'c'.repeat(64) }, f.human), error('APPROVAL_CONTENT_MISMATCH'));
  f.call('approval.decide', { approvalId: approval.id, decision: 'approved', reason: 'Synthetic owner', contentDigest: approval.contentDigest }, f.human);
  assert.throws(() => f.call('approval.decide', { approvalId: approval.id, decision: 'rejected', reason: 'Replay', contentDigest: approval.contentDigest }, f.human), error('APPROVAL_ALREADY_DECIDED'));
  f.advance(4 * 86400);
  assert.throws(() => createProject(f), error('APPROVAL_INVALID'));
});

test('rejected and expired quote approvals fail the waiting workflow safely', t => {
  const f = fixture(t);
  f.submit(f.claim('synthetic-delivery-flow'), solutionArtifact()); f.submit(f.claim('synthetic-delivery-flow'), quoteArtifact(f));
  const approval = f.call('approval.list').data[0];
  f.call('approval.decide', { approvalId: approval.id, decision: 'rejected', reason: 'Synthetic rejection', contentDigest: approval.contentDigest }, f.human);
  f.call('workflow.tick', { workflowId: 'synthetic-delivery-flow' });
  assert.equal(f.call('workflow.get', { workflowId: 'synthetic-delivery-flow' }).data.status, 'failed');
  assert.throws(() => createProject(f), error('APPROVED_QUOTE_REQUIRED'));
});

test('compatibility cannot be inferred from protocol and stale version evidence is rejected', t => {
  const f = fixture(t);
  const old = f.call('entity.get', { type: 'sku', id: 'SYN-LIGHT-01' }).data;
  f.call('sku.upsert', { id: old.id, manufacturer: old.manufacturer, model: old.model, category: old.category, protocol: old.protocol, firmwareVersion: 'synthetic-2', costCents: old.costCents, priceCents: old.priceCents, evidence: f.evidence('updated-spec'), expectedVersion: old.version });
  assert.throws(() => f.call('solution.build', { id: 'stale-solution', surveyId: 'synthetic-survey', ...solutionArtifact() }), error('COMPATIBILITY_STALE'));
  assert.throws(() => f.call('solution.build', { id: 'guessed-solution', surveyId: 'synthetic-survey', ...solutionArtifact(), compatibilityIds: [] }), error('COMPATIBILITY_EVIDENCE_MISSING'));
});

test('unknown room, duplicate BOM and scene devices outside BOM are blocked', t => {
  const f = fixture(t);
  const original = solutionArtifact();
  assert.throws(() => f.call('solution.build', { id: 'unknown-room', surveyId: 'synthetic-survey', ...original, bom: [{ ...original.bom[0], roomId: 'missing-room' }] }), error('UNKNOWN_ROOM'));
  assert.throws(() => f.call('solution.build', { id: 'duplicate-bom', surveyId: 'synthetic-survey', ...original, bom: [original.bom[0], original.bom[0]] }), error('DUPLICATE_BOM_ROW'));
  assert.throws(() => f.call('solution.build', { id: 'missing-scene-device', surveyId: 'synthetic-survey', ...original, bom: [original.bom[0]] }), error('SCENE_SKU_OUTSIDE_BOM'));
});

test('quote arithmetic uses integer cents, computes margin and blocks negative profit approvals', t => {
  const f = fixture(t);
  f.call('solution.build', { id: 'synthetic-finance-solution', surveyId: 'synthetic-survey', ...solutionArtifact() });
  const quote = f.call('quote.create', { id: 'synthetic-negative-quote', solutionId: 'synthetic-finance-solution', laborCostCents: 100000, laborPriceCents: 100, discountCents: 0, validUntil: f.future(5), terms: 'Synthetic negative margin fixture.' }).data;
  assert.equal(quote.totalCents, 30100);
  assert.equal(quote.costCents, 116000);
  assert.equal(quote.grossProfitCents, -85900);
  assert.ok(quote.policyViolations.includes('negative-gross-profit'));
  const approval = f.call('quote.request_approval', { quoteId: quote.id, expiresAt: f.future(1), reason: 'Synthetic unsafe request' }).data;
  assert.throws(() => f.call('approval.decide', { approvalId: approval.id, decision: 'approved', reason: 'Attempt override', contentDigest: approval.contentDigest }, f.human), error('NEGATIVE_MARGIN_BLOCKED'));
  assert.throws(() => f.call('quote.create', { id: 'float-quote', solutionId: 'synthetic-finance-solution', laborCostCents: 0.5, laborPriceCents: 1, discountCents: 0, validUntil: f.future(5), terms: 'Float' }), error('INVALID_INPUT'));
});

test('installation order, BOM procurement bounds, safety and complete scene test matrix are mandatory', t => {
  const f = fixture(t); prepareApprovedDelivery(f); createProject(f);
  assert.throws(() => f.call('project.milestone', { projectId: 'synthetic-project', milestone: 'installation', professionalRef: 'synthetic-tech', evidence: f.evidence(), safetyChecklist: { powerIsolated: true, manufacturerInstructionsFollowed: true, networkConfigured: true, customerPrivacyProtected: true } }, f.operator), error('MILESTONE_ORDER'));
  assert.throws(() => f.call('procurement.record', { id: 'excessive-receipt', projectId: 'synthetic-project', items: [{ skuId: 'SYN-GW-01', quantity: 2, serialRefs: [] }], evidence: f.evidence() }, f.operator), error('PROCUREMENT_EXCEEDS_BOM'));
  f.call('procurement.record', { id: 'partial-receipt-A', projectId: 'synthetic-project', items: [{ skuId: 'SYN-GW-01', quantity: 1, serialRefs: [] }], evidence: f.evidence() }, f.operator);
  assert.equal(f.call('entity.get', { type: 'project', id: 'synthetic-project' }).data.procurementComplete, false);
  f.call('procurement.record', { id: 'partial-receipt-B', projectId: 'synthetic-project', items: [{ skuId: 'SYN-LIGHT-01', quantity: 2, serialRefs: [] }], evidence: f.evidence() }, f.operator);
  assert.throws(() => f.call('project.milestone', { projectId: 'synthetic-project', milestone: 'installation', professionalRef: 'synthetic-tech', evidence: f.evidence(), safetyChecklist: { powerIsolated: false, manufacturerInstructionsFollowed: true, networkConfigured: true, customerPrivacyProtected: true } }, f.operator), error('INSTALLATION_SAFETY_INCOMPLETE'));
  f.call('project.milestone', { projectId: 'synthetic-project', milestone: 'installation', professionalRef: 'synthetic-tech', evidence: f.evidence(), safetyChecklist: { powerIsolated: true, manufacturerInstructionsFollowed: true, networkConfigured: true, customerPrivacyProtected: true } }, f.operator);
  assert.throws(() => f.call('commissioning.record', { id: 'wrong-scenes', projectId: 'synthetic-project', results: [{ sceneId: 'unknown-scene', passed: true, observation: 'Wrong' }], evidence: f.evidence() }, f.operator), error('INCOMPLETE_COMMISSIONING'));
});

test('customer outstanding issues prevent acceptance completion', t => {
  const f = fixture(t); prepareApprovedDelivery(f); createProject(f);
  f.call('procurement.record', { id: 'receipt', projectId: 'synthetic-project', items: [{ skuId: 'SYN-GW-01', quantity: 1, serialRefs: [] }, { skuId: 'SYN-LIGHT-01', quantity: 2, serialRefs: [] }], evidence: f.evidence() }, f.operator);
  f.call('project.milestone', { projectId: 'synthetic-project', milestone: 'installation', professionalRef: 'synthetic-tech', evidence: f.evidence(), safetyChecklist: { powerIsolated: true, manufacturerInstructionsFollowed: true, networkConfigured: true, customerPrivacyProtected: true } }, f.operator);
  f.call('commissioning.record', { id: 'commissioning', projectId: 'synthetic-project', results: [{ sceneId: 'scene-arrival', passed: true, observation: 'Synthetic pass' }], evidence: f.evidence() }, f.operator);
  f.call('acceptance.record', { id: 'issues-acceptance', projectId: 'synthetic-project', customerAccepted: true, trainingDelivered: true, credentialsTransferred: true, outstandingIssues: ['Synthetic unresolved scene delay'], evidence: f.evidence() }, f.human);
  assert.equal(f.call('entity.get', { type: 'project', id: 'synthetic-project' }).data.status, 'acceptance-pending');
  assert.equal(f.call('goal.report', { goalId: 'synthetic-delivery-goal' }).data.current, 0);
});

test('content approval remains pending connector and model cannot create an external publish receipt', t => {
  const f = fixture(t);
  f.call('content.create', { id: 'synthetic-publication', storeId: 'synthetic-store', channel: 'douyin', title: 'Synthetic demo', body: 'Evidence-based synthetic local draft.', claims: [], skuIds: [], piiFree: true });
  const approval = f.call('content.request_publication', { contentId: 'synthetic-publication', expiresAt: f.future(2), reason: 'Synthetic review' }).data;
  f.call('approval.decide', { approvalId: approval.id, decision: 'approved', reason: 'Synthetic owner approves draft only', contentDigest: approval.contentDigest }, f.human);
  assert.equal(f.call('entity.get', { type: 'content', id: 'synthetic-publication' }).data.status, 'approved-pending-connector');
  assert.throws(() => f.call('content.publish', { contentId: 'synthetic-publication', approvalId: approval.id }), error('CONNECTOR_DISABLED'));
  assert.equal(f.call('entity.get', { type: 'content', id: 'synthetic-publication' }).data.externallyPublished, false);
});

test('consent is purpose-specific, requires evidence and revocation blocks task execution', t => {
  const f = fixture(t);
  assert.throws(() => f.call('lead.create', { id: 'no-proof-lead', storeId: 'synthetic-store', alias: 'Synthetic alias', contactRef: 'synthetic-ref', channel: 'walk-in', intent: 'Synthetic', consent: { status: 'granted', purposes: ['consultation'] } }), error('CONSENT_EVIDENCE_REQUIRED'));
  f.call('lead.authorize', { leadId: 'synthetic-lead', status: 'denied', purposes: [], evidence: f.evidence('revocation') });
  assert.throws(() => f.call('experience.schedule', { id: 'revoked-appointment', leadId: 'synthetic-lead', startsAt: f.future(1), durationMinutes: 30, scenes: ['Synthetic'] }), error('CONSENT_REQUIRED'));
  const lease = f.claim('synthetic-growth-flow');
  assert.throws(() => f.submit(lease, { fit: true, budgetCents: 200000, renovationStage: 'finished', needs: ['Synthetic'], reason: 'Synthetic', missingInformation: [] }), error('CONSENT_REQUIRED'));
});

test('failed host tasks retry to a fixed maximum; invalid token and actor are rejected', t => {
  const f = fixture(t);
  let lease = f.claim('synthetic-growth-flow');
  assert.throws(() => f.call('task.fail', { taskId: lease.taskId, leaseToken: 'forged', error: 'Synthetic error', retryable: true }), error('INVALID_TASK_LEASE'));
  assert.throws(() => f.call('task.fail', { taskId: lease.taskId, leaseToken: lease.leaseToken, error: 'Synthetic error', retryable: true }, { ...f.agent, id: 'another-worker' }), error('INVALID_TASK_LEASE'));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = f.call('task.fail', { taskId: lease.taskId, leaseToken: lease.leaseToken, error: 'Synthetic host timeout', retryable: true }).data;
    assert.equal(result.retryScheduled, attempt < 3);
    if (attempt < 3) lease = f.claim('synthetic-growth-flow');
  }
  assert.equal(f.call('workflow.get', { workflowId: 'synthetic-growth-flow' }).data.status, 'failed');
});

test('task lease expiration recovers across process restart and old worker cannot submit', t => {
  const f = fixture(t);
  const lease = f.call('task.claim', { workflowId: 'synthetic-growth-flow', leaseSeconds: 30 }).data;
  f.engine.close();
  const recovered = createBusinessEngine({ dataDir: f.directory, tenantId: f.agent.tenantId, workspaceId: f.agent.workspaceId, clock: () => new Date(Date.parse(anchor) + 31000) });
  t.after(() => recovered.close());
  recovered.call('workflow.tick', { workflowId: 'synthetic-growth-flow', idempotencyKey: 'restart-tick' }, f.agent);
  const newLease = recovered.call('task.claim', { workflowId: 'synthetic-growth-flow', idempotencyKey: 'restart-claim' }, f.agent).data;
  assert.notEqual(newLease.leaseToken, lease.leaseToken);
  assert.equal(newLease.task.attempts, 2);
  assert.throws(() => recovered.call('task.submit', { taskId: lease.taskId, leaseToken: lease.leaseToken, artifact: {}, modelTrace: { host: 'test', model: 'synthetic', invocationRef: 'old' }, idempotencyKey: 'stale-lease' }, f.agent), error('INVALID_TASK_LEASE'));
  assert.equal(recovered.call('ledger.verify', {}, f.agent).data.ok, true);
});

test('owner pause blocks lease submission and resume restores the same valid task', t => {
  const f = fixture(t);
  const lease = f.claim('synthetic-growth-flow');
  f.call('goal.instruct', { goalId: 'synthetic-growth-goal', action: 'pause', instruction: 'Synthetic pause' }, f.human);
  assert.throws(() => f.submit(lease, { fit: false, budgetCents: 200000, renovationStage: 'finished', needs: ['Synthetic'], reason: 'Synthetic', missingInformation: ['schedule'] }), error('GOAL_PAUSED'));
  f.call('goal.instruct', { goalId: 'synthetic-growth-goal', action: 'resume', instruction: 'Synthetic resume' }, f.human);
  f.submit(lease, { fit: false, budgetCents: 200000, renovationStage: 'finished', needs: ['Synthetic'], reason: 'Unqualified synthetic lead', missingInformation: ['schedule'] });
  assert.equal(f.call('entity.get', { type: 'lead', id: 'synthetic-lead' }).data.status, 'needs-information');
});

test('goal deadline cancels leased tasks rather than silently completing them', t => {
  const f = fixture(t);
  f.claim('synthetic-growth-flow');
  f.advance(15 * 86400);
  f.call('workflow.tick', { workflowId: 'synthetic-growth-flow' });
  assert.equal(f.call('workflow.get', { workflowId: 'synthetic-growth-flow' }).data.status, 'failed');
  assert.equal(f.call('entity.get', { type: 'task', id: 'synthetic-growth-flow:qualification' }).data.status, 'cancelled');
});

test('append-only triggers prevent direct receipt/event updates and deletes', t => {
  const f = fixture(t);
  const db = new DatabaseSync(join(f.directory, 'business.sqlite'));
  t.after(() => db.close());
  assert.throws(() => db.exec("UPDATE business_events SET hash='forged'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM business_events'), /append-only/);
  assert.throws(() => db.exec("UPDATE idempotency SET request_hash='forged'"), /append-only/);
});

test('projection tampering fails verification and blocks new writes before side effects', t => {
  const f = fixture(t);
  const db = new DatabaseSync(join(f.directory, 'business.sqlite'));
  db.prepare('UPDATE entities SET doc=? WHERE type=?').run('{"id":"forged","version":1}', 'store');
  db.close();
  assert.equal(f.call('ledger.verify').data.ok, false);
  assert.throws(() => f.call('workflow.tick'), error('LEDGER_INTEGRITY_FAILURE'));
});

test('hash-chain tampering is detected on reopen even after a raw database admin removes a trigger', t => {
  const f = fixture(t); f.engine.close();
  const db = new DatabaseSync(join(f.directory, 'business.sqlite'));
  db.exec('DROP TRIGGER events_no_update');
  db.exec("UPDATE business_events SET hash='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' WHERE seq=1");
  db.close();
  assert.throws(() => createBusinessEngine({ dataDir: f.directory, tenantId: f.agent.tenantId, workspaceId: f.agent.workspaceId }), error('LEDGER_INTEGRITY_FAILURE'));
});

test('plain contact data, credentials, unknown fields, malformed IDs and excessive input are rejected', t => {
  const f = fixture(t);
  assert.throws(() => f.call('workflow.tick', { email: 'synthetic@example.invalid' }), error('SECRET_OR_PII_FIELD'));
  assert.throws(() => f.call('goal.instruct', { goalId: 'synthetic-growth-goal', instruction: `Bearer ${'a'.repeat(40)}`, action: 'continue' }, f.human), error('SECRET_REJECTED'));
  assert.throws(() => f.call('entity.get', { type: 'lead', id: '../../another-workspace' }), error('INVALID_INPUT'));
  assert.throws(() => f.call('entity.list', { type: 'unknown' }), error('UNKNOWN_ENTITY_TYPE'));
  assert.throws(() => f.call('goal.instruct', { goalId: 'synthetic-growth-goal', instruction: 'a'.repeat(1000001), action: 'continue' }, f.human), error('INPUT_TOO_LARGE'));
});

test('schema boundary rejects zero targets, invalid ISO dates, empty BOM and overlong lease', t => {
  const f = fixture(t);
  assert.throws(() => f.call('goal.create', { id: 'zero-target', storeId: 'synthetic-store', title: 'Synthetic', metric: 'qualified-leads', target: 0, deadline: f.future(1), constraints: [] }), error('INVALID_INPUT'));
  assert.throws(() => f.call('goal.create', { id: 'invalid-date', storeId: 'synthetic-store', title: 'Synthetic', metric: 'qualified-leads', target: 1, deadline: 'tomorrow', constraints: [] }), error('INVALID_INPUT'));
  assert.throws(() => f.call('solution.build', { id: 'empty-bom', surveyId: 'synthetic-survey', ...solutionArtifact(), bom: [] }), error('INVALID_INPUT'));
  assert.throws(() => f.call('task.claim', { leaseSeconds: 3601 }), error('INVALID_INPUT'));
});

test('sandbox/live identities cannot mix and live runtime refuses test actors or synthetic seeding', t => {
  const f = fixture(t);
  assert.throws(() => createBusinessEngine({ dataDir: f.directory, tenantId: f.agent.tenantId, workspaceId: f.agent.workspaceId, dataMode: 'live' }), error('DATA_MODE_MISMATCH'));
  const live = fixture(t, { seed: false, dataMode: 'live' });
  assert.throws(() => seedSyntheticDemo(live.engine), error('DEMO_IN_LIVE_BLOCKED'));
  assert.throws(() => live.call('status'), error('TEST_ACTOR_IN_LIVE'));
  assert.equal(live.engine.call('status', {}, { ...live.agent, channel: 'cli' }).data.dataMode, 'live');
});

test('optimistic version conflicts prevent lost updates and immutable domain objects cannot overwrite', t => {
  const f = fixture(t);
  const store = f.call('entity.get', { type: 'store', id: 'synthetic-store' }).data;
  const input = { id: store.id, name: store.name, city: store.city, serviceAreas: store.serviceAreas, minMarginRatio: store.minMarginRatio, maxDiscountRatio: store.maxDiscountRatio, expectedVersion: store.version };
  f.call('store.upsert', { ...input, name: 'Synthetic updated store' });
  assert.throws(() => f.call('store.upsert', { ...input, name: 'Lost update' }), error('VERSION_CONFLICT'));
  assert.throws(() => f.call('store.upsert', { ...input, expectedVersion: undefined }), error('VERSION_REQUIRED'));
  assert.throws(() => f.call('workflow.start', { id: 'synthetic-growth-flow', kind: 'growth-acquisition', goalId: 'synthetic-growth-goal', leadId: 'synthetic-lead' }), error('ALREADY_EXISTS'));
});

test('JSON text with special characters roundtrips through bound SQL without SQL injection', t => {
  const f = fixture(t);
  const title = `Synthetic '); DROP TABLE entities; -- 中文 "quote"\nsecond line`;
  const result = f.call('goal.create', { id: 'special-character-goal', storeId: 'synthetic-store', title, metric: 'qualified-leads', target: 1, deadline: f.future(1), constraints: [] });
  assert.equal(result.data.title, title);
  assert.equal(f.call('entity.get', { type: 'goal', id: 'special-character-goal' }).data.title, title);
  assert.equal(f.call('ledger.verify').data.ok, true);
});

function runWorker(dataDir, action, key) {
  const script = fileURLToPath(new URL('./concurrency-worker.mjs', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, dataDir, action, key], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => { if (code !== 0) reject(new Error(`Synthetic worker failed: ${errors}`)); else { try { resolve(JSON.parse(output)); } catch (error) { reject(error); } } });
  });
}
test('concurrent processes share one idempotent transaction without duplicate business objects', async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 6 }, () => runWorker(f.directory, 'write', 'concurrent-same-request')));
  assert.equal(results.filter(result => result.replayed === false).length, 1);
  assert.equal(results.filter(result => result.replayed === true).length, 5);
  assert.equal(f.call('entity.list', { type: 'goal' }).data.filter(goal => goal.id === 'concurrent-goal').length, 1);
  assert.equal(f.call('ledger.verify').data.ok, true);
});
test('concurrent claimers obtain at most one valid lease for the same task', async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 5 }, (_, index) => runWorker(f.directory, 'claim', `concurrent-claim-${index}`)));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.ok(results.filter(result => !result.ok).every(result => result.code === 'NO_READY_TASK'));
  assert.equal(f.call('ledger.verify').data.ok, true);
});

test('partial synthetic seed interruption recovers committed objects without overwriting them', t => {
  const f = fixture(t, { seed: false });
  const original = f.engine.call;
  f.engine.call = (operation, input, actor) => {
    if (operation === 'workflow.start' && input.id === 'synthetic-delivery-flow') throw new Error('Synthetic interrupted seed process');
    return original(operation, input, actor);
  };
  assert.throws(() => seedSyntheticDemo(f.engine), /interrupted seed/);
  f.engine.call = original;
  f.advance(2);
  const before = f.call('entity.get', { type: 'sku', id: 'SYN-GW-01' }).data;
  seedSyntheticDemo(f.engine);
  assert.equal(f.call('entity.get', { type: 'sku', id: 'SYN-GW-01' }).data.version, before.version);
  assert.equal(f.call('entity.list', { type: 'workflow' }).data.length, 2);
  assert.equal(f.call('ledger.verify').data.ok, true);
});

test('model cannot invent a customer budget; unqualified lead proceeds directly to owner report', t => {
  const f = fixture(t), lease = f.claim('synthetic-growth-flow');
  assert.throws(() => f.submit(lease, { fit: true, budgetCents: 900000, renovationStage: 'finished', needs: ['Synthetic'], reason: 'Invented', missingInformation: [] }), error('CUSTOMER_BUDGET_MISMATCH'));
  f.submit(lease, { fit: false, budgetCents: 200000, renovationStage: 'finished', needs: ['Synthetic'], reason: 'Synthetic project schedule is unavailable.', missingInformation: ['schedule'] });
  const next = f.claim('synthetic-growth-flow');
  assert.equal(next.task.phase, 'owner-report');
  f.submit(next, report);
  const workflow = f.call('workflow.get', { workflowId: 'synthetic-growth-flow' }).data;
  assert.equal(workflow.skippedPhases.length, 2);
  assert.equal(f.call('entity.list', { type: 'experience' }).data.length, 0);
});

test('low-margin or excessive-discount draft may be inspected but human approval cannot bypass hard limits', t => {
  const f = fixture(t);
  f.call('solution.build', { id: 'policy-solution', surveyId: 'synthetic-survey', ...solutionArtifact() });
  for (const [name, laborCostCents, discountCents] of [['low-margin', 20000, 0], ['high-discount', 3000, 6000]]) {
    const quote = f.call('quote.create', { id: name, solutionId: 'policy-solution', laborCostCents, laborPriceCents: 6000, discountCents, validUntil: f.future(5), terms: 'Synthetic diagnostic-only policy fixture.' }).data;
    assert.equal(quote.status, 'draft');
    assert.ok(quote.policyViolations.length > 0);
    const approval = f.call('quote.request_approval', { quoteId: quote.id, expiresAt: f.future(1), reason: 'Synthetic policy attempt' }).data;
    assert.throws(() => f.call('approval.decide', { approvalId: approval.id, decision: 'approved', reason: 'Synthetic owner tries unsafe override', contentDigest: approval.contentDigest }, f.human), error('QUOTE_POLICY_BLOCKED'));
  }
});

test('tenant financial policy can only tighten and needs owner confirmation for threshold changes', t => {
  const f = fixture(t), store = f.call('entity.get', { type: 'store', id: 'synthetic-store' }).data;
  const input = { id: store.id, name: store.name, city: store.city, serviceAreas: store.serviceAreas, minMarginRatio: 0.3, maxDiscountRatio: 0.06, expectedVersion: store.version };
  assert.throws(() => f.call('store.upsert', { ...input, minMarginRatio: 0.1 }, f.human), error('FENCE_LOOSENING_BLOCKED'));
  assert.throws(() => f.call('store.upsert', input), error('HUMAN_REVIEW_REQUIRED'));
  f.call('store.upsert', input, f.human);
  assert.equal(f.call('entity.get', { type: 'store', id: store.id }).data.minMarginRatio, 0.3);
});

test('contradictory exact-version compatibility evidence blocks old favorable evidence', t => {
  const f = fixture(t);
  f.call('compatibility.record', { id: 'incompatible-test-evidence', leftSkuId: 'SYN-GW-01', rightSkuId: 'SYN-LIGHT-01', result: 'incompatible', conditions: 'Synthetic conflict fixture; no actual product claim.', evidence: f.evidence('contrary-compatibility'), expiresAt: f.future(5) });
  assert.throws(() => f.call('solution.build', { id: 'conflicting-solution', surveyId: 'synthetic-survey', ...solutionArtifact() }), error('COMPATIBILITY_CONFLICT'));
});

test('expired compatibility and changed SKU invalidate an already drafted quote before approval', t => {
  const f = fixture(t);
  f.submit(f.claim('synthetic-delivery-flow'), solutionArtifact()); f.submit(f.claim('synthetic-delivery-flow'), quoteArtifact(f));
  const sku = f.call('entity.get', { type: 'sku', id: 'SYN-LIGHT-01' }).data;
  f.call('sku.upsert', { id: sku.id, manufacturer: sku.manufacturer, model: sku.model, category: sku.category, protocol: sku.protocol, firmwareVersion: 'changed-synthetic-firmware', costCents: sku.costCents, priceCents: sku.priceCents, evidence: f.evidence('new-firmware'), expectedVersion: sku.version });
  const approval = f.call('approval.list').data[0];
  assert.throws(() => f.call('approval.decide', { approvalId: approval.id, decision: 'approved', reason: 'Synthetic stale attempt', contentDigest: approval.contentDigest }, f.human), error('SOLUTION_SKU_STALE'));
});

test('mains-powered BOM validates surveyed neutral wire, voltage and cumulative load', t => {
  const f = fixture(t);
  const requirements = { powerType: 'mains', requiresNeutralWire: true, ratedWatts: 1200, voltageMin: 200, voltageMax: 240, requiresInternet: false, requiresWiredBackhaul: false };
  f.call('sku.upsert', { id: 'SYN-MAINS-01', manufacturer: 'Synthetic', model: 'Synthetic mains test fixture, not purchasable', category: 'lighting', protocol: 'synthetic-standalone', firmwareVersion: 'synthetic-1', costCents: 100, priceCents: 200, evidence: f.evidence('mains-spec'), installationRequirements: requirements });
  const base = { id: 'mains-solution', surveyId: 'synthetic-survey', name: 'Synthetic mains fixture', bom: [{ skuId: 'SYN-MAINS-01', roomId: 'living-room', quantity: 2, circuitId: 'lighting-circuit' }], scenes: [{ id: 'mains-scene', roomId: 'living-room', name: 'Synthetic', trigger: 'Synthetic', behavior: 'Synthetic', skuIds: ['SYN-MAINS-01'] }], compatibilityIds: [] };
  assert.throws(() => f.call('solution.build', base), error('CIRCUIT_OVERLOAD'));
  assert.throws(() => f.call('solution.build', { ...base, bom: [{ skuId: 'SYN-MAINS-01', roomId: 'living-room', quantity: 1 }] }), error('CIRCUIT_REQUIRED'));
  const result = f.call('solution.build', { ...base, bom: [{ ...base.bom[0], quantity: 1 }] }).data;
  assert.equal(result.electricalLoadChecks['living-room:lighting-circuit'], 1200);
  assert.equal(result.physicalFeasibilityVerified, false);
});

test('model proposed goal with a valid prerequisite starts a real child task; missing prerequisite stays waiting-input', t => {
  const f = fixture(t);
  f.call('lead.create', { id: 'synthetic-second-lead', storeId: 'synthetic-store', alias: '合成客户B', contactRef: 'synthetic-contact-B', channel: 'designer', intent: 'Synthetic known project only', budgetCents: 100000, renovationStage: 'design', consent: { status: 'granted', purposes: ['consultation', 'appointment'], evidence: f.evidence('second-consent') } });
  f.call('goal.create', { id: 'auto-manager-goal', storeId: 'synthetic-store', title: 'Synthetic auto manager', metric: 'management-reports', target: 1, deadline: f.future(10), constraints: ['No external contact'] });
  f.call('workflow.start', { id: 'auto-manager-flow', kind: 'management-loop', goalId: 'auto-manager-goal' });
  f.submit(f.claim('auto-manager-flow'), { observations: [{ metric: 'qualified-leads', value: 0, explanation: 'Synthetic local record count.' }], bottlenecks: [] });
  const result = f.submit(f.claim('auto-manager-flow'), { actions: [{ title: 'Qualify known lead', employee: 'lead-concierge', skill: 'lead-qualification', priority: 'P0', outcome: 'Validated qualification record.' }], proposedGoals: [{ title: 'Synthetic linked goal', metric: 'qualified-leads', target: 1, deadline: f.future(7), constraints: ['Local-only'], leadId: 'synthetic-second-lead' }, { title: 'Synthetic missing input goal', metric: 'accepted-projects', target: 1, deadline: f.future(7), constraints: ['No invented site survey'] }] });
  assert.equal(result.applied.generatedWorkflowIds.length, 1);
  assert.equal(result.applied.waitingInputs.length, 1);
  const child = f.claim(result.applied.generatedWorkflowIds[0]);
  assert.equal(child.task.phase, 'qualification');
  assert.equal(child.task.context.refs.lead.id, 'synthetic-second-lead');
  const waiting = f.call('entity.get', { type: 'goal', id: result.applied.waitingInputs[0].goalId }).data;
  assert.equal(waiting.status, 'waiting-input');
});

test('duplicate active workflows and mismatched goal metric cannot create phantom task queues', t => {
  const f = fixture(t);
  assert.throws(() => f.call('workflow.start', { id: 'duplicate-flow', kind: 'growth-acquisition', goalId: 'synthetic-growth-goal', leadId: 'synthetic-lead' }), error('DUPLICATE_ACTIVE_WORKFLOW'));
  assert.throws(() => f.call('workflow.start', { id: 'metric-mismatch-flow', kind: 'project-delivery', goalId: 'synthetic-growth-goal', surveyId: 'synthetic-survey' }), error('GOAL_WORKFLOW_MISMATCH'));
  assert.equal(f.call('entity.list', { type: 'task' }).data.length, 2);
});

test('maximum workflow ID leaves usable task and approval IDs; excessive workflow ID is rejected', t => {
  const f = fixture(t);
  f.call('goal.create', { id: 'long-id-manager-goal', storeId: 'synthetic-store', title: 'Synthetic length fixture', metric: 'management-reports', target: 1, deadline: f.future(4), constraints: [] });
  const workflowId = 'w'.repeat(64);
  f.call('workflow.start', { id: workflowId, kind: 'management-loop', goalId: 'long-id-manager-goal' });
  const lease = f.claim(workflowId);
  assert.ok(lease.taskId.length <= 100);
  f.submit(lease, { observations: [{ metric: 'qualified-leads', value: 0, explanation: 'Synthetic measured count.' }], bottlenecks: [] });
  assert.throws(() => f.call('workflow.start', { id: 'x'.repeat(65), kind: 'management-loop', goalId: 'long-id-manager-goal' }), error('INVALID_INPUT'));
});

test('idempotency receipt forgery is detected and prevents replay of fabricated results', t => {
  const f = fixture(t);
  const db = new DatabaseSync(join(f.directory, 'business.sqlite'));
  db.exec('DROP TRIGGER idempotency_no_update');
  db.prepare('UPDATE idempotency SET result=? WHERE key=?').run('{"operation":"store.upsert","data":{"status":"forged"}}', 'demo:store');
  db.close();
  const verify = f.call('ledger.verify').data;
  assert.equal(verify.ok, false);
  assert.ok(verify.issues.some(issue => /IDEMPOTENCY/.test(issue.code)));
  assert.throws(() => f.call('workflow.tick'), error('LEDGER_INTEGRITY_FAILURE'));
  assert.throws(() => f.call('entity.list', { type: 'project' }), error('LEDGER_INTEGRITY_FAILURE'));
});

test('events retain industry fence evidence for every model child operation', t => {
  const f = fixture(t);
  f.submit(f.claim('synthetic-delivery-flow'), solutionArtifact()); f.submit(f.claim('synthetic-delivery-flow'), quoteArtifact(f));
  const events = f.call('ledger.list').data;
  const quoteSubmit = events.filter(event => event.decision.action === 'task.submit').at(-1);
  assert.ok(quoteSubmit.rule_impact.some(rule => rule.rule_id === 'R-SH7' && rule.result === 'review'));
  assert.ok(quoteSubmit.rule_impact.some(rule => rule.rule_id === 'R-SH10'));
});
