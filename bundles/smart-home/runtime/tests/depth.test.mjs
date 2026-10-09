import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createBusinessEngine, seedSyntheticScenario, OPERATION_CATALOGUE, WORKFORCE, SKILLS } from '../index.mjs';

const anchor = '2026-10-09T01:00:00.000Z';
const datasetId = 'shuguang-chengdu-v1';
const storeId = 'SG-CD-GX-STORE';
const error = code => caught => { assert.equal(caught.code, code, caught.message); return true; };
function fixture(t, { seed = true, dataMode = 'sandbox', directory, tenantId = 'depth-test-tenant', workspaceId = 'depth-test-workspace', clock } = {}) {
  const dataDir = directory ?? mkdtempSync(join(tmpdir(), 'bms-depth-'));
  let time = Date.parse(anchor), key = 0;
  const engine = createBusinessEngine({ dataDir, tenantId, workspaceId, dataMode, clock: clock ?? (() => new Date(time)) });
  const agent = { ...engine.scope, id: 'depth-test-host', role: 'agent', channel: 'mcp' };
  const human = { ...engine.scope, id: 'depth-test-owner', role: 'owner', channel: dataMode === 'live' ? 'cli' : 'test', humanConfirmed: true };
  const operator = { ...engine.scope, id: 'depth-test-operator', role: 'operator', channel: 'cli', humanConfirmed: false };
  const call = (operation, input = {}, actor = agent, requestKey) => engine.call(operation, OPERATION_CATALOGUE.find(item => item.name === operation).readOnly ? input : { ...input, idempotencyKey: requestKey ?? `depth-${++key}` }, actor);
  const get = (type, id) => call('entity.get', { type, id }).data;
  const list = type => call('entity.list', { type, limit: 500 }).data;
  const evidence = (label = 'fixture', source = 'synthetic') => ({ uri: `evidence://synthetic/depth-test/${label}`, sha256: 'c'.repeat(64), source, observedAt: new Date(time - 60000).toISOString(), summary: 'Explicit synthetic unit-test evidence; no actual person, signature, payment or field operation.' });
  const inputOf = (operation, entity, overrides = {}) => {
    const schema = OPERATION_CATALOGUE.find(item => item.name === operation).schema;
    return { ...Object.fromEntries(Object.keys(schema.properties).filter(key => key !== 'idempotencyKey' && entity[key] !== undefined).map(key => [key, entity[key]])), ...overrides };
  };
  const seedResult = seed ? seedSyntheticScenario(engine, { anchorDate: anchor }) : null;
  t.after(() => { engine.close(); if (!directory) rmSync(dataDir, { recursive: true, force: true }); });
  return { engine, dataDir, agent, human, operator, call, get, list, evidence, inputOf, seedResult, advance(days) { time += days * 86400000; }, future(days) { return new Date(time + days * 86400000).toISOString(); } };
}
function proposalArtifact(lease, patch = { preferredContactWindow: 'A proposed contact window requiring customer confirmation.' }) {
  return { objective: 'Prepare a concrete customer information confirmation draft.', plan: [{ step: 'Read the exact assigned lead version and separate known facts from missing information.', deliverable: 'Proposed field patch and questions for a human to confirm.', actionType: 'human-review' }], evidenceReferences: lease.task.context.assignedObjects.map(item => item.reference), risks: ['No budget, renovation stage or permission may be inferred from an opaque WeChat reference.'], ownerDecisions: ['A human must confirm the source before applying customer facts.'], nextActions: [], proposedLeadPatch: patch, confirmationQuestions: ['What is the renovation stage and which service area should be recorded?'] };
}
function submit(f, lease, artifact) { return f.call('task.submit', { taskId: lease.taskId, leaseToken: lease.leaseToken, artifact, modelTrace: { host: 'test', model: 'synthetic-unit-test-artifact-provider', invocationRef: 'depth-artifact-test' } }).data; }

test('rich scenario imports all stage documents atomically while all forty-nine skill assignments remain genuinely ready', t => {
  const f = fixture(t);
  assert.equal(f.seedResult.counts.lead, 12); assert.equal(f.seedResult.counts.customer, 7);
  assert.equal(f.seedResult.counts.pointPlan, 9); assert.equal(f.seedResult.counts.design, 9); assert.equal(f.seedResult.counts.construction, 9);
  assert.equal(f.seedResult.counts.contract, 7); assert.equal(f.seedResult.counts.business, 23);
  assert.equal(f.seedResult.counts.task, SKILLS.length + 4); assert.equal(WORKFORCE.length, 27);
  const tasks = f.list('task');
  assert.ok(tasks.every(task => task.status === 'ready' && task.artifact === null && task.modelTrace === undefined && task.completedAt === undefined));
  assert.equal(new Set(tasks.filter(task => task.phase === 'skill-plan').map(task => task.skill)).size, 49);
  const event = f.call('ledger.list').data[0];
  assert.equal(event.who.type, 'synthetic-importer'); assert.equal(event.receipt.humanReviewPerformed, false); assert.equal(event.receipt.modelInvocationPerformed, false);
  assert.equal(f.call('ledger.verify').data.checkedEvents, 1); assert.equal(f.call('ledger.verify').data.checkedEntities, 261);
  assert.ok(f.list('approval').filter(item => item.status === 'approved').every(item => item.decision.basis === 'synthetic-history-import' && item.decision.humanReviewPerformed === false));
  assert.ok(f.list('contract').filter(item => item.status === 'signed-local-record').every(item => item.humanReviewPerformed === false && item.humanSigningRecorded === false && item.actualCashMovement === false));
});

