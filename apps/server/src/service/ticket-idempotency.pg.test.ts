import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTicketOn, rateTicketOn, ServiceHttpError, type CreateTicketInput } from "./ticket.js";

const databaseUrl = process.env.BMS_PG_TEST_URL;
describe.runIf(Boolean(databaseUrl))("MC-012 工单幂等主体与原始请求隔离（真实 PostgreSQL）", () => {
  const suffix = randomUUID();
  const tenantId = `tenant-ticket-${suffix}`;
  const workspaceId = `ws-ticket-${suffix}`;
  const userA = `user-ticket-a-${suffix}`, userB = `user-ticket-b-${suffix}`;
  const conversationA = `conv-ticket-a-${suffix}`, conversationB = `conv-ticket-b-${suffix}`;
  let owner: pg.Pool;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(url.hostname);
    owner = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    await owner.query(`INSERT INTO tenants (id,name) VALUES ($1,'合成工单隔离测试租户')`, [tenantId]);
    await owner.query(`INSERT INTO workspaces (id,tenant_id,name,slug) VALUES ($1,$2,'合成工单隔离测试',$1)`, [workspaceId, tenantId]);
    await owner.query(`INSERT INTO c_users (id,workspace_id,channel,openid) VALUES ($1,$3,'h5',$1),($2,$3,'h5',$2)`, [userA, userB, workspaceId]);
    await owner.query(`INSERT INTO c_conversations (id,workspace_id,c_user_id,channel) VALUES ($1,$3,$4,'h5'),($2,$3,$4,'h5')`,
      [conversationA, conversationB, workspaceId, userA]);
  });

  afterAll(async () => {
    if (!owner) return;
    const errors: unknown[] = [];
    for (const [sql, params] of [
      ["DELETE FROM c_ticket_events WHERE workspace_id=$1", [workspaceId]],
      ["DELETE FROM c_tickets WHERE workspace_id=$1", [workspaceId]],
      ["DELETE FROM c_conversations WHERE workspace_id=$1", [workspaceId]],
      ["DELETE FROM c_users WHERE workspace_id=$1", [workspaceId]],
      ["DELETE FROM workspaces WHERE id=$1", [workspaceId]],
      ["DELETE FROM tenants WHERE id=$1", [tenantId]],
    ] as const) {
      try { await owner.query(sql, [...params]); } catch (error) { errors.push(error); }
    }
    await owner.end();
    if (errors.length) throw new AggregateError(errors, "合成工单测试夹具清理失败");
  });

  async function transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await owner.connect();
    let discard: Error | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE workloom_app");
      await client.query("SELECT set_config('app.workspace_id',$1,true), set_config('app.tenant_id',$2,true)", [workspaceId, tenantId]);
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); }
      catch (rollback) {
        discard = rollback instanceof Error ? rollback : new Error(String(rollback));
        throw new AggregateError([error, rollback], "工单测试事务与回滚均失败", { cause: error });
      }
      throw error;
    } finally { client.release(discard); }
  }
  const input = (key: string, changes: Partial<CreateTicketInput> = {}): CreateTicketInput => ({
    workspaceId, cUserId: userA, kind: "repair", title: "合成请求：检查灯具", payload: { room: "SYN-101", nested: { a: 1, b: 2 }, items: ["a", "b"] },
    idempotencyKey: `${suffix}-${key}`, ...changes,
  });
  const create = (request: CreateTicketInput) => transaction(client => createTicketOn(client, request));
  const countEvents = async (id: string) => (await owner.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM c_ticket_events WHERE workspace_id=$1 AND ticket_id=$2 AND action='create'`, [workspaceId, id],
  )).rows[0]!.count;
  async function expectConflict(request: CreateTicketInput): Promise<Error> {
    const error = await create(request).then(() => { throw new Error("占用键被错误放行"); }, error => error);
    expect(error).toBeInstanceOf(ServiceHttpError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("工单幂等键已被占用，请使用新键重试");
    return error as Error;
  }

  it("同一客户、对象键顺序不同、新会话仍重放原单且只保留一次创建事件", async () => {
    const first = await create(input("same", { conversationId: conversationA }));
    const replay = await create(input("same", { conversationId: conversationB,
      payload: { items: ["a", "b"], nested: { b: 2, a: 1 }, room: "SYN-101" } }));
    expect(first.deduped).toBe(false);
    expect(replay.deduped).toBe(true);
    expect(replay.ticket.id).toBe(first.ticket.id);
    expect(replay.ticket.conversationId).toBe(conversationA);
    expect(await countEvents(first.ticket.id)).toBe(1);
  });
  it("同键修改标题、类型、负载或数组顺序都返回 409", async () => {
    const first = await create(input("changed"));
    for (const changes of [
      { title: "不同标题" }, { kind: "other" }, { payload: { room: "SYN-202" } },
      { payload: { room: "SYN-101", nested: { a: 1, b: 2 }, items: ["b", "a"] } },
    ]) await expectConflict(input("changed", changes));
    expect(await countEvents(first.ticket.id)).toBe(1);
  });
  it("另一客户占用同键仅得到通用 409，不泄露原单内容", async () => {
    const first = await create(input("other-user"));
    const error = await expectConflict(input("other-user", { cUserId: userB }));
    expect(error.message).not.toContain(first.ticket.id);
    expect(error.message).not.toContain(first.ticket.title);
    expect(await countEvents(first.ticket.id)).toBe(1);
  });
  it("两个并行事务的相同请求只创建一单，另一个重放已提交原单", async () => {
    const results = await Promise.all([create(input("parallel-same")), create(input("parallel-same"))]);
    expect(new Set(results.map(result => result.ticket.id)).size).toBe(1);
    expect(results.map(result => result.deduped).sort()).toEqual([false, true]);
    expect(await countEvents(results[0]!.ticket.id)).toBe(1);
  });
  it("两个并行客户竞争同键只允许一个成功，另一个通用 409", async () => {
    const results = await Promise.allSettled([create(input("parallel-users")), create(input("parallel-users", { cUserId: userB }))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ServiceHttpError);
    expect(rejected.reason.status).toBe(409);
    expect(rejected.reason.message).toBe("工单幂等键已被占用，请使用新键重试");
    const rows = await owner.query(`SELECT id FROM c_tickets WHERE workspace_id=$1 AND idempotency_key=$2`, [workspaceId, `${suffix}-parallel-users`]);
    expect(rows.rows).toHaveLength(1);
    expect(await countEvents(String(rows.rows[0].id))).toBe(1);
  });
  it("满意度修改落库 payload 后原始请求仍可安全重放", async () => {
    const first = await create(input("rated"));
    await owner.query(`UPDATE c_tickets SET status='done' WHERE workspace_id=$1 AND id=$2`, [workspaceId, first.ticket.id]);
    await transaction(client => rateTicketOn(client, { workspaceId, ticketId: first.ticket.id, cUserId: userA, score: 5, comment: "合成评价" }));
    const replay = await create(input("rated"));
    expect(replay.deduped).toBe(true);
    expect(replay.ticket.id).toBe(first.ticket.id);
    expect(replay.ticket.ratingScore).toBe(5);
    expect(await countEvents(first.ticket.id)).toBe(1);
  });
  it("旧单缺少不可变摘要时拒绝重放，不能回退到可变 payload 比较", async () => {
    const first = await create(input("legacy"));
    await owner.query(`UPDATE c_ticket_events SET detail=detail-'requestFingerprint' WHERE workspace_id=$1 AND ticket_id=$2 AND action='create'`, [workspaceId, first.ticket.id]);
    await expectConflict(input("legacy"));
  });
  it("创建事件主体不一致或出现多条创建事件时拒绝重放", async () => {
    const first = await create(input("actor"));
    await owner.query(`UPDATE c_ticket_events SET actor_id=$3 WHERE workspace_id=$1 AND ticket_id=$2 AND action='create'`, [workspaceId, first.ticket.id, userB]);
    await expectConflict(input("actor"));
    const second = await create(input("duplicates"));
    await owner.query(`INSERT INTO c_ticket_events (workspace_id,ticket_id,action,actor_type,actor_id,detail)
      SELECT workspace_id,ticket_id,action,actor_type,actor_id,detail FROM c_ticket_events WHERE workspace_id=$1 AND ticket_id=$2`, [workspaceId, second.ticket.id]);
    await expectConflict(input("duplicates"));
  });
  it("未提交幂等键的独立请求各自创建，不产生错误重放", async () => {
    const first = await create(input("no-key", { idempotencyKey: undefined }));
    const second = await create(input("no-key", { idempotencyKey: undefined }));
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(false);
    expect(second.ticket.id).not.toBe(first.ticket.id);
  });
});
