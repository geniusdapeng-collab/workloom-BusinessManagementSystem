import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gatewayAppend } from "../workdata/gateway.js";
import {
  batchApprove, decide, expireSweep, listQueue, registerApprovalTransactionProjection,
  type ApprovalRow,
} from "./approvals.js";

const adminUrl = process.env.BMS_PG_TEST_URL
  ?? (process.env.RUN_DB_TESTS === "1" ? process.env.DATABASE_URL : undefined);
const actor = { memberNo: "MEM-APPROVAL-OWNER", role: "owner" as const };

it("approval pool connection failure propagates before a transaction is acquired", async () => {
  const failure = new Error("Synthetic approval connection failure");
  const pool = { connect: async () => { throw failure; } } as unknown as pg.Pool;
  await expect(listQueue(pool, { tenantId: "unused", workspaceId: "unused" })).rejects.toBe(failure);
});

describe.runIf(Boolean(adminUrl))("Approval completion and cross-channel decisions on disposable PostgreSQL", () => {
  const database = `bms_approval_${randomUUID().replaceAll("-", "")}`;
  const projectionKind = `test.approval-${randomUUID()}`;
  const action = `test.approval.${randomUUID()}`;
  let admin: pg.Client, owner: pg.Pool, app: pg.Pool, gateway: pg.Pool;
  let unregister: (() => void) | undefined;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Disposable approval tests require loopback PostgreSQL");
    admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    url.pathname = `/${database}`;
    owner = new pg.Pool({ connectionString: url.href, max: 8 });
    const connection = await owner.connect();
    try {
      await connection.query("BEGIN");
      const migrations = new URL("../../db/migrations/", import.meta.url).pathname;
      for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
        await connection.query(readFileSync(join(migrations, file), "utf8"));
      }
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally { connection.release(); }
    url.username = "workloom_app"; url.password = process.env.APP_DB_PASSWORD ?? "workloom_dev_app";
    app = new pg.Pool({ connectionString: url.href, max: 12, statement_timeout: 5000, connectionTimeoutMillis: 5000 });
    url.username = "workloom_gateway"; url.password = process.env.GATEWAY_DB_PASSWORD ?? "workloom_dev_gateway";
    gateway = new pg.Pool({ connectionString: url.href, max: 8 });
    unregister = registerApprovalTransactionProjection(projectionKind, [action], async (client, input) => {
      await client.query(`UPDATE profiles SET archive=jsonb_set(jsonb_set(archive, '{decisionCount}',
        to_jsonb(COALESCE((archive->>'decisionCount')::int,0)+1)), '{decisionStatus}', to_jsonb($2::text))
        WHERE workspace_id=$1`, [input.scope.workspaceId, input.status]);
    });
  }, 30000);
  afterAll(async () => {
    unregister?.();
    const closed = await Promise.allSettled([app?.end(), gateway?.end(), owner?.end()]);
    const errors = closed.filter(result => result.status === "rejected");
    if (admin) {
      try { await admin.query(`DROP DATABASE IF EXISTS ${database}`); }
      finally { await admin.end(); }
    }
    expect(errors).toEqual([]);
  });

  async function fixture(channels = ["inapp"], snapshot: Record<string, unknown> = {}) {
    const suffix = randomUUID();
    const scope = { tenantId: `tenant-${suffix}`, workspaceId: `workspace-${suffix}` };
    await owner.query("INSERT INTO tenants(id,name,plan) VALUES($1,'approval regression','pro')", [scope.tenantId]);
    await owner.query("INSERT INTO workspaces(id,tenant_id,name,slug,industry,is_example) VALUES($1,$2,'approval regression',$1,'general',true)", [scope.workspaceId, scope.tenantId]);
    await owner.query("INSERT INTO profiles(workspace_id,tenant_id,industry,archive,forbidden) VALUES($1,$2,'general','{\"decisionCount\":0}','[]')", [scope.workspaceId, scope.tenantId]);
    const source = await gatewayAppend(gateway, { ...scope, actor: { id: actor.memberNo, type: "human" } }, {
      who: { type: "human", id: actor.memberNo },
      context: { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, time: new Date().toISOString() },
      object: { type: "review", id: `review-${suffix}` },
      decision: { action, kind: "review", after: { synthetic: true } }, rule_impact: [],
    });
    const ids: string[] = [];
    for (const channel of channels) {
      const id = `approval-${channel}-${suffix}`;
      ids.push(id);
      await owner.query(`INSERT INTO approvals(approval_id,tenant_id,workspace_id,event_id,channel,status,snapshot)
        VALUES($1,$2,$3,$4,$5,'pending',$6)`, [id, scope.tenantId, scope.workspaceId, source.eventId, channel,
        JSON.stringify({ projection: { kind: projectionKind }, ...snapshot })]);
    }
    return { scope, ids, eventId: source.eventId };
  }
  async function state(target: Awaited<ReturnType<typeof fixture>>) {
    const rows = (await owner.query<ApprovalRow>("SELECT * FROM approvals WHERE workspace_id=$1 ORDER BY channel", [target.scope.workspaceId])).rows;
    const profile = (await owner.query("SELECT archive FROM profiles WHERE workspace_id=$1", [target.scope.workspaceId])).rows[0].archive;
    const events = (await owner.query(`SELECT count(*)::int AS n FROM biz_events WHERE workspace_id=$1
      AND payload->'decision'->>'action'='approval.gesture'`, [target.scope.workspaceId])).rows[0].n as number;
    return { rows, profile, events };
  }
  function inject(fault: { before?: (sql: string) => void | Promise<void>; after?: (sql: string) => void | Promise<void> }) {
    const statements: string[] = [];
    const releases: Array<Error | undefined> = [];
    const pool = { connect: async () => {
      const connection = await app.connect();
      return {
        query: async (sql: string, params?: unknown[]) => {
          statements.push(sql);
          await fault.before?.(sql);
          const result = await connection.query(sql, params);
          await fault.after?.(sql);
          return result;
        },
        release: (error?: Error) => { releases.push(error); connection.release(error); },
      };
    } } as unknown as pg.Pool;
    return { pool, statements, releases };
  }
  function concurrentStart(parties: number) {
    let arrived = 0;
    let open!: () => void;
    const ready = new Promise<void>(resolve => { open = resolve; });
    return async (sql: string) => {
      if (sql.startsWith("SELECT event_id FROM approvals")) {
        arrived++;
        if (arrived === parties) open();
        await ready;
      }
    };
  }
  function pausePendingRead() {
    let selected!: () => void, resume!: () => void;
    const selectedPromise = new Promise<void>(resolve => { selected = resolve; });
    const ready = new Promise<void>(resolve => { resume = resolve; });
    let paused = false;
    const fault = inject({ after: async sql => {
      if (!paused && sql.includes("SELECT * FROM approvals WHERE workspace_id=$1 AND status='pending'")) {
        paused = true; selected(); await ready;
      }
    } });
    return { ...fault, selected: selectedPromise, resume };
  }

  it("a completed decision commits every channel, one projection and one gesture event", async () => {
    const target = await fixture(["inapp", "dingtalk"]);
    const result = await decide(app, gateway, target.scope, actor, target.ids[0]!, { type: "approve" });
    expect(result).toMatchObject({ status: "approved", deduped: false });
    const actual = await state(target);
    expect(actual.rows.map(row => row.status)).toEqual(["approved", "approved"]);
    expect(actual.rows.every(row => row.decided_by === actor.memberNo && row.gesture?.type === "approve" && row.decided_at)).toBe(true);
    expect(actual.profile).toEqual({ decisionCount: 1, decisionStatus: "approved" });
    expect(actual.events).toBe(1);
  });
  it("a real approval write followed by acknowledgement and rollback failures preserves both errors and destroys the connection", async () => {
    const target = await fixture();
    const primary = new Error("Synthetic approval write acknowledgement failure");
    const rollback = new Error("Synthetic approval rollback failure");
    const fault = inject({ before: sql => { if (sql === "ROLLBACK") throw rollback; },
      after: sql => { if (/UPDATE approvals\s+SET status=\$2/.test(sql)) throw primary; } });
    const error = await decide(fault.pool, gateway, target.scope, actor, target.ids[0]!, { type: "approve" }).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([primary, rollback]); expect(error.cause).toBe(primary);
    expect(fault.releases).toEqual([error]); expect(fault.statements).not.toContain("COMMIT");
    expect((await state(target)).rows[0]!.status).toBe("pending");
    expect((await state(target)).profile).toEqual({ decisionCount: 0 });
  });
  it("an approval projection failure rolls back status, business projection and gesture without discarding a recovered connection", async () => {
    const target = await fixture();
    const primary = new Error("Synthetic projection write acknowledgement failure");
    const fault = inject({ after: sql => { if (sql.startsWith("UPDATE profiles SET archive")) throw primary; } });
    await expect(decide(fault.pool, gateway, target.scope, actor, target.ids[0]!, { type: "approve" })).rejects.toBe(primary);
    expect(fault.statements.at(-1)).toBe("ROLLBACK"); expect(fault.statements).not.toContain("COMMIT");
    expect(fault.releases).toEqual([undefined]);
    const actual = await state(target);
    expect(actual.rows[0]!.status).toBe("pending"); expect(actual.profile).toEqual({ decisionCount: 0 }); expect(actual.events).toBe(0);
  });
  it("pre-COMMIT transport failure rejects, rolls back all writes and discards the uncertain connection", async () => {
    const target = await fixture();
    const primary = new Error("Synthetic COMMIT transport failure");
    const fault = inject({ before: sql => { if (sql === "COMMIT") throw primary; } });
    await expect(decide(fault.pool, gateway, target.scope, actor, target.ids[0]!, { type: "approve" })).rejects.toBe(primary);
    expect(fault.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]); expect(fault.releases).toEqual([primary]);
    const actual = await state(target);
    expect(actual.rows[0]!.status).toBe("pending"); expect(actual.events).toBe(0); expect(actual.profile).toEqual({ decisionCount: 0 });
  });
  it("lost COMMIT acknowledgement rejects an uncertain outcome and retry reads the committed decision without repeating side effects", async () => {
    const target = await fixture();
    const primary = new Error("Synthetic lost COMMIT acknowledgement");
    const fault = inject({ after: sql => { if (sql === "COMMIT") throw primary; } });
    await expect(decide(fault.pool, gateway, target.scope, actor, target.ids[0]!, { type: "approve" })).rejects.toBe(primary);
    expect(fault.releases).toEqual([primary]);
    expect(await decide(app, gateway, target.scope, actor, target.ids[0]!, { type: "approve" })).toMatchObject({ status: "approved", deduped: true });
    const actual = await state(target); expect(actual.profile.decisionCount).toBe(1); expect(actual.events).toBe(1);
  });
  it("COMMIT and rollback failures preserve both causes after only one COMMIT attempt", async () => {
    const target = await fixture();
    const primary = new Error("Synthetic COMMIT failure"); const rollback = new Error("Synthetic rollback failure");
    const fault = inject({ before: sql => { if (sql === "COMMIT") throw primary; if (sql === "ROLLBACK") throw rollback; } });
    const error = await decide(fault.pool, gateway, target.scope, actor, target.ids[0]!, { type: "approve" }).catch(error => error);
    expect(error.errors).toEqual([primary, rollback]); expect(error.cause).toBe(primary);
    expect(fault.statements.filter(sql => sql === "COMMIT")).toHaveLength(1); expect(fault.releases).toEqual([error]);
    expect((await state(target)).rows[0]!.status).toBe("pending");
  });
  it("BEGIN failure propagates and releases the connection once with a discard reason", async () => {
    const target = await fixture(); const primary = new Error("Synthetic BEGIN transport failure");
    const fault = inject({ before: sql => { if (sql === "BEGIN") throw primary; } });
    await expect(listQueue(fault.pool, target.scope)).rejects.toBe(primary);
    expect(fault.statements).toEqual(["BEGIN", "ROLLBACK"]); expect(fault.releases).toEqual([primary]);
  });
  it("RLS context failure rolls back before any approval access and restores the connection", async () => {
    const target = await fixture(); const primary = new Error("Synthetic RLS context acknowledgement failure");
    const fault = inject({ after: sql => { if (sql.includes("set_config('app.tenant_id'")) throw primary; } });
    await expect(listQueue(fault.pool, target.scope)).rejects.toBe(primary);
    expect(fault.statements.at(-1)).toBe("ROLLBACK"); expect(fault.statements.some(sql => sql.includes("FROM approvals"))).toBe(false);
    expect(fault.releases).toEqual([undefined]);
  });
  it("simultaneous inapp and dingtalk calls have no deadlock and only one business decision", async () => {
    const target = await fixture(["inapp", "dingtalk"]);
    const fault = inject({ before: concurrentStart(2) });
    const results = await Promise.all(target.ids.map(id => decide(fault.pool, gateway, target.scope, actor, id, { type: "approve" })));
    expect(results.filter(result => !result.deduped)).toHaveLength(1); expect(results.every(result => result.status === "approved")).toBe(true);
    const actual = await state(target);
    expect(actual.rows.every(row => row.status === "approved")).toBe(true); expect(actual.profile.decisionCount).toBe(1); expect(actual.events).toBe(1);
  });
  it("five channels and repeated concurrent callbacks share one terminal projection and event", async () => {
    const target = await fixture(["inapp", "dingtalk", "wecom", "feishu", "slack"]);
    const fault = inject({ before: concurrentStart(10) });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => decide(fault.pool, gateway, target.scope, actor,
      target.ids[i % 5]!, { type: "approve" })));
    expect(results.filter(result => !result.deduped)).toHaveLength(1);
    const actual = await state(target);
    expect(actual.rows).toHaveLength(5); expect(actual.rows.every(row => row.status === "approved")).toBe(true);
    expect(actual.profile.decisionCount).toBe(1); expect(actual.events).toBe(1);
  });
  it("concurrent competing gestures retain the first committed decision on every channel", async () => {
    const target = await fixture(["inapp", "wecom"]); const fault = inject({ before: concurrentStart(2) });
    const results = await Promise.all([
      decide(fault.pool, gateway, target.scope, actor, target.ids[0]!, { type: "approve" }),
      decide(fault.pool, gateway, target.scope, actor, target.ids[1]!, { type: "edit", editedAfter: { synthetic: "revised" } }),
    ]);
    const winner = results.find(result => !result.deduped)!;
    expect(results.filter(result => !result.deduped)).toHaveLength(1); expect(results.every(result => result.status === winner.status)).toBe(true);
    const actual = await state(target); expect(actual.rows.every(row => row.status === winner.status)).toBe(true);
    expect(actual.profile).toEqual({ decisionCount: 1, decisionStatus: winner.status }); expect(actual.events).toBe(1);
  });
  it("an old terminal sibling repairs a pending queue row with decision metadata and no duplicate event", async () => {
    const target = await fixture(["inapp", "dingtalk"]);
    await owner.query("UPDATE approvals SET status='approved',gesture='{\"type\":\"approve\",\"weight\":1}',decided_by=$2,decided_at=now() WHERE approval_id=$1", [target.ids[0], actor.memberNo]);
    const result = await decide(app, gateway, target.scope, actor, target.ids[1]!, { type: "approve" });
    expect(result).toMatchObject({ status: "approved", deduped: true });
    const actual = await state(target);
    expect(actual.rows.every(row => row.status === "approved" && row.decided_by === actor.memberNo && row.gesture?.type === "approve")).toBe(true);
    expect(actual.events).toBe(0); expect(actual.profile.decisionCount).toBe(0);
    expect(await listQueue(app, target.scope, { status: "pending" })).toEqual([]);
  });
  it("retrying the already terminal channel also repairs pending siblings", async () => {
    const target = await fixture(["inapp", "dingtalk"]);
    await owner.query("UPDATE approvals SET status='edited',gesture='{\"type\":\"edit\",\"weight\":2}',decided_by=$2,decided_at=now() WHERE approval_id=$1", [target.ids[0], actor.memberNo]);
    expect(await decide(app, gateway, target.scope, actor, target.ids[0]!, { type: "approve" })).toMatchObject({ status: "edited", deduped: true });
    expect((await state(target)).rows.every(row => row.status === "edited")).toBe(true);
  });
  it("expired requested snapshots expire all pending channels without approving or running a business projection", async () => {
    const target = await fixture(["inapp", "dingtalk"], { expires_at: new Date(Date.now() - 60000).toISOString() });
    await expect(decide(app, gateway, target.scope, actor, target.ids[0]!, { type: "approve" })).rejects.toMatchObject({ code: "EXPIRED" });
    const actual = await state(target); expect(actual.rows.every(row => row.status === "expired")).toBe(true);
    expect(actual.events).toBe(0); expect(actual.profile.decisionCount).toBe(0);
  });
  it("foreign workspace or tenant cannot acquire or mirror another scope's approvals", async () => {
    const target = await fixture(["inapp", "dingtalk"]); const other = await fixture();
    await expect(decide(app, gateway, other.scope, actor, target.ids[0]!, { type: "approve" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(decide(app, gateway, { ...target.scope, tenantId: other.scope.tenantId }, actor, target.ids[0]!, { type: "approve" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await state(target)).rows.every(row => row.status === "pending")).toBe(true);
    expect((await state(other)).rows[0]!.status).toBe("pending");
  });
  it("readonly and high-risk batch guards still leave every channel pending", async () => {
    const target = await fixture(["inapp", "dingtalk"], { high_risk: true });
    await expect(decide(app, gateway, target.scope, { ...actor, role: "readonly" }, target.ids[0]!, { type: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    const batch = await batchApprove(app, gateway, target.scope, actor, target.ids);
    expect(batch.approved).toEqual([]); expect(batch.skipped).toHaveLength(2);
    expect((await state(target)).rows.every(row => row.status === "pending")).toBe(true);
  });
  it("a sweeper's stale pending read cannot overwrite an owner decision committed before expiry", async () => {
    const expiry = Date.now() + 1000;
    const target = await fixture(["inapp", "dingtalk"], { expires_at: new Date(expiry).toISOString() });
    const paused = pausePendingRead();
    const sweep = expireSweep(paused.pool, gateway, target.scope);
    try {
      await paused.selected;
      expect(Date.now()).toBeLessThan(expiry);
      await decide(app, gateway, target.scope, actor, target.ids[0]!, { type: "approve" });
      expect(Date.now()).toBeLessThan(expiry);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry - Date.now()) + 20));
    } finally { paused.resume(); }
    expect(await sweep).toEqual({ expired: [], keptHighRisk: [] });
    const actual = await state(target); expect(actual.rows.every(row => row.status === "approved")).toBe(true);
    expect(actual.events).toBe(1);
    expect((await owner.query("SELECT count(*)::int AS n FROM biz_events WHERE workspace_id=$1 AND payload->'decision'->>'action'='approval.expired'", [target.scope.workspaceId])).rows[0].n).toBe(0);
  }, 10000);
  it("concurrent sweepers expire every channel but commit only one expiry event", async () => {
    const target = await fixture(["inapp", "dingtalk", "wecom"], { expires_at: new Date(Date.now() - 60000).toISOString() });
    const fault = inject({ before: concurrentStart(2) });
    const results = await Promise.all([expireSweep(fault.pool, gateway, target.scope), expireSweep(fault.pool, gateway, target.scope)]);
    expect(results.flatMap(result => result.expired).sort()).toEqual([...target.ids].sort());
    const actual = await state(target); expect(actual.rows.every(row => row.status === "expired")).toBe(true);
    expect(actual.events).toBe(0); expect(actual.profile.decisionCount).toBe(0);
    const events = (await owner.query("SELECT payload FROM biz_events WHERE workspace_id=$1 AND payload->'decision'->>'action'='approval.expired'", [target.scope.workspaceId])).rows;
    expect(events).toHaveLength(1);
    expect([...events[0]!.payload.decision.after.approval_ids].sort()).toEqual([...target.ids].sort());
  });
  it("a changed expiry deadline is re-read inside the locked transaction", async () => {
    const target = await fixture(["inapp"], { expires_at: new Date(Date.now() - 60000).toISOString() });
    const paused = pausePendingRead(); const sweep = expireSweep(paused.pool, gateway, target.scope);
    try {
      await paused.selected;
      await owner.query("UPDATE approvals SET snapshot=jsonb_set(snapshot,'{expires_at}',$2::jsonb) WHERE approval_id=$1", [target.ids[0], JSON.stringify(new Date(Date.now() + 60000).toISOString())]);
    } finally { paused.resume(); }
    expect(await sweep).toEqual({ expired: [], keptHighRisk: [] });
    expect((await state(target)).rows[0]!.status).toBe("pending");
  });
  it("a newly elevated chairman tier protects all channels despite a stale low-risk snapshot", async () => {
    const target = await fixture(["inapp", "dingtalk"], { expires_at: new Date(Date.now() - 60000).toISOString() });
    const paused = pausePendingRead(); const sweep = expireSweep(paused.pool, gateway, target.scope);
    try {
      await paused.selected;
      await owner.query("UPDATE approvals SET tier='l4_chairman' WHERE approval_id=$1", [target.ids[1]]);
    } finally { paused.resume(); }
    const result = await sweep; expect(result.expired).toEqual([]); expect(result.keptHighRisk.sort()).toEqual([...target.ids].sort());
    expect((await state(target)).rows.every(row => row.status === "pending")).toBe(true);
  });
  it("expiry event failure rolls back all channel status changes", async () => {
    const target = await fixture(["inapp", "dingtalk"], { expires_at: new Date(Date.now() - 60000).toISOString() });
    const primary = new Error("Synthetic expiry event acknowledgement failure");
    const fault = inject({ after: sql => { if (sql.includes("append_event_insert")) throw primary; } });
    await expect(expireSweep(fault.pool, gateway, target.scope)).rejects.toBe(primary);
    expect((await state(target)).rows.every(row => row.status === "pending")).toBe(true);
    expect((await owner.query("SELECT count(*)::int AS n FROM biz_events WHERE workspace_id=$1 AND payload->'decision'->>'action'='approval.expired'", [target.scope.workspaceId])).rows[0].n).toBe(0);
  });
  it("unparseable or absent deadlines remain pending without expiry events", async () => {
    const invalid = await fixture(["inapp"], { expires_at: "invalid-synthetic-date" });
    const absent = await fixture();
    expect(await expireSweep(app, gateway, invalid.scope)).toEqual({ expired: [], keptHighRisk: [] });
    expect(await expireSweep(app, gateway, absent.scope)).toEqual({ expired: [], keptHighRisk: [] });
    expect((await state(invalid)).rows[0]!.status).toBe("pending");
    expect((await state(absent)).rows[0]!.status).toBe("pending");
  });
});
