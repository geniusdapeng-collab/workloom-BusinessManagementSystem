import { mkdir, readFile, rename, writeFile, unlink, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { REPOSITORY_ROOT, TransportError, runtimeOptions } from './business-management-common.mjs';

const BLOCK_BEGIN = '# BUSINESS-MANAGEMENT:BEGIN';
const BLOCK_END = '# BUSINESS-MANAGEMENT:END';
const SERVER_NAME = 'business_management';

async function existingText(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function mergeCodexConfig(existing, managed) {
  const source = existing ?? '';
  const begins = source.split(BLOCK_BEGIN).length - 1;
  const ends = source.split(BLOCK_END).length - 1;
  if (begins !== ends || begins > 1) throw new TransportError('CONFIG_CONFLICT', 'Codex 受管区块缺失或重复，已保留原文件', 409);
  if (begins === 1) {
    const start = source.indexOf(BLOCK_BEGIN);
    const end = source.indexOf(BLOCK_END) + BLOCK_END.length;
    if (end < start) throw new TransportError('CONFIG_CONFLICT', 'Codex 受管区块顺序错误，已保留原文件', 409);
    const outside = source.slice(0, start) + source.slice(end);
    if (/^\s*\[mcp_servers\.business_management(?:\.|\])/mu.test(outside)) throw new TransportError('CONFIG_CONFLICT', '同名 MCP 服务在受管区块外已存在，已保留原文件', 409);
    return source.slice(0, start) + managed + source.slice(end);
  }
  if (/^\s*\[mcp_servers\.business_management(?:\.|\])/mu.test(source)) throw new TransportError('CONFIG_CONFLICT', '已有同名 Codex MCP 服务，已保留原文件', 409);
  return `${source}${source && !source.endsWith('\n') ? '\n' : ''}${source ? '\n' : ''}${managed}\n`;
}

export function mergeJsonMcp(existing, server) {
  let value;
  try { value = existing === null ? {} : JSON.parse(existing); }
  catch { throw new TransportError('CONFIG_CONFLICT', 'MCP JSON 配置不是有效 JSON，已保留原文件', 409); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || (value.mcpServers !== undefined && (!value.mcpServers || Array.isArray(value.mcpServers) || typeof value.mcpServers !== 'object'))) throw new TransportError('CONFIG_CONFLICT', 'MCP JSON 配置结构无效，已保留原文件', 409);
  const prior = value.mcpServers?.[SERVER_NAME];
  if (prior && (!Array.isArray(prior.args) || prior.args.length !== 1 || prior.args[0] !== server.args[0])) throw new TransportError('CONFIG_CONFLICT', '已有同名外部 MCP 服务，已保留原文件', 409);
  return JSON.stringify({ ...value, mcpServers: { ...value.mcpServers, [SERVER_NAME]: server } }, null, 2) + '\n';
}

async function atomicText(file, text) {
  const prior = await existingText(file);
  if (prior === text) return 'unchanged';
  await mkdir(resolve(file, '..'), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } catch (error) {
    try { await unlink(temporary); } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw new AggregateError([error, cleanup], '配置写入与清理失败'); }
    throw error;
  }
  return prior === null ? 'created' : 'updated';
}

export async function setupWorkbench(options = {}, { root = REPOSITORY_ROOT, env = process.env, nodePath = process.execPath } = {}) {
  const client = options['--client'] ?? 'all';
  if (!['all', 'codex', 'workbuddy', 'qwenwork', 'generic'].includes(client)) throw new TransportError('USAGE', 'client 须为 all/codex/workbuddy/qwenwork/generic');
  const config = runtimeOptions(options, env, root);
  const entry = join(root, 'scripts/business-management-mcp.mjs');
  await access(entry);
  const server = { command: nodePath, args: [entry], env: { BMS_DATA_DIR: config.dataDir, BMS_DATA_MODE: config.dataMode, BMS_TENANT_ID: config.tenantId, BMS_WORKSPACE_ID: config.workspaceId } };
  const toml = [
    BLOCK_BEGIN, '[mcp_servers.business_management]', `command = ${JSON.stringify(nodePath)}`,
    `args = [${JSON.stringify(entry)}]`, `cwd = ${JSON.stringify(root)}`,
    'startup_timeout_sec = 30', 'tool_timeout_sec = 60', '[mcp_servers.business_management.env]',
    ...Object.entries(server.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`), BLOCK_END,
  ].join('\n');
  const generic = JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: 'stdio', ...server } } }, null, 2) + '\n';
  const results = [];
  const plans = [];
  if (client === 'all' || client === 'codex') plans.push({ client: 'codex', file: join(root, '.codex/config.toml'), merge: prior => mergeCodexConfig(prior, toml), candidate: toml + '\n' });
  if (client === 'all' || client === 'workbuddy') plans.push({ client: 'workbuddy', file: join(root, '.workbuddy/mcp.json'), merge: prior => mergeJsonMcp(prior, server), candidate: JSON.stringify({ mcpServers: { [SERVER_NAME]: server } }, null, 2) + '\n' });
  if (client === 'all' || client === 'qwenwork') plans.push({ client: 'qwenwork', file: join(root, '.business-management/setup/qwenwork.mcp.json'), merge: () => generic });
  if (client === 'all' || client === 'generic') plans.push({ client: 'generic', file: join(root, '.business-management/setup/generic.mcp.json'), merge: () => generic });
  for (const plan of plans) {
    try {
      const text = plan.merge(await existingText(plan.file));
      results.push({ client: plan.client, file: plan.file, status: await atomicText(plan.file, text) });
    } catch (error) {
      if (error.code !== 'CONFIG_CONFLICT') throw error;
      const candidate = join(root, '.business-management/setup', `${plan.client}.candidate.${plan.client === 'codex' ? 'toml' : 'json'}`);
      await atomicText(candidate, plan.candidate);
      results.push({ client: plan.client, file: plan.file, status: 'preserved-conflict', candidate, reason: error.message });
    }
  }
  return { schemaVersion: 'bms.workbench-setup/v1', config, results, next: {
    codex: '在 Codex 中信任当前项目并新建会话；/mcp 检查 business_management。宿主未加载项目配置时可直接调用 CLI。',
    workbuddy: '用本项目目录新建任务，在 MCP 页面启用 business_management。',
    qwenwork: '扩展 → 连接器 → 添加 → 粘贴本项目 .business-management/setup/qwenwork.mcp.json，启用后新建任务。',
    business: '调用 status/catalog，创建目标与工作流，claim → 宿主模型处理 → submit → tick → goal.report。',
  } };
}
