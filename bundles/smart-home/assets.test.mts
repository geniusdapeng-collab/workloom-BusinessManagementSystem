import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import YAML from 'yaml';
import { parseBundleManifest, WorkforcePresetCollectionSchema, assertBundleCompatibility, canonicalBundleArtifactPayload } from '../../packages/industry-contract/src/index.ts';
import { loadVerifiedBundleManifest } from '../../packages/base/bundles/assembly.ts';
import { resolveSegment, listSegments } from '../../packages/base/bundles/segment.ts';
import { loadVerifiedBundleEvalQuestions } from '../../packages/base/bundles/eval-questions.ts';
import { loadFencePack } from '../../packages/base/fence-engine/dsl.ts';
import { evalCondition } from '../../packages/base/fence-engine/expr.ts';
import { parseModelPolicy } from '../../packages/base/model-router/policy.ts';
import { loadFeedbackEnumsFromBundle } from '../../packages/base/evolve/feedback-enums.ts';
import { loadCatalog, invokeCapability } from '../../scripts/agent-capabilities.mjs';
import { OPERATION_CATALOGUE, ENTITY_TYPES } from './runtime/catalogue.mjs';
import { WORKFLOW_CATALOGUE } from './runtime/workflows.mjs';

const bundle = resolve(import.meta.dirname);
const repository = resolve(bundle, '../..');
const text = (path: string) => readFileSync(resolve(bundle, path), 'utf8');
const json = (path: string) => JSON.parse(text(path));
const manifest = parseBundleManifest(json('bundle.json'));

test('default product and governed asset closure select the smart-home bundle', () => {
  const product = JSON.parse(readFileSync(resolve(repository, 'product.manifest.json'), 'utf8'));
  assert.equal(product.defaultBundle, 'smart-home');
  assert.equal(manifest.workloom.industry, 'smart-home');
  assertBundleCompatibility(manifest, { base: '0.1.0', ui: '0.1.19' });
  const paths = Object.values(manifest.workloom.provides).flatMap(value => typeof value === 'string' ? [value] : value ?? []);
  assert.equal(new Set(paths).size, paths.length);
  for (const path of paths) {
    const absolute = resolve(bundle, path);
    assert.ok(absolute.startsWith(bundle + sep), path);
    assert.ok(statSync(absolute).isFile(), path);
    assert.equal(createHash('sha256').update(readFileSync(absolute)).digest('hex'), manifest.integrity?.assets[path], path);
  }
  assert.equal(createHash('sha256').update(canonicalBundleArtifactPayload(manifest)).digest('hex'), manifest.integrity?.digest);
  assert.equal(loadVerifiedBundleManifest('smart-home').workloom.industry, 'smart-home');
});

