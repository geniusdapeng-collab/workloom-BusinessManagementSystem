import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDemoAuth } from "./channels.js";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const adminUrl = process.env.BMS_PG_TEST_URL;
const secret = "synthetic-h5-entry-test-secret-at-least-32-characters";
const sessionSecret = "synthetic-c-session-test-secret-at-least-32-characters";
const PROBE = `
  import { serviceGateway, DEMO_AUTH } from './apps/server/src/service/gateway.ts';
  import { issueH5EntryToken } from './apps/server/src/service/channels.ts';
  import { closeAllPools } from './packages/db/src/client.ts';
  const results = [];
  try {
    for (const request of JSON.parse(process.argv[1])) {
      const body = { channel: 'h5', ...request.body };
      if (request.entry) body.entryToken = await issueH5EntryToken({
        workspaceKey: 'brand-a', subject: request.subject || 'synthetic-signed-subject',
        appId: 'synthetic-service-front', secret: process.env.SERVICE_C_H5_ENTRY_SECRET,
        ...(request.entry === 'expired' ? { expiresIn: '-1s' } : {}),
      });
      const response = await serviceGateway.request('/session', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.240' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      results.push({ status: response.status, code: data.code, tokenIssued: typeof data.token === 'string',
        authMode: data.user?.authMode, openid: data.user?.openid, nickname: data.user?.nickname,
        hasUser: Boolean(data.user), requestIdProvided: typeof data.requestId === 'string' });
    }
  } finally { await closeAllPools(); }
  console.log(JSON.stringify({ demoAuth: DEMO_AUTH, results }));
`;

describe("MC-013 演示认证统一策略", () => {
  it("生产 true/false/缺省均关闭；开发保留缺省及显式配置行为", () => {
    for (const value of [undefined, "true", "false"]) {
      expect(resolveDemoAuth({ NODE_ENV: "production", SERVICE_C_DEMO_AUTH: value })).toBe(false);
    }
    expect(resolveDemoAuth({ NODE_ENV: "development" })).toBe(true);
    expect(resolveDemoAuth({ NODE_ENV: "test", SERVICE_C_DEMO_AUTH: "true" })).toBe(true);
    expect(resolveDemoAuth({ NODE_ENV: "test", SERVICE_C_DEMO_AUTH: "false" })).toBe(false);
  });
});

