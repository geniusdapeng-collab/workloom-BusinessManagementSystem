#!/usr/bin/env node
/** Real browser checks on a fresh, explicitly synthetic Chengdu dataset. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { PassThrough } from 'node:stream';
const { values } = parseArgs({ options: { 'source-root': { type: 'string', default: fileURLToPath(new URL('../', import.meta.url)) }, output: { type: 'string' }, channel: { type: 'string' } } });
const root = resolve(values['source-root']), proofDir = resolve(values.output ?? join(root, 'docs/evidence/smart-home-depth/ui'));
await mkdir(proofDir, { recursive: true });
const require = createRequire(pathToFileURL(join(root, 'apps/web/package.json')));
const { chromium } = require('@playwright/test');
const { startBusinessHttp } = await import(pathToFileURL(join(root, 'scripts/business-management-http.mjs')));
const { seedSyntheticScenario } = await import(pathToFileURL(join(root, 'bundles/smart-home/runtime/index.mjs')));
const dataDir = await mkdtemp(join(tmpdir(), 'bms-chengdu-ui-'));
const input = new PassThrough(), output = new PassThrough(), errors = new PassThrough();
input.isTTY = false; output.isTTY = false; output.on('data', () => {}); errors.on('data', () => {});
const cases = [], events = { pageErrors: [], consoleErrors: [], requestFailures: [] }, screenshots = [];
let session, browser, context, page, actor, startupError;
let requestIndex = 0;
const call = (operation, input = {}) => session.engine.call(operation, { ...input, ...(!session.engine.catalog().operations.find(item => item.name === operation).readOnly ? { idempotencyKey: `depth-browser-${++requestIndex}` } : {}) }, actor).data;
const list = type => call('entity.list', { type, limit: 500 });
async function record(id, precondition, steps, expected, execute) {
  try { const actual = await execute(); cases.push({ id, precondition, steps, expected, actual, pass: true }); }
  catch (error) { cases.push({ id, precondition, steps, expected, actual: { error: error.message }, pass: false }); if (page) { try { await page.screenshot({ path: join(proofDir, `${id}-failure.png`), fullPage: true }); await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close())); } catch (failure) { events.requestFailures.push({ case: id, error: failure.message }); } } }
  console.log(JSON.stringify({ id, pass: cases.at(-1).pass, ...(cases.at(-1).pass ? {} : { error: cases.at(-1).actual.error }) }));
}
async function navigate(route) { await page.locator(`nav [data-page="${route}"]`).click(); await page.waitForFunction(route => document.querySelector('nav a.active')?.dataset.page === route, route); }
async function fill(name, value) { const control = page.locator(`#action-form [name="${name}"]`); if (await control.evaluate(element => element.tagName === 'SELECT')) await control.selectOption(String(value)); else await control.fill(String(value)); }
async function save() { const waiting = page.waitForResponse(response => response.url().endsWith('/api/call')); await page.locator('#submit-action').click(); const response = await waiting; const value = await response.json(); return { status: response.status(), operation: value.operation, error: value.error?.code }; }
async function photo(name) {
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: join(proofDir, name), fullPage: true }); screenshots.push(name);
  const viewportName = name.replace(/\.png$/, '-viewport.png');
  await page.screenshot({ path: join(proofDir, viewportName) }); screenshots.push(viewportName);
}
try {
  session = await startBusinessHttp({ root, input, output, errors, env: {}, options: { '--port': '0', '--data-dir': dataDir, '--mode': 'sandbox', '--tenant': 'depth-browser', '--workspace': 'chengdu' } });
  seedSyntheticScenario(session.engine);
  actor = { id: 'independent-depth-browser', role: 'agent', channel: 'test', tenantId: session.config.tenantId, workspaceId: session.config.workspaceId };
  browser = await chromium.launch({ ...(values.channel ? { channel: values.channel } : {}), headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
  page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', error => events.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') events.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => events.requestFailures.push({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
  await record('DEPTH-UI-01', 'Fresh sandbox; imported Chengdu fictional history; all host tasks untouched', 'Open desktop; inspect store identity, all eight routes and task states', 'Eight real pages; exact live workforce count; no seeded model completions or fabricated history metrics', async () => {
    await page.goto(session.url); await page.locator('#updated').filter({ hasText: '更新于' }).waitFor();
    assert.equal(await page.locator('#banner').isVisible(), false);
    assert.match(await page.locator('#store-name').innerText(), /蜀光智家/);
    for (const route of ['overview', 'growth', 'delivery', 'aftercare', 'approvals', 'team', 'store', 'records']) { await navigate(route); assert.ok(!(await page.locator('#content').innerText()).includes('undefined'), route); }
    const tasks = list('task'); assert.ok(tasks.length >= 49); assert.equal(tasks.filter(task => task.status === 'completed').length, 0); assert.equal(tasks.filter(task => task.modelTrace || task.artifact).length, 0);
    await navigate('overview'); await photo('desktop-overview.png');
    return { routes: 8, tasks: tasks.length, completedSeededTasks: 0, modelTracesSeeded: 0, actualCounts: call('status').counts };
  });
  await record('DEPTH-UI-02', 'Anonymous browser and an imported store', 'Use the lead form to save surname only; inspect stored fields and missing information card', 'No generated contact, budget or renovation stage; unknown consent retained; lead visible with missing fields', async () => {
    await navigate('growth'); await page.locator('#content [data-operation="lead.create"]').first().click();
    await fill('id', 'depth-ui-surname-only'); await fill('surname', '周');
    const response = await save(); assert.equal(response.status, 200, JSON.stringify(response)); await page.locator('#drawer').waitFor({ state: 'hidden' });
    const lead = call('entity.get', { type: 'lead', id: 'depth-ui-surname-only' });
    assert.equal(lead.surname, '周'); assert.equal(lead.consent.status, 'unknown');
    for (const key of ['alias', 'contactRef', 'phoneRef', 'wechatRef', 'budgetCents', 'renovationStage']) assert.equal(Object.hasOwn(lead, key), false, key);
    const card = page.locator('.lead-card').filter({ has: page.locator('[data-enrich-lead="depth-ui-surname-only"]') }); assert.match(await card.innerText(), /待完善/);
    await photo('desktop-growth.png'); return { response, actualLeadVersion: lead.version, absentFields: ['alias', 'contactRef', 'phoneRef', 'wechatRef', 'budgetCents', 'renovationStage'], consent: lead.consent.status };
  });
  await record('DEPTH-UI-03', 'Surname-only lead with unchanged version', 'Open its enrichment button; propose a verified synthetic intent with source model-proposal and evidence', 'Selected lead/version preserved; a proposal appears; original lead facts and consent unchanged', async () => {
    const before = call('entity.get', { type: 'lead', id: 'depth-ui-surname-only' });
    await page.locator('[data-enrich-lead="depth-ui-surname-only"]').click();
    assert.equal(await page.locator('[name="leadId"]').inputValue(), before.id); assert.equal(Number(await page.locator('[name="expectedVersion"]').inputValue()), before.version);
    await fill('patch.intent', 'AI 提议：先确认客厅照明与是否方便到店，仅为演练问题。');
    await fill('evidence.uri', 'evidence://synthetic/depth-ui-proposal'); await fill('evidence.sha256', 'b'.repeat(64)); await fill('evidence.source', 'synthetic');
    await fill('evidence.observedAt', '2026-01-01T14:00'); await fill('evidence.summary', '明确合成的界面提议测试；没有客户确认。');
    const response = await save(); assert.equal(response.status, 200, JSON.stringify(response)); await page.locator('#drawer').waitFor({ state: 'hidden' });
    const after = call('entity.get', { type: 'lead', id: before.id }); assert.equal(after.version, before.version); assert.equal(after.intent, before.intent); assert.equal(after.consent.status, 'unknown');
    const proposal = list('leadEnrichment').find(item => item.leadId === before.id); assert.equal(proposal.customerFactsApplied, false); assert.equal(proposal.status, 'pending-human-confirmation');
    return { response, originalVersion: after.version, appliedFacts: false, proposalStatus: proposal.status };
  });
  await record('DEPTH-UI-04', 'Imported clients, point revisions, design and construction records', 'Inspect SVG dimensions and exact number of points; switch revision; read customer/project document associations', 'Each diagram follows stored coordinates; revision switch changes the actual drawing; source disclosure visible', async () => {
    await navigate('delivery'); const plans = list('pointPlan'), latest = plans.at(-1);
    assert.equal(await page.locator('#point-diagram svg').count(), latest.rooms.length);
    assert.equal(await page.locator('#point-diagram svg circle').count(), latest.points.length);
    assert.match(await page.locator('#point-diagram').innerText(), /毫米/); assert.match(await page.locator('#point-diagram').innerText(), /虚构历史/);
    const first = plans[0]; await page.locator('#point-plan-view').selectOption(first.id); assert.equal(await page.locator('#point-diagram svg circle').count(), first.points.length);
    const survey = list('survey').find(item => item.id === first.surveyId);
    assert.deepEqual(await page.locator('#point-diagram figcaption strong').allTextContents(), first.rooms.map(room => survey.rooms.find(item => item.id === room.roomId).name));
    const coordinates = await page.locator('#point-diagram svg circle').evaluateAll(elements => elements.map(element => ({ x: Number(element.getAttribute('cx')), y: Number(element.getAttribute('cy')) })));
    const actualPoints = first.rooms.flatMap(room => first.points.filter(point => point.roomId === room.roomId).map(point => ({ x: point.xMm, y: point.yMm })));
    assert.deepEqual(coordinates, actualPoints);
    await photo('desktop-delivery.png'); return { selectedRevision: first.revision, rooms: first.rooms.length, points: coordinates.length, storedCoordinatesMatched: true, designs: list('design').length, constructionPlans: list('construction').length, contracts: list('contract').length };
  });
  await record('DEPTH-UI-05', 'Anonymous agent browser; point plan and contract editing available', 'Open point-plan form; add and remove a point row; try opening signed-contract evidence', 'Structured point inputs and minimum item check; no owner action allowed without terminal session', async () => {
    await page.locator('[data-operation="pointPlan.record"]').click();
    assert.equal(await page.locator('[data-array-items="points"]>.array-item').count(), 1);
    await page.locator('[data-add-array="points"]').click(); assert.equal(await page.locator('[data-array-items="points"]>.array-item').count(), 2);
    await page.locator('[data-array-items="points"]>.array-item').last().locator('[data-remove-array]').click(); assert.equal(await page.locator('[data-array-items="points"]>.array-item').count(), 1);
    assert.equal(await page.locator('[name="points.0.xMm"]').getAttribute('type'), 'number');
    assert.equal(await page.locator('[name="rooms.0.widthMm"]').getAttribute('min'), '100');
    await page.locator('#cancel-drawer').click(); await page.locator('[data-operation="contract.record_signing"]').click();
    await page.locator('#apply-owner').waitFor(); assert.equal(await page.locator('#drawer').isVisible(), false); await page.locator('#close-detail').click();
    return { structuredPointRowsUsable: true, physicalSigningBypass: false, realHumanApprovalClaimed: false };
  });
  await record('DEPTH-UI-06', 'Actual workforce catalogue with new roles and skill ownership', 'Open employees; launch sales coach skill; inspect exact top-level operation defaults', 'Exact runtime names/responsibilities/skills rendered and the matching employee-work form selected', async () => {
    await navigate('team'); const workforce = session.engine.catalog().workforce;
    assert.equal(await page.locator('.team-card').count(), workforce.length);
    const coach = workforce.find(role => role.id === 'sales-coach'); assert.ok(coach);
    const button = page.locator(`[data-employee="sales-coach"][data-skill="${coach.skills[0]}"]`); assert.match(await button.innerText(), /销售.*(?:陪练|训练|角色扮演)/); await button.click();
    assert.equal(await page.locator('[name="kind"]').inputValue(), 'employee-work'); assert.equal(await page.locator('[name="employeeId"]').inputValue(), coach.id); assert.equal(await page.locator('[name="skillId"]').inputValue(), coach.skills[0]);
    assert.equal(await page.locator('[name="employeeId"] option:checked').innerText(), coach.name);
    assert.equal(await page.locator('[name="skillId"] option:checked').innerText(), session.engine.catalog().skillTitles[coach.skills[0]]);
    const other = workforce.find(role => role.id === 'appointment-coordinator');
    await page.locator('[name="employeeId"]').selectOption(other.id);
    assert.equal(await page.locator('[name="skillId"]').inputValue(), '');
    assert.deepEqual(await page.locator('[name="skillId"] option').evaluateAll(options => options.filter(option => option.value).map(option => option.value)), other.skills);
    await page.locator('#cancel-drawer').click(); return { workforce: workforce.length, role: coach.id, skill: coach.skills[0], changedRole: other.id, staleSkillCleared: true, modelRunClaimed: false };
  });
  await record('DEPTH-UI-11', 'Recorded lead has budget zero, no service area and consultation-only consent', 'Create that lead through native operation, refresh growth, compare UI missing facts and permissions with runtime', 'Budget and service area remain missing; appointment authorization remains missing; consultation is present', async () => {
    const lead = call('lead.create', { id: 'depth-ui-completeness-edge', storeId: list('store')[0].id, surname: '何', contactRef: 'SYN-UI-CONTACT', buildingRef: 'SYN-UI-BUILDING', intent: '咨询客厅照明', budgetCents: 0, renovationStage: 'design', consent: { status: 'granted', purposes: ['consultation'], evidence: { uri: 'evidence://synthetic/ui-consultation-only', sha256: 'c'.repeat(64), source: 'synthetic', observedAt: new Date(Date.now() - 60000).toISOString(), summary: '仅用于沙箱界面授权差异验证，未发生真实客户授权。' } } });
    await navigate('growth'); await page.locator('#refresh').click();
    const card = page.locator('.lead-card').filter({ has: page.locator('[data-enrich-lead="depth-ui-completeness-edge"]') }); await card.waitFor();
    const missing = await card.locator('.missing').innerText();
    assert.deepEqual(lead.completeness.missingFields, ['budgetCents', 'serviceArea']);
    assert.deepEqual(lead.completeness.permissionsMissing, ['appointment']);
    assert.match(missing, /预算/); assert.match(missing, /服务区域/); assert.match(missing, /预约用途授权/); assert.doesNotMatch(missing, /咨询用途授权/);
    return { missingFields: lead.completeness.missingFields, permissionsMissing: lead.completeness.permissionsMissing, actualCard: missing };
  });
  await record('DEPTH-UI-07', 'Sealed industry source material and independently fictional SKUs', 'Open store page and inspect product, scene, channel, source and affiliation boundaries', 'Fictional identity and official-reference boundary visible; links exactly match sealed references', async () => {
    await navigate('store'); const text = await page.locator('#content').innerText(); assert.match(text, /蜀光智家/); assert.match(text, /华为/); assert.match(text, /Aqara/); assert.match(text, /虚构/); assert.match(text, /不能自动作为.*兼容依据.*品牌授权/);
    const background = call('industry.context').data, links = await page.locator('#content a[target="_blank"]').evaluateAll(elements => elements.map(element => element.href));
    assert.deepEqual(links, background.officialReferences.items.map(item => item.url));
    assert.ok(text.includes('SYN-SG')); await photo('desktop-store.png');
    return { officialReferenceLinks: links.length, actualSaleSKUs: list('sku').length, fictionalStoreDisclosed: true, manufacturerAuthorizationClaimed: false };
  });
  await record('DEPTH-UI-08', 'Network reads previously successful; cached Chengdu data retained', 'Inject an industry-context read failure, refresh, recover and refresh again', 'Readable error banner; cached data remains; button is re-enabled; later read recovers', async () => {
    await page.route('**/api/call', route => { const body = route.request().postDataJSON(); return body.operation === 'industry.context' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SYNTHETIC_READ_FAILURE', message: '合成行业背景读取故障' } }) }) : route.continue(); });
    await page.locator('#refresh').click(); await page.locator('#banner').waitFor(); assert.match(await page.locator('#banner').innerText(), /合成行业背景读取故障/); assert.equal(await page.locator('#refresh').isEnabled(), true); assert.match(await page.locator('#content').innerText(), /蜀光智家/);
    await page.unroute('**/api/call'); await page.locator('#refresh').click(); await page.locator('#banner').waitFor({ state: 'hidden' }); return { injectedReadFailureVisible: true, cachedRecordsRetained: true, recovery: true };
  });
  await record('DEPTH-UI-09', 'Rich dataset and all eight pages; 390×844 and 320×780 mobile widths', 'Visit each page at both sizes; measure horizontal overflow; capture growth/delivery/store', 'All eight navigation links usable, no document overflow, diagrams and controls remain within viewport', async () => {
    const dimensions = [];
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 780 });
      for (const route of ['overview', 'growth', 'delivery', 'aftercare', 'approvals', 'team', 'store', 'records']) {
        await navigate(route); const measurement = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth })); assert.ok(measurement.content <= measurement.viewport, `${route}/${width}: ${JSON.stringify(measurement)}`); dimensions.push({ route, ...measurement });
        if (width === 390 && ['growth', 'delivery', 'store'].includes(route)) await photo(`mobile-${route}.png`);
      }
    }
    return dimensions;
  });
  await record('DEPTH-UI-10', 'End of real browser paths, failures explicitly injected', 'Inspect browser page errors, CSP errors and current ledger integrity', 'No uncaught script or CSP error; ledger verifies; no host tasks falsely completed', async () => {
    assert.deepEqual(events.pageErrors, []); assert.deepEqual(events.consoleErrors.filter(text => !/Failed to load resource:/.test(text)), []);
    const integrity = call('ledger.verify'); assert.equal(integrity.ok, true); assert.equal(list('task').filter(task => task.status === 'completed').length, 0);
    return { ledger: integrity, scriptErrors: [], hostTasksCompletedByBrowser: 0, physicalActionsExecuted: 0 };
  });
} catch (error) { startupError = error; process.exitCode = 1; }
finally {
  const cleanupErrors = [];
  const hashes = {};
  for (const file of ['bundles/smart-home/ui/workbench/app.js', 'bundles/smart-home/ui/workbench/index.html', 'bundles/smart-home/ui/workbench/style.css', 'bundles/smart-home/runtime/scenario.mjs', 'bundles/smart-home/library/industry-context.json', relative(root, fileURLToPath(import.meta.url))]) {
    try { hashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex'); } catch (error) { cleanupErrors.push({ file, error: error.message }); }
  }
  // An already-disposed browser/context is not a regression: only report cleanup errors that
  // still describe a live infrastructure failure.
  const alreadyGone = error => /Failed to find context|Target (page, context or browser has been closed|closed)|Browser has been closed|TargetClosedError/i.test(String(error?.message ?? error));
  for (const close of [() => context?.close(), () => browser?.close(), () => session?.close(), () => rm(dataDir, { recursive: true, force: true })]) { try { await close(); } catch (error) { if (!alreadyGone(error)) cleanupErrors.push({ error: error.message }); } }
  const proof = { schemaVersion: 'bms.smart-home-depth-browser-proof/v1', testedAt: new Date().toISOString(), browserVersion: browser?.version(), channel: values.channel ?? 'chromium', environment: 'local-preview', dataMode: 'sandbox', syntheticScenario: 'shuguang-chengdu-v1', realHumanApprovalClaimed: false, realCustomerData: false, physicalExecution: false, sourceHashes: hashes, screenshots, cases, events, cleanupErrors, ...(startupError ? { infrastructureFailure: startupError.message } : {}), totals: { cases: cases.length, passed: cases.filter(item => item.pass).length, failed: cases.filter(item => !item.pass).length } };
  await writeFile(join(proofDir, 'depth-browser-proof.json'), JSON.stringify(proof, null, 2) + '\n'); console.log(JSON.stringify(proof.totals));
  if (startupError || proof.totals.failed || cleanupErrors.length) process.exitCode = 1;
}