test('every preset has distinct responsibility, existing skills, fences and native operations', () => {
  const presets = WorkforcePresetCollectionSchema.parse(manifest.workloom.provides.presets.map(path => YAML.parse(text(path))));
  const baseline = loadFencePack(text('fences/smart-home-baseline.yml'));
  const rules = new Set(baseline.rules.map(rule => rule.rule_id));
  const operations = new Set(OPERATION_CATALOGUE.map(operation => operation.name));
  assert.equal(presets.length, 27);
  assert.equal(manifest.workloom.provides.skills.length, 49);
  const physical = readdirSync(resolve(bundle, 'presets')).filter(path => /\.ya?ml$/u.test(path)).map(path => `presets/${path}`);
  assert.deepEqual(physical.sort(), [...manifest.workloom.provides.presets].sort());
  for (const preset of presets) {
    for (const rule of preset.fence_bindings) assert.ok(rules.has(rule), `${preset.preset_key}: ${rule}`);
    for (const skill of preset.skills) assert.ok(existsSync(resolve(bundle, `skills/${skill}/SKILL.md`)), skill);
    for (const tool of preset.tools) assert.ok(operations.has(tool.name), `${preset.preset_key}: ${tool.name}`);
    for (const operation of preset.write_back) assert.ok(operations.has(operation), operation);
    for (const tool of ['workflow.start', 'task.claim', 'task.submit']) assert.ok(preset.tools.some(item => item.name === tool), `${preset.preset_key}: missing host task tool ${tool}`);
    assert.ok(preset.write_back.includes('task.submit'), `${preset.preset_key}: missing host artifact receipt`);
  }
  for (const operation of OPERATION_CATALOGUE) {
    for (const rule of operation.fenceIds) assert.ok(rules.has(rule), `${operation.name}: ${rule}`);
  }
  const skills = json('library/skill-catalogue.json').skills;
  const owners = new Set(presets.map(preset => preset.preset_key));
  for (const skill of skills) {
    assert.ok(owners.has(skill.owner), skill.key);
    assert.ok(operations.has(skill.operation), skill.operation);
    for (const rule of skill.fences) assert.ok(rules.has(rule), rule);
    for (const section of ['## 前置与输入', '## 结构化输出', '## 执行步骤', '## 失败、超时与并发处理', '## 验收断言']) assert.ok(text(`skills/${skill.key}/SKILL.md`).includes(section), `${skill.key}: ${section}`);
    const body = text(`skills/${skill.key}/SKILL.md`);
    const frontMatter = YAML.parse(body.split(/^---\s*$/mu)[1]);
    assert.equal(frontMatter.name, skill.key);
    assert.equal(frontMatter.owner, skill.owner);
    assert.ok(body.includes('## 宿主岗位任务协议'), skill.key);
    assert.ok(body.includes('kind=employee-work'), skill.key);
    assert.ok(body.includes(`employeeId\` 为 \`${skill.owner}\``), skill.key);
    assert.ok(body.includes(`skillId\` 为 \`${skill.key}\``), skill.key);
    const owner = presets.find(preset => preset.preset_key === skill.owner);
    assert.ok(owner?.skills.includes(skill.key), `${skill.owner}: ${skill.key}`);
  }
  assert.equal(new Set(skills.map(skill => skill.key)).size, 49);
  assert.equal(new Set(presets.flatMap(preset => preset.skills)).size, 49);
});

test('all segments resolve concrete references and pipeline steps are assigned', () => {
  const segments = listSegments(bundle);
  assert.equal(segments.length, 7);
  for (const segment of segments) assert.ok(resolveSegment(bundle, segment.key).presetFiles.length > 0);
  assert.throws(() => resolveSegment(bundle, 'does-not-exist'), /未知客群/u);
  const roleKeys = new Set(json('library/workforce.json').roles.map(role => role.id));
  const skillKeys = new Set(json('library/skill-catalogue.json').skills.map(skill => skill.key));
  assert.equal(manifest.workloom.provides.pipelines.length, 5);
  for (const path of manifest.workloom.provides.pipelines) {
    const pipeline = YAML.parse(text(path));
    assert.equal(pipeline.modelProvider, 'host-workbench');
    assert.equal(pipeline.executor, 'runtime/workflows.mjs');
    for (const step of pipeline.steps) {
      if (pipeline.id === 'employee-work') {
        assert.equal(step.agent, '$employeeId');
        assert.equal(step.skill, '$skillId');
        assert.equal(pipeline.assignment.ownershipSource, 'library/workforce.json');
        assert.equal(pipeline.assignment.instructionsSource, 'skills/{skillId}/SKILL.md');
        for (const required of ['employeeId', 'skillId', 'brief', 'objectRefs']) assert.ok(step.required.includes(required), required);
      } else {
        assert.ok(roleKeys.has(step.agent), step.agent);
        assert.ok(skillKeys.has(step.skill), step.skill);
      }
      assert.ok(Array.isArray(step.required) && step.required.includes('goalId'));
    }
    const runtime = WORKFLOW_CATALOGUE.find(workflow => workflow.id === pipeline.id);
    assert.ok(runtime, pipeline.id);
    assert.deepEqual(pipeline.steps.map(step => ({ id: step.id, employee: step.agent, skill: step.skill })), runtime.phases.map(phase => ({ id: phase.id, employee: phase.employee, skill: phase.skill })));
    for (const phase of runtime.phases) {
      if (pipeline.id === 'employee-work') continue;
      const owner = json('library/workforce.json').roles.find(role => role.id === phase.employee);
      assert.ok(owner?.skills.includes(phase.skill), `${phase.employee}: ${phase.skill}`);
    }
  }
});

