import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = resolve('outputs/BusinessManagementSystem/bundles/smart-home');
const directory = mkdtempSync(resolve('work/industry-v2/design-coverage-'));
const copy = join(directory, 'fixture');
const anchorDate = new Date().toISOString();
const output = { probe: 'design point-device coverage versus complete solution BOM', checkedAt: new Date().toISOString(), sourceMutated: false, isolatedManifestRefresh: true, sourceHashes: {}, observations: [] };
let engine;
try {
  cpSync(source, copy, { recursive: true });
  output.sourceHashes = Object.fromEntries(readdirSync(join(copy, 'runtime')).filter(path => path.endsWith('.mjs')).map(path => [path, createHash('sha256').update(readFileSync(join(copy, 'runtime', path))).digest('hex')]));
  const manifestPath = join(copy, 'bundle.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const path of Object.keys(manifest.integrity.assets)) manifest.integrity.assets[path] = createHash('sha256').update(readFileSync(join(copy, path))).digest('hex');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const runtime = await import(pathToFileURL(join(copy, 'runtime/index.mjs')).href);
  engine = runtime.createBusinessEngine({ dataDir: join(directory, 'data'), tenantId: 'design-probe', workspaceId: 'local', clock: () => new Date(anchorDate) });
  runtime.seedSyntheticScenario(engine, { anchorDate });
  const actor = { ...engine.scope, id: 'design-source-review', role: 'agent', channel: 'mcp' };
  let key = 0;
  const call = (operation, input) => engine.call(operation, { ...input, idempotencyKey: `probe-${++key}` }, actor).data;
  const get = (type, id) => engine.call('entity.get', { type, id }, actor).data;
  const evidence = { uri: 'evidence://synthetic/design-coverage-probe', sha256: 'a'.repeat(64), source: 'synthetic', observedAt: anchorDate, summary: 'Explicit local synthetic design-coverage probe; no physical observation or customer statement.' };
  const inputOf = (operation, entity, overrides) => ({ ...Object.fromEntries(Object.keys(runtime.OPERATION_CATALOGUE.find(item => item.name === operation).schema.properties).filter(key => key !== 'idempotencyKey' && entity[key] !== undefined).map(key => [key, entity[key]])), evidence, ...overrides });
  let plan = get('pointPlan', 'SG-POINT06-V1'), design = get('design', 'SG-DESIGN06-V1');
  const solution = get('solution', design.solutionId);
  const originalPoints = plan.points;
  const unassignedPoints = originalPoints.map((point, index) => {
    if (index !== originalPoints.findIndex(item => item.skuId)) return point;
    const { skuId, ...unassigned } = point;
    return unassigned;
  });
  for (const [label, points] of [
    ['all-but-one-devices-omitted', [originalPoints.find(point => point.skuId)]],
    ['one-device-duplicated', [...originalPoints, { ...originalPoints.find(point => point.skuId), id: 'extra-device-point' }]],
    ['device-point-without-sku', unassignedPoints],
    ['complete-device-count-with-unassigned-network-helper', originalPoints],
  ]) {
    const item = { label, expectedDevicePoints: solution.bom.reduce((sum, row) => sum + row.quantity, 0), submittedDevicePoints: points.filter(point => point.skuId).length };
    try {
      const nextPlan = call('pointPlan.record', inputOf('pointPlan.record', plan, { id: `probe-plan-${plan.revision + 1}`, revision: plan.revision + 1, previousRevisionId: plan.id, points }));
      plan = nextPlan;
      const nextDesign = call('design.record', inputOf('design.record', design, { id: `probe-design-${design.revision + 1}`, revision: design.revision + 1, previousRevisionId: design.id, pointPlanId: nextPlan.id }));
      item.accepted = true; item.designStatus = nextDesign.status; plan = nextPlan; design = nextDesign;
    } catch (error) { item.accepted = false; item.code = error.code; item.message = error.message; }
    output.observations.push(item);
  }
  output.completed = true;
  output.passed = output.observations[0].code === 'DESIGN_POINT_BOM_MISMATCH'
    && output.observations[1].code === 'DESIGN_POINT_BOM_MISMATCH'
    && output.observations[2].code === 'DESIGN_POINT_SKU_REQUIRED'
    && output.observations[3].accepted === true
    && output.observations[3].designStatus === 'draft-local-validated';
  if (!output.passed) process.exitCode = 2;
} catch (error) { output.completed = false; output.error = { code: error.code ?? error.name, message: error.message }; process.exitCode = 1; }
finally {
  engine?.close(); rmSync(directory, { recursive: true, force: true });
  writeFileSync(resolve(process.argv[2] ?? 'work/industry-v2/design-coverage-probe.json'), JSON.stringify(output, null, 2) + '\n');
}
process.stdout.write(JSON.stringify(output) + '\n');