for (const [field, value] of [['surname', '林'], ['alias', '合成称谓'], ['phoneRef', 'SYN-PHONE-ONLY'], ['wechatRef', 'SYN-WX-ONLY'], ['buildingRef', 'SYN-BUILDING-ONLY'], ['buildingName', '云岚庭（虚构）']]) test(`progressive intake accepts only ${field} without fabricating missing customer facts`, t => {
  const f = fixture(t);
  const lead = f.call('lead.create', { id: `minimal-${field}`, storeId, [field]: value }).data;
  assert.equal(lead[field], value); assert.equal(lead.channel, 'unknown'); assert.equal(lead.consent.status, 'unknown');
  for (const unknown of ['budgetCents', 'renovationStage', 'intent']) assert.equal(Object.hasOwn(lead, unknown), false);
  assert.equal(lead.completeness.handoffReady, false); assert.ok(lead.completeness.missingFields.length >= 5);
});

test('empty intake, plain contact details, permission injection and fake synthetic provenance are rejected', t => {
  const f = fixture(t), before = f.call('ledger.verify').data.checkedEvents;
  assert.throws(() => f.call('lead.create', { id: 'empty-intake', storeId }), error('LEAD_IDENTIFIER_REQUIRED'));
  assert.throws(() => f.call('lead.create', { id: 'pii-intake', storeId, phoneRef: '13812345678' }), error('PII_REJECTED'));
  assert.throws(() => f.call('lead.create', { id: 'fake-consent', storeId, surname: '林', customerAccepted: true }), error('INVALID_INPUT'));
  assert.throws(() => f.call('lead.create', { id: 'fake-history', storeId, surname: '林', source: 'synthetic-history' }), error('CUSTOMER_FACT_CONFIRMATION_REQUIRED'));
  assert.throws(() => f.call('lead.enrich', { leadId: 'SG-L01', expectedVersion: 1, patch: { status: 'qualified' }, source: 'model-proposal', evidence: f.evidence() }), error('INVALID_INPUT'));
  assert.equal(f.call('ledger.verify').data.checkedEvents, before);
});

test('model enrichment creates a version-bound pending draft and cannot apply customer facts or permissions', t => {
  const f = fixture(t), before = f.get('lead', 'SG-L02');
  const proposal = f.call('lead.enrich', { leadId: before.id, expectedVersion: before.version, patch: { budgetCents: 900000, renovationStage: 'design' }, source: 'model-proposal', evidence: f.evidence('proposal') }).data;
  assert.equal(proposal.status, 'pending-human-confirmation'); assert.equal(proposal.customerFactsApplied, false); assert.equal(proposal.consentGranted, false);
  assert.deepEqual(f.get('lead', before.id), before);
  assert.throws(() => f.call('lead.enrich', { leadId: before.id, expectedVersion: before.version, patch: {}, source: 'model-proposal', evidence: f.evidence() }), error('EMPTY_LEAD_PATCH'));
});

test('confirmed enrichment requires a human source, preserves field history and refuses stale lost updates', t => {
  const f = fixture(t), before = f.get('lead', 'SG-L01');
  const input = { leadId: before.id, expectedVersion: before.version, patch: { wechatRef: 'SYN-WX-L01', buildingName: '云溪坊（虚构）', budgetCents: 1800000 }, source: 'customer', evidence: f.evidence('human-supplied') };
  assert.throws(() => f.call('lead.enrich', input), error('HUMAN_REVIEW_REQUIRED'));
  const result = f.call('lead.enrich', input, f.human, 'confirmed-enrichment');
  assert.equal(result.data.version, before.version + 1); assert.equal(result.data.enrichmentHistory.at(-1).source, 'customer');
  assert.equal(result.data.enrichmentHistory.at(-1).newValues.budgetCents, 1800000);
  assert.equal(result.data.consent.status, 'unknown');
  assert.equal(f.call('lead.enrich', input, f.human, 'confirmed-enrichment').replayed, true);
  assert.throws(() => f.call('lead.enrich', input, f.human), error('VERSION_CONFLICT'));
  assert.throws(() => f.call('lead.enrich', { ...input, expectedVersion: result.data.version, source: 'synthetic-history' }, f.human), error('SYNTHETIC_HISTORY_CONTEXT_REQUIRED'));
});

test('two specialized enrichment skills persist real proposals, exact references and explicit readiness without replacing lead facts', t => {
  const f = fixture(t), before = f.get('lead', 'SG-L02');
  for (const skill of ['lead-profile-enrichment', 'customer-handoff-check']) {
    const task = f.list('task').find(item => item.skill === skill);
    const lease = f.call('task.claim', { taskId: task.id }).data;
    assert.ok(lease.outputSchema.required.includes('proposedLeadPatch')); assert.ok(lease.outputSchema.required.includes('confirmationQuestions'));
    const artifact = { ...proposalArtifact(lease), ...(skill === 'customer-handoff-check' ? { handoffReady: false } : {}) };
    if (skill === 'customer-handoff-check') assert.throws(() => submit(f, lease, { ...artifact, handoffReady: true }), error('HANDOFF_READINESS_MISMATCH'));
    const result = submit(f, lease, artifact), proposal = f.get('leadEnrichment', result.applied.leadEnrichmentId);
    assert.equal(proposal.baseVersion, before.version); assert.equal(proposal.confirmationQuestions.length, 1);
    assert.equal(f.get('report', result.applied.reportId).leadEnrichmentId, proposal.id);
    assert.equal(result.applied.customerFactsApplied, false); assert.equal(result.applied.confirmationRequired, true);
  }
  assert.deepEqual(f.get('lead', before.id), before); assert.equal(f.list('leadEnrichment').length, 2);
});