test('floor, objects, stages and archive have complete unique industry identities', () => {
  const floor = json('floor-scene.json');
  assert.equal(floor.stations.length, 27);
  assert.equal(new Set(floor.stations.map(station => station.id)).size, 27);
  for (const station of floor.stations) {
    assert.ok(station.x >= 0 && station.x <= floor.grid.w);
    assert.ok(station.y >= 0 && station.y <= floor.grid.h);
  }
  const objects = json('schemas/objects.json').objects;
  const stages = json('schemas/stages.json').stages;
  assert.equal(new Set(objects.map(object => object.type)).size, objects.length);
  assert.deepEqual(objects.map(object => object.type).sort(), [...ENTITY_TYPES].sort());
  assert.equal(new Set(stages.map(stage => stage.id)).size, stages.length);
  assert.deepEqual(json('schemas/archive.schema.json').required.sort(), ['property','business','forbidden','goals','dataMode'].sort());
});

test('fence expressions, feedback and foundation model policy parse with real loaders', () => {
  const baseline = loadFencePack(text('fences/smart-home-baseline.yml'));
  assert.equal(baseline.rules.length, 16);
  for (const rule of baseline.rules) assert.equal(typeof evalCondition(rule.when, { params: {}, context: {} }), 'boolean', rule.rule_id);
  const quoteFloor = baseline.rules.find(rule => rule.rule_id === 'R-SH10');
  assert.ok(quoteFloor);
  assert.ok(!quoteFloor.actions.includes('quote.create'));
  assert.ok(quoteFloor.actions.includes('approval.decide'));
  assert.equal(evalCondition(quoteFloor.when, { params: { margin_below_floor: true } }), true);
  assert.equal(parseModelPolicy(text('model-policy.yml')).issues.length, 0);
  assert.equal(loadFeedbackEnumsFromBundle(bundle)?.length, 12);
});

test('customer front exposes only truthful public service scope and valid evaluation questions', () => {
  const client = json('service-front/client.json');
  assert.equal(client.profile.identityBinding, false);
  assert.equal(client.profile.membership, false);
  assert.equal(client.profile.orders, false);
  assert.equal(manifest.workloom.ui.serviceFront.adapterId, 'smart-home.service-front-v1');
  assert.equal(manifest.workloom.ui.serviceFront.identityPolicy, 'disabled');
  const faq = json('service-front/faq.json');
  assert.equal(faq.categories.length, 8);
  assert.equal(faq.categories.flatMap(category => category.items).length, 32);
  assert.equal(client.supportPhone, '', 'the required phone field must not invent a support number');
  const questions = loadVerifiedBundleEvalQuestions('smart-home');
  assert.equal(questions.questions.length, 20);
  assert.ok(questions.questions.filter(question => question.redLine).length >= 8);
});

test('legacy read capability and native schemas stay separate and synchronized', async () => {
  const native = json('library/native-operations.json');
  assert.equal(createHash('sha256').update(JSON.stringify(native.operations)).digest('hex'), createHash('sha256').update(JSON.stringify(OPERATION_CATALOGUE)).digest('hex'), 'native operation snapshot must reflect the executable catalogue');
  const workflows = json('library/native-workflows.json');
  assert.equal(createHash('sha256').update(JSON.stringify(workflows.workflows)).digest('hex'), createHash('sha256').update(JSON.stringify(WORKFLOW_CATALOGUE)).digest('hex'), 'native workflow snapshot must reflect executable phase contracts');
  const catalog = await loadCatalog(repository);
  const entries = [...catalog.entries.values()].filter(entry => entry.id.startsWith('smart_home.'));
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.equal(entry.operation, 'read');
    const result = await invokeCapability(catalog, entry.id, {});
    assert.equal(result.status, 'succeeded');
    assert.notEqual(result.dataMode, 'real');
    await assert.rejects(() => invokeCapability(catalog, entry.id, { unexpected: true }), error => error.code === 'INVALID_INPUT');
  }
});


