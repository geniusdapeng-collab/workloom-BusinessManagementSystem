import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateBundle, computeAssembly, loadVerifiedBundleWorkforcePresets, readVerifiedBundleJsonAsset,
} from "./assembly.js";
import { getFeedbackEnums } from "../evolve/feedback-enums.js";
import { eventHash } from "../workdata/events.js";

const sourceRoot = new URL("../../../bundles/", import.meta.url).pathname;
const roots: string[] = [];
function fixtureRoot(draft = false): string {
  const root = mkdtempSync(join(tmpdir(), "bms-assembly-safety-"));
  roots.push(root);
  cpSync(join(sourceRoot, "smart-home"), join(root, "smart-home"), { recursive: true });
  if (draft) {
    const path = join(root, "smart-home", "bundle.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.workloom.status = "draft";
    delete manifest.integrity;
    writeFileSync(path, JSON.stringify(manifest));
  }
  return root;
}
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function clientFixture(root: string, faults: { commitAt?: number; query?: string; rollback?: Error; afterCommit?: (count: number) => void } = {}) {
  const presets = loadVerifiedBundleWorkforcePresets("smart-home", root);
  const statements: string[] = [];
  const releaseErrors: Array<Error | undefined> = [];
  const primaryError = Object.assign(new Error("Injected transaction failure"), { code: "ECONNRESET" });
  let commits = 0;
  const client = {
    async query(sql: string) {
      const statement = sql.trim().replace(/\s+/g, " ");
      statements.push(statement);
      if (statement === "COMMIT") {
        commits++;
        if (commits === faults.commitAt) throw primaryError;
        faults.afterCommit?.(commits);
      }
      if (statement === "ROLLBACK" && faults.rollback) throw faults.rollback;
      if (faults.query && statement.includes(faults.query)) throw primaryError;
      if (statement.includes("SELECT industry, stage FROM workspaces")) return { rows: [{ industry: "prior-industry", stage: "store-onboarding" }] };
      if (statement.includes("FROM agents WHERE workspace_id")) return { rows: presets.map(preset => ({ id: `test-${preset.preset_key}`, ...preset, status: "ready" })) };
      if (statement.includes("SELECT DISTINCT rule_id FROM fence_rules")) return { rows: [...new Set(presets.flatMap(preset => preset.fence_bindings))].map(rule_id => ({ rule_id })) };
      if (statement.includes("SELECT industry FROM workspaces")) return { rows: [{ industry: "prior-industry" }] };
      if (statement.includes("nextval('biz_events_eid_seq')")) return { rows: [{ v: "1" }] };
      if (statement.includes("SELECT * FROM append_event_insert")) return { rows: [{ seq: "1", inserted: true }] };
      return { rows: [], rowCount: 1 };
    },
    release(error?: Error) { releaseErrors.push(error); },
  };
  return { pool: { connect: async () => client } as unknown as pg.Pool, statements, releaseErrors, primaryError };
}
const scope = () => ({ tenantId: "test-tenant", workspaceId: `test-${randomUUID()}` });

describe("Verified assets and assembly transaction boundaries", () => {
  it("reads declared JSON after manifest and asset verification", () => {
    const root = fixtureRoot();
    const asset = readVerifiedBundleJsonAsset("smart-home", "library/workforce.json", root) as { roles: unknown[] };
    const declared = JSON.parse(readFileSync(join(sourceRoot, "smart-home", "library", "workforce.json"), "utf8")) as { roles: unknown[] };
    expect(asset.roles).toEqual(declared.roles);
  });
  it.each([false, true])("rejects an adjacent undeclared JSON file in candidate/draft mode %s", draft => {
    const root = fixtureRoot(draft);
    writeFileSync(join(root, "smart-home", "unsigned.json"), JSON.stringify({ injected: true }));
    expect(() => readVerifiedBundleJsonAsset("smart-home", "unsigned.json", root)).toThrow(/未声明资产/);
  });
  it.each(["../outside.json", "/tmp/outside.json", "library/../workforce.json"])("rejects invalid asset path %s", path => {
    expect(() => readVerifiedBundleJsonAsset("smart-home", path, fixtureRoot())).toThrow(/路径/);
  });
  it("computeAssembly propagates COMMIT failure and rolls back before release", async () => {
    const root = fixtureRoot(); const fixture = clientFixture(root, { commitAt: 1 });
    await expect(computeAssembly(fixture.pool, scope(), "smart-home", root)).rejects.toBe(fixture.primaryError);
    expect(fixture.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
    expect(fixture.releaseErrors).toEqual([undefined]);
  });
  it("query failure rolls back once without subsequently attempting COMMIT", async () => {
    const root = fixtureRoot(); const fixture = clientFixture(root, { query: "tenant_overlays" });
    await expect(computeAssembly(fixture.pool, scope(), "smart-home", root)).rejects.toBe(fixture.primaryError);
    expect(fixture.statements.at(-1)).toBe("ROLLBACK");
    expect(fixture.statements).not.toContain("COMMIT");
    expect(fixture.releaseErrors).toEqual([undefined]);
  });
  it("computeAssembly retains both failure causes and discards a connection whose rollback fails", async () => {
    const root = fixtureRoot(); const rollback = new Error("Injected rollback failure");
    const fixture = clientFixture(root, { commitAt: 1, rollback });
    const error = await computeAssembly(fixture.pool, scope(), "smart-home", root).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([fixture.primaryError, rollback]);
    expect(error.cause).toBe(fixture.primaryError);
    expect(fixture.releaseErrors).toEqual([rollback]);
  });
  it("successful computeAssembly returns only after COMMIT", async () => {
    const root = fixtureRoot(); const fixture = clientFixture(root);
    const profile = await computeAssembly(fixture.pool, scope(), "smart-home", root);
    expect(profile.canActivate).toBe(true);
    expect(fixture.statements.at(-1)).toBe("COMMIT");
    expect(fixture.releaseErrors).toEqual([undefined]);
  });
  it("activation COMMIT failure rejects and never registers post-commit feedback state", async () => {
    const root = fixtureRoot(); const fixture = clientFixture(root, { commitAt: 2 }); const target = scope();
    await expect(activateBundle(fixture.pool, fixture.pool, target, "smart-home", "test-owner", root)).rejects.toBe(fixture.primaryError);
    expect(fixture.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
    expect(fixture.releaseErrors).toEqual([undefined, undefined]);
    expect(getFeedbackEnums(target.workspaceId)).toBeUndefined();
  });
  it("activation update failure rolls back without a second COMMIT", async () => {
    const root = fixtureRoot(); const fixture = clientFixture(root, { query: "UPDATE workspaces SET industry" });
    await expect(activateBundle(fixture.pool, fixture.pool, scope(), "smart-home", "test-owner", root)).rejects.toBe(fixture.primaryError);
    expect(fixture.statements.filter(sql => sql === "COMMIT")).toHaveLength(1);
    expect(fixture.statements.at(-1)).toBe("ROLLBACK");
  });
  it("activation retains COMMIT and rollback failures and discards the failed connection", async () => {
    const root = fixtureRoot(); const rollback = new Error("Injected rollback failure");
    const fixture = clientFixture(root, { commitAt: 2, rollback });
    const error = await activateBundle(fixture.pool, fixture.pool, scope(), "smart-home", "test-owner", root).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([fixture.primaryError, rollback]);
    expect(fixture.releaseErrors).toEqual([undefined, rollback]);
  });
  it("a lost draft manifest triggers compensating transaction and reports activation failure", async () => {
    const root = fixtureRoot(true);
    const fixture = clientFixture(root, { afterCommit: count => { if (count === 2) rmSync(join(root, "smart-home", "bundle.json")); } });
    await expect(activateBundle(fixture.pool, fixture.pool, scope(), "smart-home", "test-owner", root)).rejects.toThrow(/DB 激活已补偿回滚/);
    expect(fixture.statements.filter(sql => sql === "COMMIT")).toHaveLength(3);
    expect(fixture.releaseErrors).toEqual([undefined, undefined, undefined]);
  });
  it("failed compensation is exposed and never described as successful rollback", async () => {
    const root = fixtureRoot(true);
    const fixture = clientFixture(root, { commitAt: 3, afterCommit: count => { if (count === 2) rmSync(join(root, "smart-home", "bundle.json")); } });
    const error = await activateBundle(fixture.pool, fixture.pool, scope(), "smart-home", "test-owner", root).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toMatch(/DB 补偿均失败/);
    expect(error.errors[1]).toBe(fixture.primaryError);
    expect(fixture.statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
    expect(fixture.releaseErrors).toEqual([undefined, undefined, undefined]);
  });
});

const adminUrl = process.env.BMS_PG_TEST_URL;
describe.runIf(Boolean(adminUrl))("Assembly transactions on disposable PostgreSQL", () => {
  const database = `bms_assembly_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Client, owner: pg.Pool, app: pg.Pool;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Disposable integration tests require a loopback PostgreSQL instance");
    admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    url.pathname = `/${database}`;
    owner = new pg.Pool({ connectionString: url.href });
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      const migrations = new URL("../../db/migrations/", import.meta.url).pathname;
      for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) await client.query(readFileSync(join(migrations, file), "utf8"));
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
    const target = { tenantId: `tenant-${randomUUID()}`, workspaceId: `workspace-${randomUUID()}` };
    await owner.query("INSERT INTO tenants(id,name) VALUES($1,'transaction regression')", [target.tenantId]);
    await owner.query("INSERT INTO workspaces(id,tenant_id,name,slug,industry,stage) VALUES($1,$2,'transaction regression',$1,'prior-industry','store-onboarding')", [target.workspaceId, target.tenantId]);
    await owner.query("INSERT INTO profiles(workspace_id,tenant_id,industry,archive,forbidden) VALUES($1,$2,'prior-industry',$3,'[]')", [target.workspaceId, target.tenantId, JSON.stringify({ property: {}, business: {}, forbidden: [{ rule: "test" }], goals: {} })]);
    const presets = loadVerifiedBundleWorkforcePresets("smart-home", sourceRoot);
    for (const preset of presets) await owner.query("INSERT INTO agents(id,workspace_id,preset_key,name,version,kind,readonly,fence_bindings,skills,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready')", [`${target.workspaceId}-${preset.preset_key}`, target.workspaceId, preset.preset_key, preset.name, preset.version, preset.kind, preset.readonly, JSON.stringify(preset.fence_bindings), JSON.stringify(preset.skills)]);
    for (const rule of new Set(presets.flatMap(preset => preset.fence_bindings))) await owner.query("INSERT INTO fence_rules(id,rule_id,version,workspace_id,name,level,match_spec,action,is_baseline,status,created_by) VALUES($1,$2,'test',$3,'transaction regression','review','{}','{}',false,'active','test-owner')", [`${target.workspaceId}-${rule}`, rule, target.workspaceId]);
    return target;
  }
  function failingCommitPool(at: number) {
    let count = 0;
    const error = Object.assign(new Error("Injected pre-COMMIT connection failure"), { code: "ECONNRESET" });
    const pool = { connect: async () => {
      const client = await app.connect();
      return { query: (sql: string, params?: unknown[]) => { if (sql === "COMMIT" && ++count === at) throw error; return client.query(sql, params); }, release: (reason?: Error) => client.release(reason) };
    } } as unknown as pg.Pool;
    return { pool, error };
  }
  it("computeAssembly propagates an injected commit failure on a real app connection", async () => {
    const target = await workspaceFixture(); const fixture = failingCommitPool(1);
    await expect(computeAssembly(fixture.pool, target, "smart-home", sourceRoot)).rejects.toBe(fixture.error);
    expect((await owner.query("SELECT industry FROM workspaces WHERE id=$1", [target.workspaceId])).rows[0].industry).toBe("prior-industry");
  });
  it("activation commit failure rolls back both actual workspace state and event insert", async () => {
    const target = await workspaceFixture(); const fixture = failingCommitPool(2);
    await expect(activateBundle(fixture.pool, app, target, "smart-home", "test-owner", sourceRoot)).rejects.toBe(fixture.error);
    expect((await owner.query("SELECT industry FROM workspaces WHERE id=$1", [target.workspaceId])).rows[0].industry).toBe("prior-industry");
    expect((await owner.query("SELECT count(*)::int AS n FROM biz_events WHERE workspace_id=$1", [target.workspaceId])).rows[0].n).toBe(0);
  });
  it("successful activation commits actual workspace state and one recomputable audit event", async () => {
    const target = await workspaceFixture();
    const result = await activateBundle(app, app, target, "smart-home", "test-owner", sourceRoot);
    expect(result.profile.status).toBe("active");
    expect((await owner.query("SELECT industry FROM workspaces WHERE id=$1", [target.workspaceId])).rows[0].industry).toBe("smart-home");
    const rows = (await owner.query("SELECT payload,prev_hash,hash FROM biz_events WHERE workspace_id=$1", [target.workspaceId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.event_id).toBe(result.eventId);
    expect(rows[0].payload.decision.action).toBe("bundle.activate");
    expect(rows[0].hash).toBe(eventHash(rows[0].prev_hash, rows[0].payload));
  });
});