test('the public workflow catalogue exposes both specialized output contracts before a host claims its task', t => {
  const f = fixture(t), workflow = f.engine.catalog().workflows.find(item => item.id === 'employee-work');
  assert.deepEqual(Object.keys(workflow.dynamicAssignment.outputSchemaBySkill).sort(), ['customer-handoff-check', 'lead-profile-enrichment']);
  for (const skill of ['lead-profile-enrichment', 'customer-handoff-check']) {
    const task = f.list('task').find(item => item.skill === skill), lease = f.call('task.claim', { taskId: task.id }).data;
    assert.deepEqual(lease.outputSchema, workflow.dynamicAssignment.outputSchemaBySkill[skill]);
    assert.equal(lease.outputSchema.required.includes('handoffReady'), skill === 'customer-handoff-check');
  }
});

test('specialized proposals reject missing lead assignment, a changed lead and fabricated extra output fields', t => {
  const f = fixture(t);
  assert.throws(() => f.call('workflow.start', { id: 'wrong-enrichment-refs', kind: 'employee-work', goalId: 'SG-GOAL-MANAGEMENT', employeeId: 'lead-enrichment-specialist', skillId: 'lead-profile-enrichment', brief: 'No lead supplied.', objectRefs: [{ type: 'store', id: storeId }] }), error('ENRICHMENT_LEAD_REQUIRED'));
  const task = f.list('task').find(item => item.skill === 'lead-profile-enrichment'), lease = f.call('task.claim', { taskId: task.id }).data;
  assert.throws(() => submit(f, lease, { ...proposalArtifact(lease), approved: true }), error('INVALID_INPUT'));
  const lead = f.get('lead', 'SG-L02');
  f.call('lead.enrich', { leadId: lead.id, expectedVersion: lead.version, patch: { surname: '林' }, source: 'customer', evidence: f.evidence() }, f.human);
  assert.throws(() => submit(f, lease, proposalArtifact(lease)), error('WORK_REFERENCE_STALE'));
  assert.equal(f.list('leadEnrichment').length, 0); assert.equal(f.get('task', task.id).status, 'leased');
});

test('customer dossier revisions preserve previous contents and require consent, source confirmation and stable linkage', t => {
  const f = fixture(t), customer = f.get('customer', 'SG-C06');
  const input = f.inputOf('customer.upsert', customer, { expectedVersion: customer.version, source: 'customer', evidence: f.evidence(), preferences: { ...customer.preferences, priorities: ['客户确认后变更为手动优先', ...customer.preferences.priorities] } });
  assert.throws(() => f.call('customer.upsert', input), error('PERMISSION_DENIED'));
  assert.throws(() => f.call('customer.upsert', input, f.operator), error('HUMAN_REVIEW_REQUIRED'));
  const updated = f.call('customer.upsert', input, f.human).data;
  assert.equal(updated.revisionHistory.length, 1); assert.deepEqual(updated.revisionHistory[0].content.preferences, customer.preferences);
  assert.throws(() => f.call('customer.upsert', input, f.human), error('VERSION_CONFLICT'));
  assert.throws(() => f.call('customer.upsert', { ...input, expectedVersion: updated.version, leadId: 'SG-L07' }, f.human), error('CUSTOMER_REPARENT_BLOCKED'));
  assert.throws(() => f.call('customer.upsert', { ...input, id: 'no-consent-customer', leadId: 'SG-L01', expectedVersion: undefined }, f.human), error('CONSENT_REQUIRED'));
});

test('point diagrams validate geometry, unique points, surveyed rooms/circuits and customer ownership', t => {
  const f = fixture(t), plan = f.get('pointPlan', 'SG-POINT06-V1');
  const input = f.inputOf('pointPlan.record', plan, { id: 'point-next', revision: 2, previousRevisionId: plan.id, evidence: f.evidence() });
  assert.throws(() => f.call('pointPlan.record', { ...input, points: [{ ...plan.points[0], xMm: 99999 }] }), error('POINT_OUTSIDE_ROOM'));
  assert.throws(() => f.call('pointPlan.record', { ...input, points: [plan.points[0], plan.points[0]] }), error('DUPLICATE_POINT_ID'));
  assert.throws(() => f.call('pointPlan.record', { ...input, rooms: [{ roomId: 'unknown', widthMm: 1000, lengthMm: 1000 }] }), error('POINT_ROOM_INVALID'));
  assert.throws(() => f.call('pointPlan.record', { ...input, points: [{ ...plan.points[0], circuitId: 'unsurveyed' }] }), error('UNKNOWN_CIRCUIT'));
  assert.throws(() => f.call('pointPlan.record', { ...input, customerId: 'SG-C07' }), error('CUSTOMER_SURVEY_MISMATCH'));
  const next = f.call('pointPlan.record', input).data;
  assert.equal(next.previousDigest.length, 64); assert.equal(next.diagramUnits, 'millimetres'); assert.equal(next.constructionAuthorized, false);
  assert.equal(f.get('pointPlan', plan.id).version, 1);
});

test('engineering revision chains prevent forks, skipped revision numbers and silent mutation of old documents', t => {
  const f = fixture(t), plan = f.get('pointPlan', 'SG-POINT06-V1');
  const input = f.inputOf('pointPlan.record', plan, { id: 'new-point-v2', revision: 2, previousRevisionId: plan.id, evidence: f.evidence() });
  assert.throws(() => f.call('pointPlan.record', { ...input, revision: 3 }), error('REVISION_CHAIN_INVALID'));
  f.call('pointPlan.record', input);
  assert.throws(() => f.call('pointPlan.record', { ...input, id: 'fork-point-v2' }), error('REVISION_CHAIN_INVALID'));
  assert.throws(() => f.call('contract.request_approval', { contractId: 'SG-CONTRACT06', expiresAt: f.future(2), reason: 'Old drawing cannot become a new promise.' }), error('DOCUMENT_REVISION_SUPERSEDED'));
  assert.equal(f.get('pointPlan', plan.id).revision, 1); assert.equal(f.call('ledger.verify').data.ok, true);
});

