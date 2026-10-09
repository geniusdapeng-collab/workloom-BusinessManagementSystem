#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import {
  HOST_INSTRUCTIONS, REPOSITORY_ROOT, TransportError, actorFor, describeOperation,
  descriptors, errorObject, openEngine, parseArguments, positiveInteger, readInput, runtimeOptions,
} from './business-management-common.mjs';
import { setupWorkbench } from './business-management-setup.mjs';

const HELP = `经营管理系统 · 全屋智能门店\n\n用法：node scripts/business-management.mjs <command> [操作] [options]\n\n命令：\n  init [--demo]                 初始化本机数据；--demo 仅允许 sandbox 合成样本\n  doctor                       检查 Node、SQLite、入口与数据范围\n  setup [--client all]          生成 Codex/WorkBuddy 项目配置及千问办公导入 JSON\n  catalog                      操作契约目录（不触发模型）\n  describe <operation>         单项输入 schema、角色与风险\n  call <operation>             agent 权限调用业务操作\n  workflow start|get|tick       工作流操作别名\n  scenario list|import         查看或导入成都门店演练背景（仅 sandbox）\n  tick [--interval 秒]          确定性调度；--max-ticks 指定最大次数\n  human-call <operation>       真实终端确认后录入店主决定或现场事实\n  approve [approvalId]         人类确认 approval.decide（输入必须带内容摘要）\n  serve [--port 9393]           本机响应式工作台；真实终端可确认店主会话\n  mcp                          agent 权限 stdio MCP\n\n输入：--input-file <JSON文件或 -> 或 --input '<JSON>'（二者互斥）\n范围：--data-dir <目录> --tenant <ID> --workspace <ID> --mode sandbox|live\n端口：--port 优先，其次 BMS_PORT，最后 product.manifest.json 的 workbench.port。\n模型：当前 Codex/千问办公/WorkBuddy 自带模型 claim → 生成 → submit；不需要额外模型 key。\n`;

