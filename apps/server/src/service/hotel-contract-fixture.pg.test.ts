import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installHotelContractFixture } from "./hotel-contract-fixture.js";

const adminUrl = process.env.BMS_PG_TEST_URL;
describe("酒店合成契约夹具启用边界", () => {
  it("未显式启用或指定工作区时在连接数据库前拒绝", async () => {
    const prior = process.env.RUN_DB_TESTS;
    process.env.RUN_DB_TESTS = "0";
    try {
      await expect(installHotelContractFixture("synthetic-ws", "postgres://postgres@127.0.0.1:1/unused")).rejects.toThrow("必须显式启用");
    } finally {
      if (prior === undefined) delete process.env.RUN_DB_TESTS; else process.env.RUN_DB_TESTS = prior;
    }
  });
  it("非回环数据库在连接前拒绝", async () => {
    const priorRun = process.env.RUN_DB_TESTS, priorWs = process.env.SERVICE_C_TEST_WORKSPACE_ID;
    process.env.RUN_DB_TESTS = "1"; process.env.SERVICE_C_TEST_WORKSPACE_ID = "synthetic-ws";
    try {
      await expect(installHotelContractFixture("synthetic-ws", "postgres://postgres@example.invalid/unused")).rejects.toThrow("回环测试数据库");
    } finally {
      if (priorRun === undefined) delete process.env.RUN_DB_TESTS; else process.env.RUN_DB_TESTS = priorRun;
      if (priorWs === undefined) delete process.env.SERVICE_C_TEST_WORKSPACE_ID; else process.env.SERVICE_C_TEST_WORKSPACE_ID = priorWs;
    }
  });
});

describe.runIf(Boolean(adminUrl))("酒店合成契约夹具真实 PG", () => {
  const suffix = randomUUID(), tenantId = `tenant-fixture-${suffix}`;
  const workspaces: string[] = [];
  let owner: pg.Pool;
  const priorRun = process.env.RUN_DB_TESTS, priorWs = process.env.SERVICE_C_TEST_WORKSPACE_ID;
  beforeAll(async () => {
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(adminUrl!).hostname);
    owner = new pg.Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await owner.query(`INSERT INTO tenants (id,name) VALUES ($1,'合成酒店契约夹具测试')`, [tenantId]);
    process.env.RUN_DB_TESTS = "1";
  });
  afterAll(async () => {
    if (priorRun === undefined) delete process.env.RUN_DB_TESTS; else process.env.RUN_DB_TESTS = priorRun;
    if (priorWs === undefined) delete process.env.SERVICE_C_TEST_WORKSPACE_ID; else process.env.SERVICE_C_TEST_WORKSPACE_ID = priorWs;
    if (!owner) return;
    const errors: unknown[] = [];
    for (const sql of [
      "DELETE FROM demo_orders WHERE workspace_id=ANY($1)",
      "DELETE FROM demo_members WHERE workspace_id=ANY($1)",
      "DELETE FROM bundle_installs WHERE workspace_id=ANY($1)",
      "DELETE FROM workspaces WHERE id=ANY($1)",
    ]) {
      try { await owner.query(sql, [workspaces]); } catch (error) { errors.push(error); }
    }
    try { await owner.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]); } catch (error) { errors.push(error); }
    await owner.end();
    if (errors.length) throw new AggregateError(errors, "酒店合成夹具测试清理失败");
  });
  async function workspace(name: string, options: { example?: boolean; industry?: string; install?: string | null } = {}): Promise<string> {
    const id = `ws-fixture-${name}-${suffix}`;
    workspaces.push(id);
    await owner.query(`INSERT INTO workspaces (id,tenant_id,name,slug,industry,is_example) VALUES ($1,$2,$1,$1,$3,$4)`,
      [id, tenantId, options.industry ?? "hotel", options.example ?? true]);
    if (options.install !== null) await owner.query(
      `INSERT INTO bundle_installs (id,workspace_id,bundle_id,status) VALUES ($1,$2,$3,'active')`,
      [`install-${id}`, id, options.install ?? "hotel"],
    );
    process.env.SERVICE_C_TEST_WORKSPACE_ID = id;
    return id;
  }
  const counts = async (id: string) => (await owner.query<{ members: number; orders: number }>(
    `SELECT (SELECT count(*)::int FROM demo_members WHERE workspace_id=$1) AS members,
            (SELECT count(*)::int FROM demo_orders WHERE workspace_id=$1) AS orders`, [id],
  )).rows[0]!;

  it("未标示示例的酒店工作区拒绝且没有数据写入", async () => {
    const id = await workspace("nonexample", { example: false });
    await expect(installHotelContractFixture(id, adminUrl!)).rejects.toThrow("is_example");
    expect(await counts(id)).toEqual({ members: 0, orders: 0 });
  });
  it("其他行业或未活动装配不能获得酒店数据", async () => {
    for (const [name, options] of [
      ["other-industry", { industry: "smart-home", install: "smart-home" }],
      ["no-install", { install: null }],
      ["wrong-install", { install: "smart-home" }],
    ] as const) {
      const id = await workspace(name, options);
      await expect(installHotelContractFixture(id, adminUrl!)).rejects.toThrow(/酒店工作区|唯一活动 hotel/);
      expect(await counts(id)).toEqual({ members: 0, orders: 0 });
    }
  });
  it("固定标识被不同内容占用时不覆盖并回滚全部新增行", async () => {
    const id = await workspace("occupied");
    await owner.query(`INSERT INTO demo_members (workspace_id,member_id,name) VALUES ($1,'M-1002','SYN-DIFFERENT-CONTENT')`, [id]);
    await expect(installHotelContractFixture(id, adminUrl!)).rejects.toThrow("不同内容占用");
    expect(await counts(id)).toEqual({ members: 1, orders: 0 });
    const row = await owner.query(`SELECT name FROM demo_members WHERE workspace_id=$1 AND member_id='M-1002'`, [id]);
    expect(row.rows[0].name).toBe("SYN-DIFFERENT-CONTENT");
  });
  it("同一显式合成工作区并行与重复安装幂等，另一个工作区保持为空", async () => {
    const untouched = await workspace("untouched");
    const id = await workspace("positive");
    await Promise.all([installHotelContractFixture(id, adminUrl!), installHotelContractFixture(id, adminUrl!)]);
    await installHotelContractFixture(id, adminUrl!);
    expect(await counts(id)).toEqual({ members: 2, orders: 3 });
    expect(await counts(untouched)).toEqual({ members: 0, orders: 0 });
  });
});