test('design and construction reject incomplete scenes, mismatched versions, wrong materials and unsafe scheduling order', t => {
  const f = fixture(t), design = f.get('design', 'SG-DESIGN06-V1'), construction = f.get('construction', 'SG-BUILD06-V1');
  const designInput = f.inputOf('design.record', design, { id: 'next-design', revision: 2, previousRevisionId: design.id, evidence: f.evidence() });
  assert.throws(() => f.call('design.record', { ...designInput, sceneNotes: design.sceneNotes.slice(1) }), error('DESIGN_SCENE_COVERAGE'));
  assert.throws(() => f.call('design.record', { ...designInput, customerId: 'SG-C07' }), error('DESIGN_REFERENCE_MISMATCH'));
  const input = f.inputOf('construction.record', construction, { id: 'next-construction', revision: 2, previousRevisionId: construction.id, evidence: f.evidence() });
  assert.throws(() => f.call('construction.record', { ...input, materials: construction.materials.slice(1) }), error('CONSTRUCTION_BOM_MISMATCH'));
  assert.throws(() => f.call('construction.record', { ...input, milestones: [...construction.milestones].reverse() }), error('MILESTONE_ORDER'));
  assert.throws(() => f.call('construction.record', { ...input, milestones: construction.milestones.map((row, index) => ({ ...row, dueAt: f.future(index === 1 ? 1 : 10 + index) })) }), error('MILESTONE_DATE_ORDER'));
  assert.throws(() => f.call('construction.record', { ...input, qualityChecks: [{ ...construction.qualityChecks[0], responsibleRole: 'unregistered' }] }), error('UNKNOWN_EMPLOYEE'));
});

test('a point sketch stays a draft until design locates the exact room-by-SKU BOM quantities', t => {
  const f = fixture(t), point = f.get('pointPlan', 'SG-POINT06-V1'), design = f.get('design', 'SG-DESIGN06-V1');
  const makePoint = (id, revision, previousRevisionId, points) => f.call('pointPlan.record', f.inputOf('pointPlan.record', point, { id, revision, previousRevisionId, points, evidence: f.evidence() })).data;
  const designInput = f.inputOf('design.record', design, { id: 'closed-design-v2', revision: 2, previousRevisionId: design.id, evidence: f.evidence() });
  const partial = makePoint('partial-device-point-plan', 2, point.id, [point.points[0]]);
  assert.equal(partial.constructionAuthorized, false);
  assert.throws(() => f.call('design.record', { ...designInput, pointPlanId: partial.id }), error('DESIGN_POINT_BOM_MISMATCH'));
  const complete = makePoint('complete-device-point-plan', 3, partial.id, point.points);
  const corrected = f.call('design.record', { ...designInput, pointPlanId: complete.id }).data;
  assert.equal(corrected.status, 'draft-local-validated');
  const extra = makePoint('extra-device-point-plan', 4, complete.id, [...point.points, { ...point.points[0], id: 'extra-device-point' }]);
  assert.throws(() => f.call('design.record', { ...designInput, id: 'wrong-design-v3', revision: 3, previousRevisionId: corrected.id, pointPlanId: extra.id }), error('DESIGN_POINT_BOM_MISMATCH'));
  const unassigned = makePoint('unassigned-device-point-plan', 5, extra.id, [...point.points, { ...point.points[0], id: 'unassigned-device-point', skuId: undefined }]);
  assert.throws(() => f.call('design.record', { ...designInput, id: 'unassigned-design-v3', revision: 3, previousRevisionId: corrected.id, pointPlanId: unassigned.id }), error('DESIGN_POINT_SKU_REQUIRED'));
  assert.equal(f.get('design', design.id).version, 1); assert.equal(f.call('ledger.verify').data.ok, true);
});

test('contracts require matching engineering, exact payment total and independent current quote approval', t => {
  const f = fixture(t), contract = f.get('contract', 'SG-CONTRACT06');
  const input = f.inputOf('contract.create', contract, { id: 'manual-contract' });
  assert.throws(() => f.call('contract.create', { ...input, paymentSchedule: [{ label: 'Wrong', amountCents: 1, dueRule: 'Not a real payment.' }] }), error('CONTRACT_PAYMENT_TOTAL_MISMATCH'));
  assert.throws(() => f.call('contract.create', { ...input, constructionId: 'SG-BUILD07-V2' }), error('CONTRACT_REFERENCE_MISMATCH'));
  assert.throws(() => f.call('contract.request_approval', { contractId: 'SG-CONTRACT06', expiresAt: f.future(2), reason: 'Unapproved quote.' }), error('APPROVED_QUOTE_REQUIRED'));
  assert.throws(() => f.call('contract.record_signing', { contractId: 'SG-CONTRACT06', evidence: f.evidence() }, f.human), error('APPROVED_CONTRACT_REQUIRED'));
});

