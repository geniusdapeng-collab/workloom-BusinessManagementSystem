#!/usr/bin/env node
/**
 * Reproduce the bilingual source-site checks using the repository's existing
 * Playwright installation. No business data, model or outside service is used.
 *
 * node scripts/check-business-site.mjs
 * node scripts/check-business-site.mjs --out docs/evidence --browser-executable /absolute/path/to/chrome
 *
 * The default evidence location is ignored local state. Browser installation
 * failures return nonzero and retain an explicit failed report.
 */
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadChromium } from './acceptance/lib/playwright.mjs';


const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}
for (let index = 0; index < args.length; index += 2) {
  if (!['--out', '--browser-executable'].includes(args[index])) throw new Error(`Unknown option: ${args[index]}`);
  option(args[index]);
}
const root = resolve(import.meta.dirname, '..');
const site = join(root, 'apps/site');
const evidenceRoot = resolve(option('--out') ?? join(root, '.business-management/evidence/site'));
const out = join(evidenceRoot, 'site');
const browserExecutable = option('--browser-executable');
const chromium = loadChromium(root);
mkdirSync(out, { recursive: true });
const report = { schemaVersion: 'bms.site-proof/v1', startedAt: new Date().toISOString(), browser: 'Chromium', expectedTotal: 48, command: ['node', 'scripts/check-business-site.mjs', ...args], javascriptRequired: false, status: 'running', sourceFiles: [], cases: [], errors: [], externalBusinessVerified: false, websiteDeployed: false };
for (const name of ['index.html','en.html']) report.sourceFiles.push({ path: `apps/site/${name}`, sha256: createHash('sha256').update(readFileSync(join(site,name))).digest('hex') });
function check(id, preconditions, steps, expected, actual, pass) {
  report.cases.push({ id, preconditions, steps, expected, actual, pass });
  assert.equal(pass, true, `${id}: ${JSON.stringify(actual)}`);
}
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const path = resolve(site,relative);
    if (!path.startsWith(site+sep)) { response.writeHead(403); response.end('Forbidden'); return; }
    if (!statSync(path).isFile()) { response.writeHead(404); response.end('Missing'); return; }
    const content = readFileSync(path);
    response.writeHead(200, { 'content-type': ({'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'})[extname(path)] ?? 'application/octet-stream' });
    response.end(content);
  } catch { response.writeHead(404); response.end('Missing'); }
});
await new Promise((done,reject)=> { server.once('error',reject); server.listen(0,'127.0.0.1',done); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(browserExecutable ? { executablePath: resolve(browserExecutable) } : {}) });
  report.browserVersion = browser.version();
  for (const lang of ['zh','en']) for (const width of [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:width===390?844:1000},javaScriptEnabled:false,reducedMotion:'reduce'});
    const page = await context.newPage();
    const issues = []; const failed = [];
    page.on('pageerror',error=>issues.push(error.message));
    page.on('requestfailed',request=>failed.push({url:request.url(),error:request.failure()?.errorText}));
    page.on('response',response=> { if(response.status()>=400) failed.push({url:response.url(),status:response.status()}); });
    const prefix = `${lang}-${width}`;
    await page.goto(`${origin}/${lang==='zh'?'index.html':'en.html'}`,{waitUntil:'networkidle'});
    check(`${prefix}-identity`, '静态页面可访问，JavaScript禁用', '读取标题、lang与唯一H1', '新产品身份且唯一H1', {title:await page.title(),language:await page.locator('html').getAttribute('lang'),h1:await page.locator('h1').count()}, (await page.title()).includes(lang==='zh'?'经营管理系统':'BusinessManagementSystem') && await page.locator('h1').count()===1);
    const dimensions = await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
    check(`${prefix}-overflow`, `视口${width}px`, '测量页面与body宽度', '页面无水平滚动',dimensions,dimensions.document<=width && dimensions.body<=width);
    const invisible = await page.locator('section').evaluateAll(sections=>sections.filter(s=>getComputedStyle(s).opacity==='0'||getComputedStyle(s).visibility==='hidden'||getComputedStyle(s).display==='none').map(s=>s.id));
    check(`${prefix}-no-js`, 'JavaScript禁用', '检查所有section的CSS可见状态', '内容全部可见',invisible,invisible.length===0);
    const repoHref = await page.locator('#btn-download').getAttribute('href');
    check(`${prefix}-source-cta`, '源码CTA可见', '读取主CTA href', '公开CNB新仓，无假安装包地址',repoHref,repoHref==='https://cnb.cool/workloom-ai/workloom-BusinessManagementSystem');
    const anchorIds = await page.locator('a[href^="#"]').evaluateAll(links=>links.map(a=>({href:a.getAttribute('href'),targetExists:!!document.getElementById(a.hash.slice(1))})));
    check(`${prefix}-anchors`, '静态页包含导航与跳转', '核对所有锚点目标', '锚点没有悬空',anchorIds,anchorIds.every(a=>a.targetExists));
    const anchors = page.locator('nav.top a[href="#start"]');
    await anchors.click();
    check(`${prefix}-start-link`, '开始导航可点击', '点击开始使用锚点', 'URL转到#start',page.url(),page.url().endsWith('#start'));
    const faq = page.locator('.faq details').first();
    await faq.locator('summary').click();
    check(`${prefix}-faq`, 'FAQ默认折叠', '点击第一条summary', '浏览器原生展开',await faq.getAttribute('open'),await faq.getAttribute('open')!==null);
    const docHrefs = await page.locator('.doc-grid a').evaluateAll(links=>links.map(a=>a.href));
    const docFiles = docHrefs.map(href=>href.split('/-/blob/main/')[1]);
    const docsOk = docFiles.every(file=>file && statSync(join(root,file)).isFile());
    check(`${prefix}-documentation`, '文档卡片可见', '解析仓库文档路径并检查本地交付文件', '所有文档卡指向已创建文件',docFiles,docsOk);
    await page.locator('#boundaries').scrollIntoViewIfNeeded();
    const text = await page.locator('body').innerText();
    check(`${prefix}-boundaries`, '页面内容读取', '核对连接器和synthetic/外部边界措辞', '明确disabled、本地提交、合成数据', {disabled:text.includes('disabled'),synthetic:text.includes('synthetic')||text.includes('Synthetic'),external:text.includes('externalVerified=false')}, text.includes('disabled') && text.includes('externalVerified=false') && (text.includes('synthetic')||text.includes('Synthetic')));
    await page.locator('img').scrollIntoViewIfNeeded();
    await page.waitForLoadState('networkidle');
    const images = await page.locator('img').evaluateAll(images=>images.map(image=>({src:image.getAttribute('src'),alt:image.alt,loaded:image.complete&&image.naturalWidth>0})));
    check(`${prefix}-assets`, '图像已进入视口', '核对已加载图片和alt', '图片可读且描述为概念图',images,images.every(image=>image.loaded&&image.alt&&(image.alt.includes('概念图')||image.alt.includes('Concept'))));
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:join(out,`${prefix}-viewport.png`)});
    await page.screenshot({path:join(out,`${prefix}-full.png`),fullPage:true});
    const switcher=page.locator('nav.top a[href="'+(lang==='zh'?'en.html':'index.html')+'"]');
    await switcher.click();
    check(`${prefix}-language`, '语言链接常驻，手机未隐藏', '点击语言切换', '打开另一语言页面',await page.locator('html').getAttribute('lang'),await page.locator('html').getAttribute('lang')===(lang==='zh'?'en':'zh-CN'));
    check(`${prefix}-browser-events`, '整个导航与资源加载过程', '收集pageerror/requestfailed/HTTP>=400', '无脚本错误或资源错误',{issues,failed},issues.length===0&&failed.length===0);
    await context.close();
  }
  report.status='pass';
} catch(error) { report.status='fail'; report.errors.push(error.message); process.exitCode=1; }
finally {
  report.finishedAt=new Date().toISOString();
  report.passed=report.cases.filter(test=>test.pass).length; report.total=report.cases.length;
  writeFileSync(join(evidenceRoot,'site-proof.json'),JSON.stringify(report,null,2)+'\n');
  if (browser) await browser.close();
  server.closeIdleConnections();
  await new Promise(done=>server.close(done));
}
console.log(JSON.stringify({status:report.status,passed:report.passed,total:report.total,errors:report.errors}));
