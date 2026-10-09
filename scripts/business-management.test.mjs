import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as rawRequest } from 'node:http';
import { seedSyntheticDemo } from '../bundles/smart-home/runtime/index.mjs';
import { startBusinessMcp } from './business-management-mcp.mjs';
import { startBusinessHttp, validateHttpBoundary } from './business-management-http.mjs';
import { mergeCodexConfig, mergeJsonMcp, setupWorkbench } from './business-management-setup.mjs';
import { parseArguments, runtimeOptions, readInput, REPOSITORY_ROOT, MAX_INPUT_BYTES, errorObject } from './business-management-common.mjs';
import { confirmHumanOperation, doctor } from './business-management.mjs';

const sandboxEnv = { BMS_DATA_MODE: 'sandbox', BMS_TENANT_ID: 'test-store', BMS_WORKSPACE_ID: 'test-space' };
const waitFor = async predicate => {
  for (let i = 0; i < 200; i += 1) {
    const value = predicate(); if (value !== undefined && value !== false) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Expected transport response did not arrive');
};
async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'bms-transport-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const sink = tty => {
  let text = '';
  const stream = new Writable({ write(chunk, _encoding, done) { text += chunk.toString(); done(); } });
  stream.isTTY = Boolean(tty);
  return { stream, value: () => text };
};
async function cli(args, { env = {}, stdin } = {}) {
  const child = spawn(process.execPath, [join(REPOSITORY_ROOT, 'scripts/business-management.mjs'), ...args], { env: { PATH: process.env.PATH, ...sandboxEnv, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(stdin);
  const [code] = await once(child, 'exit');
  return { code, stdout, stderr };
}
async function mcp(t, dir) {
  const input = new PassThrough(), output = sink(), errors = sink();
  const session = await startBusinessMcp({ options: { '--data-dir': dir }, env: sandboxEnv, input, output: output.stream, errors: errors.stream });
  t.after(() => { input.end(); session.close(); });
  let id = 0;
  const frames = () => output.value().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const request = async (method, params) => {
    const current = ++id;
    input.write(JSON.stringify({ jsonrpc: '2.0', id: current, method, ...(params === undefined ? {} : { params }) }) + '\n');
    return waitFor(() => frames().find(frame => frame.id === current));
  };
  const initialize = async () => {
    const result = await request('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'transport-test', version: '1' }, capabilities: {} });
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return result;
  };
  return { input, output, errors, session, frames, request, initialize };
}
async function http(t, root, tty = false, options = {}, env = {}) {
  await mkdir(join(root, 'bundles/smart-home/ui/workbench'), { recursive: true });
  await writeFile(join(root, 'product.manifest.json'), JSON.stringify({ workbench: { port: 0 } }));
  await writeFile(join(root, 'bundles/smart-home/ui/workbench/index.html'), '<!doctype html><html><body>test</body></html>');
  const input = new PassThrough(); input.isTTY = tty;
  const output = sink(tty), errors = sink();
  const session = await startBusinessHttp({ root, options: { '--data-dir': join(root, 'data'), ...options }, env: { ...sandboxEnv, ...env }, input, output: output.stream, errors: errors.stream });
  t.after(() => session.close());
  const request = (path, body, extra = {}) => fetch(session.url + path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', ...extra.headers }, body: JSON.stringify(body) }), ...extra });
  return { session, input, output, errors, request };
}

test('arguments reject unknown, duplicate, missing and conflicting input; scopes reject invalid values', () => {
  assert.deepEqual(parseArguments(['call', 'status', '--mode', 'sandbox']).positional, ['call', 'status']);
  for (const args of [['--role', 'owner'], ['--mode'], ['--mode', 'sandbox', '--mode', 'live'], ['--input', '{}', '--input-file', '-']]) assert.throws(() => parseArguments(args), { code: 'USAGE' });
  assert.throws(() => runtimeOptions({ '--mode': 'simulated' }, {}), { code: 'INVALID_MODE' });
  assert.throws(() => runtimeOptions({ '--tenant': '../../escape' }, {}), { code: 'INVALID_SCOPE' });
  const config = runtimeOptions({}, {});
  assert.equal(config.dataMode, 'sandbox'); assert.equal(config.tenantId, 'demo-store'); assert.equal(config.workspaceId, 'default');
});
test('input rejects arrays, invalid JSON and oversized files; accepts UTF-8 special characters', async t => {
  const dir = await temporary(t), file = join(dir, 'input.json');
  assert.deepEqual(await readInput({ '--input': '{"title":"中文 🏠 <>&\\\""}' }), { title: '中文 🏠 <>&"' });
  await assert.rejects(() => readInput({ '--input': '[]' }), { code: 'INVALID_INPUT' });
  await assert.rejects(() => readInput({ '--input': '{' }), { code: 'INVALID_JSON' });
  await writeFile(file, 'x'.repeat(MAX_INPUT_BYTES + 1));
  await assert.rejects(() => readInput({ '--input-file': file }), { code: 'INPUT_TOO_LARGE' });
});
test('errors redact credentials and cap detail', () => {
  const value = errorObject(new Error('Bearer abcdefghijklmnop sk-abcdefghijklmnop apiKey=abcdefghijklmnop ' + 'x'.repeat(1000)));
  assert(!value.message.includes('abcdefghijklmnop')); assert(value.message.length <= 600);
});
test('doctor reports verified SQLite and repository entrypoints', async () => {
  const result = await doctor({ '--mode': 'sandbox' });
  assert.equal(result.ready, true); assert.equal(result.model.additionalApiKeyRequired, false); assert(result.items.find(item => item.id === 'sqlite').version);
});
test('human CLI confirmation cannot be supplied by a pipe', async () => {
  await assert.rejects(() => confirmHumanOperation('approval.decide', {}, { input: new PassThrough(), output: sink().stream }), { code: 'HUMAN_TERMINAL_REQUIRED' });
});
test('CLI demo persists, replays, exposes catalogue and refuses live demo/agent approval', async t => {
  const dir = await temporary(t);
  const init = await cli(['init', '--demo', '--data-dir', dir]); assert.equal(init.code, 0, init.stderr);
  assert.equal(JSON.parse(init.stdout).data.runtimeModelCalls, 0); assert.equal(JSON.parse(init.stdout).seeded.seeded, true);
  const again = await cli(['init', '--demo', '--data-dir', dir]); assert.equal(again.code, 0, again.stderr); assert.equal(JSON.parse(again.stdout).seeded.recovered, true);
  const catalogue = await cli(['catalog']); assert.equal(catalogue.code, 0, catalogue.stderr); assert(JSON.parse(catalogue.stdout).operations.length >= 30);
  const approval = await cli(['call', 'approval.decide', '--data-dir', dir, '--input', '{}']); assert.notEqual(approval.code, 0); assert.match(approval.stderr, /PERMISSION_DENIED/);
  const live = await cli(['init', '--demo', '--mode', 'live', '--data-dir', join(dir, 'live')]); assert.notEqual(live.code, 0); assert.match(live.stderr, /SCENARIO_IN_LIVE_BLOCKED/);
  const unknown = await cli(['call', 'unknown.op', '--data-dir', dir]); assert.notEqual(unknown.code, 0); assert.match(unknown.stderr, /NOT_FOUND/);
});
test('CLI read and write use shared schema, stable idempotency and actor', async t => {
  const dir = await temporary(t), args = ['call', 'store.upsert', '--data-dir', dir, '--input', JSON.stringify({ id: 'one', name: '测试', city: 'test', serviceAreas: ['A'], minMarginRatio: 0.25, maxDiscountRatio: 0.08, idempotencyKey: 'store-one' })];
  const first = await cli(args); assert.equal(first.code, 0, first.stderr); const written = JSON.parse(first.stdout); assert.equal(written.receipt.localCommitted, true); assert.equal(written.receipt.externalVerified, false);
  const replay = await cli(args); assert.equal(replay.code, 0, replay.stderr); assert.equal(JSON.parse(replay.stdout).replayed, true);
  const injection = await cli(['call', 'status', '--data-dir', dir, '--input', '{"actor":{"role":"owner"}}']); assert.notEqual(injection.code, 0); assert.match(injection.stderr, /INVALID_INPUT/);
});

test('scenario CLI imports synthetic background as operator, preserves an incomplete lead and cannot run in live', async t => {
  const dir = await temporary(t);
  const catalogue = await cli(['scenario', 'list', '--data-dir', dir]);
  assert.equal(catalogue.code, 0, catalogue.stderr);
  assert.match(catalogue.stdout, /shuguang-chengdu-v1/);
  const imported = await cli(['scenario', 'import', '--data-dir', dir]);
  assert.equal(imported.code, 0, imported.stderr);
  const first = JSON.parse(imported.stdout);
  assert.equal(first.receipt.localCommitted, true);
  assert.equal(first.receipt.externalVerified, false);
  const replay = await cli(['scenario', 'import', '--data-dir', dir]);
  assert.equal(replay.code, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).replayed, true);
  const stores = await cli(['call', 'entity.list', '--data-dir', dir, '--input', '{"type":"store"}']);
  assert.equal(stores.code, 0, stores.stderr);
  const storeId = JSON.parse(stores.stdout).data[0].id;
  const created = await cli(['call', 'lead.create', '--data-dir', dir, '--input', JSON.stringify({ id: 'surname-only', storeId, surname: '周', idempotencyKey: 'surname-only-create' })]);
  assert.equal(created.code, 0, created.stderr);
  const lead = JSON.parse(created.stdout).data;
  assert.equal(lead.surname, '周');
  assert.equal(lead.consent.status, 'unknown');
  for (const key of ['alias', 'contactRef', 'phoneRef', 'wechatRef', 'budgetCents', 'renovationStage']) assert.equal(Object.hasOwn(lead, key), false, key);
  const agentImport = await cli(['call', 'scenario.import', '--data-dir', dir, '--input', '{"datasetId":"shuguang-chengdu-v1","idempotencyKey":"agent-import"}']);
  assert.notEqual(agentImport.code, 0); assert.match(agentImport.stderr, /PERMISSION_DENIED/);
  const live = await cli(['scenario', 'import', '--mode', 'live', '--data-dir', join(dir, 'live')]);
  assert.notEqual(live.code, 0); assert.match(live.stderr, /SCENARIO_IN_LIVE_BLOCKED/);
  const bad = await cli(['scenario', 'approve', '--data-dir', dir]);
  assert.notEqual(bad.code, 0); assert.match(bad.stderr, /USAGE/);
});
test('Codex merge preserves unrelated configuration and detects duplicate/malformed blocks', () => {
  const managed = '# BUSINESS-MANAGEMENT:BEGIN\n[mcp_servers.business_management]\ncommand="node"\n# BUSINESS-MANAGEMENT:END';
  const prior = 'model="keep"\n[mcp_servers.existing]\ncommand="keep"\n';
  const merged = mergeCodexConfig(prior, managed); assert(merged.startsWith(prior)); assert.equal(mergeCodexConfig(merged, managed), merged);
  for (const text of ['[mcp_servers.business_management]\ncommand="other"', '# BUSINESS-MANAGEMENT:BEGIN\n', '# BUSINESS-MANAGEMENT:END\n# BUSINESS-MANAGEMENT:BEGIN']) assert.throws(() => mergeCodexConfig(text, managed), { code: 'CONFIG_CONFLICT' });
});
test('JSON merge preserves other servers and refuses malformed or foreign same-name server', () => {
  const server = { command: '/node', args: ['/repo/scripts/business-management-mcp.mjs'] };
  const merged = JSON.parse(mergeJsonMcp('{"other":"keep","mcpServers":{"foo":{"command":"bar"}}}', server)); assert.equal(merged.other, 'keep'); assert.equal(merged.mcpServers.foo.command, 'bar');
  for (const value of ['invalid', '[]', '{"mcpServers":[]}', '{"mcpServers":{"business_management":{"command":"foreign","args":[]}}}', '{"mcpServers":{"business_management":{"command":"foreign","args":["/other-clone/scripts/business-management-mcp.mjs"]}}}']) assert.throws(() => mergeJsonMcp(value, server), { code: 'CONFIG_CONFLICT' });
});
test('setup writes absolute paths, protects config permissions, preserves conflicts and is repeatable', async t => {
  const root = await temporary(t); await mkdir(join(root, 'scripts')); await writeFile(join(root, 'scripts/business-management-mcp.mjs'), '');
  const result = await setupWorkbench({}, { root, env: sandboxEnv, nodePath: process.execPath }); assert.equal(result.results.length, 4); assert(result.results.every(item => item.status === 'created'));
  const codex = await readFile(join(root, '.codex/config.toml'), 'utf8'); assert(codex.includes(process.execPath)); assert(codex.includes(join(root, 'scripts/business-management-mcp.mjs'))); assert.equal((await stat(join(root, '.codex/config.toml'))).mode & 0o777, 0o600);
  const repeat = await setupWorkbench({}, { root, env: sandboxEnv, nodePath: process.execPath }); assert(repeat.results.every(item => item.status === 'unchanged'));
  const foreign = '[mcp_servers.business_management]\ncommand="foreign"\n'; await writeFile(join(root, '.codex/config.toml'), foreign);
  const conflict = await setupWorkbench({ '--client': 'codex' }, { root, env: sandboxEnv }); assert.equal(conflict.results[0].status, 'preserved-conflict'); assert.equal(await readFile(join(root, '.codex/config.toml'), 'utf8'), foreign); assert((await readFile(conflict.results[0].candidate, 'utf8')).includes('BUSINESS-MANAGEMENT:BEGIN'));
});
test('MCP requires initialization and exposes only agent operations with current schemas', async t => {
  const client = await mcp(t, await temporary(t));
  assert.equal((await client.request('tools/list')).error.code, -32000);
  const initialized = await client.initialize(); assert.equal(initialized.result.protocolVersion, '2025-11-25'); assert.equal(initialized.result.serverInfo.name, 'business-management-system');
  const listing = await client.request('tools/list'); const names = listing.result.tools.map(tool => tool.name);
  assert(names.includes('bms_task_claim')); assert(names.includes('bms_task_submit')); assert(!names.includes('bms_approval_decide')); assert(!names.includes('bms_survey_record')); assert(!names.includes('bms_content_publish'));
  assert(names.includes('bms_lead_enrich')); assert(names.includes('bms_industry_context')); assert(names.includes('bms_scenario_list'));
  assert(!names.includes('bms_scenario_import')); assert(!names.includes('bms_contract_record_signing')); assert(!names.includes('bms_customer_upsert')); assert(!names.includes('bms_business_record'));
  const submit = listing.result.tools.find(tool => tool.name === 'bms_task_submit'); assert(submit.inputSchema.required.includes('idempotencyKey')); assert.equal(submit.inputSchema.additionalProperties, false);
  const status = await client.request('tools/call', { name: 'bms_status', arguments: {} }); assert.equal(status.result.structuredContent.data.workspaceId, 'test-space'); assert.equal(status.result.structuredContent.data.runtimeModelCalls, 0);
  assert.match(client.errors.value(), /MCP ready/); assert(client.frames().every(frame => frame.jsonrpc === '2.0'));
});
test('MCP denies hidden owner methods, extra scope/role input and unknown resources; prompts guide host execution', async t => {
  const client = await mcp(t, await temporary(t)); await client.initialize();
  const hidden = await client.request('tools/call', { name: 'bms_approval_decide', arguments: {} }); assert.equal(hidden.result.isError, true); assert.equal(hidden.result.structuredContent.error.code, 'NOT_FOUND');
  const spoof = await client.request('tools/call', { name: 'bms_status', arguments: { role: 'owner', tenantId: 'other' } }); assert.equal(spoof.result.isError, true); assert.equal(spoof.result.structuredContent.error.code, 'INVALID_INPUT');
  const resource = await client.request('resources/read', { uri: 'bms://host-guide' }); assert.match(resource.result.contents[0].text, /task\.claim|task_claim/);
  const prompt = await client.request('prompts/get', { name: 'business-management' }); assert.match(prompt.result.messages[0].content.text, /leaseToken/);
  assert.equal((await client.request('resources/read', { uri: 'bms://secret' })).error.code, -32602); assert.equal((await client.request('does/not/exist')).error.code, -32601);
});

test('MCP host task claim and submit produce persisted local receipts and stable replay', async t => {
  const client = await mcp(t, await temporary(t)); seedSyntheticDemo(client.session.engine); await client.initialize();
  const claimed = await client.request('tools/call', { name: 'bms_task_claim', arguments: { workflowId: 'synthetic-growth-flow', idempotencyKey: 'mcp-claim-1' } });
  const lease = claimed.result.structuredContent.data; assert(lease.leaseToken); assert(lease.task.context.refs.lead.budgetCents === 200000);
  const input = { taskId: lease.taskId, leaseToken: lease.leaseToken, artifact: { fit: true, budgetCents: 200000, renovationStage: 'finished', needs: ['Recorded synthetic living room lighting'], reason: 'Uses only seeded structured customer fields', missingInformation: [] }, modelTrace: { host: 'test', model: 'transport-fixture', invocationRef: 'mcp-test-1' }, idempotencyKey: 'mcp-submit-1' };
  const submitted = await client.request('tools/call', { name: 'bms_task_submit', arguments: input }); assert.equal(submitted.result.isError, false); assert.equal(submitted.result.structuredContent.data.task.status, 'completed'); assert.equal(submitted.result.structuredContent.receipt.externalVerified, false);
  const replayed = await client.request('tools/call', { name: 'bms_task_submit', arguments: input }); assert.equal(replayed.result.structuredContent.replayed, true);
  const listed = await client.request('tools/call', { name: 'bms_task_list', arguments: { workflowId: 'synthetic-growth-flow' } }); assert(!JSON.stringify(listed.result).includes(lease.leaseToken)); assert(!JSON.stringify(listed.result).includes('leaseTokenHash'));
  const verified = await client.request('tools/call', { name: 'bms_ledger_verify', arguments: {} }); assert.equal(verified.result.structuredContent.data.ok, true);
});

test('MCP rejects malformed and oversized frames without printing non-protocol stdout', async t => {
  const client = await mcp(t, await temporary(t)); client.input.write('{bad}\n');
  await waitFor(() => client.frames().some(frame => frame.error?.code === -32700));
  client.input.write('x'.repeat(MAX_INPUT_BYTES + 1)); await waitFor(() => client.frames().some(frame => frame.error?.code === -32600));
  assert.throws(() => client.session.engine.call('status', {}, { id: 'test', role: 'agent', channel: 'mcp', tenantId: 'test-store', workspaceId: 'test-space' }), { code: 'ENGINE_CLOSED' });
});
test('HTTP host/origin boundary rejects rebinding and foreign origin', () => {
  validateHttpBoundary({ headers: { host: '127.0.0.1:9393' } }, 9393);
  for (const headers of [{ host: 'evil.test:9393' }, { host: '127.0.0.1:9393', origin: 'https://evil.test' }, { host: 'localhost:9393', 'sec-fetch-site': 'cross-site' }]) assert.throws(() => validateHttpBoundary({ headers }, 9393));
});
test('HTTP reads manifest default and environment port; options take precedence', async t => {
  const root = await temporary(t), app = await http(t, root, false, { '--port': '0' }, { BMS_PORT: 'invalid' }); assert.match(app.session.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const second = await http(t, await temporary(t), false, {}, { BMS_PORT: '0' }); assert(second.session.server.address().port > 0);
  const third = await http(t, await temporary(t)); assert(third.session.server.address().port > 0);
  await assert.rejects(() => startBusinessHttp({ root, options: { '--port': '65536' }, env: sandboxEnv }), { code: 'USAGE' });
});
test('HTTP static route and agent API return safe headers, shared data and meaningful errors', async t => {
  const app = await http(t, await temporary(t));
  const page = await app.request('/'); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/); assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const status = await app.request('/api/status'); assert.equal(status.status, 200); assert.equal((await status.json()).data.dataMode, 'sandbox');
  const state = await app.request('/api/state'); assert.equal(state.status, 200); assert.equal((await state.json()).data.store.total, 0);
  const missing = await app.request('/.env'); assert.equal(missing.status, 404);
  const forbiddenStatus = await new Promise((resolve, reject) => { const call = rawRequest(app.session.url + '/api/status', { headers: { host: 'foreign.test' } }, response => { response.resume(); resolve(response.statusCode); }); call.on('error', reject); call.end(); }); assert.equal(forbiddenStatus, 403);
  const origin = await app.request('/api/call', { operation: 'status', input: {} }, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.test' } }); assert.equal(origin.status, 403);
  const query = await app.request('/api/status?q=1'); assert.equal(query.status, 400);
  const method = await app.request('/api/status', {}, { method: 'POST', headers: { 'content-type': 'application/json' } }); assert.equal(method.status, 404);
});
test('HTTP validates content type, JSON, size and untrusted role fields', async t => {
  const app = await http(t, await temporary(t));
  const contentType = await fetch(app.session.url + '/api/call', { method: 'POST', body: '{}' }); assert.equal(contentType.status, 415);
  const ambiguousType = await fetch(app.session.url + '/api/call', { method: 'POST', headers: { 'content-type': 'application/json-malformed' }, body: '{}' }); assert.equal(ambiguousType.status, 415);
  const invalid = await fetch(app.session.url + '/api/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }); assert.equal(invalid.status, 400);
  const large = await fetch(app.session.url + '/api/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(MAX_INPUT_BYTES) }) }); assert.equal(large.status, 413);
  const spoof = await app.request('/api/call', { operation: 'status', input: {}, role: 'owner' }); assert.equal(spoof.status, 400);
  const owner = await app.request('/api/call', { operation: 'approval.decide', input: {} }); assert.equal(owner.status, 403); assert.equal((await owner.json()).error.code, 'PERMISSION_DENIED');
});
test('HTTP background process cannot grant owner identity', async t => {
  const app = await http(t, await temporary(t));
  const status = await app.request('/api/owner/session'); assert.equal((await status.json()).ownerConsoleAvailable, false);
  const apply = await app.request('/api/owner/session', {}, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.session.url } }); assert.equal(apply.status, 403); assert.equal((await apply.json()).error.code, 'OWNER_CONSOLE_UNAVAILABLE');
});
test('HTTP owner handshake requires terminal confirmation, same origin and CSRF; revocation clears authority', async t => {
  const app = await http(t, await temporary(t), true);
  const missingOrigin = await app.request('/api/owner/session', {}); assert.equal(missingOrigin.status, 403);
  const applied = await app.request('/api/owner/session', {}, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.session.url } }); assert.equal(applied.status, 202);
  const cookie = applied.headers.get('set-cookie').split(';')[0]; assert.match(applied.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const pending = await applied.json(); assert.equal(pending.status, 'pending'); assert.equal(Object.hasOwn(pending, 'csrfToken'), false);
  const callHeaders = { 'content-type': 'application/json', origin: app.session.url, cookie };
  const noConfirm = await app.request('/api/owner/call', { operation: 'status', input: {} }, { method: 'POST', headers: callHeaders }); assert.equal(noConfirm.status, 403);
  app.input.write(`owner ${pending.requestId}\n`); await waitFor(() => app.output.value().includes('已由终端确认'));
  const authorized = await app.request('/api/owner/session', undefined, { headers: { cookie } }); const auth = await authorized.json(); assert.equal(auth.status, 'authorized'); assert(auth.csrfToken); assert(!app.output.value().includes(auth.csrfToken)); assert(!app.output.value().includes(cookie.split('=')[1]));
  const noCsrf = await app.request('/api/owner/call', { operation: 'status', input: {} }, { method: 'POST', headers: callHeaders }); assert.equal(noCsrf.status, 403);
  const success = await app.request('/api/owner/call', { operation: 'status', input: {} }, { method: 'POST', headers: { ...callHeaders, 'x-bms-csrf': auth.csrfToken } }); assert.equal(success.status, 200);
  const revoke = await app.request('/api/owner/session', undefined, { method: 'DELETE', headers: { origin: app.session.url, cookie, 'x-bms-csrf': auth.csrfToken } }); assert.equal(revoke.status, 200);
  const after = await app.request('/api/owner/call', { operation: 'status', input: {} }, { method: 'POST', headers: { ...callHeaders, 'x-bms-csrf': auth.csrfToken } }); assert.equal(after.status, 403);
});
