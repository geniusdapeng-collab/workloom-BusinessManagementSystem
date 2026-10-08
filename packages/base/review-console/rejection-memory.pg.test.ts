import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVOLUTION_MIN_SIGNAL_SAMPLES } from "@workloom/shared";
import { gatewayAppend, gatewayAppendOnClient } from "../workdata/gateway.js";
import { getMemorySources, MockEmbedder, scopedMemoryId, searchMemories, upsertMemory } from "../workdata/memory.js";
import { runMemoryMinerBeat } from "../evolve/memory-miner.js";
import { decide } from "./approvals.js";

const adminUrl = process.env.BMS_PG_TEST_URL
  ?? (process.env.RUN_DB_TESTS === "1" ? process.env.DATABASE_URL : undefined);
const actor = { memberNo: "MEM-MEMORY-OWNER", role: "owner" as const };
const logicalAction = "test.memory.same-action";
const sharedReason = "fixture.shared_rejection";
type Scope = { tenantId: string; workspaceId: string };

describe("Feedback memory identity", () => {
  const scope = { tenantId: "tenant-a", workspaceId: "workspace-a" };
  it("repeated same-scope feedback has a stable bounded identifier", () => {
    const key = "租户反馈 🔒\n".repeat(1000);
    expect(scopedMemoryId(scope, "mem-reject", key)).toBe(scopedMemoryId(scope, "mem-reject", key));
    expect(scopedMemoryId(scope, "mem-reject", key)).toMatch(/^mem-reject-[a-f0-9]{64}$/);
  });
  it("tenant, workspace, namespace and logical key each change the identifier", () => {
    const values = [
      scopedMemoryId(scope, "mem-reject", "same"),
      scopedMemoryId({ ...scope, tenantId: "tenant-b" }, "mem-reject", "same"),
      scopedMemoryId({ ...scope, workspaceId: "workspace-b" }, "mem-reject", "same"),
      scopedMemoryId(scope, "mem-pat-edit", "same"),
      scopedMemoryId(scope, "mem-reject", "different"),
    ];
    expect(new Set(values).size).toBe(values.length);
  });
  it("ambiguous delimiter strings cannot collide across structured scope and keys", () => {
    expect(scopedMemoryId({ tenantId: "a:b", workspaceId: "c" }, "mem-reject", "d"))
      .not.toBe(scopedMemoryId({ tenantId: "a", workspaceId: "b:c" }, "mem-reject", "d"));
    expect(scopedMemoryId({ tenantId: "a", workspaceId: "b" }, "mem-reject", "c:d"))
      .not.toBe(scopedMemoryId({ tenantId: "a", workspaceId: "b:c" }, "mem-reject", "d"));
  });
});

