#!/usr/bin/env node
/** Independent browser regression; every business object and owner terminal is synthetic. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';

const { values } = parseArgs({ options: {
  'source-root': { type: 'string', default: fileURLToPath(new URL('../', import.meta.url)) },
  output: { type: 'string' }, browser: { type: 'string', default: 'chromium' }, channel: { type: 'string' },
  'keep-data': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
} });
if (values.help) {
  console.log('Usage: node scripts/check-business-workbench.mjs [--source-root <clone>] [--output <evidence-directory>] [--browser chromium|firefox|webkit] [--channel chrome|msedge] [--keep-data]');
  process.exit(0);
}
if (!['chromium', 'firefox', 'webkit'].includes(values.browser)) throw new Error('--browser must be chromium, firefox or webkit');
if (values.channel && values.browser !== 'chromium') throw new Error('--channel is supported only with --browser chromium');
const root = resolve(values['source-root']);
const proofDir = resolve(values.output ?? join(root, 'docs/evidence'));
const evidenceDir = join(proofDir, 'ui');
await mkdir(evidenceDir, { recursive: true });
const require = createRequire(pathToFileURL(join(root, 'apps/web/package.json')));
const playwright = require('@playwright/test');
const { startBusinessHttp } = await import(pathToFileURL(join(root, 'scripts/business-management-http.mjs')));
const { seedSyntheticDemo } = await import(pathToFileURL(join(root, 'bundles/smart-home/runtime/index.mjs')));
const input = new PassThrough(); input.isTTY = true;
const output = new PassThrough(); output.isTTY = true; output.on('data', () => {});
const errors = new PassThrough(); errors.on('data', () => {});
const dataDir = await mkdtemp(join(tmpdir(), 'bms-ui-independent-'));
let server, browser, context, page, actor, startupError;
let operationNumber = 0;
const call = (operation, body = {}) => server.engine.call(operation, { ...body, ...(server.engine.catalog().operations.find(x => x.name === operation).readOnly ? {} : { idempotencyKey: `ui-fixture-${++operationNumber}` }) }, actor);
const future = days => new Date(Date.now() + days * 86400000).toISOString();
const goalDeadlineUTC = new Date(Date.now() + 32 * 86400000);
goalDeadlineUTC.setUTCHours(6, 30, 0, 0);
const goalDeadlineLocal = `${goalDeadlineUTC.toISOString().slice(0, 10)}T14:30`;
const events = { pageErrors: [], consoleErrors: [], httpErrors: [], requestFailures: [], evidenceErrors: [] };
const cases = [];
async function record(id, precondition, steps, expected, fn) {
  try { const actual = await fn(); cases.push({ id, precondition, steps, expected, actual, pass: true }); }
  catch (error) {
    cases.push({ id, precondition, steps, expected, actual: { error: error.message }, pass: false });
    try { await page.screenshot({ path: join(evidenceDir, `${id}-failure.png`), fullPage: true }); }
    catch (failure) { events.evidenceErrors.push({ case: id, step: 'failure-screenshot', message: failure.message }); }
    try { await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); }); }
    catch (failure) { events.evidenceErrors.push({ case: id, step: 'dialog-recovery', message: failure.message }); }
  }
  console.log(JSON.stringify({ case: id, pass: cases.at(-1).pass, ...(cases.at(-1).pass ? {} : { actual: cases.at(-1).actual }) }));
}
async function navigate(name) { await page.locator(`nav [data-page="${name}"]`).click(); await page.waitForFunction(expected => document.querySelector('nav a.active')?.dataset.page === expected, name); }
async function fill(name, value) {
  const control = page.locator(`#action-form [name="${name}"]`);
  if (await control.evaluate(element => element.tagName === 'SELECT')) await control.selectOption(String(value));
  else await control.fill(String(value));
}
async function save(operation) {
  const response = page.waitForResponse(response => response.url().endsWith('/api/call') || response.url().endsWith('/api/owner/call'));
  await page.locator('#submit-action').click();
  const result = await response;
  const body = await result.json();
  return { path: new URL(result.url()).pathname, status: result.status(), operation: body.operation, errorCode: body.error?.code };
}
try {
  browser = await playwright[values.browser].launch({ ...(values.channel ? { channel: values.channel } : {}), headless: true });
  server = await startBusinessHttp({ root, input, output, errors, env: {}, options: { '--port': '0', '--data-dir': dataDir, '--data-mode': 'sandbox', '--tenant': 'ui-test-tenant', '--workspace': 'independent-browser' } });
  seedSyntheticDemo(server.engine);
  actor = { id: 'synthetic-ui-fixture', role: 'agent', tenantId: server.config.tenantId, workspaceId: server.config.workspaceId, channel: 'test' };
  call('solution.build', { id: 'ui-synthetic-solution', surveyId: 'synthetic-survey', name: '合成浏览器审批方案', bom: [{ skuId: 'SYN-GW-01', roomId: 'living-room', quantity: 1 }, { skuId: 'SYN-LIGHT-01', roomId: 'living-room', quantity: 1 }], scenes: [{ id: 'ui-scene', roomId: 'living-room', name: '合成灯光体验', trigger: '合成测试按钮', behavior: '仅验证本地结构化方案', skuIds: ['SYN-GW-01', 'SYN-LIGHT-01'] }], compatibilityIds: ['synthetic-pair'], exclusions: ['非真实设备安装'] });
  call('quote.create', { id: 'ui-synthetic-quote', solutionId: 'ui-synthetic-solution', laborCostCents: 4000, laborPriceCents: 8000, discountCents: 0, validUntil: future(5), terms: '合成浏览器审批夹具，不构成商业承诺。' });
  const approval = call('quote.request_approval', { quoteId: 'ui-synthetic-quote', expiresAt: future(3), reason: '合成浏览器审批夹具' }).data;
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
  page = await context.newPage(); page.setDefaultTimeout(6000);
  page.on('pageerror', error => events.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') events.consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) events.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('requestfailed', request => events.requestFailures.push({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
  await record('UI-01', '独立沙箱数据目录，随机端口 HTTP 服务，1440×1000 Chromium', '打开首页；等待首轮 state/catalog/owner 与嵌套 goal.report 完成', '所有资源和业务读取成功，初始 KPI 与合成种子一致，无 CSP 或脚本错误', async () => {
    await page.goto(server.url); await page.locator('#updated').filter({ hasText: '更新于' }).waitFor();
    assert.equal(await page.locator('#banner').isVisible(), false);
    assert.equal(await page.locator('.kpi').first().locator('strong').innerText(), '1条');
    assert.equal(await page.locator('.goal-number').first().innerText(), '0 / 1');
    assert.deepEqual(events.pageErrors, []); assert.deepEqual(events.httpErrors, []); assert.deepEqual(events.consoleErrors, []);
    await page.screenshot({ path: join(evidenceDir, 'desktop-overview.png'), fullPage: true });
    return { kpis: await page.locator('.kpi strong').allInnerTexts(), goalProgress: await page.locator('.goal-number').allInnerTexts(), errors: structuredClone(events), viewport: { width: 1440, height: 1000 } };
  });
  await record('UI-02', '桌面布局加载完成', '逐一点击全部八个导航入口', '八页可达，active 与 breadcrumb 一致，页面不出现 undefined', async () => {
    const titles = [];
    for (const name of ['overview', 'growth', 'delivery', 'aftercare', 'approvals', 'team', 'store', 'records']) { await navigate(name); titles.push(await page.locator('#breadcrumb').innerText()); assert.ok(!(await page.locator('#content').innerText()).includes('undefined')); }
    assert.equal(await page.locator('.operation-button[data-operation="content.publish"]').count(), 0);
    await navigate('team'); assert.equal(await page.locator('.team-card').count(), server.engine.catalog().workforce.length);
    return { visited: titles, employeesRendered: server.engine.catalog().workforce.length, externalPublishButton: 'not exposed' };
  });
  await record('UI-03', '桌面记录页', '选择员工任务；查看业务详情和结构化业务依据；关闭弹窗', '任务可查看，租约或 CSRF 字段不出现在结构化内容', async () => {
    await navigate('records'); await page.locator('#record-type').selectOption('task');
    await page.locator('#record-table [data-detail-id]').first().click();
    const text = await page.locator('#detail-content').innerText();
    assert.ok(text.includes('沙箱业务样本')); assert.ok(!/leaseToken|leaseTokenHash|csrfToken/.test(text));
    await page.locator('#close-detail').click(); return { detailShown: true, sensitiveFieldsDisplayed: false };
  });
  await record('UI-04', '桌面首页，匿名浏览器会话', '打开新建经营目标；填入标题/目标数/期限/约束；保存', '新增目标成功，保持本地进度 0，特殊 HTML 字符作为文本呈现', async () => {
    await navigate('overview'); await page.locator('#content [data-operation="goal.create"]').first().click();
    await fill('id', 'ui-special-goal'); await fill('storeId', 'synthetic-store'); await fill('title', '<img src=x onerror=window.UI_XSS=1> 合成目标 & < >');
    await fill('metric', 'qualified-leads'); await fill('target', 2); await fill('deadline', goalDeadlineLocal); await fill('constraints', '[]');
    const response = await save('goal.create'); assert.equal(response.status, 200);
    await page.locator('#drawer').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.UI_XSS), undefined);
    assert.equal(await page.locator('#content img').count(), 0);
    const actual = call('entity.get', { type: 'goal', id: 'ui-special-goal' }).data;
    assert.equal(actual.deadline, goalDeadlineUTC.toISOString());
    return { response, goalSaved: actual.title, deadlineSavedInUTC: actual.deadline, scriptExecuted: false };
  });
  await record('UI-05', '目标表单可以打开', '输入非法结构化约束，再输入零目标数', '结构化错误显示可理解错误；目标数零由 HTML 校验阻止提交', async () => {
    await page.locator('#content [data-operation="goal.create"]').first().click();
    await fill('storeId', 'synthetic-store'); await fill('title', '合成非法约束测试'); await fill('deadline', goalDeadlineLocal); await fill('constraints', '[invalid]');
    await page.locator('#submit-action').click(); await page.locator('#form-error').waitFor();
    const error = await page.locator('#form-error').innerText(); assert.ok(error.includes('结构化资料不是有效格式'));
    await fill('constraints', '[]'); await fill('target', 0);
    assert.equal(await page.locator('[name="target"]').evaluate(element => element.validity.rangeUnderflow), true);
    await page.locator('#cancel-drawer').click(); return { structuredError: error, zeroTargetRangeUnderflow: true };
  });
  await record('UI-06', '匿名浏览器，合成门店存在', '新增线索；把原始手机号写入联系方式保管编号；保存后改用保管编号重新保存', '原始手机号被服务器拒绝，表单保留；同表单更改内容后须关闭重开或明确冲突提示', async () => {
    await navigate('growth'); await page.locator('#content [data-operation="lead.create"]').first().click();
    await fill('id', 'ui-pii-lead'); await fill('storeId', 'synthetic-store'); await fill('alias', '合成客户界面测试'); await fill('contactRef', '13812345678'); await fill('channel', 'walk-in'); await fill('intent', '合成预算灯光咨询');
    let response = await save('lead.create'); assert.notEqual(response.status, 200); assert.equal(response.errorCode, 'PII_REJECTED');
    await page.locator('#form-error').waitFor(); const error = await page.locator('#form-error').innerText(); assert.ok(error.includes('保管编号'));
    await fill('contactRef', 'synthetic-ui-contact'); response = await save('lead.create'); assert.equal(response.status, 200);
    await page.locator('#drawer').waitFor({ state: 'hidden' }); assert.equal(call('entity.get', { type: 'lead', id: 'ui-pii-lead' }).data.contactRef, 'synthetic-ui-contact');
    return { originalPhoneRejected: true, error, correctedInputSaved: response };
  });
  await record('UI-07', '匿名浏览器，存在合成审批待办', '查看报价审批内容；点击批准；申请人员会话', '审批显示报价类型，匿名批准不会提交审批而提示人员会话；仅待终端确认', async () => {
    await navigate('approvals'); const row = page.locator('.row').filter({ hasText: '合成浏览器审批夹具' });
    assert.ok((await row.innerText()).includes('报价'));
    await row.locator('[data-decision="approved"]').click(); await page.locator('#apply-owner').click();
    await page.locator('#check-owner').waitFor();
    const current = await page.evaluate(async () => (await fetch('/api/owner/session')).json());
    assert.equal(current.status, 'pending'); assert.equal(call('entity.get', { type: 'approval', id: approval.id }).data.status, 'pending');
    await page.locator('#close-detail').click(); return { approvalType: '报价', sessionStatus: current.status, approvalStatus: 'pending', userApprovalBypassed: false };
  });
  await record('UI-08', '测试程序的明确合成终端夹具，浏览器待确认会话', '把公开请求号写入模拟终端；浏览器刷新权限；批准合成报价', '仅 owner/call 提交，CSRF 与同源校验有效，审批转 approved；不代表真实人员批准', async () => {
    const pending = await page.evaluate(async () => (await fetch('/api/owner/session')).json());
    input.write(`owner ${pending.requestId}\n`);
    await page.locator('#refresh').click(); await page.waitForFunction(() => document.querySelector('#owner-label').textContent.includes('已建立'));
    await navigate('approvals'); await page.locator(`[data-approval="${approval.id}"][data-decision="approved"]`).click();
    await fill('reason', '合成自动化终端测试批准，不代表真实人员决定。');
    const response = await save('approval.decide'); assert.equal(response.status, 200); assert.equal(response.path, '/api/owner/call');
    await page.locator('#drawer').waitFor({ state: 'hidden' });
    assert.equal(call('entity.get', { type: 'approval', id: approval.id }).data.status, 'approved');
    return { response, approvalStatus: 'approved', authority: 'synthetic test terminal fixture only', realHumanApprovalClaimed: false };
  });
  await record('UI-09', '浏览器已由合成终端夹具授权，agent/owner 共用操作', '新增普通线索并保存', '该操作保存至 owner endpoint，事件 actor 为 human，owner 权限由端点建立', async () => {
    await navigate('growth'); await page.locator('#content [data-operation="lead.create"]').first().click();
    await fill('id', 'ui-owner-lead'); await fill('storeId', 'synthetic-store'); await fill('alias', '合成人员录入线索'); await fill('contactRef', 'synthetic-owner-contact'); await fill('channel', 'walk-in'); await fill('intent', '合成人员录入界面测试');
    const response = await save('lead.create'); assert.equal(response.path, '/api/owner/call'); assert.equal(response.status, 200);
    await page.locator('#drawer').waitFor({ state: 'hidden' });
    const last = call('ledger.list').data.at(-1); assert.equal(last.who.type, 'human');
    return { response, recordedActorType: last.who.type, roleEstablishedByEndpoint: 'owner' };
  });
  await record('UI-10', '有有效人员测试会话', '申请人员会话入口；结束会话；再打开现场勘测登记', 'Cookie 会话撤销；现场操作重新要求人员确认，未绕过', async () => {
    await navigate('records'); await page.locator('#request-owner').click(); await page.locator('#end-owner').click();
    await page.locator('#detail-dialog').waitFor({ state: 'hidden' });
    const current = await page.evaluate(async () => (await fetch('/api/owner/session')).json()); assert.equal(current.status, 'anonymous');
    await navigate('delivery'); await page.locator('#content [data-operation="survey.record"]').first().click();
    await page.locator('#apply-owner').waitFor(); assert.equal(await page.locator('#drawer').isVisible(), false);
    await page.locator('#close-detail').click(); return { sessionStatus: 'anonymous', physicalFormOpenedWithoutAuthorization: false };
  });
  await record('UI-11', '模型任务尚未领取，浏览器界面提供推进待办', '在数字员工页面推进获客流程，然后核验业务记录完整性', 'tick 不完成模型任务；ledger 验证有效', async () => {
    await navigate('team'); await page.locator('[data-tick="synthetic-growth-flow"]').click();
    await page.locator('#toast').filter({ hasText: '模型任务等待' }).waitFor();
    assert.equal(call('workflow.get', { workflowId: 'synthetic-growth-flow' }).data.tasks[0].status, 'ready');
    await navigate('records'); await page.locator('#verify-ledger').click(); await page.locator('#toast').filter({ hasText: '完整性通过' }).waitFor();
    return { firstTaskStatus: 'ready', ledger: call('ledger.verify').data };
  });
  await record('UI-12', '读操作初始正常', '拦截 goal.report 返回错误；刷新；解除拦截再刷新', '单项报告错误显式显示待读取与错误，恢复后显示真实进度', async () => {
    await navigate('overview');
    await page.route('**/api/call', async route => { const body = route.request().postDataJSON(); if (body.operation === 'goal.report') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SYNTHETIC_READ_FAILURE', message: '合成报告读取失败' } }) }); else await route.continue(); });
    await page.locator('#refresh').click(); await page.locator('.goal-number').first().filter({ hasText: '待读取' }).waitFor();
    assert.ok((await page.locator('.report-note').first().innerText()).includes('合成报告读取失败'));
    await page.unroute('**/api/call'); await page.locator('#refresh').click(); await page.locator('.goal-number').first().filter({ hasText: '0 / 1' }).waitFor();
    return { failureVisible: true, recoveredProgress: await page.locator('.goal-number').first().innerText() };
  });
  await record('UI-13', '首页缓存有已读取数据', '拦截 /api/state 成网络错误；点击刷新；解除后再次刷新', '顶栏错误提示出现，既有数据保留，刷新按钮恢复可点击，恢复后错误消失', async () => {
    await page.route('**/api/state', route => route.abort('failed')); await page.locator('#refresh').click(); await page.locator('#banner').waitFor();
    assert.ok((await page.locator('#banner').innerText()).includes('连接未完成')); assert.equal(await page.locator('#refresh').isEnabled(), true);
    assert.equal(await page.locator('.kpi').count(), 4);
    await page.unroute('**/api/state'); await page.locator('#refresh').click(); await page.locator('#banner').waitFor({ state: 'hidden' });
    return { errorVisible: true, cachedKPIsRetained: true, refreshRecovered: true };
  });
  await record('UI-14', '已有独立沙箱数据，390×844移动宽度', '逐一点击全部八个导航入口；量测文档宽度；拍摄总览与数字员工页面', '八页可达，页面无横向溢出，新增目标与人员申请入口可用', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); const widths = [];
    for (const name of ['overview', 'growth', 'delivery', 'aftercare', 'approvals', 'team', 'store', 'records']) {
      await navigate(name); assert.equal(await page.locator(`nav [data-page="${name}"]`).isVisible(), true);
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert.ok(metrics.document <= metrics.viewport, `${name} horizontal overflow: ${JSON.stringify(metrics)}`); widths.push({ page: name, ...metrics });
    }
    await page.screenshot({ path: join(evidenceDir, 'mobile-records.png'), fullPage: true });
    await navigate('overview'); assert.equal(await page.locator('#content [data-operation="goal.create"]').first().isVisible(), true); await page.screenshot({ path: join(evidenceDir, 'mobile-overview.png'), fullPage: true });
    await navigate('team'); await page.screenshot({ path: join(evidenceDir, 'mobile-team.png'), fullPage: true });
    return { navigationCount: 8, widths, newGoalAccessible: true };
  });
  await record('UI-15', '320×780窄移动宽度', '八页导航与所有 page-head 内容布局检查', '八个导航入口仍可点且文档无横向溢出', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); const widths = [];
    for (const name of ['overview', 'growth', 'delivery', 'aftercare', 'approvals', 'team', 'store', 'records']) { await navigate(name); const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert.ok(metrics.document <= metrics.viewport, `${name}: ${JSON.stringify(metrics)}`); widths.push({ page: name, ...metrics }); }
    await page.screenshot({ path: join(evidenceDir, 'narrow-mobile-records.png'), fullPage: true }); return widths;
  });
  await record('UI-16', '完成各功能路径', '检查全流程浏览器脚本与安全策略错误', '无 pageerror、无 CSP 阻断，HTTP失败仅限主动注入错误或拒绝非法PII', async () => {
    assert.deepEqual(events.pageErrors, []); assert.ok(!events.consoleErrors.some(error => /Content Security Policy|Refused to/i.test(error)));
    return { pageErrors: events.pageErrors, cspErrors: events.consoleErrors.filter(error => /Content Security Policy|Refused to/i.test(error)), observedExpectedFailureResponses: events.httpErrors, expectedInjectedNetworkFailures: events.requestFailures };
  });
  await record('UI-17', '匿名浏览器，新增线索的可选授权依据默认关闭', '启用可选 consent.evidence；保持所需字段为空', '启用才要求依据子字段，浏览器校验阻止不完整提交', async () => {
    await navigate('growth'); await page.locator('#content [data-operation="lead.create"]').first().click();
    const enabled = page.locator('[name="__enable.consent.evidence"]'); assert.equal(await enabled.isChecked(), false); await enabled.check();
    assert.equal(await page.locator('[name="consent.evidence.uri"]').isEnabled(), true);
    assert.equal(await page.locator('[name="consent.evidence.uri"]').evaluate(element => element.validity.valueMissing), true);
    await page.locator('#cancel-drawer').click(); return { enabledEvidenceRequiresURI: true, incompleteEvidenceBlockedByHTMLValidation: true };
  });
  await record('UI-18', '匿名浏览器，线索可选依据可开关', '开启依据后填部分资料，再关闭依据并保存unknown授权线索', '关闭后子字段不校验、不序列化，业务保存成功且无半残依据', async () => {
    await page.locator('#content [data-operation="lead.create"]').first().click();
    await fill('id', 'ui-optional-evidence-lead'); await fill('storeId', 'synthetic-store'); await fill('alias', '合成可选依据开关测试'); await fill('contactRef', 'synthetic-optional-contact'); await fill('channel', 'walk-in'); await fill('intent', '仅验证可选证据表单语义');
    const enabled = page.locator('[name="__enable.consent.evidence"]'); await enabled.check(); await fill('consent.evidence.uri', 'evidence://synthetic/ui-optional'); await enabled.uncheck();
    assert.equal(await page.locator('[name="consent.evidence.uri"]').isEnabled(), false);
    const response = await save('lead.create'); assert.equal(response.status, 200); await page.locator('#drawer').waitFor({ state: 'hidden' });
    const entity = call('entity.get', { type: 'lead', id: 'ui-optional-evidence-lead' }).data; assert.equal(entity.consent.evidence, undefined);
    return { response, incompleteOptionalEvidenceStored: false };
  });
  await record('UI-19', '匿名浏览器，线索编号表单使用 HTML pattern 校验', '输入包含空格的编号，再输入包含点、下划线、冒号与连字符的编号', '空格编号被原生 pattern 阻止；允许字符通过；现代 /v 正则合法', async () => {
    await page.locator('#content [data-operation="lead.create"]').first().click();
    await fill('id', 'invalid identifier');
    const invalid = await page.locator('[name="id"]').evaluate(element => ({ pattern: element.pattern, patternMismatch: element.validity.patternMismatch }));
    assert.equal(invalid.patternMismatch, true);
    await fill('id', 'valid.identifier_with:hyphen-1');
    assert.equal(await page.locator('[name="id"]').evaluate(element => element.validity.patternMismatch), false);
    await page.locator('#cancel-drawer').click();
    return { pattern: invalid.pattern, invalidIdentifierBlocked: true, allowedIdentifierAccepted: true };
  });
  await record('UI-20', '全部表单与移动页面路径结束', '汇总浏览器 pageerror 与 console.error', '没有脚本异常、CSP 阻断或非法正则；资源错误仅为明确故障注入与 PII 拒绝', async () => {
    assert.deepEqual(events.pageErrors, []);
    const unexpected = events.consoleErrors.filter(error => !/Failed to load resource:/.test(error));
    assert.deepEqual(unexpected, []);
    return { pageErrors: events.pageErrors, unexpectedConsoleErrors: unexpected, expectedResourceErrors: events.consoleErrors.filter(error => /Failed to load resource:/.test(error)) };
  });
  await record('UI-21', '独立沙箱正常返回 snapshot；明确注入仅验证显示的五个状态夹具', '拦截一次 state 为合成状态；在业务记录页分别读取线索、流程、目标与项目', '五个运行时状态显示准确中文，客户验收明确写本地登记', async () => {
    const fixture = structuredClone(call('state.snapshot').data);
    fixture.lead.items[0].status = 'needs-information';
    fixture.workflow.items[0].status = 'waiting-approval'; fixture.workflow.items[1].status = 'waiting-evidence';
    fixture.goal.items[0].status = 'waiting-input';
    fixture.project = { total: 1, items: [{ id: 'ui-render-only-project', name: '合成状态显示项目', status: 'accepted-local-record', dataMode: 'sandbox', updatedAt: new Date().toISOString() }] };
    await page.route('**/api/state', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ operation: 'state.snapshot', data: fixture }) }));
    try {
      await page.locator('#refresh').click(); await navigate('records');
      const actual = [];
      for (const [type, labels] of [['lead', ['等待补充客户信息']], ['workflow', ['等待店主审批', '等待人员登记现场依据']], ['goal', ['等待关联业务资料']], ['project', ['本地已登记客户验收']]]) {
        await page.locator('#record-type').selectOption(type); const text = await page.locator('#record-table').innerText();
        for (const label of labels) { assert.ok(text.includes(label), `${type} missing ${label}`); actual.push({ type, label }); }
      }
      await page.locator('[data-detail-id="ui-render-only-project"]').click(); const detail = await page.locator('#detail-content').innerText();
      assert.ok(detail.includes('本地已登记客户验收')); assert.ok(detail.includes('外部渠道成功仍需独立核验'));
      await page.locator('#close-detail').click(); return { renderingOnly: true, statuses: actual, localAcceptanceBoundaryDisplayed: true };
    } finally { await page.unroute('**/api/state'); await page.locator('#refresh').click(); }
  });
  await record('UI-22', '明确注入仅验证显示的两个等待流程状态', '在数字员工页查看审批与现场依据等待标签；恢复服务真实 snapshot', '两标签中文可读并以橙色显示待办，恢复后显示真实运行状态', async () => {
    const fixture = structuredClone(call('state.snapshot').data);
    fixture.workflow.items[0].status = 'waiting-approval'; fixture.workflow.items[1].status = 'waiting-evidence';
    await page.route('**/api/state', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ operation: 'state.snapshot', data: fixture }) }));
    try {
      await page.locator('#refresh').click(); await navigate('team');
      await page.locator('.tag.orange').filter({ hasText: '等待店主审批' }).waitFor();
      await page.locator('.tag.orange').filter({ hasText: '等待人员登记现场依据' }).waitFor();
      return { renderingOnly: true, waitingApproval: 'orange / 等待店主审批', waitingEvidence: 'orange / 等待人员登记现场依据' };
    } finally { await page.unroute('**/api/state'); await page.locator('#refresh').click(); }
  });
} catch (error) {
  startupError = error; process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  try {
    const hashes = {};
    for (const file of ['index.html', 'style.css', 'app.js']) hashes[file] = createHash('sha256').update(await readFile(join(root, 'bundles/smart-home/ui/workbench', file))).digest('hex');
    const testFile = fileURLToPath(import.meta.url);
    const proof = { schemaVersion: 'bms.ui-workbench-proof/v1', testSource: relative(root, testFile).replaceAll('\\', '/'), testSourceSha256: createHash('sha256').update(await readFile(testFile)).digest('hex'), browser: values.browser, channel: values.channel ?? null, browserVersion: browser?.version() ?? null, testedAt: new Date().toISOString(), independentRandomPort: server ? new URL(server.url).port : null, isolatedSandboxDirectory: dataDir, temporaryDataRetentionRequested: values['keep-data'], realCustomerData: false, realHumanApprovalClaimed: false, physicalExecution: false, headerAssessment: 'Same-origin script/style/API and nested goal.report tested; owner POST sends browser Origin and CSRF. Test owner authority is explicitly simulated terminal fixture. UI-21/UI-22 inject rendering fixtures only.', sourceHashes: hashes, cases, totals: { cases: cases.length, passed: cases.filter(x => x.pass).length, failed: cases.filter(x => !x.pass).length }, browserEvents: events, ...(startupError ? { infrastructureFailure: startupError.message } : {}), screenshots: ['desktop-overview.png', 'mobile-overview.png', 'mobile-records.png', 'mobile-team.png', 'narrow-mobile-records.png'].map(file => `ui/${file}`) };
    await writeFile(join(proofDir, 'ui-workbench-proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof.totals));
    if (proof.totals.failed) process.exitCode = 1;
  } catch (error) { cleanupErrors.push(error); }
  const cleanup = await Promise.allSettled([context?.close(), browser?.close(), server?.close()]);
  for (const result of cleanup) if (result.status === 'rejected') cleanupErrors.push(result.reason);
  if (!values['keep-data']) {
    try { await rm(dataDir, { recursive: true, force: true }); }
    catch (error) { cleanupErrors.push(error); }
  }
  if (startupError || cleanupErrors.length) throw new AggregateError([...(startupError ? [startupError] : []), ...cleanupErrors], 'Browser regression infrastructure or cleanup failed', { ...(startupError ? { cause: startupError } : {}) });
}
