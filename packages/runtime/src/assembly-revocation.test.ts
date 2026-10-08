import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installSkill, resolveAgentFenceBindings, revokeSkill } from "@workloom/base/skills";
import { assemblePreset, AssemblyReject } from "./assembly.js";

const scope = { tenantId: "tenant-transaction", workspaceId: "workspace-transaction" };
const input = { workspaceId: scope.workspaceId, presetKey: "test-controller", goal: "Verify local assembly" };
function clientFixture(faults: { query?: string; commit?: Error; rollback?: Error } = {}) {
  const statements: string[] = [];
  const releases: Array<Error | undefined> = [];
  const queryError = new Error("Injected query failure");
  const client = {
    async query(sql: string) {
      const statement = sql.trim().replace(/\s+/g, " ");
      statements.push(statement);
      if (sql === "COMMIT" && faults.commit) throw faults.commit;
      if (sql === "ROLLBACK" && faults.rollback) throw faults.rollback;
      if (faults.query && statement.includes(faults.query)) throw queryError;
      if (statement.includes("FROM agents")) return { rows: [{ id: "agent-local", preset_key: input.presetKey,
        version: "1.0.0", fence_bindings: ["R-BASE"], meta: {}, status: "ready" }] };
      if (statement.includes("FROM profiles")) return { rows: [{ archive: { store: "local regression" } }] };
      if (statement.includes("FROM workspaces")) return { rows: [{ stage: "ready" }] };
      if (statement.includes("FROM skill_installs")) return { rows: [{ fence_bindings_snapshot: ["R-SKILL"] }] };
      return { rows: [] };
    },
    release(error?: Error) { releases.push(error); },
  };
  return { pool: { connect: async () => client } as unknown as pg.Pool, statements, releases, queryError };
}