test('contract approval binds the exact digest, signing remains human-only and projects require signed dossier-backed contracts', t => {
  const f = fixture(t), quote = f.get('quote', 'SG-QUOTE06');
  const quoteApproval = f.call('quote.request_approval', { quoteId: quote.id, expiresAt: f.future(3), reason: 'Explicit synthetic human test approval.' }).data;
  f.call('approval.decide', { approvalId: quoteApproval.id, decision: 'approved', contentDigest: quoteApproval.contentDigest, reason: 'Test owner approves local fixture only.' }, f.human);
  const approval = f.call('contract.request_approval', { contractId: 'SG-CONTRACT06', expiresAt: f.future(2), reason: 'Independent local contract review.' }).data;
  assert.throws(() => f.call('approval.decide', { approvalId: approval.id, decision: 'approved', contentDigest: 'a'.repeat(64), reason: 'Wrong content.' }, f.human), error('APPROVAL_CONTENT_MISMATCH'));
  f.call('approval.decide', { approvalId: approval.id, decision: 'approved', contentDigest: approval.contentDigest, reason: 'Owner confirms this exact fixture.' }, f.human);
  assert.throws(() => f.call('contract.record_signing', { contractId: 'SG-CONTRACT06', evidence: f.evidence() }), error('PERMISSION_DENIED'));
  assert.throws(() => f.call('project.create', { id: 'missing-contract-project', quoteId: quote.id, contractEvidence: f.evidence(), dueAt: f.future(8) }, f.human), error('SIGNED_CONTRACT_REQUIRED'));
  const signed = f.call('contract.record_signing', { contractId: 'SG-CONTRACT06', evidence: f.evidence() }, f.human).data;
  assert.equal(signed.externallySigned, false); assert.equal(signed.actualCashMovement, false);
  const project = f.call('project.create', { id: 'manual-project', quoteId: quote.id, contractId: signed.id, contractEvidence: f.evidence(), dueAt: f.future(8) }, f.human).data;
  assert.equal(project.contractDigest, signed.commitmentDigest); assert.equal(project.constructionId, signed.constructionId);
  assert.throws(() => f.call('contract.record_signing', { contractId: signed.id, evidence: f.evidence() }, f.human), error('APPROVED_CONTRACT_REQUIRED'));
});

test('changed customer data or expired approvals invalidate a pending contract without applying the decision', t => {
  const f = fixture(t), approval = f.list('approval').find(item => item.targetType === 'contract' && item.targetId === 'SG-CONTRACT12');
  const customer = f.get('customer', 'SG-C12');
  f.call('customer.upsert', f.inputOf('customer.upsert', customer, { expectedVersion: customer.version, source: 'customer', evidence: f.evidence(), communication: { ...customer.communication, cadence: 'A newly human-confirmed communication plan.' } }), f.human);
  assert.throws(() => f.call('approval.decide', { approvalId: approval.id, decision: 'approved', contentDigest: approval.contentDigest, reason: 'Cannot approve stale dossier.' }, f.human), error('DOCUMENT_REFERENCE_STALE'));
  assert.equal(f.get('approval', approval.id).status, 'pending');
  f.advance(5);
  assert.throws(() => f.call('approval.decide', { approvalId: approval.id, decision: 'approved', contentDigest: approval.contentDigest, reason: 'Expired.' }, f.human), error('APPROVAL_EXPIRED'));
});

test('business observations need a human, exact amount/quantity and local-store references while never executing money movement', t => {
  const f = fixture(t);
  const input = { id: 'observed-payment', storeId, kind: 'payment-observation', occurredAt: anchor, summary: 'A synthetic observed bookkeeping entry, not a bank-confirmed receipt.', amountCents: 18000, objectRefs: [{ type: 'contract', id: 'SG-CONTRACT09' }], evidence: f.evidence() };
  assert.throws(() => f.call('business.record', input), error('PERMISSION_DENIED'));
  assert.throws(() => f.call('business.record', input, f.operator), error('HUMAN_REVIEW_REQUIRED'));
  assert.throws(() => f.call('business.record', { ...input, amountCents: undefined }, f.human), error('BUSINESS_AMOUNT_REQUIRED'));
  assert.throws(() => f.call('business.record', { ...input, occurredAt: f.future(1) }, f.human), error('FUTURE_BUSINESS_OBSERVATION'));
  const record = f.call('business.record', input, f.human).data;
  for (const field of ['actualCashMovement', 'financialExecutionPerformed', 'externalPaymentExecuted', 'externalReceiptVerified']) assert.equal(record[field], false);
  f.call('store.upsert', { id: 'foreign-local-store', name: 'Other synthetic store', city: 'Synthetic', serviceAreas: ['Synthetic'], minMarginRatio: 0.28, maxDiscountRatio: 0.08 });
  assert.throws(() => f.call('business.record', { ...input, id: 'cross-store-observation', objectRefs: [{ type: 'store', id: 'foreign-local-store' }] }, f.human), error('STORE_SCOPE_MISMATCH'));
});

test('imported historical outcomes stay separate from real post-import local model work', t => {
  const f = fixture(t);
  const before = f.call('goal.report', { goalId: 'SG-GOAL-GROWTH' }).data;
  assert.equal(before.current, 0); assert.equal(before.historicalSynthetic.acceptedProjects, 1);
  assert.equal(f.call('goal.report', { goalId: 'SG-GOAL-DELIVERY' }).data.current, 0);
  assert.equal(f.call('goal.report', { goalId: 'SG-GOAL-SERVICE' }).data.current, 0);
  const lease = f.call('task.claim', { workflowId: 'SG-FLOW-GROWTH' }).data, lead = lease.task.context.refs.lead;
  submit(f, lease, { fit: true, budgetCents: lead.budgetCents, renovationStage: lead.renovationStage, needs: lead.needs, reason: 'The exact structured synthetic records have now been processed by this local test artifact.', missingInformation: [] });
  const after = f.call('goal.report', { goalId: 'SG-GOAL-GROWTH' }).data;
  assert.equal(after.current, 1); assert.equal(after.historicalSynthetic.leads, 12); assert.equal(after.externallyVerified, false);
});

test('unknown renovation stage cannot be invented to qualify a progressively captured lead', t => {
  const f = fixture(t);
  f.call('lead.authorize', { leadId: 'SG-L01', status: 'granted', purposes: ['consultation', 'appointment'], evidence: f.evidence() });
  f.call('workflow.start', { id: 'unknown-stage-flow', kind: 'growth-acquisition', goalId: 'SG-GOAL-GROWTH', leadId: 'SG-L01' });
  const lease = f.call('task.claim', { workflowId: 'unknown-stage-flow' }).data;
  const artifact = { fit: false, budgetCents: 0, renovationStage: 'unknown', needs: ['Ask for the real requirement.'], reason: 'Budget and renovation stage are unrecorded.', missingInformation: ['budget', 'stage'] };
  assert.throws(() => submit(f, lease, { ...artifact, renovationStage: 'finished' }), error('CUSTOMER_STAGE_MISMATCH'));
  const result = submit(f, lease, artifact); assert.equal(result.applied.qualifiedLocally, false);
  assert.equal(f.get('lead', 'SG-L01').renovationStage, undefined);
});

