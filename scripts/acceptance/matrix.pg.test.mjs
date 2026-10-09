import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import YAML from 'yaml';
import { loadComposition } from './lib/compose.mjs';

const run = promisify(execFile);
const repo = resolve(import.meta.dirname, '../..');
const testUrl = process.env.BMS_PG_TEST_URL;

test('acceptance matrix resolves actual installed skill IDs and preserves rejection checks', {
  skip: testUrl ? false : 'BMS_PG_TEST_URL is required; no database test was executed',
  timeout: 60000,
}, async (suite) => {
  const databaseName = `bms_matrix_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 });
  const fixtureUrl = new URL(testUrl);
  fixtureUrl.pathname = `/${databaseName}`;
  const directory = await mkdtemp(join(tmpdir(), 'bms-matrix-'));
  const report = { schemaVersion: 'bms.matrix-regression/v1', startedAt: new Date().toISOString(),
    scope: 'Real disposable PostgreSQL database with synthetic matrix tables; not platform migration or model execution',
    command: ['node', '--test', 'scripts/acceptance/matrix.pg.test.mjs'], modelCalls: 0,
    cases: [], databaseRemoved: false };
  let fixture;
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    fixture = new pg.Client({ connectionString: fixtureUrl.toString(), connectionTimeoutMillis: 5000 });
    await fixture.connect();
    await fixture.query(`
      CREATE TABLE workspaces (id text PRIMARY KEY, slug text, bundle_id text);
      CREATE TABLE agents (id text PRIMARY KEY, workspace_id text, preset_key text,
        name text, version text, kind text, readonly boolean, status text,
        invalid_reason text, fence_bindings text[], skills text[], meta jsonb,
        created_at timestamptz DEFAULT now());
      CREATE TABLE skills (id text PRIMARY KEY, name text, version text, level text,
        bundle text, description text, fence_bindings text[]);
      CREATE TABLE skill_installs (workspace_id text, skill_id text,
        fence_bindings_snapshot text[], installed_version text);
      CREATE TABLE fence_rules (workspace_id text, rule_id text, level text, status text);
    `);
    const composition = await loadComposition(repo, 'smart-home');
    const skillDocs = await Promise.all(composition.skillDocs.map(async (doc) => {
      const text = await readFile(doc.file, 'utf8');
      const frontmatter = YAML.parse(text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '{}');
      return { ...doc, version: frontmatter.version, fences: frontmatter.fence_bindings };
    }));
    const firstSkill = skillDocs[0].key;
    // Expected counts come from the same composition the fixture seeds, so roster growth
    // cannot silently turn a passing matrix run into a red gate.
    const expectedAgents = composition.presets.size;
    const expectedSkills = skillDocs.length;
    async function seed(prefix = 'skill-smart-home-', mode = 'normal') {
      await fixture.query('BEGIN');
      try {
        await fixture.query('TRUNCATE workspaces, agents, skills, skill_installs, fence_rules');
        await fixture.query('INSERT INTO workspaces VALUES ($1,$2,$3)',
          ['ws-smart-home', 'smart-home-demo', 'smart-home']);
        for (const [key, entry] of composition.presets) {
          const preset = entry.preset;
          await fixture.query(`INSERT INTO agents
            (id,workspace_id,preset_key,name,version,kind,readonly,status,fence_bindings,skills,meta)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [`agent-${key}`, 'ws-smart-home', key, preset.name, preset.version, preset.kind,
            preset.readonly, 'ready', entry.fenceBindings, preset.skills,
            { sourceBundleId: entry.bundleId, shadowedBundleIds: entry.shadowedBundleIds,
              night_shift: preset.night_shift }]);
        }
        for (const doc of skillDocs) {
          const id = `${prefix}${doc.key}`;
          await fixture.query('INSERT INTO skills VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [id, doc.key, doc.version, 'industry', doc.bundle, doc.description, doc.fences]);
          if (mode === 'missing' && doc.key === firstSkill) continue;
          await fixture.query('INSERT INTO skill_installs VALUES ($1,$2,$3,$4)',
            [mode === 'wrong-workspace' && doc.key === firstSkill ? 'other-workspace' : 'ws-smart-home',
              id, doc.fences, mode === 'wrong-version' && doc.key === firstSkill ? '99.0.0' : doc.version]);
        }
        for (const [ruleId, rule] of composition.fenceRules) {
          await fixture.query('INSERT INTO fence_rules VALUES ($1,$2,$3,$4)',
            ['ws-smart-home', ruleId, rule.level, 'active']);
        }
        await fixture.query('COMMIT');
      } catch (error) {
        await fixture.query('ROLLBACK');
        throw error;
      }
    }
    async function matrix(name) {
      const out = join(directory, name);
      let exitCode = 0;
      try {
        await run(process.execPath, ['--import', 'tsx', 'scripts/acceptance/matrix.mts',
          '--out', out, '--workspace', 'ws-smart-home', '--bundle', 'smart-home', '--fail-on-error'],
        { cwd: repo, env: { ...process.env, DATABASE_URL: fixtureUrl.toString() },
          timeout: 15000, maxBuffer: 1024 * 1024 });
      } catch (error) {
        if (typeof error.code !== 'number') throw error;
        exitCode = error.code;
      }
      const summary = JSON.parse(await readFile(join(out, 'matrix-summary.json'), 'utf8'));
      const agents = JSON.parse(await readFile(join(out, 'agent-matrix.json'), 'utf8'));
      return { exitCode, summary, agents };
    }
    const scenarios = [
      { name: 'namespaced industry IDs', prefix: 'skill-smart-home-', mode: 'normal', expected: 0 },
      { name: 'legacy IDs', prefix: 'skill-', mode: 'normal', expected: 0 },
      { name: 'opaque registered IDs', prefix: 'registered.actual.', mode: 'normal', expected: 0 },
      { name: 'missing installation', prefix: 'skill-smart-home-', mode: 'missing', expected: 1 },
      { name: 'another workspace installation', prefix: 'skill-smart-home-', mode: 'wrong-workspace', expected: 1 },
      { name: 'installed version mismatch', prefix: 'skill-smart-home-', mode: 'wrong-version', expected: 1 },
    ];
    for (const scenario of scenarios) {
      await suite.test(scenario.name, async () => {
        await seed(scenario.prefix, scenario.mode);
        const result = await matrix(scenario.mode + scenario.prefix.replace(/[^a-z]/g, ''));
        assert.equal(result.summary.runtimeConnected, true);
        assert.equal(result.exitCode, scenario.expected);
        if (scenario.expected === 0) {
          assert.equal(result.summary.counts.agentsPass, expectedAgents);
          assert.equal(result.summary.counts.skillsPass, expectedSkills);
        } else if (scenario.mode === 'wrong-version') {
          assert.equal(result.summary.counts.agentsPass, expectedAgents);
          assert.equal(result.summary.counts.skillsPass, expectedSkills - 1);
          assert.ok(result.summary.failures.skills.some((row) => row.failures.includes('SA5_install')));
        } else {
          assert.ok(result.summary.failures.agents.some((row) => row.failures.includes('B7_skill_installed')));
          assert.equal(result.summary.counts.skillsPass, expectedSkills - 1);
        }
        report.cases.push({ name: scenario.name, preconditions: 'Isolated synthetic PostgreSQL matrix fixture',
          steps: ['Seed complete smart-home roster and the stated skill installation variant',
            'Run the actual matrix CLI with --fail-on-error', 'Read matrix JSON and exit status'],
          expected: { exitCode: scenario.expected }, actual: { exitCode: result.exitCode,
            agentsPass: result.summary.counts.agentsPass, skillsPass: result.summary.counts.skillsPass }, pass: true });
      });
    }
    assert.equal(report.cases.length, scenarios.length, 'Every fixture scenario must complete');
  } finally {
    try {
      if (fixture) await fixture.end();
      if (created) {
        await admin.query(`DROP DATABASE "${databaseName}"`);
        report.databaseRemoved = true;
      }
    } finally {
      await admin.end();
      await rm(directory, { recursive: true, force: true });
      report.finishedAt = new Date().toISOString();
      if (process.env.BMS_MATRIX_EVIDENCE_PATH) {
        await writeFile(resolve(process.env.BMS_MATRIX_EVIDENCE_PATH), JSON.stringify(report, null, 2) + '\n');
      }
    }
  }
});
