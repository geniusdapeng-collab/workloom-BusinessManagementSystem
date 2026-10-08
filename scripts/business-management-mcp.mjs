#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  MAX_INPUT_BYTES, HOST_INSTRUCTIONS, TransportError, actorFor, descriptors,
  errorObject, openEngine, parseArguments, toolName, validateTransportInput,
} from './business-management-common.mjs';

const SUPPORTED_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const SERVER_VERSION = '1.0.0';
const GUIDE = `${HOST_INSTRUCTIONS}\n\n操作顺序：status → catalog → goal.create → workflow.start → workflow.tick → task.claim → 当前宿主模型按 outputSchema 编写 artifact → task.submit → workflow.tick → goal.report → ledger.verify。每个写操作需要 idempotencyKey。task.claim 返回的 leaseToken 只用于当前租约提交，不能放入报告或源码；重试保持幂等键和输入一致。禁止从AI产物推断现场施工、验收或外部发布已经完成。`;

export async function startBusinessMcp({ options = {}, input = process.stdin, output = process.stdout, errors = process.stderr, env = process.env } = {}) {
  const { engine, config } = await openEngine(options, env);
  const actor = actorFor(config, 'mcp');
  const entries = descriptors({ agentOnly: true });
  const byName = new Map(entries.map(item => [toolName(item.name), item]));
  const tools = entries.map(item => ({
    name: toolName(item.name), title: item.title,
    description: `${item.description}；本地${config.dataMode === 'sandbox' ? '沙箱' : '客户提供数据'}；${item.readOnly ? '只读' : '须幂等键'}；外部交付须单独核验。`,
    inputSchema: item.inputSchema,
    annotations: { readOnlyHint: item.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
  let initialization = 'new';
  let buffer = '';
  let stopped = false;
  let queue = Promise.resolve();
  const respond = (id, result) => output.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  const reject = (id, code, message) => output.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
  const toolResult = (data, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError });

  function handle(request) {
    if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
        || (request.id !== undefined && request.id !== null && !['number', 'string'].includes(typeof request.id))) {
      reject(request?.id ?? null, -32600, 'invalid request'); return;
    }
    const { method, params, id } = request;
    if (id === undefined) {
      if (method === 'notifications/initialized' && initialization === 'initializing') initialization = 'ready';
      return;
    }
    if (method === 'initialize') {
      if (initialization !== 'new') { reject(id, -32600, 'already initialized'); return; }
      if (typeof params?.protocolVersion !== 'string' || !params?.clientInfo || typeof params.clientInfo.name !== 'string') {
        reject(id, -32602, 'initialize requires protocolVersion and clientInfo'); return;
      }
      initialization = 'initializing';
      respond(id, {
        protocolVersion: SUPPORTED_VERSIONS.has(params.protocolVersion) ? params.protocolVersion : '2025-11-25',
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: 'business-management-system', version: SERVER_VERSION }, instructions: HOST_INSTRUCTIONS,
      }); return;
    }
    if (method === 'ping') { respond(id, {}); return; }
    if (initialization !== 'ready') { reject(id, -32000, 'send initialize and notifications/initialized first'); return; }
    switch (method) {
      case 'tools/list':
        if (params?.cursor) { reject(id, -32602, 'pagination cursor is not supported'); return; }
        respond(id, { tools }); return;
      case 'tools/call': {
        const descriptor = byName.get(params?.name);
        if (!descriptor) { respond(id, toolResult({ error: { code: 'NOT_FOUND', message: '工具未开放；人审与现场证据操作不能通过 MCP 执行' } }, true)); return; }
        try {
          const value = validateTransportInput(params?.arguments ?? {});
          respond(id, toolResult(engine.call(descriptor.name, value, actor)));
        } catch (error) { respond(id, toolResult({ error: errorObject(error) }, true)); }
        return;
      }
      case 'resources/list':
        respond(id, { resources: [{ uri: 'bms://host-guide', name: 'host-guide', title: '全屋智能经营宿主模型接入', description: '宿主模型任务循环与证据边界', mimeType: 'text/plain' }] }); return;
      case 'resources/read':
        if (params?.uri !== 'bms://host-guide') { reject(id, -32602, 'resource not found'); return; }
        respond(id, { contents: [{ uri: 'bms://host-guide', mimeType: 'text/plain', text: GUIDE }] }); return;
      case 'prompts/list':
        respond(id, { prompts: [{ name: 'business-management', title: '推进全屋智能门店经营任务', description: '使用宿主内置模型领取与交付当前业务任务', arguments: [] }] }); return;
      case 'prompts/get':
        if (params?.name !== 'business-management') { reject(id, -32602, 'prompt not found'); return; }
        respond(id, { description: '全屋智能经营任务执行', messages: [{ role: 'user', content: { type: 'text', text: GUIDE } }] }); return;
      default: reject(id, -32601, 'method not found');
    }
  }

  const close = () => { if (!stopped) { stopped = true; engine.close(); } };
  input.setEncoding('utf8');
  input.on('data', chunk => {
    if (stopped) return;
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const frame = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!frame) continue;
      if (Buffer.byteLength(frame) > MAX_INPUT_BYTES) {
        reject(null, -32600, 'input frame exceeds 1 MiB'); close(); input.pause(); return;
      }
      queue = queue.then(() => {
        if (stopped) return;
        try { handle(JSON.parse(frame)); }
        catch (error) { if (error instanceof SyntaxError) reject(null, -32700, 'parse error'); else reject(null, -32000, errorObject(error).message); }
      });
    }
    if (Buffer.byteLength(buffer) > MAX_INPUT_BYTES) {
      reject(null, -32600, 'input frame exceeds 1 MiB'); close(); input.pause();
    }
  });
  input.on('end', () => {
    void queue.then(() => { if (!stopped && buffer.trim()) reject(null, -32700, 'incomplete frame'); close(); });
  });
  input.on('error', error => { errors.write(`${JSON.stringify({ error: errorObject(error) })}\n`); close(); });
  errors.write('BusinessManagementSystem MCP ready (stdio, agent role).\n');
  return { close, engine, config };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { options, positional } = parseArguments(process.argv.slice(2));
    if (positional.length) throw new TransportError('USAGE', 'MCP 入口只接受全局运行参数');
    const session = await startBusinessMcp({ options });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { session.close(); process.exit(0); });
  } catch (error) { process.stderr.write(`${JSON.stringify({ error: errorObject(error) })}\n`); process.exitCode = 1; }
}