test('same scenario request replays its receipt and a fresh key recovers without overwriting an enriched lead', t => {
  const f = fixture(t), before = f.call('ledger.verify').data.checkedEvents;
  const replay = seedSyntheticScenario(f.engine, { anchorDate: anchor }); assert.equal(replay.replayed, true); assert.equal(replay.recovered, true);
  assert.equal(f.call('ledger.verify').data.checkedEvents, before);
  const lead = f.get('lead', 'SG-L01');
  f.call('lead.enrich', { leadId: lead.id, expectedVersion: lead.version, patch: { wechatRef: 'SYN-WX-AFTER-IMPORT' }, source: 'customer', evidence: f.evidence() }, f.human);
  const recovery = f.call('scenario.import', { datasetId, anchorDate: anchor }, f.operator, 'new-recovery-request').data;
  assert.equal(recovery.recovered, true); assert.equal(recovery.overwrittenObjects, 0); assert.equal(f.get('lead', lead.id).wechatRef, 'SYN-WX-AFTER-IMPORT');
  assert.throws(() => seedSyntheticScenario(f.engine, { anchorDate: '2026-10-08T23:00:00.000Z' }), error('IDEMPOTENCY_CONFLICT'));
});

test('whole-record dossier, SKU and store replacements retain synthetic provenance so recovery preserves human revisions', t => {
  const f = fixture(t), customer = f.get('customer', 'SG-C06'), sku = f.get('sku', 'SYN-SG-GW-01'), store = f.get('store', storeId);
  const dossier = f.call('customer.upsert', f.inputOf('customer.upsert', customer, { expectedVersion: customer.version, source: 'customer', evidence: f.evidence(), communication: { ...customer.communication, cadence: 'Human-confirmed updated cadence after the original import.' } }), f.human).data;
  const device = f.call('sku.upsert', f.inputOf('sku.upsert', sku, { expectedVersion: sku.version, model: 'Updated synthetic lab gateway after local review.', evidence: f.evidence() })).data;
  const outlet = f.call('store.upsert', f.inputOf('store.upsert', store, { expectedVersion: store.version, name: 'Updated synthetic store name after local review.' })).data;
  for (const record of [dossier, device, outlet]) { assert.equal(record.synthetic, true); assert.equal(record.dataOrigin, 'synthetic-history-import'); assert.equal(record.provenance.datasetId, datasetId); assert.equal(record.actualCustomerRecord, false); }
  const recovered = f.call('scenario.import', { datasetId }, f.operator, 'recover-replaced-documents').data;
  assert.equal(recovered.recovered, true); assert.equal(recovered.overwrittenObjects, 0);
  assert.deepEqual(f.get('customer', customer.id), dossier); assert.deepEqual(f.get('sku', sku.id), device); assert.deepEqual(f.get('store', store.id), outlet);
  assert.equal(f.call('ledger.verify').data.ok, true);
});

test('actual post-import acceptance and service records count locally while imported historical totals stay fixed', t => {
  const f = fixture(t), project = f.get('project', 'SG-PROJECT10'), solution = f.get('solution', project.solutionId);
  assert.equal(f.call('goal.report', { goalId: 'SG-GOAL-DELIVERY' }).data.current, 0);
  f.call('commissioning.record', { id: 'post-import-retest', projectId: project.id, results: solution.scenes.map(scene => ({ sceneId: scene.id, passed: true, observation: 'Synthetic local human test record after import; no real device controlled.' })), evidence: f.evidence() }, f.human);
  f.call('acceptance.record', { id: 'post-import-acceptance', projectId: project.id, customerAccepted: true, trainingDelivered: true, credentialsTransferred: true, outstandingIssues: [], evidence: f.evidence() }, f.human);
  const delivery = f.call('goal.report', { goalId: 'SG-GOAL-DELIVERY' }).data;
  assert.equal(delivery.current, 1); assert.equal(delivery.historicalSynthetic.acceptedProjects, 1); assert.equal(f.get('project', project.id).operationalAcceptanceRecorded, true);
  f.call('aftercare.resolve', { ticketId: 'SG-SERVICE11-OPEN', resolution: 'Local synthetic human follow-up evidence was recorded after import.', customerConfirmed: true, followupAt: f.future(2), evidence: f.evidence() }, f.human);
  const service = f.call('goal.report', { goalId: 'SG-GOAL-SERVICE' }).data;
  assert.equal(service.current, 1); assert.equal(service.historicalSynthetic.resolvedAftercare, 1); assert.equal(service.externallyVerified, false);
});

test('progressive fields enforce their upper bounds while retaining Chinese text and explicit unknowns', t => {
  const f = fixture(t);
  const lead = f.call('lead.create', { id: 'maximum-progressive-fields', storeId, surname: '林'.repeat(40), householdSize: 20, budgetCents: 1000000000, intent: '客户原话\n第二行；含标点和Unicode。' }).data;
  assert.equal(lead.householdSize, 20); assert.equal(lead.renovationStage, undefined); assert.equal(lead.intent.includes('\n'), true);
  for (const extra of [{ surname: '林'.repeat(41) }, { householdSize: 21 }, { budgetCents: 1000000001 }, { budgetCents: -1 }, { budgetCents: 0.5 }]) assert.throws(() => f.call('lead.create', { id: 'over-progressive-bound', storeId, surname: '林', ...extra }), error('INVALID_INPUT'));
});