describe.runIf(Boolean(adminUrl))("MC-013 生产网关入口（隔离子进程与真实 PostgreSQL）", () => {
  const suffix = randomUUID();
  const tenantId = `tenant-auth-${suffix}`, workspaceId = `ws-auth-${suffix}`;
  let owner: pg.Pool;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(url.hostname);
    owner = new pg.Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await owner.query(`INSERT INTO tenants (id,name) VALUES ($1,'合成 H5 入口测试租户')`, [tenantId]);
    await owner.query(`INSERT INTO workspaces (id,tenant_id,name,slug) VALUES ($1,$2,'合成 H5 入口测试',$1)`, [workspaceId, tenantId]);
  });
  afterAll(async () => {
    if (!owner) return;
    try {
      await owner.query(`DELETE FROM c_users WHERE workspace_id=$1`, [workspaceId]);
      await owner.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
      await owner.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
    } finally { await owner.end(); }
  });
  const userCount = async () => (await owner.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM c_users WHERE workspace_id=$1`, [workspaceId],
  )).rows[0]!.count;
  async function probe(requests: Array<{ body: Record<string, unknown>; entry?: "valid" | "expired"; subject?: string }>, options: { production?: boolean; entrySecret?: boolean; demo?: string } = {}) {
    const appUrl = new URL(adminUrl!);
    appUrl.username = "workloom_app";
    appUrl.password = process.env.APP_DB_PASSWORD ?? "workloom_dev_app";
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      NODE_ENV: options.production === false ? "test" : "production",
      DATABASE_URL: adminUrl,
      DATABASE_APP_URL: appUrl.href,
      SERVICE_C_SECRET: sessionSecret,
      SERVICE_C_DEMO_AUTH: options.demo ?? "true",
      SERVICE_C_WORKSPACE_MAP: JSON.stringify({ "brand-a": workspaceId }),
      ...(options.entrySecret ? { SERVICE_C_H5_ENTRY_SECRET: secret } : {}),
      LLM_PROVIDER: "mock",
    };
    const { stdout } = await run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", PROBE, JSON.stringify(requests)],
      { cwd: ROOT, env, timeout: 20_000, maxBuffer: 128 * 1024 });
    return JSON.parse(stdout.trim()) as { demoAuth: boolean; results: Array<{
      status: number; code?: string; tokenIssued: boolean; authMode?: string; openid?: string;
      nickname?: string; hasUser: boolean; requestIdProvided: boolean;
    }> };
  }

  it("production + 显式 true + 无 H5 密钥返回 503，零用户、零 token", async () => {
    const before = await userCount();
    const result = await probe([{ body: { openid: "forged-anonymous", workspaceKey: "brand-a" } }]);
    expect(result.demoAuth).toBe(false);
    expect(result.results[0]).toMatchObject({ status: 503, code: "H5_ENTRY_NOT_CONFIGURED", tokenIssued: false, hasUser: false, requestIdProvided: true });
    expect(await userCount()).toBe(before);
  });
  it("production + 密钥已配置仍拒绝缺少签名的客户端自报 openid", async () => {
    const before = await userCount();
    const result = await probe([{ body: { openid: "forged-anonymous", workspaceKey: "brand-a" } }], { entrySecret: true });
    expect(result.results[0]).toMatchObject({ status: 401, code: "H5_ENTRY_REQUIRED", tokenIssued: false });
    expect(await userCount()).toBe(before);
  });
  it("伪造与过期签名都返回 401，不写用户", async () => {
    const before = await userCount();
    const result = await probe([
      { body: { entryToken: "not.a.valid-token" } }, { body: {}, entry: "expired" },
    ], { entrySecret: true });
    for (const response of result.results) expect(response).toMatchObject({ status: 401, code: "H5_ENTRY_INVALID", tokenIssued: false });
    expect(await userCount()).toBe(before);
  });
  it("签名站点与客户端站点不一致返回 403，不写用户", async () => {
    const before = await userCount();
    const result = await probe([{ body: { workspaceKey: "brand-b" }, entry: "valid" }], { entrySecret: true });
    expect(result.results[0]).toMatchObject({ status: 403, code: "H5_ENTRY_SCOPE_MISMATCH", tokenIssued: false });
    expect(await userCount()).toBe(before);
  });
  it("有效签名入口正常建立 channel 会话，客户端不能改写签名身份", async () => {
    const before = await userCount();
    const subject = `synthetic-signed-${suffix}`;
    const result = await probe([{ body: { workspaceKey: "brand-a", openid: "forged-subject", nickname: "forged-name" }, entry: "valid", subject }], { entrySecret: true });
    const expectedOpenid = `h5_${createHash("sha256").update(`synthetic-service-front:${subject}`).digest("hex").slice(0, 40)}`;
    expect(result.demoAuth).toBe(false);
    expect(result.results[0]).toMatchObject({ status: 200, tokenIssued: true, authMode: "channel", openid: expectedOpenid, nickname: "已验证用户" });
    expect(await userCount()).toBe(before + 1);
  });
  it("开发显式 true 保留 demo 标注，显式 false 要求正式签名", async () => {
    const enabled = await probe([{ body: { openid: `synthetic-demo-${suffix}`, workspaceKey: "brand-a" } }], { production: false });
    expect(enabled.demoAuth).toBe(true);
    expect(enabled.results[0]).toMatchObject({ status: 200, tokenIssued: true, authMode: "demo" });
    const before = await userCount();
    const disabled = await probe([{ body: { openid: "forged-demo", workspaceKey: "brand-a" } }], { production: false, demo: "false", entrySecret: true });
    expect(disabled.demoAuth).toBe(false);
    expect(disabled.results[0]).toMatchObject({ status: 401, code: "H5_ENTRY_REQUIRED", tokenIssued: false });
    expect(await userCount()).toBe(before);
  });
  it("生产显式 true 也不能用小程序 openid 绕过 code 交换", async () => {
    const before = await userCount();
    const result = await probe([{ body: { channel: "wechat-mini", openid: "forged-mini", workspaceKey: "brand-a" } }]);
    expect(result.results[0]).toMatchObject({ status: 400, tokenIssued: false, hasUser: false });
    expect(await userCount()).toBe(before);
  });
});
