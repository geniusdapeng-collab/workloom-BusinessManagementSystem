import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVOLUTION_MIN_SIGNAL_SAMPLES } from "@workloom/shared";
import { gatewayAppend } from "./gateway.js";
import { MockEmbedder, scopedMemoryId, searchMemories, upsertMemory } from "./memory.js";
import { runMemoryMinerBeat } from "../evolve/memory-miner.js";

const adminUrl = process.env.BMS_PG_TEST_URL
  ?? (process.env.RUN_DB_TESTS === "1" ? process.env.DATABASE_URL : undefined);
const entries = ["upsertMemory", "runMemoryMinerBeat"] as const;
type Entry = typeof entries[number];
type Scope = { tenantId: string; workspaceId: string };
const reason = "fixture.transaction_failure";

it.each(entries)("%s connection acquisition failure propagates without attempting a transaction", async entry => {
  const error = new Error("Synthetic memory connection failure");
  const pool = { connect: async () => { throw error; } } as unknown as pg.Pool;
  const scope = { tenantId: "unused", workspaceId: "unused" };
  const result = entry === "upsertMemory"
    ? upsertMemory(pool, scope, { memoryId: "unused", scope: "workspace", kind: "preference", content: "synthetic", sourceEvents: [] }, new MockEmbedder())
    : runMemoryMinerBeat(pool, pool, scope);
  await expect(result).rejects.toBe(error);
});