test('expired contract approval cannot record signing even while its quote remains valid', t => {
  const f = fixture(t), quoteApproval = f.call('quote.request_approval', { quoteId: 'SG-QUOTE06', expiresAt: f.future(3), reason: 'Local fixture review.' }).data;
  f.call('approval.decide', { approvalId: quoteApproval.id, decision: 'approved', contentDigest: quoteApproval.contentDigest, reason: 'Local human fixture approval.' }, f.human);
  const contractApproval = f.call('contract.request_approval', { contractId: 'SG-CONTRACT06', expiresAt: f.future(1), reason: 'Short contract review window.' }).data;
  f.call('approval.decide', { approvalId: contractApproval.id, decision: 'approved', contentDigest: contractApproval.contentDigest, reason: 'Exact local contract fixture.' }, f.human);
  f.advance(2);
  assert.throws(() => f.call('contract.record_signing', { contractId: 'SG-CONTRACT06', evidence: f.evidence() }, f.human), error('APPROVAL_INVALID'));
  assert.equal(f.get('contract', 'SG-CONTRACT06').status, 'approved');
});

test('scenario import refuses namespace collisions atomically rather than overwriting old data', t => {
  const f = fixture(t, { seed: false });
  f.call('store.upsert', { id: storeId, name: 'Existing unrelated synthetic store', city: 'Synthetic', serviceAreas: ['Synthetic'], minMarginRatio: 0.28, maxDiscountRatio: 0.08 });
  assert.throws(() => seedSyntheticScenario(f.engine, { anchorDate: anchor }), error('SCENARIO_OBJECT_COLLISION'));
  assert.equal(f.list('lead').length, 0); assert.equal(f.get('store', storeId).name, 'Existing unrelated synthetic store');
  assert.equal(f.call('ledger.verify').data.checkedEvents, 1);
});

test('a mid-import failure rolls back every fixture operation and the same request can safely retry', t => {
  let reads = 0, interrupt = true;
  const f = fixture(t, { seed: false, clock: () => (++reads > 150 && interrupt ? new Date('invalid') : new Date(anchor)) });
  assert.throws(() => seedSyntheticScenario(f.engine, { anchorDate: anchor }), error('INVALID_CLOCK'));
  interrupt = false;
  assert.equal(f.call('ledger.verify').data.checkedEvents, 0); assert.equal(f.list('store').length, 0); assert.equal(f.list('lead').length, 0);
  const restored = seedSyntheticScenario(f.engine, { anchorDate: anchor }); assert.equal(restored.seeded, true); assert.equal(restored.counts.task, 53);
  assert.equal(f.call('ledger.verify').data.ok, true);
});

test('scenario data remains isolated by tenant/workspace and survives restart without duplicate tasks', t => {
  const f = fixture(t);
  const other = fixture(t, { directory: f.dataDir, tenantId: 'other-depth-tenant' });
  assert.equal(other.list('lead').length, 12); assert.equal(other.call('ledger.verify').data.checkedEvents, 1);
  assert.throws(() => f.call('scenario.import', { datasetId }, other.operator), error('TENANT_SCOPE_MISMATCH'));
  f.engine.close();
  const reopened = createBusinessEngine({ dataDir: f.dataDir, ...f.engine.scope, clock: () => new Date(anchor) }); t.after(() => reopened.close());
  const recovered = seedSyntheticScenario(reopened, { anchorDate: anchor }); assert.equal(recovered.replayed, true);
  assert.equal(reopened.call('entity.list', { type: 'task' }, f.agent).data.length, 53); assert.equal(reopened.call('ledger.verify', {}, f.agent).data.ok, true);
});

test('live and agent imports, future/stale anchors and actor import-context spoofing are denied before records appear', t => {
  const f = fixture(t, { seed: false });
  assert.throws(() => f.call('scenario.import', { datasetId }), error('PERMISSION_DENIED'));
  assert.throws(() => f.call('scenario.import', { datasetId }, { ...f.operator, syntheticHistory: true }), error('ACTOR_IMPORT_CONTEXT_SPOOFING'));
  assert.throws(() => f.call('scenario.import', { datasetId, anchorDate: f.future(1) }, f.operator), error('INVALID_SCENARIO_ANCHOR'));
  assert.throws(() => f.call('scenario.import', { datasetId, anchorDate: '2026-10-01T01:00:00.000Z' }, f.operator), error('INVALID_SCENARIO_ANCHOR'));
  assert.equal(f.list('store').length, 0);
  const live = fixture(t, { seed: false, dataMode: 'live' });
  assert.throws(() => seedSyntheticScenario(live.engine), error('SCENARIO_IN_LIVE_BLOCKED'));
  assert.throws(() => live.call('scenario.import', { datasetId }, live.operator), error('SCENARIO_IN_LIVE_BLOCKED'));
});

test('tampering with a imported engineering projection blocks recovery and every fact read', t => {
  const f = fixture(t), db = new DatabaseSync(join(f.dataDir, 'business.sqlite'));
  db.prepare('UPDATE entities SET doc=? WHERE type=? AND id=?').run('{"id":"forged","version":1}', 'pointPlan', 'SG-POINT06-V1'); db.close();
  assert.equal(f.call('ledger.verify').data.ok, false);
  assert.throws(() => f.call('entity.get', { type: 'pointPlan', id: 'SG-POINT06-V1' }), error('LEDGER_INTEGRITY_FAILURE'));
  assert.throws(() => f.call('scenario.import', { datasetId }, f.operator), error('LEDGER_INTEGRITY_FAILURE'));
});