describe.runIf(Boolean(adminUrl))("Scoped approval feedback and miner identity on disposable PostgreSQL", () => {
  const database = `bms_rejection_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Client, owner: pg.Pool, app: pg.Pool, gateway: pg.Pool;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Disposable feedback tests require loopback PostgreSQL");
    admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await admin.connect(); await admin.query(`CREATE DATABASE ${database}`);
    url.pathname = `/${database}`;
    owner = new pg.Pool({ connectionString: url.href });
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      const migrations = new URL("../../db/migrations/", import.meta.url).pathname;
      for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
        await client.query(readFileSync(join(migrations, file), "utf8"));
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    url.username = "workloom_app"; url.password = process.env.APP_DB_PASSWORD ?? "workloom_dev_app";
    app = new pg.Pool({ connectionString: url.href, max: 8, statement_timeout: 5000 });
    url.username = "workloom_gateway"; url.password = process.env.GATEWAY_DB_PASSWORD ?? "workloom_dev_gateway";
    gateway = new pg.Pool({ connectionString: url.href, max: 8 });
  }, 30000);
  afterAll(async () => {
    const closed = await Promise.allSettled([app?.end(), gateway?.end(), owner?.end()]);
    if (admin) {
      try { await admin.query(`DROP DATABASE IF EXISTS ${database}`); }
      finally { await admin.end(); }
    }
    expect(closed.filter(result => result.status === "rejected")).toEqual([]);
  });
  async function workspace(tenantId = `tenant-${randomUUID()}`): Promise<Scope> {
    const workspaceId = `workspace-${randomUUID()}`;
    await owner.query("INSERT INTO tenants(id,name,plan) VALUES($1,'feedback regression','pro') ON CONFLICT(id) DO NOTHING", [tenantId]);
    await owner.query("INSERT INTO workspaces(id,tenant_id,name,slug,industry,is_example) VALUES($1,$2,'feedback regression',$1,'general',true)", [workspaceId, tenantId]);
    return { tenantId, workspaceId };
  }
  async function pending(scope: Scope) {
    const id = randomUUID();
    const source = await gatewayAppend(gateway, { ...scope, actor: { id: actor.memberNo, type: "human" } }, {
      who: { type: "human", id: actor.memberNo },
      context: { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, time: new Date().toISOString() },
      object: { type: "review", id: `review-${id}` }, decision: { action: logicalAction, kind: "review" }, rule_impact: [],
    });
    const approvalId = `approval-${id}`;
    await owner.query("INSERT INTO approvals(approval_id,tenant_id,workspace_id,event_id,channel,status,snapshot) VALUES($1,$2,$3,$4,'inapp','pending','{}')", [approvalId, scope.tenantId, scope.workspaceId, source.eventId]);
    return approvalId;
  }
  async function reject(scope: Scope, reason = sharedReason) {
    return decide(app, gateway, scope, actor, await pending(scope), { type: "reject", reasonEnum: reason });
  }
  async function seedMinerSignals(scope: Scope) {
    const source = await gatewayAppend(gateway, { ...scope, actor: { id: actor.memberNo, type: "human" } }, {
      who: { type: "human", id: actor.memberNo },
      context: { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, time: new Date().toISOString() },
      object: { type: "review", id: `review-${randomUUID()}` }, decision: { action: logicalAction, kind: "review" }, rule_impact: [],
    });
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [scope.tenantId]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [scope.workspaceId]);
      for (let i = 0; i < EVOLUTION_MIN_SIGNAL_SAMPLES; i++) {
        const gesture = i % 2 === 0 ? "reject" : "edit";
        await gatewayAppendOnClient(client, { ...scope, actor: { id: actor.memberNo, type: "human" } }, {
          who: { type: "human", id: actor.memberNo },
          context: { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, time: new Date().toISOString() },
          object: { type: "review", id: source.eventId },
          decision: { action: "approval.gesture", after: { gesture, weight: gesture === "reject" ? 3 : 2,
            ...(gesture === "reject" ? { reason_enum: sharedReason } : { edit_kind: "preference", edited_after: { synthetic: true } }) } },
          rule_impact: [], links: [source.eventId],
        });
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  it("two tenants can reject for the same reason while retaining isolated memories, gesture events and sources", async () => {
    const first = await workspace(), second = await workspace();
    const results = [await reject(first), await reject(second)];
    expect(results.every(result => result.status === "rejected" && !result.deduped)).toBe(true);
    const firstId = scopedMemoryId(first, "mem-reject", sharedReason), secondId = scopedMemoryId(second, "mem-reject", sharedReason);
    expect(firstId).not.toBe(secondId);
    for (const [scope, id, result] of [[first, firstId, results[0]], [second, secondId, results[1]]] as const) {
      const sources = await getMemorySources(app, scope, id);
      expect(sources.memory?.kind).toBe("preference"); expect(sources.memory?.source_events).toEqual([result!.gestureEventId]);
      expect(sources.usedBy).toEqual([result!.gestureEventId]);
      expect(sources.sourceEvents.every(event => event.context.tenant_id === scope.tenantId && event.context.workspace_id === scope.workspaceId)).toBe(true);
    }
    expect((await getMemorySources(app, first, secondId)).memory).toBeNull();
    expect((await getMemorySources(app, second, firstId)).memory).toBeNull();
  });
  it("two workspaces of the same tenant retain distinct keys and app-role searches", async () => {
    const first = await workspace(), second = await workspace(first.tenantId);
    await reject(first); await reject(second);
    const memories = await Promise.all([searchMemories(app, first, {}), searchMemories(app, second, {})]);
    expect(memories[0]!.map(row => row.memory_id)).toEqual([scopedMemoryId(first, "mem-reject", sharedReason)]);
    expect(memories[1]!.map(row => row.memory_id)).toEqual([scopedMemoryId(second, "mem-reject", sharedReason)]);
  });
  it("repeated same-scope rejections reuse one memory and retain each usage trace", async () => {
    const scope = await workspace(); const results = [await reject(scope), await reject(scope), await reject(scope)];
    expect((await searchMemories(app, scope, {}))).toHaveLength(1);
    const sources = await getMemorySources(app, scope, scopedMemoryId(scope, "mem-reject", sharedReason));
    expect(sources.memory!.source_events).toEqual([results[2]!.gestureEventId]);
    expect([...sources.usedBy].sort()).toEqual(results.map(result => result.gestureEventId!).sort());
  });
  it("concurrent different approvals for one scoped reason do not conflict or create multiple memories", async () => {
    const scope = await workspace(); const ids = await Promise.all(Array.from({ length: 6 }, () => pending(scope)));
    const results = await Promise.all(ids.map(id => decide(app, gateway, scope, actor, id, { type: "reject", reasonEnum: sharedReason })));
    expect(results.every(result => result.status === "rejected" && !result.deduped)).toBe(true);
    expect((await searchMemories(app, scope, {}))).toHaveLength(1);
    expect((await getMemorySources(app, scope, scopedMemoryId(scope, "mem-reject", sharedReason))).usedBy).toHaveLength(6);
  });
  it("miner reinforces the exact approval key and creates isolated edit keys in two tenants", async () => {
    const first = await workspace(), second = await workspace();
    for (const scope of [first, second]) {
      await reject(scope); await seedMinerSignals(scope);
      const result = await runMemoryMinerBeat(app, gateway, scope);
      expect(result.reinforced).toBe(1); expect(result.editPatterns).toBe(1); expect(result.calibrateEventIds).toHaveLength(2);
      const rejection = await getMemorySources(app, scope, scopedMemoryId(scope, "mem-reject", sharedReason));
      const edited = await getMemorySources(app, scope, scopedMemoryId(scope, "mem-pat-edit", logicalAction));
      expect(rejection.memory!.content).toContain("提炼器强化"); expect(rejection.sourceEvents.length).toBeGreaterThanOrEqual(10);
      expect(edited.memory!.kind).toBe("pattern"); expect(edited.sourceEvents).toHaveLength(10);
      expect([...rejection.sourceEvents, ...edited.sourceEvents].every(event => event.context.workspace_id === scope.workspaceId && event.context.tenant_id === scope.tenantId)).toBe(true);
      expect(await searchMemories(app, scope, {})).toHaveLength(2);
    }
    expect((await getMemorySources(app, first, scopedMemoryId(second, "mem-pat-edit", logicalAction))).memory).toBeNull();
  });
  it("legacy global keys remain untouched while new scoped rejections cannot collide with them", async () => {
    const legacy = await workspace(), scope = await workspace();
    const legacyId = `mem-reject-${sharedReason}`;
    await upsertMemory(app, legacy, { memoryId: legacyId, scope: "workspace", kind: "preference", content: "Legacy synthetic record", sourceEvents: [] }, new MockEmbedder());
    expect((await reject(scope)).status).toBe("rejected");
    expect((await getMemorySources(app, legacy, legacyId)).memory!.content).toBe("Legacy synthetic record");
    expect((await getMemorySources(app, scope, legacyId)).memory).toBeNull();
    expect((await getMemorySources(app, scope, scopedMemoryId(scope, "mem-reject", sharedReason))).memory).not.toBeNull();
  });
  it("embedding failure rolls back the rejected status, gesture event, memory and usage", async () => {
    const scope = await workspace(), id = await pending(scope); const failure = new Error("Synthetic feedback embedding failure");
    await expect(decide(app, gateway, scope, actor, id, { type: "reject", reasonEnum: sharedReason }, { embed: async () => { throw failure; } })).rejects.toBe(failure);
    expect((await owner.query("SELECT status FROM approvals WHERE approval_id=$1", [id])).rows[0].status).toBe("pending");
    expect(await searchMemories(app, scope, {})).toEqual([]);
    expect((await owner.query("SELECT count(*)::int AS n FROM biz_events WHERE workspace_id=$1 AND payload->'decision'->>'action'='approval.gesture'", [scope.workspaceId])).rows[0].n).toBe(0);
    expect((await owner.query("SELECT count(*)::int AS n FROM memory_usage WHERE workspace_id=$1", [scope.workspaceId])).rows[0].n).toBe(0);
  });
});
