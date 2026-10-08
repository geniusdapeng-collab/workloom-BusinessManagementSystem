import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { OPERATION_CATALOGUE } from '../bundles/smart-home/runtime/catalogue.mjs';

export const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
export const MAX_INPUT_BYTES = 1024 * 1024;
export const HOST_INSTRUCTIONS = '全屋智能门店经营：先读 bms_status 与 bms_catalog，再按工作流领取 bms_task_claim，使用当前 AI 工作台内置模型生成符合任务 outputSchema 的产物，并用 bms_task_submit 提交。每次写操作须使用稳定 idempotencyKey；冲突先读状态再重试。模型产物、沙箱样本、真实现场证据与外部回执须分别标记。MCP 固定 agent 权限，不能审批、证明客户授权、伪造勘测/安装/调试/验收；遇到权限或人审门禁应向店主说明。不得读取或输出账号配置、密钥；无需新建付费模型 API。公开发布与外部付款连接器未启用。';

export class TransportError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'TransportError'; this.code = code; this.status = status; }
}

export function errorObject(error) {
  const message = String(error?.message ?? error ?? '未知错误')
    .replace(/Bearer\s+[^\s"']+/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED]')
    .replace(/(?:leaseToken|csrfToken|password|api[_-]?key|access[_-]?token)\s*[:=]\s*[^,\s}]+/giu, '[REDACTED]')
    .slice(0, 600);
  return { code: typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR', message };
}

export function parseArguments(argv) {
  const options = {};
  const positional = [];
  const values = new Set(['--data-dir', '--tenant', '--workspace', '--mode', '--input-file', '--input', '--client', '--port', '--interval', '--max-ticks']);
  const flags = new Set(['--demo', '--help', '-h']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (values.has(token)) {
      if (options[token] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new TransportError('USAGE', `参数重复或缺值：${token}`);
      options[token] = argv[++i];
    } else if (flags.has(token)) {
      if (options[token]) throw new TransportError('USAGE', `参数重复：${token}`);
      options[token] = true;
    } else if (token.startsWith('-')) {
      throw new TransportError('USAGE', `未知参数：${token}`);
    } else positional.push(token);
  }
  if (options['--input'] && options['--input-file']) throw new TransportError('USAGE', '--input 与 --input-file 不能同时使用');
  return { options, positional };
}

export function runtimeOptions(options = {}, env = process.env, root = REPOSITORY_ROOT) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new TransportError('NODE_VERSION', '需要 Node.js 24 或更高版本', 503);
  const dataMode = options['--mode'] ?? env.BMS_DATA_MODE ?? 'sandbox';
  if (!['sandbox', 'live'].includes(dataMode)) throw new TransportError('INVALID_MODE', 'mode 必须为 sandbox 或 live');
  const tenantId = options['--tenant'] ?? env.BMS_TENANT_ID ?? 'demo-store';
  const workspaceId = options['--workspace'] ?? env.BMS_WORKSPACE_ID ?? 'default';
  for (const [label, value] of Object.entries({ tenantId, workspaceId })) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u.test(value)) throw new TransportError('INVALID_SCOPE', `${label} 格式无效`);
  }
  const dataDir = resolve(options['--data-dir'] ?? env.BMS_DATA_DIR ?? join(root, '.business-management', 'data', dataMode));
  return { dataDir, dataMode, tenantId, workspaceId };
}

export async function openEngine(options = {}, env = process.env, root = REPOSITORY_ROOT) {
  const config = runtimeOptions(options, env, root);
  const { createBusinessEngine } = await import('../bundles/smart-home/runtime/index.mjs');
  return { engine: createBusinessEngine(config), config };
}

export function actorFor(config, channel = 'cli', role = 'agent', humanConfirmed = false) {
  return { id: `business-management-${channel}-${role}`, role, tenantId: config.tenantId, workspaceId: config.workspaceId, channel, ...(humanConfirmed ? { humanConfirmed: true } : {}) };
}

export function descriptors({ agentOnly = false } = {}) {
  return OPERATION_CATALOGUE.filter(item => !agentOnly || (item.roles.includes('agent') && item.risk !== 'block'));
}

export function describeOperation(name) {
  const entry = OPERATION_CATALOGUE.find(item => item.name === name);
  if (!entry) throw new TransportError('NOT_FOUND', `能力不存在：${name}`, 404);
  return entry;
}

export function toolName(operation) { return `bms_${operation.replaceAll('.', '_')}`; }

export function validateTransportInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TransportError('INVALID_INPUT', '输入必须为 JSON 对象');
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_INPUT_BYTES) throw new TransportError('INPUT_TOO_LARGE', '输入超过 1 MiB', 413);
  return value;
}

export async function readInput(options, stream = process.stdin) {
  let source = options['--input'];
  const file = options['--input-file'];
  if (file && file !== '-') {
    const info = await stat(file);
    if (!info.isFile()) throw new TransportError('INVALID_INPUT', '输入路径必须为普通文件');
    if (info.size > MAX_INPUT_BYTES) throw new TransportError('INPUT_TOO_LARGE', '输入文件超过 1 MiB', 413);
    source = await readFile(file, 'utf8');
  } else if (file === '-') {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_INPUT_BYTES) throw new TransportError('INPUT_TOO_LARGE', '标准输入超过 1 MiB', 413);
      chunks.push(buffer);
    }
    source = Buffer.concat(chunks).toString('utf8');
  }
  if (source === undefined) return {};
  if (Buffer.byteLength(source) > MAX_INPUT_BYTES) throw new TransportError('INPUT_TOO_LARGE', '输入超过 1 MiB', 413);
  try { return validateTransportInput(JSON.parse(source)); }
  catch (error) { if (error instanceof TransportError) throw error; throw new TransportError('INVALID_JSON', '输入不是有效 JSON'); }
}

export function positiveInteger(value, fallback, min, max, label) {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(String(value))) throw new TransportError('USAGE', `${label} 必须为整数`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new TransportError('USAGE', `${label} 须在 ${min} 到 ${max} 之间`);
  return parsed;
}