test('industry context uses its declared sealed JSON source and rejects a changed source before exposing brand claims', t => {
  const f = fixture(t), context = f.call('industry.context').data;
  assert.equal(context.schemaVersion, 'business-management.industry-context/v1'); assert.equal(context.assetDigest.length, 64);
  assert.ok(context.data.storeProfile); assert.ok(context.data.productReference); assert.ok(context.data.syntheticDisclosure);
  assert.deepEqual(f.call('industry.context', { section: 'storeProfile' }).data.data, context.data.storeProfile);
  const directory = mkdtempSync(join(tmpdir(), 'bms-context-integrity-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const copy = join(directory, 'smart-home'); cpSync(fileURLToPath(new URL('../../', import.meta.url)), copy, { recursive: true });
  writeFileSync(join(copy, 'library/industry-context.json'), '{"schemaVersion":"business-management.industry-context/v1","storeProfile":{"fakeAuthorization":true}}');
  const script = `import(${JSON.stringify(pathToFileURL(join(copy, 'runtime/assets.mjs')).href)}).then(m=>{try{m.readIndustryContext();process.exit(2)}catch(error){process.stdout.write(JSON.stringify({code:error.code}))}})`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).code, 'INDUSTRY_ASSET_INTEGRITY');
});

test('catalogue titles come from sealed Chinese labels and reject missing, duplicate or wrongly owned skill entries', t => {
  const f = fixture(t), titles = f.engine.catalog().skillTitles;
  assert.equal(Object.keys(titles).length, 49); assert.ok(SKILLS.every(skill => typeof titles[skill] === 'string' && titles[skill].length > 0));
  assert.equal(titles['lead-profile-enrichment'], '线索补充提议与确认问题');
  const cases = [
    { label: 'changed-unsealed-title', mutate: data => { data.skills[0].title = 'Changed title'; }, reseal: false, code: 'INDUSTRY_ASSET_INTEGRITY' },
    { label: 'wrong-owner', mutate: data => { data.skills[0].owner = 'lead-enrichment-specialist'; }, reseal: true, code: 'INDUSTRY_SKILL_OWNERSHIP' },
    { label: 'duplicate-entry', mutate: data => { data.skills.push(data.skills[0]); }, reseal: true, code: 'INDUSTRY_SKILL_OWNERSHIP' },
    { label: 'missing-entry', mutate: data => { data.skills.pop(); }, reseal: true, code: 'INDUSTRY_SKILL_OWNERSHIP' },
    { label: 'empty-title', mutate: data => { data.skills[0].title = ''; }, reseal: true, code: 'INDUSTRY_ASSET_INVALID' },
  ];
  for (const row of cases) {
    const directory = mkdtempSync(join(tmpdir(), `bms-skill-title-${row.label}-`)); t.after(() => rmSync(directory, { recursive: true, force: true }));
    const copy = join(directory, 'smart-home'); cpSync(fileURLToPath(new URL('../../', import.meta.url)), copy, { recursive: true });
    const path = join(copy, 'library/skill-catalogue.json'), data = JSON.parse(readFileSync(path, 'utf8')); row.mutate(data);
    const body = JSON.stringify(data); writeFileSync(path, body);
    if (row.reseal) { const manifestPath = join(copy, 'bundle.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); manifest.integrity.assets['library/skill-catalogue.json'] = createHash('sha256').update(body).digest('hex'); writeFileSync(manifestPath, JSON.stringify(manifest)); }
    const script = `import(${JSON.stringify(pathToFileURL(join(copy, 'runtime/assets.mjs')).href)}).then(m=>{try{m.readSkillTitles();process.exit(2)}catch(error){process.stdout.write(JSON.stringify({code:error.code}))}})`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).code, row.code, row.label);
  }
});

test('scenario recovery rejects changed runtime implementation inputs even when dataset name and version are unchanged', t => {
  const f = fixture(t), directory = mkdtempSync(join(tmpdir(), 'bms-scenario-version-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const copy = join(directory, 'smart-home'); cpSync(fileURLToPath(new URL('../../', import.meta.url)), copy, { recursive: true });
  const location = join(copy, 'runtime/errors.mjs'); writeFileSync(location, `${readFileSync(location, 'utf8')}\n// Deliberately changed installed implementation bytes for version-conflict testing.\n`);
  const script = `import(${JSON.stringify(pathToFileURL(join(copy, 'runtime/index.mjs')).href)}).then(m=>{const e=m.createBusinessEngine({dataDir:${JSON.stringify(f.dataDir)},tenantId:'depth-test-tenant',workspaceId:'depth-test-workspace',clock:()=>new Date(${JSON.stringify(anchor)})});const codes=[];try{for(const idempotencyKey of [undefined,'different-installed-code']){try{m.seedSyntheticScenario(e,{anchorDate:${JSON.stringify(anchor)},...(idempotencyKey?{idempotencyKey}:{})});process.exitCode=2}catch(error){codes.push(error.code)}}process.stdout.write(JSON.stringify({codes}))}finally{e.close()}})`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).codes, ['SCENARIO_VERSION_CONFLICT', 'SCENARIO_VERSION_CONFLICT']);
  assert.equal(f.call('ledger.verify').data.checkedEvents, 1); assert.equal(f.call('ledger.verify').data.ok, true);
});

function worker(dataDir) {
  const script = fileURLToPath(new URL('./scenario-worker.mjs', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, dataDir], { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; }); child.on('error', reject);
    child.on('close', code => { if (code !== 0) reject(new Error(stderr)); else { try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); } } });
  });
}
test('four concurrent importer processes produce one atomic scenario receipt and no duplicate skill tasks', async t => {
  const f = fixture(t, { seed: false });
  const results = await Promise.all(Array.from({ length: 4 }, () => worker(f.dataDir)));
  assert.equal(results.filter(result => result.replayed === false).length, 1); assert.equal(results.filter(result => result.replayed === true).length, 3);
  assert.equal(new Set(results.map(result => result.eventId)).size, 1); assert.equal(f.list('task').length, 53);
  assert.equal(f.call('ledger.verify').data.checkedEvents, 1); assert.equal(f.call('ledger.verify').data.ok, true);
});