test('fictional Chengdu store, official product references and scene routes preserve source and execution boundaries', () => {
  const context = json('library/industry-context.json');
  assert.equal(context.schemaVersion, 'business-management.industry-context/v1');
  assert.equal(context.storeProfile.brand, '蜀光智家');
  assert.equal(context.storeProfile.dataMode, 'sandbox');
  assert.equal(context.storeProfile.synthetic, true);
  assert.equal(context.storeProfile.realStoreVerified, false);
  assert.deepEqual(context.storeProfile.manufacturerAuthorization, { huawei: 'unverified', aqara: 'unverified' });
  assert.equal(context.productReference.notSaleCatalogue, true);
  assert.equal(context.productReference.kind, 'official-reference-only');
  const sources = new Map(json('library/official-sources.json').sources.map(source => [source.id, source]));
  const referenceIds = new Set(context.officialReferences.items.map(source => source.id));
  for (const source of context.officialReferences.items) {
    assert.equal(source.verification, 'page-body');
    assert.deepEqual(source, sources.get(source.id));
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(['consumer.huawei.com', 'www.aqara.cn', 'docs.aqara.com'].includes(url.hostname));
    assert.ok(source.supports.length > 10 && source.limitation.length > 10);
  }
  for (const item of context.productReference.items) {
    assert.equal(item.quoteEligible, false);
    assert.equal(item.compatibilityEvidence, false);
    assert.ok(!item.id.startsWith('SYN-SG-'));
    assert.ok(item.sourceIds.length > 0 && item.limitations.length > 0);
    for (const id of item.sourceIds) assert.ok(referenceIds.has(id), id);
  }
  const zones = new Map(context.storeProfile.experienceZones.map(zone => [zone.id, zone]));
  const scenes = new Map(context.experienceGuide.scenes.map(scene => [scene.id, scene]));
  assert.equal(scenes.size, context.experienceGuide.scenes.length);
  for (const scene of scenes.values()) {
    assert.ok(zones.has(scene.zoneId), scene.zoneId);
    assert.ok(zones.get(scene.zoneId).sceneIds.includes(scene.id));
    assert.ok(scene.requiredEvidence.length > 0 && scene.fallback.length > 0 && scene.boundary.length > 0);
    for (const id of scene.sourceIds) assert.ok(referenceIds.has(id), id);
  }
  for (const route of context.experienceGuide.routes) {
    assert.ok(route.qualificationQuestions.length > 0 && route.excludedActions.length > 0);
    for (const id of route.sceneIds) assert.ok(scenes.has(id), id);
  }
  for (const channel of context.channelGuide.channels) {
    assert.equal(channel.connectorStatus, 'disabled');
    assert.equal(channel.accountVerified, false);
    assert.ok(channel.sourcePolicy.length > 0 && channel.consentPolicy.length > 0);
    assert.ok(json('library/workforce.json').roles.some(role => role.id === channel.handoffRole));
  }
  assert.equal(context.syntheticDisclosure.actualBrandAuthorization, false);
  assert.equal(context.syntheticDisclosure.externalActionsExecuted, 0);
  assert.equal(context.syntheticDisclosure.skuPrefix, 'SYN-SG-');
  assert.ok(context.storeProfile.journey.some(stage => stage.objects.includes('pointPlan')));
  assert.ok(context.storeProfile.journey.some(stage => stage.objects.includes('contract')));
});

test('new operating responsibilities are reachable without adding writes to the audit-only segment', () => {
  const newRoles = ['prospecting-specialist', 'lead-enrichment-specialist', 'appointment-coordinator', 'sales-assistant', 'sales-coach', 'business-operations-assistant', 'store-manager-assistant'];
  const segments = YAML.parse(text('segment-defaults.yml')).segments;
  for (const [key, segment] of Object.entries(segments)) {
    for (const role of newRoles) assert.equal(segment.presets.includes(role), key !== 'audit_only', `${key}: ${role}`);
  }
  for (const skill of ['lead-profile-enrichment', 'customer-handoff-check']) {
    const sop = text(`skills/${skill}/SKILL.md`);
    assert.ok(sop.includes('proposedLeadPatch') && sop.includes('confirmationQuestions'));
    assert.ok(sop.includes('model-proposal') && sop.includes('synthetic-history'));
    assert.ok(sop.includes('expectedVersion'));
  }
  assert.ok(text('skills/customer-handoff-check/SKILL.md').includes('handoffReady'));
});
