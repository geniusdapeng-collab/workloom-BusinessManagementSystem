import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gatewayAppend } from "@workloom/base/workdata";
import { installSkill, uninstallSkill, listInstalls, resolveAgentFenceBindings } from "@workloom/base/skills";
import { runQuest, type QuestPlanner, type QuestStep } from "./loop.js";

const adminUrl = process.env.BMS_PG_TEST_URL;
describe.runIf(Boolean(adminUrl))("Quest and skill registry transaction safety on disposable PostgreSQL", () => {
  const database = `bms_transaction_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Client, owner: pg.Pool, app: pg.Pool;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Disposable tests require loopback PostgreSQL");
    admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    url.pathname = `/${database}`;
    owner = new pg.Pool({ connectionString: url.href });
    const client = await owner.connect();
    let releaseError: Error | undefined;
    try {
      await client.query("BEGIN");
      const migrations = new URL("../../db/migrations/", import.meta.url).pathname;
      for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
        await client.query(readFileSync(join(migrations, file), "utf8"));
      }
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)); throw new AggregateError([error, rollbackError], "Test database migration and rollback failed", { cause: error }); }
      throw error;
    } finally { client.release(releaseError); }
    url.username = "workloom_app"; url.password = process.env.APP_DB_PASSWORD ?? "workloom_dev_app";
    app = new pg.Pool({ connectionString: url.href });
  }, 30000);
  afterAll(async () => {
    const closed = await Promise.allSettled([app?.end(), owner?.end()]);
    const errors = closed.filter(result => result.status === "rejected");
    if (admin) {
      try { await admin.query(`DROP DATABASE IF EXISTS ${database}`); }
      finally { await admin.end(); }
    }
    expect(errors).toEqual([]);
  });
  const readStep: QuestStep = { stepId: "s1", action: "audit.read", objectType: "audit", tool: "audit.read", params: { local: true }, label: "Read local regression" };
  const planner: QuestPlanner = () => [readStep];
  async function workspaceFixture() {
    const suffix = randomUUID();
    const target = { tenantId: `tenant-${suffix}`, workspaceId: `workspace-${suffix}`, agentId: `agent-${suffix}`, threadId: `thread-${suffix}` };
    await owner.query("INSERT INTO tenants(id,name) VALUES($1,'transaction regression')", [target.tenantId]);
    await owner.query("INSERT INTO workspaces(id,tenant_id,name,slug,industry,stage) VALUES($1,$2,'transaction regression',$1,'regression','ready')", [target.workspaceId, target.tenantId]);
    await owner.query("INSERT INTO profiles(workspace_id,tenant_id,industry,archive,forbidden) VALUES($1,$2,'regression',$3,'[]')", [target.workspaceId, target.tenantId, JSON.stringify({ store: "local transaction regression", dataMode: "simulated" })]);
    await owner.query("INSERT INTO agents(id,workspace_id,preset_key,name,version,kind,readonly,fence_bindings,skills,status,meta) VALUES($1,$2,'test-controller','test controller','1.0.0','regression',false,'[]','[]','ready',$3)", [target.agentId, target.workspaceId, JSON.stringify({ tools: [{ name: "audit.read", access: "read", desc: "Read local regression" }] })]);
    await owner.query("INSERT INTO threads(id,tenant_id,workspace_id,title,mode,status,created_by) VALUES($1,$2,$3,'Local regression','quest','queued','local-owner')", [target.threadId, target.tenantId, target.workspaceId]);
    return target;
  }
  async function skillFixture(target: { workspaceId: string }, opts: { team?: boolean; bindings?: string[] } = {}) {
    const skillId = `${opts.team ? `skill-t-${target.workspaceId}-` : "skill-"}${randomUUID()}`;
    await owner.query("INSERT INTO skills(id,level,name,version,fence_bindings,body,desensitized) VALUES($1,$2,$1,'1.0.0',$3,'local regression',true)", [skillId, opts.team ? "team" : "official", JSON.stringify(opts.bindings ?? [])]);
    return skillId;
  }
  async function counts(target: { workspaceId: string }) {
    const result = await owner.query("SELECT (SELECT count(*)::int FROM skill_installs WHERE workspace_id=$1) AS installs,(SELECT count(*)::int FROM biz_events WHERE workspace_id=$1) AS events,(SELECT count(*)::int FROM approvals WHERE workspace_id=$1) AS approvals", [target.workspaceId]);
    return result.rows[0] as { installs: number; events: number; approvals: number };
  }
  function faultPool(target: RegExp, faults: { commit?: Error; query?: Error; rollback?: Error } = {}) {
    const statements: string[] = [], releases: Array<Error | undefined> = [];
    let triggered = 0;
    const pool = {
      query: app.query.bind(app),
      connect: async () => {
        const real = await app.connect();
        let armed = false;
        return {
          async query(sql: string, params?: unknown[]) {
            const statement = sql.trim().replace(/\s+/g, " ");
            statements.push(statement);
            if (target.test(statement)) { armed = true; if (faults.query) { triggered++; throw faults.query; } }
            if (armed && sql === "COMMIT" && faults.commit) { triggered++; throw faults.commit; }
            if (armed && sql === "ROLLBACK" && faults.rollback) throw faults.rollback;
            return real.query(sql, params);
          },
          release(error?: Error) { releases.push(error); real.release(error); },
        };
      },
    } as unknown as pg.Pool;
    return { pool, statements, releases, triggered: () => triggered };
  }
  async function quest(target: { tenantId: string; workspaceId: string; threadId: string }, appPool: pg.Pool = app, gatewayPool: pg.Pool = app, extra: Partial<Parameters<typeof runQuest>[3]> = {}) {
    return runQuest(appPool, gatewayPool, target, { threadId: target.threadId, presetKey: "test-controller", goal: "Read local regression", fallbackPlanner: planner, ...extra });
  }
  async function thread(target: { threadId: string }) {
    return (await owner.query("SELECT status,progress_done,plan_version FROM threads WHERE id=$1", [target.threadId])).rows[0];
  }
  const commitError = () => Object.assign(new Error("Injected asynchronous pre-COMMIT transport failure"), { code: "ECONNRESET" });
  it("normal install/uninstall returns only with durable row and matching events", async () => {
    const target = await workspaceFixture(); const skillId = await skillFixture(target);
    expect(await installSkill(app, app, target, { skillId, by: "local-owner" })).toEqual({ installed: true, deduped: false, bindings: [] });
    expect(await counts(target)).toEqual({ installs: 1, events: 1, approvals: 0 });
    expect((await listInstalls(app, target)).map(row => row.skill_id)).toEqual([skillId]);
    expect(await resolveAgentFenceBindings(app, target, target.agentId)).toEqual([]);
    expect(await uninstallSkill(app, app, target, { skillId, by: "local-owner" })).toEqual({ uninstalled: true, revokedBindings: [] });
    expect(await counts(target)).toEqual({ installs: 0, events: 2, approvals: 0 });
  });
  it("listInstalls rejects COMMIT failure and completes rollback before release", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/FROM skill_installs WHERE workspace_id/, { commit: error });
    await expect(listInstalls(fault.pool, target)).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect(fault.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]); expect(fault.releases).toEqual([undefined]);
  });
  it("binding resolution rejects COMMIT failure instead of returning uncommitted scope data", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/FROM skill_installs i/, { commit: error });
    await expect(resolveAgentFenceBindings(fault.pool, target, target.agentId)).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect(fault.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
  });
  it("install COMMIT failure cannot claim installed or persist either installation or its event", async () => {
    const target = await workspaceFixture(); const skillId = await skillFixture(target); const error = commitError(); const fault = faultPool(/INSERT INTO skill_installs/, { commit: error });
    await expect(installSkill(fault.pool, app, target, { skillId, by: "local-owner" })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect(await counts(target)).toEqual({ installs: 0, events: 0, approvals: 0 }); expect(fault.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
  });
  it("active-rule preflight COMMIT failure aborts installation before its row or event", async () => {
    const target = await workspaceFixture(); const skillId = await skillFixture(target, { bindings: ["R-LOCAL"] }); const error = commitError(); const fault = faultPool(/SELECT DISTINCT rule_id/, { commit: error });
    await expect(installSkill(fault.pool, app, target, { skillId, by: "local-owner" })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect(await counts(target)).toEqual({ installs: 0, events: 0, approvals: 0 });
  });
  it("team dry-run preflight COMMIT failure propagates despite a valid dry-run trace", async () => {
    const target = await workspaceFixture(); const skillId = await skillFixture(target, { team: true });
    await gatewayAppend(app, { ...target, actor: { id: "local-owner", type: "human" } }, { who: { type: "human", id: "local-owner" }, context: { tenant_id: target.tenantId, workspace_id: target.workspaceId, time: new Date().toISOString() }, object: { type: "skill", id: skillId }, decision: { action: "skill.dry_run", after: { skillId } }, rule_impact: [] });
    const error = commitError(); const fault = faultPool(/count\(\*\) AS c FROM biz_events/, { commit: error });
    await expect(installSkill(fault.pool, app, target, { skillId, by: "local-owner" })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect(await counts(target)).toEqual({ installs: 0, events: 1, approvals: 0 });
  });
  it("conflict approval COMMIT failure rolls back both the conflict event and pending approval", async () => {
    const target = await workspaceFixture(); const skillId = await skillFixture(target, { bindings: ["R-MISSING"] }); const error = commitError(); const fault = faultPool(/INSERT INTO approvals/, { commit: error });
    await expect(installSkill(fault.pool, app, target, { skillId, by: "local-owner" })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect(await counts(target)).toEqual({ installs: 0, events: 0, approvals: 0 });
  });
  it("uninstall COMMIT failure retains installed state and does not leave an uninstall event", async () => {
    const target = await workspaceFixture(); const skillId = await skillFixture(target);
    await installSkill(app, app, target, { skillId, by: "local-owner" }); const error = commitError(); const fault = faultPool(/DELETE FROM skill_installs/, { commit: error });
    await expect(uninstallSkill(fault.pool, app, target, { skillId, by: "local-owner" })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect(await counts(target)).toEqual({ installs: 1, events: 1, approvals: 0 });
  });
  it("install query failure rolls back without any COMMIT", async () => {
    const target = await workspaceFixture(); const skillId = await skillFixture(target); const error = new Error("Injected SQL failure"); const fault = faultPool(/INSERT INTO skill_installs/, { query: error });
    await expect(installSkill(fault.pool, app, target, { skillId, by: "local-owner" })).rejects.toBe(error);
    expect(fault.statements.at(-1)).toBe("ROLLBACK"); expect(fault.statements).not.toContain("COMMIT"); expect(await counts(target)).toEqual({ installs: 0, events: 0, approvals: 0 });
  });
  it("registry COMMIT and ROLLBACK failures retain both causes and discard the connection", async () => {
    const target = await workspaceFixture(); const skillId = await skillFixture(target); const commit = commitError(); const rollback = new Error("Injected rollback failure"); const fault = faultPool(/INSERT INTO skill_installs/, { commit, rollback });
    const error = await installSkill(fault.pool, app, target, { skillId, by: "local-owner" }).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([commit, rollback]); expect(error.cause).toBe(commit); expect(fault.releases).toEqual([rollback]); expect(fault.statements.filter(sql => sql === "COMMIT")).toHaveLength(1);
  });
  it("registry SQL and ROLLBACK failures preserve the SQL cause and never attempt COMMIT", async () => {
    const target = await workspaceFixture(); const error = new Error("Injected binding SQL failure"); const rollback = new Error("Injected rollback failure"); const fault = faultPool(/FROM agents/, { query: error, rollback });
    const caught = await resolveAgentFenceBindings(fault.pool, target, target.agentId).catch(error => error);
    expect(caught.errors).toEqual([error, rollback]); expect(caught.cause).toBe(error); expect(fault.releases).toEqual([rollback]); expect(fault.statements).not.toContain("COMMIT");
  });
  it("failed scoped read cannot leak transaction state into the next workspace read", async () => {
    const target = await workspaceFixture(); const other = await workspaceFixture(); const skillId = await skillFixture(target);
    await installSkill(app, app, target, { skillId, by: "local-owner" }); const fault = faultPool(/FROM skill_installs WHERE workspace_id/, { commit: commitError() });
    await expect(listInstalls(fault.pool, target)).rejects.toThrow("pre-COMMIT"); expect(await listInstalls(app, other)).toEqual([]); expect((await listInstalls(app, target)).map(row => row.skill_id)).toEqual([skillId]);
  });
  it("normal public Quest completes one verified local step with durable event and thread", async () => {
    const target = await workspaceFixture(); const result = await quest(target);
    expect(result.status).toBe("completed"); expect(result.stepsDone).toBe(1); expect((await thread(target)).status).toBe("completed"); expect((await counts(target)).events).toBe(1);
  });
  it("Quest rule-read COMMIT failure stops before planning, execution or completion", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/FROM fence_rules WHERE/, { commit: error }); let toolCalled = false;
    await expect(quest(target, fault.pool, app, { toolExecutor: async () => { toolCalled = true; throw new Error("Must not execute"); } })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect(toolCalled).toBe(false); expect((await thread(target)).status).toBe("queued"); expect(await counts(target)).toEqual({ installs: 0, events: 0, approvals: 0 }); expect(fault.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
  });
  it("Quest receipt-read COMMIT failure stops before tool execution or completion", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/SELECT payload FROM biz_events/, { commit: error }); let toolCalled = false;
    await expect(quest(target, app, fault.pool, { toolExecutor: async () => { toolCalled = true; throw new Error("Must not execute"); } })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect(toolCalled).toBe(false); expect((await thread(target)).status).toBe("queued"); expect((await counts(target)).events).toBe(0); expect(fault.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
  });
  it("Quest saved-plan COMMIT failure retains no new plan and never starts a tool", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/UPDATE threads SET plan=/, { commit: error }); let toolCalled = false;
    await expect(quest(target, fault.pool, app, { toolExecutor: async () => { toolCalled = true; throw new Error("Must not execute"); } })).rejects.toBe(error);
    expect(toolCalled).toBe(false); expect((await thread(target)).plan_version).toBe(0); expect((await counts(target)).events).toBe(0);
  });
  it("Quest saved-plan read COMMIT failure stops without a new plan or tool execution", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/SELECT plan, plan_version FROM threads/, { commit: error });
    await expect(quest(target, fault.pool)).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect((await thread(target)).status).toBe("queued"); expect((await thread(target)).plan_version).toBe(0); expect((await counts(target)).events).toBe(0);
  });
  it("Quest approved-step read COMMIT failure cannot progress into execution", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/SELECT e.payload->'decision'->>'step_id'/, { commit: error });
    await expect(quest(target, fault.pool)).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect((await thread(target)).status).toBe("queued"); expect((await counts(target)).events).toBe(0);
  });
  it("Quest pending-approval read COMMIT failure does not create a replacement approval", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/SELECT a.approval_id FROM approvals/, { commit: error });
    await expect(quest(target, fault.pool, app, { mode: "agent" })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect((await thread(target)).status).toBe("running"); expect(await counts(target)).toEqual({ installs: 0, events: 0, approvals: 0 });
  });
  it("Quest running-state COMMIT failure leaves the thread queued and starts no tool", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/UPDATE threads SET updated_at = now\(\), status =/, { commit: error });
    await expect(quest(target, fault.pool)).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect((await thread(target)).status).toBe("queued"); expect((await counts(target)).events).toBe(0);
  });
  it("Quest review transaction COMMIT failure rolls back its event, approval and pending state", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/INSERT INTO approvals/, { commit: error });
    await expect(quest(target, fault.pool, app, { mode: "agent" })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect((await thread(target)).status).toBe("running"); expect(await counts(target)).toEqual({ installs: 0, events: 0, approvals: 0 });
  });
  it("failed explicit replan preserves its old plan and pending approval without a superseded event", async () => {
    const target = await workspaceFixture(); const first = await quest(target, app, app, { mode: "agent" });
    expect(first.status).toBe("pending_review"); expect(first.pendingApprovalId).toBeDefined();
    const error = commitError(); const fault = faultPool(/UPDATE threads SET plan=/, { commit: error });
    await expect(quest(target, fault.pool, app, { mode: "agent", replan: true })).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect((await thread(target)).plan_version).toBe(1); expect((await thread(target)).status).toBe("pending_review"); expect(await counts(target)).toEqual({ installs: 0, events: 1, approvals: 1 });
    expect((await owner.query("SELECT status FROM approvals WHERE approval_id=$1", [first.pendingApprovalId])).rows[0].status).toBe("pending");
  });
  it("Quest execution transaction COMMIT failure rolls back its event and progress", async () => {
    const target = await workspaceFixture(); const error = commitError(); const fault = faultPool(/append_event_insert/, { commit: error });
    await expect(quest(target, fault.pool)).rejects.toBe(error);
    expect(fault.triggered()).toBe(1); expect((await thread(target)).status).toBe("running"); expect((await thread(target)).progress_done).toBe(0); expect((await counts(target)).events).toBe(0); expect(fault.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
  });
  it("Quest rule COMMIT and ROLLBACK failures retain both causes and discard the connection", async () => {
    const target = await workspaceFixture(); const commit = commitError(); const rollback = new Error("Injected rollback failure"); const fault = faultPool(/FROM fence_rules WHERE/, { commit, rollback });
    const error = await quest(target, fault.pool).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([commit, rollback]); expect(error.cause).toBe(commit); expect(fault.releases.at(-1)).toBe(rollback); expect((await thread(target)).status).toBe("queued");
  });
  it("Quest SQL and ROLLBACK failures preserve the first cause and never commit the failed read", async () => {
    const target = await workspaceFixture(); const error = new Error("Injected rules SQL failure"); const rollback = new Error("Injected rollback failure"); const fault = faultPool(/FROM fence_rules WHERE/, { query: error, rollback });
    const caught = await quest(target, fault.pool).catch(error => error);
    expect(caught.errors).toEqual([error, rollback]); expect(caught.cause).toBe(error); expect(fault.releases.at(-1)).toBe(rollback); expect(fault.statements.slice(-1)).toEqual(["ROLLBACK"]); expect((await thread(target)).status).toBe("queued");
  });
  it("public registry and Quest propagate connection acquisition failures", async () => {
    const target = await workspaceFixture(); const error = new Error("Injected connection acquisition failure"); const pool = { connect: async () => { throw error; } } as unknown as pg.Pool;
    await expect(listInstalls(pool, target)).rejects.toBe(error); await expect(quest(target, pool)).rejects.toBe(error);
  });
});
