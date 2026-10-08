import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusinessEvent } from "@workloom/shared";
import {
  appendEvent, appendEventIdempotent, appendEventIdempotentInTx,
  eventHash, GENESIS_HASH, withScopedEventTransaction, type EventDraft,
} from "./events.js";
import { gatewayAppend, gatewayAppendIdempotent, gatewayAppendOnClient, type ActorInfo, type GatewayContext } from "./gateway.js";

const adminUrl = process.env.BMS_PG_TEST_URL
  ?? (process.env.RUN_DB_TESTS === "1" ? process.env.DATABASE_URL : undefined);
const human = { id: "MEM-SYNTHETIC-OWNER", type: "human" as const };
const agent = { id: "synthetic-gateway-agent", type: "agent" as const, highRisk: true, fenceBindings: ["SYN-FENCE"] };
const wrappers = ["gatewayAppend", "gatewayAppendIdempotent", "appendEvent", "appendEventIdempotent"] as const;
type Wrapper = (typeof wrappers)[number];

it("event transaction connection failure propagates before any transaction or release", async () => {
  const primary = new Error("Synthetic event connection failure");
  let called = false;
  const pool = { connect: async () => { throw primary; } } as unknown as pg.Pool;
  await expect(withScopedEventTransaction(pool, { tenantId: "unused", workspaceId: "unused" }, async () => { called = true; })).rejects.toBe(primary);
  expect(called).toBe(false);
});

