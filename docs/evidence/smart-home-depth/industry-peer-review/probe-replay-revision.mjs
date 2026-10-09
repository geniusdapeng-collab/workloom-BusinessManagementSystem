import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = resolve('outputs/BusinessManagementSystem/bundles/smart-home');
const directory = mkdtempSync(resolve('work/industry-v2/scenario-replay-'));
const baseline = join(directory, 'baseline');
const changed = join(directory, 'changed');
const dataDir = join(directory, 'data');
const anchorDate = new Date().toISOString();
const output = { probe: 'scenario revision guard with original versus new idempotency key', checkedAt: new Date().toISOString(), sourceMutated: false, isolatedManifestRefresh: true, sourceHashes: {}, observations: {} };
try {
  cpSync(source, baseline, { recursive: true });
  output.sourceHashes = Object.fromEntries(readdirSync(join(baseline, 'runtime')).filter(path => path.endsWith('.mjs')).map(path => [path, createHash('sha256').update(readFileSync(join(baseline, 'runtime', path))).digest('hex')]));
  // The isolated fixture manifest must reflect the current parallel source.
  // This never changes the shared repository or its sealing state.
  const manifestPath = join(baseline, 'bundle.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const path of Object.keys(manifest.integrity.assets)) manifest.integrity.assets[path] = createHash('sha256').update(readFileSync(join(baseline, path))).digest('hex');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  cpSync(baseline, changed, { recursive: true });
  const errorsPath = join(changed, 'runtime/errors.mjs');
  writeFileSync(errorsPath, `${readFileSync(errorsPath, 'utf8')}\n// Controlled fixture implementation revision for replay test.\n`);
  const first = await import(pathToFileURL(join(baseline, 'runtime/index.mjs')).href);
  const second = await import(pathToFileURL(join(changed, 'runtime/index.mjs')).href);
  const create = module => module.createBusinessEngine({ dataDir, tenantId: 'replay-probe', workspaceId: 'same-key', clock: () => new Date(anchorDate) });
  const initial = create(first);
  output.observations.initial = first.seedSyntheticScenario(initial, { anchorDate });
  output.observations.stableSameKey = first.seedSyntheticScenario(initial, { anchorDate });
  output.observations.stableNewKey = first.seedSyntheticScenario(initial, { anchorDate, idempotencyKey: 'unchanged-new-key-probe' });
  initial.close();
  const upgraded = create(second);
  output.observations.changedFixtureDigest = second.listSyntheticScenarios()[0].fixtureDigest;
  try { output.observations.sameKey = second.seedSyntheticScenario(upgraded, { anchorDate }); }
  catch (error) { output.observations.sameKey = { code: error.code, message: error.message }; }
  try { output.observations.newKey = second.seedSyntheticScenario(upgraded, { anchorDate, idempotencyKey: 'different-key-probe' }); }
  catch (error) { output.observations.newKey = { code: error.code, message: error.message }; }
  upgraded.close();
  output.completed = true;
  output.passed = output.observations.stableSameKey.replayed === true
    && output.observations.stableNewKey.recovered === true
    && output.observations.sameKey.code === 'SCENARIO_VERSION_CONFLICT'
    && output.observations.newKey.code === 'SCENARIO_VERSION_CONFLICT';
  if (!output.passed) process.exitCode = 2;
} catch (error) {
  output.completed = false;
  output.error = { code: error.code ?? error.name, message: error.message };
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
  writeFileSync(resolve(process.argv[2] ?? 'work/industry-v2/scenario-replay-revision-probe.json'), JSON.stringify(output, null, 2) + '\n');
}
process.stdout.write(JSON.stringify({ completed: output.completed, passed: output.passed, initialFixtureDigest: output.observations.initial?.fixtureDigest, changedFixtureDigest: output.observations.changedFixtureDigest, stableSameKeyReplayed: output.observations.stableSameKey?.replayed, stableNewKeyRecovered: output.observations.stableNewKey?.recovered, sameKeyCode: output.observations.sameKey?.code, newKeyCode: output.observations.newKey?.code, error: output.error }) + '\n');