async function fileExists(file) { try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

export async function doctor(options = {}) {
  const config = runtimeOptions(options);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  let sqlite;
  try { sqlite = db.prepare('SELECT sqlite_version() AS version').get().version; } finally { db.close(); }
  const items = [
    { id: 'node', ok: Number(process.versions.node.split('.')[0]) >= 24, version: process.versions.node },
    { id: 'sqlite', ok: Boolean(sqlite), version: sqlite },
    { id: 'engine', ok: await fileExists(join(REPOSITORY_ROOT, 'bundles/smart-home/runtime/index.mjs')) },
    { id: 'mcp', ok: await fileExists(join(REPOSITORY_ROOT, 'scripts/business-management-mcp.mjs')) },
    { id: 'skill', ok: await fileExists(join(REPOSITORY_ROOT, '.agents/skills/business-management/SKILL.md')) },
  ];
  return { schemaVersion: 'bms.doctor/v1', ready: items.every(item => item.ok), items, config,
    model: { provider: 'host-workbench', additionalApiKeyRequired: false, daemonCallsModel: false },
    boundary: { externalConnectorsEnabled: false, physicalEvidenceRequiresHuman: true },
  };
}

export async function confirmHumanOperation(operation, value, { input = process.stdin, output = process.stdout } = {}) {
  if (input.isTTY !== true || output.isTTY !== true) throw new TransportError('HUMAN_TERMINAL_REQUIRED', '店主操作必须在真实交互终端确认，不能通过管道或 MCP 代办', 403);
  const descriptor = describeOperation(operation);
  if (!descriptor.roles.includes('owner')) throw new TransportError('FORBIDDEN', '该操作没有店主权限入口', 403);
  const confirmation = `confirm ${operation}`;
  const ui = createInterface({ input, output, terminal: true });
  try {
    output.write(`人工确认：${descriptor.title}\n操作 ${operation}；对象 ${value.approvalId ?? value.projectId ?? value.leadId ?? value.goalId ?? value.id ?? '见输入文件'}${value.contentDigest ? `；内容摘要 ${value.contentDigest}` : ''}\n`);
    const answer = await ui.question(`核实已具备真实权限与证据后键入 ${confirmation}：`);
    if (answer.trim() !== confirmation) throw new TransportError('HUMAN_CONFIRMATION_REJECTED', '人工确认未通过，未执行操作', 403);
  } finally { ui.close(); }
}

export async function runCli(argv, { input = process.stdin, output = process.stdout, errors = process.stderr } = {}) {
  const { options, positional } = parseArguments(argv);
  const command = positional[0];
  if (options['--help'] || options['-h'] || !command) { output.write(HELP); return; }
  const args = positional.slice(1);
  let result;
  if (command === 'doctor') {
    if (args.length) throw new TransportError('USAGE', 'doctor 不接受位置参数');
    result = await doctor(options);
  } else if (command === 'setup') {
    if (args.length) throw new TransportError('USAGE', 'setup 不接受位置参数');
    result = await setupWorkbench(options);
  } else if (command === 'catalog') {
    if (args.length) throw new TransportError('USAGE', 'catalog 不接受位置参数');
    result = { schemaVersion: 'bms.catalog/v1', industry: 'smart-home', operations: descriptors(), instructions: HOST_INSTRUCTIONS };
  } else if (command === 'describe') {
    if (args.length !== 1) throw new TransportError('USAGE', 'describe 需要一个 operation');
    result = describeOperation(args[0]);
  } else if (command === 'mcp') {
    if (args.length) throw new TransportError('USAGE', 'mcp 不接受位置参数');
    const { startBusinessMcp } = await import('./business-management-mcp.mjs');
    const session = await startBusinessMcp({ options, input, output, errors });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { session.close(); process.exit(0); });
    return;
  } else if (command === 'serve') {
    if (args.length) throw new TransportError('USAGE', 'serve 不接受位置参数');
    const { startBusinessHttp } = await import('./business-management-http.mjs');
    const session = await startBusinessHttp({ options, input, output, errors });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void session.close().then(() => process.exit(0), error => { errors.write(`${JSON.stringify({ error: errorObject(error) })}\n`); process.exit(1); }); });
    return;
  } else {
    const known = new Set(['init', 'call', 'workflow', 'scenario', 'tick', 'human-call', 'approve']);
    if (!known.has(command)) throw new TransportError('USAGE', `未知命令 ${command}`);
    if (command === 'init' || command === 'tick') { if (args.length) throw new TransportError('USAGE', `${command} 不接受位置参数`); }
    else if (command === 'approve') { if (args.length > 1) throw new TransportError('USAGE', 'approve 最多接受一个 approvalId'); }
    else if (args.length !== 1) throw new TransportError('USAGE', `${command} 需要一个操作名`);
    if (['approve', 'human-call'].includes(command) && options['--input-file'] === '-') throw new TransportError('HUMAN_TERMINAL_REQUIRED', '人工操作请用 JSON 文件，不使用标准输入管道', 403);
    const value = await readInput(options, input);
    const { engine, config } = await openEngine(options);
    try {
      const agent = actorFor(config, 'cli');
      if (command === 'init') {
        let seeded;
        if (options['--demo']) {
          const { seedSyntheticScenario } = await import('../bundles/smart-home/runtime/index.mjs');
          seeded = seedSyntheticScenario(engine);
        }
        result = { ...engine.call('status', {}, agent), ...(seeded ? { seeded } : {}), config };
      } else if (command === 'tick') {
        const intervalSeconds = positiveInteger(options['--interval'], 0, 0, 3600, 'interval');
        const maxTicks = positiveInteger(options['--max-ticks'], 1, 1, 10000, 'max-ticks');
        for (let i = 0; i < maxTicks; i += 1) {
          const tickInput = { ...value, idempotencyKey: value.idempotencyKey && maxTicks === 1 ? value.idempotencyKey : `tick-${randomUUID()}` };
          output.write(`${JSON.stringify(engine.call('workflow.tick', tickInput, agent))}\n`);
          if (i + 1 < maxTicks && intervalSeconds) await delay(intervalSeconds * 1000);
        }
        return;
      } else {
        if (command === 'scenario' && !['list', 'import'].includes(args[0])) throw new TransportError('USAGE', 'scenario 只接受 list 或 import');
        const operation = command === 'approve' ? 'approval.decide' : ['workflow', 'scenario'].includes(command) ? `${command}.${args[0]}` : args[0];
        describeOperation(operation);
        if (command === 'approve' && args[0]) {
          if (value.approvalId && value.approvalId !== args[0]) throw new TransportError('INVALID_INPUT', '位置 approvalId 与输入不一致');
          value.approvalId = args[0];
        }
        if (['approve', 'human-call'].includes(command)) {
          await confirmHumanOperation(operation, value, { input, output });
          result = engine.call(operation, value, actorFor(config, 'cli', 'owner', true));
        } else if (command === 'scenario' && args[0] === 'import') {
          result = engine.call(operation, { datasetId: 'shuguang-chengdu-v1', idempotencyKey: 'cli-shuguang-chengdu-v1-import', ...value }, actorFor(config, 'cli', 'operator', false));
        } else result = engine.call(operation, value, agent);
      }
    } finally { engine.close(); }
  }
  output.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runCli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${JSON.stringify({ error: errorObject(error) })}\n`); process.exitCode = ['FORBIDDEN', 'HUMAN_TERMINAL_REQUIRED'].includes(error?.code) ? 3 : 1; }
}
