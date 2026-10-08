import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = join(dirname(fileURLToPath(import.meta.url)), 'bootstrap.sh');

async function runBootstrap(t, { migrateCode = 0, seedCode = 0, existingEnv } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bms bootstrap 中文-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['scripts', 'bin', 'node_modules', 'packages/base/computer-use/toolkit']) {
    await mkdir(join(root, path), { recursive: true });
  }
  await copyFile(script, join(root, 'scripts/bootstrap.sh'));
  const example = 'BMS_MODE=sandbox\nPRODUCT=smart-home\n';
  await writeFile(join(root, '.env.example'), example);
  if (existingEnv !== undefined) await writeFile(join(root, '.env'), existingEnv);
  const callsPath = join(root, 'calls.txt');
  await writeFile(join(root, 'bin/node'), `#!/bin/sh
case "$1" in
  -e) printf '24\\n' ;;
  -v) printf 'v24.0.0-test\\n' ;;
  *) exit 96 ;;
esac
`, { mode: 0o755 });
  await writeFile(join(root, 'bin/pnpm'), `#!/bin/sh
printf '%s\\n' "$*" >> "$BMS_BOOTSTRAP_TEST_CALLS"
case "$1" in
  -v) printf '10.14.0-test\\n' ;;
  db:migrate) exit "$BMS_BOOTSTRAP_TEST_MIGRATE_CODE" ;;
  db:seed) exit "$BMS_BOOTSTRAP_TEST_SEED_CODE" ;;
  *) exit 97 ;;
esac
`, { mode: 0o755 });
  await writeFile(join(root, 'bin/docker'), `#!/bin/sh
case "$1" in
  ps) printf 'workloom-im-pg\\n' ;;
  inspect) printf 'healthy\\n' ;;
  *) exit 98 ;;
esac
`, { mode: 0o755 });
  const result = spawnSync('/bin/bash', [join(root, 'scripts/bootstrap.sh'), '--skip-computer'], {
    cwd: root,
    env: {
      PATH: `${join(root, 'bin')}:/usr/bin:/bin`,
      BMS_BOOTSTRAP_TEST_CALLS: callsPath,
      BMS_BOOTSTRAP_TEST_MIGRATE_CODE: String(migrateCode),
      BMS_BOOTSTRAP_TEST_SEED_CODE: String(seedCode),
    },
    encoding: 'utf8', timeout: 15_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, result.stderr);
  return {
    ...result,
    calls: (await readFile(callsPath, 'utf8')).trim().split('\n'),
    env: await readFile(join(root, '.env'), 'utf8'),
    example,
  };
}

test('foundation bootstrap migrates before invoking only the current product seed', async t => {
  const result = await runBootstrap(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.calls, ['-v', 'db:migrate', 'db:seed']);
  assert.equal(result.env, result.example);
  assert.match(result.stdout, /当前产品 db:seed 种子就位/);
  assert.match(result.stdout, /FAIL=0/);
});

test('foundation bootstrap never invokes any seed after migration failure', async t => {
  const result = await runBootstrap(t, { migrateCode: 12 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(result.calls, ['-v', 'db:migrate']);
  assert.match(result.stdout, /db:migrate 失败/);
  assert.match(result.stdout, /迁移未完成，已停止 db:seed/);
  assert.match(result.stdout, /FAIL=1/);
});

test('foundation bootstrap reports a current product seed failure as blocking', async t => {
  const result = await runBootstrap(t, { seedCode: 13 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(result.calls, ['-v', 'db:migrate', 'db:seed']);
  assert.match(result.stdout, /pnpm db:seed 失败/);
  assert.doesNotMatch(result.stdout, /当前产品 db:seed 种子就位/);
  assert.match(result.stdout, /FAIL=1/);
});

test('foundation bootstrap preserves an existing environment file', async t => {
  const existingEnv = 'BMS_MODE=live\nPRODUCT=existing-store\n';
  const result = await runBootstrap(t, { existingEnv });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.env, existingEnv);
  assert.match(result.stdout, /\.env 已存在（跳过）/);
  assert.deepEqual(result.calls, ['-v', 'db:migrate', 'db:seed']);
});