describe.runIf(Boolean(adminUrl))("MC-020/MC-023 event transactions and one-time authorization on disposable PostgreSQL", () => {
  const database = `bms_gateway_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Client, owner: pg.Pool, gateway: pg.Pool;
  let created = false;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Disposable event tests require loopback PostgreSQL");
    admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await admin.connect(); await admin.query(`CREATE DATABASE ${database}`); created = true;
    url.pathname = `/${database}`;
    owner = new pg.Pool({ connectionString: url.href, max: 6, connectionTimeoutMillis: 5000 });
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      const migrations = new URL("../../db/migrations/", import.meta.url).pathname;
      for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
        await client.query(readFileSync(join(migrations, file), "utf8"));
      }
      await client.query("COMMIT");
    } catch (primary) {
      try { await client.query("ROLLBACK"); }
      catch (cleanup) { throw new AggregateError([primary, cleanup], "Gateway test migration and rollback failed", { cause: primary }); }
      throw primary;
    } finally { client.release(); }
    url.username = "workloom_gateway"; url.password = process.env.GATEWAY_DB_PASSWORD ?? "workloom_dev_gateway";
    gateway = new pg.Pool({ connectionString: url.href, max: 8, statement_timeout: 8000, connectionTimeoutMillis: 5000 });
    expect((await gateway.query("SELECT current_user")).rows[0].current_user).toBe("workloom_gateway");
  }, 30000);
  afterAll(async () => {
    const failures: unknown[] = [];
    const closed = await Promise.allSettled([gateway?.end(), owner?.end()]);
    for (const result of closed) if (result.status === "rejected") failures.push(result.reason);
    if (admin) {
      try { if (created) await admin.query(`DROP DATABASE ${database}`); }
      catch (error) { failures.push(error); }
      finally { try { await admin.end(); } catch (error) { failures.push(error); } }
    }
    if (failures.length) throw new AggregateError(failures, "Gateway test database cleanup failed");
  }, 30000);

  async function fixture() {
    const suffix = randomUUID();
    const scope = { tenantId: `tenant-gateway-${suffix}`, workspaceId: `ws-gateway-${suffix}` };
    await owner.query("INSERT INTO tenants(id,name,plan) VALUES($1,'synthetic gateway regression','pro')", [scope.tenantId]);
    await owner.query("INSERT INTO workspaces(id,tenant_id,name,slug,industry,is_example) VALUES($1,$2,'synthetic gateway regression',$1,'general',true)", [scope.workspaceId, scope.tenantId]);
    const source = await gatewayAppend(gateway, { ...scope, actor: human }, {
      who: human, context: { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, time: new Date().toISOString() },
      object: { type: "review", id: `source-${suffix}` }, decision: { action: "test.synthetic.source" }, rule_impact: [],
    });
    const approvalId = `approval-gateway-${suffix}`;
    await owner.query(`INSERT INTO approvals(approval_id,tenant_id,workspace_id,event_id,channel,status,snapshot)
      VALUES($1,$2,$3,$4,'inapp','approved',$5)`, [approvalId, scope.tenantId, scope.workspaceId, source.eventId,
      JSON.stringify({ action: "desktop.gui", object_type: "room", object_id: "SYN-ROOM", expires_at: new Date(Date.now() + 60000).toISOString() })]);
    const draft: EventDraft = {
      who: human, context: { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, time: new Date().toISOString() },
      object: { type: "room", id: "SYN-ROOM" }, decision: { action: "test.synthetic.write", kind: "execute" }, rule_impact: [],
    };
    const replay: BusinessEvent = { ...draft, event_id: `E-RPL-${suffix}` };
    const highRisk: BusinessEvent = { ...replay, who: { id: agent.id, type: agent.type, version: "1.0.0" }, decision: { action: "desktop.gui", kind: "execute" } };
    return { scope, approvalId, draft, replay, highRisk };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function state(target: Fixture) {
    const approval = (await owner.query("SELECT status,consumed_at FROM approvals WHERE approval_id=$1", [target.approvalId])).rows[0];
    const events = (await owner.query("SELECT event_id,payload,prev_hash,hash FROM biz_events WHERE workspace_id=$1 AND payload->'decision'->>'action'<>'test.synthetic.source' ORDER BY seq", [target.scope.workspaceId])).rows;
    return { approval, events };
  }
  const highRiskContext = (target: Fixture): GatewayContext => ({ ...target.scope, actor: agent, approvalRef: target.approvalId });
  const invoke = (name: Wrapper, pool: pg.Pool, target: Fixture) => name === "gatewayAppend"
    ? gatewayAppend(pool, { ...target.scope, actor: human }, target.draft)
    : name === "gatewayAppendIdempotent" ? gatewayAppendIdempotent(pool, highRiskContext(target), target.highRisk)
      : name === "appendEvent" ? appendEvent(pool, target.scope, { event: target.draft })
        : appendEventIdempotent(pool, target.scope, target.replay);
  function instrument(faults: { before?: (sql: string, client: pg.PoolClient) => void | Promise<void>; after?: (sql: string, client: pg.PoolClient) => void | Promise<void> } = {}) {
    const statements: string[] = [], clientPids: number[] = [];
    const releases: Array<Error | undefined> = [];
    let connections = 0;
    const pool = { connect: async () => {
      connections++;
      const client = await gateway.connect();
      clientPids.push((await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid);
      return { query: async (sql: string, params?: unknown[]) => {
        statements.push(sql); await faults.before?.(sql, client);
        const result = await client.query(sql, params); await faults.after?.(sql, client); return result;
      }, release: (error?: Error) => { releases.push(error); client.release(error); } };
    } } as unknown as pg.Pool;
    return { pool, statements, clientPids, releases, connections: () => connections };
  }

  it.each(wrappers)("%s retains real-write and rollback errors, destroys the connection and rolls back event/approval", async name => {
    const target = await fixture(), primary = new Error("Synthetic write acknowledgement failure"), cleanup = new Error("Synthetic rollback transport failure");
    const f = instrument({ before: sql => { if (sql === "ROLLBACK") throw cleanup; },
      after: sql => { if (sql.includes("FROM append_event_insert(")) throw primary; } });
    const error = await invoke(name, f.pool, target).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([primary, cleanup]); expect(error.cause).toBe(primary);
    expect(f.statements.filter(sql => sql === "ROLLBACK")).toHaveLength(1); expect(f.statements).not.toContain("COMMIT");
    expect(f.releases).toEqual([error]); expect(f.connections()).toBe(1);
    const next = await gateway.connect();
    try {
      expect((await next.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid).not.toBe(f.clientPids[0]);
      expect((await next.query("SELECT pg_current_xact_id_if_assigned() AS tx")).rows[0].tx).toBeNull();
    } finally { next.release(); }
    expect((await state(target)).events).toEqual([]); expect((await state(target)).approval.consumed_at).toBeNull();
  });
  it.each(wrappers)("%s rejects a COMMIT failure, rolls back writes and discards the uncertain connection", async name => {
    const target = await fixture(), primary = new Error("Synthetic COMMIT failure");
    const f = instrument({ before: sql => { if (sql === "COMMIT") throw primary; } });
    await expect(invoke(name, f.pool, target)).rejects.toBe(primary);
    expect(f.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]); expect(f.releases).toEqual([primary]);
    expect((await state(target)).events).toEqual([]); expect((await state(target)).approval.consumed_at).toBeNull();
  });
  it.each(wrappers)("%s reports lost COMMIT acknowledgement instead of false success while preserving actual committed state", async name => {
    const target = await fixture(), primary = new Error("Synthetic lost COMMIT acknowledgement");
    const f = instrument({ after: sql => { if (sql === "COMMIT") throw primary; } });
    await expect(invoke(name, f.pool, target)).rejects.toBe(primary);
    expect(f.statements.filter(sql => sql === "COMMIT")).toHaveLength(1); expect(f.releases).toEqual([primary]);
    const actual = await state(target); expect(actual.events).toHaveLength(1);
    if (name === "gatewayAppendIdempotent") expect(actual.approval.consumed_at).not.toBeNull();
    else expect(actual.approval.consumed_at).toBeNull();
  });
  it.each(wrappers)("%s rolls back RLS setup failure before touching an event or approval", async name => {
    const target = await fixture(), primary = new Error("Synthetic RLS setup failure");
    const f = instrument({ before: sql => { if (sql.includes("set_config('app.workspace_id'")) throw primary; } });
    await expect(invoke(name, f.pool, target)).rejects.toBe(primary);
    expect(f.statements.at(-1)).toBe("ROLLBACK"); expect(f.statements.some(sql => sql.includes("FROM approvals") || sql.includes("FROM biz_events"))).toBe(false);
    expect(f.releases).toEqual([undefined]); expect((await state(target)).events).toEqual([]);
  });
  it("BEGIN and rollback failures retain both causes before any scoped write", async () => {
    const target = await fixture(), primary = new Error("Synthetic BEGIN failure"), cleanup = new Error("Synthetic rollback failure");
    const f = instrument({ before: sql => { if (sql === "BEGIN") throw primary; if (sql === "ROLLBACK") throw cleanup; } });
    const error = await gatewayAppend(f.pool, { ...target.scope, actor: human }, target.draft).catch(error => error);
    expect(error.errors).toEqual([primary, cleanup]); expect(error.cause).toBe(primary);
    expect(f.statements).toEqual(["BEGIN", "ROLLBACK"]); expect(f.releases).toEqual([error]);
  });
  it("non-Error rollback failures remain visible and the client is discarded with an Error", async () => {
    const target = await fixture(), primary = new Error("Synthetic write failure");
    const f = instrument({ before: sql => { if (sql === "ROLLBACK") throw "synthetic disconnect"; },
      after: sql => { if (sql.includes("FROM append_event_insert(")) throw primary; } });
    const error = await gatewayAppend(f.pool, { ...target.scope, actor: human }, target.draft).catch(error => error);
    expect(error.errors).toEqual([primary, "synthetic disconnect"]); expect(error.cause).toBe(primary);
    expect(f.releases).toEqual([error]); expect((await state(target)).events).toEqual([]);
  });
  it("ordinary sequence namespace rejects before connection and never consumes a valid approval", async () => {
    const target = await fixture(), f = instrument();
    await expect(gatewayAppendIdempotent(f.pool, highRiskContext(target), { ...target.highRisk, event_id: "E-889901" })).rejects.toThrow("前缀空间");
    expect(f.connections()).toBe(0); expect((await state(target)).approval.consumed_at).toBeNull(); expect((await state(target)).events).toEqual([]);
  });
  it("invalid event schema fails before permission or connection and never consumes approval", async () => {
    const target = await fixture(), f = instrument();
    await expect(gatewayAppendIdempotent(f.pool, highRiskContext(target), { ...target.highRisk,
      who: { type: "agent", id: "different-actor" }, context: { ...target.highRisk.context, time: "invalid" } })).rejects.toThrow("附录 E");
    expect(f.connections()).toBe(0); expect((await state(target)).approval.consumed_at).toBeNull();
  });
  it("a real payload-conflict SQL error rolls back authorization; valid retry can still use the approval", async () => {
    const target = await fixture();
    await gatewayAppendIdempotent(gateway, { ...target.scope, actor: human }, { ...target.replay, event_id: target.highRisk.event_id });
    await expect(gatewayAppendIdempotent(gateway, highRiskContext(target), target.highRisk)).rejects.toThrow("抢占攻击");
    expect((await state(target)).approval.consumed_at).toBeNull();
    const valid = { ...target.highRisk, event_id: `${target.highRisk.event_id}-retry` };
    expect((await gatewayAppendIdempotent(gateway, highRiskContext(target), valid)).deduped).toBe(false);
    const actual = await state(target); expect(actual.approval.consumed_at).not.toBeNull(); expect(actual.events).toHaveLength(2);
  });
  it("authorization consumption and idempotent event insertion use one client and one COMMIT", async () => {
    const target = await fixture(), f = instrument();
    const result = await gatewayAppendIdempotent(f.pool, highRiskContext(target), target.highRisk);
    expect(result.deduped).toBe(false); expect(f.connections()).toBe(1);
    expect(f.statements.filter(sql => sql === "BEGIN")).toHaveLength(1); expect(f.statements.filter(sql => sql === "COMMIT")).toHaveLength(1);
    expect(f.statements.findIndex(sql => sql.includes("UPDATE approvals SET consumed_at"))).toBeLessThan(f.statements.findIndex(sql => sql.includes("FROM append_event_insert(")));
    const actual = await state(target); expect(actual.approval.consumed_at).not.toBeNull(); expect(actual.events).toHaveLength(1);
  });
  it("two concurrent requests sharing one approval commit one action and reject the other consumption", async () => {
    const target = await fixture();
    const results = await Promise.allSettled([
      gatewayAppendIdempotent(gateway, highRiskContext(target), target.highRisk),
      gatewayAppendIdempotent(gateway, highRiskContext(target), { ...target.highRisk, event_id: `${target.highRisk.event_id}-second` }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toContain("已被消费");
    expect((await state(target)).events).toHaveLength(1); expect((await state(target)).approval.consumed_at).not.toBeNull();
  });
  it("same-payload replay preserves the original sequence/hash; different payload is rejected without a new event", async () => {
    const target = await fixture(), ctx = { ...target.scope, actor: human };
    const first = await gatewayAppendIdempotent(gateway, ctx, target.replay);
    const replay = await gatewayAppendIdempotent(gateway, ctx, target.replay);
    expect(first.deduped).toBe(false); expect(replay).toMatchObject({ deduped: true, eventId: first.eventId, seq: first.seq, hash: first.hash });
    await expect(gatewayAppendIdempotent(gateway, ctx, { ...target.replay, decision: { action: "test.synthetic.changed" } })).rejects.toThrow("抢占攻击");
    expect((await state(target)).events).toHaveLength(1);
  });
  it("same-payload replay cannot bypass one-time authorization with an already consumed reference", async () => {
    const target = await fixture();
    await gatewayAppendIdempotent(gateway, highRiskContext(target), target.highRisk);
    await expect(gatewayAppendIdempotent(gateway, highRiskContext(target), target.highRisk)).rejects.toThrow("已被消费");
    expect((await state(target)).events).toHaveLength(1);
  });
  it("foreign workspace and tenant cannot consume another scope's approval", async () => {
    const target = await fixture(), foreign = await fixture();
    const ctx = { ...highRiskContext(target), ...foreign.scope };
    const event = { ...target.highRisk, context: { ...target.highRisk.context, tenant_id: foreign.scope.tenantId, workspace_id: foreign.scope.workspaceId } };
    await expect(gatewayAppendIdempotent(gateway, ctx, event)).rejects.toThrow("不存在");
    expect((await state(target)).approval.consumed_at).toBeNull(); expect((await state(foreign)).events).toEqual([]);
  });
  it.each(["tenant", "workspace", "both"] as const)("mismatching replay %s rejects before connection or local approval consumption", async mismatch => {
    const target = await fixture(), foreign = await fixture(), f = instrument();
    const otherWorkspace = `${target.scope.workspaceId}-other`;
    await owner.query("INSERT INTO workspaces(id,tenant_id,name,slug,industry,is_example) VALUES($1,$2,'synthetic second workspace',$1,'general',true)", [otherWorkspace, target.scope.tenantId]);
    const context = { ...target.highRisk.context,
      tenant_id: mismatch === "workspace" ? target.scope.tenantId : foreign.scope.tenantId,
      workspace_id: mismatch === "tenant" ? target.scope.workspaceId : mismatch === "workspace" ? otherWorkspace : foreign.scope.workspaceId };
    await expect(gatewayAppendIdempotent(f.pool, highRiskContext(target), { ...target.highRisk, context })).rejects.toThrow("context 与调用作用域不一致");
    expect(f.connections()).toBe(0); expect((await state(target)).approval.consumed_at).toBeNull();
    expect((await state(target)).events).toEqual([]); expect((await state(foreign)).events).toEqual([]);
  });
  it("direct idempotent wrapper and InTx primitive both reject foreign payload attribution", async () => {
    const target = await fixture(), foreign = await fixture(), f = instrument();
    const event = { ...target.replay, context: { ...target.replay.context, tenant_id: foreign.scope.tenantId, workspace_id: foreign.scope.workspaceId } };
    await expect(appendEventIdempotent(f.pool, target.scope, event)).rejects.toThrow("context 与调用作用域不一致");
    expect(f.connections()).toBe(0);
    await expect(withScopedEventTransaction(gateway, target.scope, client => appendEventIdempotentInTx(client, target.scope, event))).rejects.toThrow("context 与调用作用域不一致");
    expect((await state(target)).events).toEqual([]); expect((await state(foreign)).events).toEqual([]);
  });
  it.each(["gatewayAppend", "gatewayAppendOnClient"] as const)("%s normalizes ordinary drafts to the trusted context before authorization and event storage", async name => {
    const target = await fixture(), foreign = await fixture();
    const draft: EventDraft = { ...target.draft, who: target.highRisk.who, decision: target.highRisk.decision,
      context: { ...target.draft.context, tenant_id: foreign.scope.tenantId, workspace_id: foreign.scope.workspaceId } };
    const result = name === "gatewayAppend" ? await gatewayAppend(gateway, highRiskContext(target), draft)
      : await withScopedEventTransaction(gateway, target.scope, client => gatewayAppendOnClient(client, highRiskContext(target), draft));
    expect(result.deduped).toBe(false);
    const actual = await state(target); expect(actual.events).toHaveLength(1); expect(actual.approval.consumed_at).not.toBeNull();
    expect(actual.events[0].payload.context).toMatchObject({ tenant_id: target.scope.tenantId, workspace_id: target.scope.workspaceId });
    expect(draft.context.tenant_id).toBe(foreign.scope.tenantId); expect(draft.context.workspace_id).toBe(foreign.scope.workspaceId);
    expect((await state(foreign)).events).toEqual([]);
  });
  it("readonly, missing fence bindings and mismatching attribution reject before database access", async () => {
    const target = await fixture();
    const attempts: Array<[ActorInfo, BusinessEvent]> = [
      [{ ...agent, readonly: true }, target.highRisk],
      [{ ...agent, fenceBindings: [] }, target.highRisk],
      [agent, { ...target.highRisk, who: { type: "agent" as const, id: "different-actor" } }],
    ];
    for (const [actor, event] of attempts) {
      const f = instrument();
      await expect(gatewayAppendIdempotent(f.pool, { ...highRiskContext(target), actor }, event)).rejects.toThrow();
      expect(f.connections()).toBe(0);
    }
    expect((await state(target)).approval.consumed_at).toBeNull(); expect((await state(target)).events).toEqual([]);
  });
  it("binding mismatch, expired, pending and forged approvals never authorize an event", async () => {
    const target = await fixture();
    await expect(gatewayAppendIdempotent(gateway, highRiskContext(target), { ...target.highRisk, object: { type: "room", id: "SYN-OTHER" } })).rejects.toThrow("不符");
    await owner.query("UPDATE approvals SET snapshot=jsonb_set(snapshot,'{expires_at}',to_jsonb($2::text)) WHERE approval_id=$1", [target.approvalId, "2020-01-01T00:00:00.000Z"]);
    await expect(gatewayAppendIdempotent(gateway, highRiskContext(target), target.highRisk)).rejects.toThrow("已过期");
    await owner.query("UPDATE approvals SET status='pending' WHERE approval_id=$1", [target.approvalId]);
    await expect(gatewayAppendIdempotent(gateway, highRiskContext(target), target.highRisk)).rejects.toThrow("非 approved");
    await expect(gatewayAppendIdempotent(gateway, { ...highRiskContext(target), approvalRef: "synthetic-forged" }, target.highRisk)).rejects.toThrow("不存在");
    expect((await state(target)).approval.consumed_at).toBeNull(); expect((await state(target)).events).toEqual([]);
  });
  it("PII is masked before authorization/event insertion and the complete workspace hash chain recomputes", async () => {
    const target = await fixture();
    const result = await gatewayAppendIdempotent(gateway, highRiskContext(target), { ...target.highRisk,
      decision: { ...target.highRisk.decision, after: { note: "联系 13812345678" } } });
    expect(result.piiHits).toBe(1);
    const actual = await state(target); expect(JSON.stringify(actual.events)).not.toContain("13812345678"); expect(JSON.stringify(actual.events)).toContain("[PII:PHONE:");
    const rows = (await owner.query("SELECT payload,prev_hash,hash FROM biz_events WHERE workspace_id=$1 ORDER BY seq", [target.scope.workspaceId])).rows;
    let previous = GENESIS_HASH;
    for (const row of rows) { expect(row.prev_hash).toBe(previous); expect(row.hash).toBe(eventHash(previous, row.payload)); previous = row.hash; }
  });
  it("the idempotent InTx primitive joins caller business writes and rolls them back with the event", async () => {
    const target = await fixture();
    await owner.query("INSERT INTO profiles(workspace_id,tenant_id,industry,archive,forbidden) VALUES($1,$2,'general','{}','[]')", [target.scope.workspaceId, target.scope.tenantId]);
    const primary = new Error("Synthetic caller failure after event");
    await expect(withScopedEventTransaction(gateway, target.scope, async client => {
      await client.query("UPDATE profiles SET archive='{\"synthetic\":true}' WHERE workspace_id=$1", [target.scope.workspaceId]);
      await appendEventIdempotentInTx(client, target.scope, target.replay);
      throw primary;
    })).rejects.toBe(primary);
    expect((await state(target)).events).toEqual([]);
    expect((await owner.query("SELECT archive FROM profiles WHERE workspace_id=$1", [target.scope.workspaceId])).rows[0].archive).toEqual({});
  });
});
