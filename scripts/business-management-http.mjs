import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import {
  MAX_INPUT_BYTES, REPOSITORY_ROOT, TransportError, actorFor, errorObject,
  openEngine, positiveInteger, validateTransportInput,
} from './business-management-common.mjs';

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const SESSION_COOKIE = 'bms_owner_session';
const PENDING_TTL = 5 * 60_000;
const OWNER_TTL = 30 * 60_000;

export function validateHttpBoundary(request, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!hosts.has(request.headers.host)) throw new TransportError('FORBIDDEN_HOST', 'Host 不属于当前本机工作台', 403);
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}`) throw new TransportError('FORBIDDEN_ORIGIN', '拒绝跨来源请求', 403);
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new TransportError('FORBIDDEN_ORIGIN', '拒绝跨站请求', 403);
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieValue(header, name) {
  for (const item of String(header ?? '').split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function headers(response) {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function json(response, status, value) {
  headers(response);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function bodyJson(request) {
  if (String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new TransportError('INVALID_CONTENT_TYPE', '请求须使用 application/json', 415);
  const declared = request.headers['content-length'];
  if (declared && Number(declared) > MAX_INPUT_BYTES) throw new TransportError('INPUT_TOO_LARGE', '请求体超过 1 MiB', 413);
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) throw new TransportError('INPUT_TOO_LARGE', '请求体超过 1 MiB', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new TransportError('INVALID_JSON', '请求体不是有效 JSON'); }
  return validateTransportInput(value);
}

export async function startBusinessHttp({ options = {}, env = process.env, input = process.stdin, output = process.stdout, errors = process.stderr, root = REPOSITORY_ROOT } = {}) {
  const product = JSON.parse(await readFile(join(root, 'product.manifest.json'), 'utf8'));
  const requestedPort = positiveInteger(options['--port'] ?? env.BMS_PORT ?? product.workbench?.port, 9393, 0, 65535, 'port');
  const { engine, config } = await openEngine(options, env, root);
  const sessions = new Map();
  const agent = actorFor(config, 'http');
  const ownerEnabled = input.isTTY === true && output.isTTY === true;
  let actualPort = requestedPort;
  let closed = false;
  let terminal;

  function pruneSessions() {
    const now = Date.now();
    for (const [nonce, session] of sessions) if (session.expiresAt <= now) sessions.delete(nonce);
  }
  function sessionOf(request) {
    pruneSessions();
    return sessions.get(cookieValue(request.headers.cookie, SESSION_COOKIE));
  }
  function authorizeOwner(request, body) {
    const session = sessionOf(request);
    if (session?.status !== 'authorized') throw new TransportError('OWNER_SESSION_REQUIRED', '需要由人类终端批准的店主会话', 403);
    if (!safeEqual(request.headers['x-bms-csrf'], session.csrfToken)) throw new TransportError('CSRF_REJECTED', '店主请求校验失败', 403);
    if (request.headers.origin !== `http://${request.headers.host}`) throw new TransportError('FORBIDDEN_ORIGIN', '店主操作须来自本工作台页面', 403);
    return engine.call(body.operation, validateTransportInput(body.input ?? {}), actorFor(config, 'http', 'owner', true));
  }

  const server = createServer(async (request, response) => {
    try {
      validateHttpBoundary(request, actualPort);
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.search) throw new TransportError('INVALID_URL', '当前入口不接受 URL 查询参数');
      if (url.pathname === '/api/owner/session') {
        if (request.method === 'GET') {
          const session = sessionOf(request);
          json(response, 200, session
            ? { status: session.status, requestId: session.requestId, expiresAt: new Date(session.expiresAt).toISOString(), ...(session.status === 'authorized' ? { csrfToken: session.csrfToken } : {}) }
            : { status: 'anonymous', ownerConsoleAvailable: ownerEnabled });
          return;
        }
        if (request.method === 'DELETE') {
          const session = sessionOf(request);
          if (session?.status === 'authorized' && !safeEqual(request.headers['x-bms-csrf'], session.csrfToken)) throw new TransportError('CSRF_REJECTED', '店主请求校验失败', 403);
          sessions.delete(cookieValue(request.headers.cookie, SESSION_COOKIE));
          response.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/api/owner; HttpOnly; SameSite=Strict; Max-Age=0`);
          json(response, 200, { status: 'anonymous' }); return;
        }
        if (request.method !== 'POST') throw new TransportError('METHOD_NOT_ALLOWED', '方法不支持', 405);
        if (!ownerEnabled) throw new TransportError('OWNER_CONSOLE_UNAVAILABLE', '请由店主在真实终端启动 serve，当前进程无法授予店主会话', 403);
        if (request.headers.origin !== `http://${request.headers.host}`) throw new TransportError('FORBIDDEN_ORIGIN', '会话申请须来自本工作台页面', 403);
        const body = await bodyJson(request);
        if (Object.keys(body).length) throw new TransportError('INVALID_INPUT', '店主会话申请不接受身份或权限字段');
        const existing = sessionOf(request);
        if (existing) { json(response, 200, { status: existing.status, requestId: existing.requestId }); return; }
        pruneSessions();
        if (sessions.size >= 50) throw new TransportError('RATE_LIMITED', '待确认会话数量达到上限', 429);
        const nonce = randomBytes(32).toString('hex');
        const session = { status: 'pending', requestId: randomBytes(6).toString('hex'), csrfToken: randomBytes(32).toString('hex'), expiresAt: Date.now() + PENDING_TTL };
        sessions.set(nonce, session);
        response.setHeader('set-cookie', `${SESSION_COOKIE}=${nonce}; Path=/api/owner; HttpOnly; SameSite=Strict; Max-Age=1800`);
        output.write(`\n浏览器申请店主会话：${session.requestId}。核对页面上的请求号后，键入 owner ${session.requestId} 批准；5 分钟内有效。\n`);
        json(response, 202, { status: 'pending', requestId: session.requestId }); return;
      }
      if (url.pathname === '/api/owner/call' && request.method === 'POST') {
        const body = await bodyJson(request);
        if (typeof body.operation !== 'string' || Object.keys(body).some(key => !['operation', 'input'].includes(key))) throw new TransportError('INVALID_INPUT', '请求须为 {operation,input}');
        json(response, 200, authorizeOwner(request, body)); return;
      }
      if (url.pathname === '/api/call' && request.method === 'POST') {
        const body = await bodyJson(request);
        if (typeof body.operation !== 'string' || Object.keys(body).some(key => !['operation', 'input'].includes(key))) throw new TransportError('INVALID_INPUT', '请求须为 {operation,input}');
        json(response, 200, engine.call(body.operation, validateTransportInput(body.input ?? {}), agent)); return;
      }
      if (url.pathname === '/api/catalog' && request.method === 'GET') { json(response, 200, engine.catalog()); return; }
      if (url.pathname === '/api/state' && request.method === 'GET') { json(response, 200, engine.call('state.snapshot', {}, agent)); return; }
      if (url.pathname === '/api/status' && request.method === 'GET') { json(response, 200, engine.call('status', {}, agent)); return; }
      if (url.pathname.startsWith('/api/')) throw new TransportError('NOT_FOUND', 'API 路径或方法不存在', 404);
      const file = STATIC_FILES.get(url.pathname);
      if (!file || !['GET', 'HEAD'].includes(request.method)) throw new TransportError('NOT_FOUND', '页面不存在', 404);
      const staticRoot = await realpath(join(root, 'bundles/smart-home/ui/workbench'));
      const target = await realpath(join(staticRoot, file[0]));
      if (!target.startsWith(staticRoot + sep)) throw new TransportError('FORBIDDEN_PATH', '页面资产越出指定目录', 403);
      const data = await readFile(target);
      headers(response);
      response.writeHead(200, { 'content-type': file[1], 'content-length': data.length });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      json(response, Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500, { error: errorObject(error) });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 50;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  server.listen(requestedPort, '127.0.0.1');
  try { await once(server, 'listening'); }
  catch (error) { engine.close(); throw error; }
  actualPort = server.address().port;
  if (ownerEnabled) {
    terminal = createInterface({ input, output, terminal: true });
    terminal.on('line', line => {
      pruneSessions();
      const match = /^owner ([a-f0-9]{12})$/u.exec(line.trim());
      const session = match ? [...sessions.values()].find(item => item.requestId === match[1] && item.status === 'pending') : null;
      if (!session) { output.write('指令不匹配有效申请；使用 owner <页面请求号>。\n'); return; }
      session.status = 'authorized'; session.expiresAt = Date.now() + OWNER_TTL;
      output.write(`店主会话 ${session.requestId} 已由终端确认；30 分钟后过期。\n`);
    });
  }
  errors.write(`BusinessManagementSystem workbench: http://127.0.0.1:${actualPort} (${config.dataMode}, ${ownerEnabled ? 'human console available' : 'agent only'})\n`);
  return {
    server, engine, config, url: `http://127.0.0.1:${actualPort}`, ownerEnabled,
    async close() {
      if (closed) return;
      closed = true; terminal?.close(); sessions.clear();
      server.closeIdleConnections();
      await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      engine.close();
    },
  };
}