describe("Runtime assembly transaction completion", () => {
  it("returns a complete preset only after successful COMMIT", async () => {
    const fixture = clientFixture();
    const result = await assemblePreset(fixture.pool, scope, input);
    expect(result.fenceBindings).toEqual(["R-BASE", "R-SKILL"]);
    expect(fixture.statements.at(-1)).toBe("COMMIT");
    expect(fixture.statements.filter(sql => sql === "COMMIT")).toHaveLength(1);
    expect(fixture.releases).toEqual([undefined]);
  });
  it("COMMIT failure rejects and attempts ROLLBACK before release", async () => {
    const commit = Object.assign(new Error("Injected COMMIT failure"), { code: "ECONNRESET" });
    const fixture = clientFixture({ commit });
    await expect(assemblePreset(fixture.pool, scope, input)).rejects.toBe(commit);
    expect(fixture.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
    expect(fixture.releases).toEqual([undefined]);
  });
  it("query failure rolls back and never attempts COMMIT", async () => {
    const fixture = clientFixture({ query: "FROM profiles" });
    await expect(assemblePreset(fixture.pool, scope, input)).rejects.toBe(fixture.queryError);
    expect(fixture.statements.at(-1)).toBe("ROLLBACK");
    expect(fixture.statements).not.toContain("COMMIT");
    expect(fixture.releases).toEqual([undefined]);
  });
  it("query and rollback failures retain both causes and discard the failed connection", async () => {
    const rollback = new Error("Injected ROLLBACK failure");
    const fixture = clientFixture({ query: "FROM profiles", rollback });
    const error = await assemblePreset(fixture.pool, scope, input).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([fixture.queryError, rollback]);
    expect(error.cause).toBe(fixture.queryError);
    expect(fixture.statements).not.toContain("COMMIT");
    expect(fixture.releases).toEqual([rollback]);
  });
  it("COMMIT and rollback failures retain both causes without a second COMMIT", async () => {
    const commit = new Error("Injected COMMIT failure");
    const rollback = new Error("Injected ROLLBACK failure");
    const fixture = clientFixture({ commit, rollback });
    const error = await assemblePreset(fixture.pool, scope, input).catch(error => error);
    expect(error.errors).toEqual([commit, rollback]);
    expect(error.cause).toBe(commit);
    expect(fixture.statements.filter(sql => sql === "COMMIT")).toHaveLength(1);
    expect(fixture.releases).toEqual([rollback]);
  });
  it("missing essentials still reject and end through ROLLBACK", async () => {
    const fixture = clientFixture();
    await expect(assemblePreset(fixture.pool, scope, { ...input, goal: "" })).rejects.toBeInstanceOf(AssemblyReject);
    expect(fixture.statements.at(-1)).toBe("ROLLBACK");
    expect(fixture.statements).not.toContain("COMMIT");
  });
  it("pool connection failure propagates before any query", async () => {
    const error = new Error("Injected connection failure");
    const pool = { connect: async () => { throw error; } } as unknown as pg.Pool;
    await expect(assemblePreset(pool, scope, input)).rejects.toBe(error);
  });
});

const adminUrl = process.env.BMS_PG_TEST_URL;
describe.runIf(Boolean(adminUrl))("Runtime revocation on disposable PostgreSQL", () => {
  const database = `bms_runtime_${randomUUID().replaceAll("-", "")}`;
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
    try {
      await client.query("BEGIN");
      const migrations = new URL("../../db/migrations/", import.meta.url).pathname;
      for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
        await client.query(readFileSync(join(migrations, file), "utf8"));
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
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
  async function workspaceFixture() {
    const suffix = randomUUID();
    const target = { tenantId: `tenant-${suffix}`, workspaceId: `workspace-${suffix}` };
    const agentId = `agent-${suffix}`;
    await owner.query("INSERT INTO tenants(id,name) VALUES($1,'runtime regression')", [target.tenantId]);
    await owner.query("INSERT INTO workspaces(id,tenant_id,name,slug,industry,stage) VALUES($1,$2,'runtime regression',$1,'regression','ready')", [target.workspaceId, target.tenantId]);
    await owner.query("INSERT INTO profiles(workspace_id,tenant_id,industry,archive,forbidden) VALUES($1,$2,'regression','{\"store\":\"local regression\"}','[]')", [target.workspaceId, target.tenantId]);
    await owner.query("INSERT INTO agents(id,workspace_id,preset_key,name,version,kind,readonly,fence_bindings,skills,status,meta) VALUES($1,$2,'test-controller','test controller','1.0.0','regression',false,'[\"R-BASE\"]','[]','ready','{}')", [agentId, target.workspaceId]);
    return { ...target, agentId };
  }
  async function installedFixture(target: { workspaceId: string }, rules: string[]) {
    const skillId = `skill-${randomUUID()}`;
    await owner.query("INSERT INTO skills(id,level,name,version,fence_bindings,body,desensitized) VALUES($1,'official',$1,'1.0.0',$2,'local regression',true)", [skillId, JSON.stringify(rules)]);
    await owner.query("INSERT INTO skill_installs(skill_id,workspace_id,installed_by,fence_bindings_snapshot,installed_version) VALUES($1,$2,'test-owner',$3,'1.0.0')", [skillId, target.workspaceId, JSON.stringify(rules)]);
    return skillId;
  }
  async function assembled(target: { tenantId: string; workspaceId: string }) {
    return assemblePreset(app, target, { workspaceId: target.workspaceId, presetKey: "test-controller", goal: "Verify local runtime" });
  }
  it("non-revoked installed skill snapshots remain in the actual app-role assembly", async () => {
    const target = await workspaceFixture();
    await installedFixture(target, ["R-SKILL"]);
    expect((await assembled(target)).fenceBindings).toEqual(["R-BASE", "R-SKILL"]);
  });
  it("owner revocation removes only the revoked snapshot while retaining preset and live control bindings", async () => {
    const target = await workspaceFixture();
    const revoked = await installedFixture(target, ["R-BASE", "R-REVOKED"]);
    await installedFixture(target, ["R-CONTROL"]);
    expect((await assembled(target)).fenceBindings).toEqual(["R-BASE", "R-CONTROL", "R-REVOKED"]);
    expect(await revokeSkill(owner, app, target, { skillId: revoked, reason: "Local regression", by: "test-owner" })).toEqual({ deduped: false });
    expect((await owner.query("SELECT count(*)::int AS n FROM skill_installs WHERE skill_id=$1", [revoked])).rows[0].n).toBe(1);
    const result = await assembled(target);
    expect(result.fenceBindings).toEqual(["R-BASE", "R-CONTROL"]);
    expect(await resolveAgentFenceBindings(app, target, target.agentId)).toEqual(result.fenceBindings);
    await expect(installSkill(app, app, target, { skillId: revoked, by: "test-owner" })).rejects.toMatchObject({ code: "SKILL_REVOKED" });
  });
  it("one tenant workspace never imports another workspace's installed or revoked bindings", async () => {
    const target = await workspaceFixture();
    const other = await workspaceFixture();
    await installedFixture(target, ["R-LOCAL"]);
    const otherSkill = await installedFixture(other, ["R-OTHER"]);
    expect((await assembled(target)).fenceBindings).toEqual(["R-BASE", "R-LOCAL"]);
    expect((await assembled(other)).fenceBindings).toEqual(["R-BASE", "R-OTHER"]);
    await revokeSkill(owner, app, other, { skillId: otherSkill, reason: "Other workspace regression", by: "test-owner" });
    expect((await assembled(target)).fenceBindings).toEqual(["R-BASE", "R-LOCAL"]);
    expect((await assembled(other)).fenceBindings).toEqual(["R-BASE"]);
  });
  it("injected COMMIT failure on a real app connection rejects after rollback", async () => {
    const target = await workspaceFixture();
    const error = Object.assign(new Error("Injected pre-COMMIT transport failure"), { code: "ECONNRESET" });
    const statements: string[] = [];
    const failing = { connect: async () => {
      const client = await app.connect();
      return { query: (sql: string, params?: unknown[]) => {
        statements.push(sql);
        if (sql === "COMMIT") throw error;
        return client.query(sql, params);
      }, release: (reason?: Error) => client.release(reason) };
    } } as unknown as pg.Pool;
    await expect(assemblePreset(failing, target, { workspaceId: target.workspaceId, presetKey: "test-controller", goal: "Verify commit" })).rejects.toBe(error);
    expect(statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
    expect((await assembled(target)).fenceBindings).toEqual(["R-BASE"]);
  });
});