describe.runIf(Boolean(adminUrl))("Memory and miner transaction completion on disposable PostgreSQL", () => {
  const database = `bms_memory_tx_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Client, owner: pg.Pool, app: pg.Pool, gateway: pg.Pool;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Disposable memory tests require loopback PostgreSQL");
    admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await admin.connect(); await admin.query(`CREATE DATABASE ${database}`);
    url.pathname = `/${database}`; owner = new pg.Pool({ connectionString: url.href });
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
    app = new pg.Pool({ connectionString: url.href, max: 1, statement_timeout: 5000 });
    url.username = "workloom_gateway"; url.password = process.env.GATEWAY_DB_PASSWORD ?? "workloom_dev_gateway";
    gateway = new pg.Pool({ connectionString: url.href, max: 2 });
  }, 30000);
  afterAll(async () => {
    const closed = await Promise.allSettled([app?.end(), gateway?.end(), owner?.end()]);
    if (admin) {
      try { await admin.query(`DROP DATABASE IF EXISTS ${database}`); }
      finally { await admin.end(); }
    }
    expect(closed.filter(result => result.status === "rejected")).toEqual([]);
  });
  async function workspace(): Promise<Scope> {
    const suffix = randomUUID(); const scope = { tenantId: `tenant-${suffix}`, workspaceId: `workspace-${suffix}` };
    await owner.query("INSERT INTO tenants(id,name) VALUES($1,'memory transaction regression')", [scope.tenantId]);
    await owner.query("INSERT INTO workspaces(id,tenant_id,name,slug,industry,is_example) VALUES($1,$2,'memory transaction regression',$1,'general',true)", [scope.workspaceId, scope.tenantId]);
    return scope;
  }
  async function prepare(entry: Entry) {
    const scope = await workspace();
    if (entry === "runMemoryMinerBeat") {
      const source = await gatewayAppend(gateway, { ...scope, actor: { id: "MEM-TEST", type: "human" } }, {
        who: { type: "human", id: "MEM-TEST" },
        context: { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, time: new Date().toISOString() },
        object: { type: "review", id: `review-${randomUUID()}` }, decision: { action: "test.memory.transaction", kind: "review" }, rule_impact: [],
      });
      for (let i = 0; i < EVOLUTION_MIN_SIGNAL_SAMPLES; i++) {
        await gatewayAppend(gateway, { ...scope, actor: { id: "MEM-TEST", type: "human" } }, {
          who: { type: "human", id: "MEM-TEST" },
          context: { tenant_id: scope.tenantId, workspace_id: scope.workspaceId, time: new Date().toISOString() },
          object: { type: "review", id: source.eventId },
          decision: { action: "approval.gesture", after: { gesture: "reject", weight: 3, reason_enum: reason } },
          rule_impact: [], links: [source.eventId],
        });
      }
    }
    const memoryId = scopedMemoryId(scope, entry === "upsertMemory" ? "mem-test" : "mem-reject", entry === "upsertMemory" ? entry : reason);
    const call = (pool: pg.Pool) => entry === "upsertMemory"
      ? upsertMemory(pool, scope, { memoryId, scope: "workspace", kind: "preference", content: "Synthetic memory transaction", sourceEvents: [] }, new MockEmbedder())
      : runMemoryMinerBeat(pool, gateway, scope);
    const counts = async () => (await owner.query(`SELECT
      (SELECT count(*)::int FROM org_memory WHERE workspace_id=$1) AS memories,
      (SELECT count(*)::int FROM biz_events WHERE workspace_id=$1 AND payload->'decision'->>'action'='memory.calibrate') AS calibrations`, [scope.workspaceId])).rows[0] as { memories: number; calibrations: number };
    return { scope, memoryId, call, counts };
  }
  function inject(fault: { before?: (sql: string, client: pg.PoolClient) => void | Promise<void>; after?: (sql: string) => void | Promise<void> } = {}) {
    const statements: string[] = []; const releases: Array<Error | undefined> = []; let originalPid = 0;
    const pool = { connect: async () => {
      const connection = await app.connect();
      originalPid = (await connection.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      return {
        query: async (sql: string, params?: unknown[]) => {
          statements.push(sql); await fault.before?.(sql, connection);
          const result = await connection.query(sql, params); await fault.after?.(sql); return result;
        },
        release: (error?: Error) => { releases.push(error); connection.release(error); },
      };
    } } as unknown as pg.Pool;
    const inspect = async (discarded: boolean) => {
      const connection = await app.connect();
      try {
        const state = (await connection.query("SELECT pg_backend_pid() AS pid,current_setting('app.tenant_id',true) AS tenant,current_setting('app.workspace_id',true) AS workspace")).rows[0];
        expect(Boolean(state.tenant)).toBe(false); expect(Boolean(state.workspace)).toBe(false);
        expect(state.pid === originalPid).toBe(!discarded);
        const transaction = (await owner.query("SELECT state,xact_start IS NOT NULL AS transaction_open FROM pg_stat_activity WHERE pid=$1", [state.pid])).rows[0];
        expect(transaction.state).toBe("idle"); expect(transaction.transaction_open).toBe(false);
        expect((await connection.query("SELECT pg_try_advisory_xact_lock(761214) AS acquired")).rows[0].acquired).toBe(true);
      } finally { connection.release(); }
    };
    return { pool, statements, releases, inspect };
  }
  const primaryQuery = (entry: Entry, sql: string) => entry === "upsertMemory" ? sql.includes("INSERT INTO org_memory")
    : sql.includes("e.payload->'decision'->'after'->>'gesture' AS gesture");

  describe.each(entries)("%s", entry => {
    it("commits real data and releases a clean reusable connection", async () => {
      const target = await prepare(entry); const fault = inject();
      await target.call(fault.pool);
      expect(await target.counts()).toEqual({ memories: 1, calibrations: entry === "upsertMemory" ? 0 : 1 });
      expect(fault.statements.at(-1)).toBe("COMMIT"); expect(fault.releases).toEqual([undefined]);
      await fault.inspect(false);
    });
    it("actual SQL failure rolls back without COMMIT and cleans the recovered connection", async () => {
      const target = await prepare(entry); let injected = false;
      const fault = inject({ before: async (sql, client) => {
        if (!injected && primaryQuery(entry, sql)) { injected = true; await client.query("SELECT synthetic_missing_memory_column"); }
      } });
      await expect(target.call(fault.pool)).rejects.toMatchObject({ code: "42703" });
      expect(fault.statements).not.toContain("COMMIT"); expect(fault.statements.at(-1)).toBe("ROLLBACK");
      expect(await target.counts()).toEqual({ memories: 0, calibrations: 0 }); expect(fault.releases).toEqual([undefined]);
      await fault.inspect(false);
    });
    it("query acknowledgement and rollback failures retain both causes and discard leaked transaction state", async () => {
      const target = await prepare(entry); const primary = new Error("Synthetic query acknowledgement failure");
      const rollback = new Error("Synthetic rollback transport failure");
      const fault = inject({ before: sql => { if (sql === "ROLLBACK") throw rollback; }, after: sql => { if (primaryQuery(entry, sql)) throw primary; } });
      const error = await target.call(fault.pool).catch(error => error);
      expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([primary, rollback]); expect(error.cause).toBe(primary);
      expect(fault.releases).toEqual([error]); expect(fault.statements).not.toContain("COMMIT");
      await fault.inspect(true); expect(await target.counts()).toEqual({ memories: 0, calibrations: 0 });
    });
    it("pre-COMMIT failure rejects and rolls back real writes before discarding the uncertain connection", async () => {
      const target = await prepare(entry); const primary = new Error("Synthetic pre-COMMIT transport failure");
      const fault = inject({ before: sql => { if (sql === "COMMIT") throw primary; } });
      await expect(target.call(fault.pool)).rejects.toBe(primary);
      expect(fault.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]); expect(fault.releases).toEqual([primary]);
      await fault.inspect(true); expect(await target.counts()).toEqual({ memories: 0, calibrations: 0 });
    });
    it("lost acknowledgement after server COMMIT rejects the uncertain result while preserving already committed data", async () => {
      const target = await prepare(entry); const primary = new Error("Synthetic lost COMMIT acknowledgement");
      const fault = inject({ after: sql => { if (sql === "COMMIT") throw primary; } });
      await expect(target.call(fault.pool)).rejects.toBe(primary); expect(fault.releases).toEqual([primary]);
      await fault.inspect(true);
      expect(await target.counts()).toEqual({ memories: 1, calibrations: entry === "upsertMemory" ? 0 : 1 });
      expect((await searchMemories(app, target.scope, {}))[0]!.memory_id).toBe(target.memoryId);
    });
    it("COMMIT and rollback failures preserve both causes after one COMMIT and destroy the failed connection", async () => {
      const target = await prepare(entry); const primary = new Error("Synthetic COMMIT failure"); const rollback = new Error("Synthetic rollback failure");
      const fault = inject({ before: sql => { if (sql === "COMMIT") throw primary; if (sql === "ROLLBACK") throw rollback; } });
      const error = await target.call(fault.pool).catch(error => error);
      expect(error.errors).toEqual([primary, rollback]); expect(error.cause).toBe(primary);
      expect(fault.statements.filter(sql => sql === "COMMIT")).toHaveLength(1); expect(fault.releases).toEqual([error]);
      await fault.inspect(true); expect(await target.counts()).toEqual({ memories: 0, calibrations: 0 });
    });
    it("BEGIN failure rejects and discards once without touching business data", async () => {
      const target = await prepare(entry); const primary = new Error("Synthetic BEGIN transport failure");
      const fault = inject({ before: sql => { if (sql === "BEGIN") throw primary; } });
      await expect(target.call(fault.pool)).rejects.toBe(primary); expect(fault.statements).toEqual(["BEGIN", "ROLLBACK"]);
      expect(fault.releases).toEqual([primary]); await fault.inspect(true);
      expect(await target.counts()).toEqual({ memories: 0, calibrations: 0 });
    });
    it("RLS context acknowledgement failure rolls back local settings and releases a clean connection", async () => {
      const target = await prepare(entry); const primary = new Error("Synthetic RLS context acknowledgement failure");
      const fault = inject({ after: sql => { if (sql.includes("set_config('app.tenant_id'")) throw primary; } });
      await expect(target.call(fault.pool)).rejects.toBe(primary); expect(fault.statements.at(-1)).toBe("ROLLBACK");
      expect(fault.statements.some(sql => primaryQuery(entry, sql))).toBe(false); expect(fault.releases).toEqual([undefined]);
      await fault.inspect(false); expect(await target.counts()).toEqual({ memories: 0, calibrations: 0 });
    });
  });
  it("miner statistical gate still commits observations without inventing memories or calibrations", async () => {
    const scope = await workspace(); const fault = inject();
    expect(await runMemoryMinerBeat(fault.pool, gateway, scope)).toMatchObject({ samples: 0, reinforced: 0, editPatterns: 0, calibrateEventIds: [], skipped: expect.stringContaining("统计闸") });
    expect(fault.statements.at(-1)).toBe("COMMIT"); await fault.inspect(false);
  });
  it("miner busy-lock gate retains its normal skip result and releases only its own transaction", async () => {
    const scope = await workspace(); const held = await gateway.connect(); const fault = inject();
    try {
      await held.query("BEGIN"); await held.query("SELECT pg_advisory_xact_lock(761214)");
      expect(await runMemoryMinerBeat(fault.pool, gateway, scope)).toMatchObject({ samples: 0, reinforced: 0, editPatterns: 0, calibrateEventIds: [], skipped: expect.stringContaining("节拍已在进行中") });
      expect(fault.statements.at(-1)).toBe("COMMIT"); expect(fault.releases).toEqual([undefined]);
    } finally { await held.query("ROLLBACK"); held.release(); }
    await fault.inspect(false);
  });
});
